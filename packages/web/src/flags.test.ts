import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { flagOn, variantOf } from './bucket.ts'
import { makeFlags } from './flags.ts'

// The flags module against a stand-in core bridge and network.

const EXP = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const KEY = 'pk_test_abcdefghijklmnopqrstuvwx'
const ENDPOINT = 'https://ingest.example/v1/batch'

type Sent = [string, Record<string, unknown>]
function fakeCore(o: { state?: string; cookies?: boolean; anon?: string; key?: string } = {}) {
  const sent: Sent[] = []
  const me = {
    state: o.state ?? 'granted',
    cookies: o.cookies ?? true,
    anon: o.anon ?? crypto.randomUUID(),
    key: o.key ?? KEY,
    sent,
    _fb: () => [
      me.state,
      me.cookies,
      me.key,
      ENDPOINT,
      me.anon,
      null,
      's',
      (e: string, p: Record<string, unknown>) => sent.push([e, p]),
    ],
  }
  return me
}

let answer: () => Promise<Response>
let calls: string[] = []
const saved = globalThis.fetch
const ok = (body: object) => () => Promise.resolve(Response.json(body))

beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = globalThis
  calls = []
  answer = ok({ flags: { on: 100, quarter: 25, half: 50 }, experiments: { checkout: EXP } })
  globalThis.fetch = ((url: string) => {
    calls.push(url)
    return answer()
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = saved
  delete (globalThis as { window?: unknown }).window
})

describe('flags', () => {
  test('on a server (SSR): defaults, no request', async () => {
    delete (globalThis as { window?: unknown }).window
    const core = fakeCore()
    const f = makeFlags(() => core)
    expect(await f.flag('on')).toBe(false)
    expect(await f.experiment('checkout')).toBe('A')
    expect(calls).toHaveLength(0)
    expect(core.sent).toHaveLength(0)
  })

  test('asks the capture host once, with the public key only', async () => {
    const f = makeFlags(() => fakeCore())
    await Promise.all([f.flag('on'), f.flag('half'), f.experiment('checkout'), f.flag('x')])
    expect(calls).toEqual([`https://ingest.example/v1/flags?api_key=${KEY}`])
  })

  test('rollout follows the shared assignment; 100% is on for everyone', async () => {
    for (let i = 0; i < 200; i++) {
      const core = fakeCore()
      const f = makeFlags(() => core)
      expect(await f.flag('on')).toBe(true)
      expect(await f.flag('quarter')).toBe(flagOn('quarter', 25, core.anon))
      expect(await f.flag('half')).toBe(flagOn('half', 50, core.anon))
    }
  })

  test('unknown, off and odd keys are off', async () => {
    const f = makeFlags(() => fakeCore())
    expect(await f.flag('nope')).toBe(false)
    expect(await f.flag('constructor')).toBe(false)
    expect(await f.flag('__proto__')).toBe(false)
    expect(await f.experiment('constructor')).toBe('A')
    expect(await f.experiment('nope')).toBe('A')
  })

  test('before consent: only a 100% flag is on, experiments show A, nothing is recorded', async () => {
    const core = fakeCore({ state: 'pending', anon: '' })
    const f = makeFlags(() => core)
    // an experiment needs no request before consent
    expect(await f.experiment('checkout')).toBe('A')
    expect(calls).toHaveLength(0)
    // a rollout to everyone needs no visitor; a partial one does
    expect(await f.flag('on')).toBe(true)
    expect(await f.flag('half')).toBe(false)
    expect(core.sent).toHaveLength(0)
    // consent granted later on the same page: assigned from then on
    core.state = 'granted'
    core.anon = crypto.randomUUID()
    expect(await f.experiment('checkout')).toBe(variantOf(EXP, core.anon))
    expect(core.sent).toHaveLength(1)
  })

  test('cookies refused: the id lasts one page, so nothing is split', async () => {
    const core = fakeCore({ cookies: false })
    const f = makeFlags(() => core)
    expect(await f.flag('half')).toBe(false)
    expect(await f.experiment('checkout')).toBe('A')
    expect(core.sent).toHaveLength(0)
  })

  test('an experiment records one exposure per page with its id and version', async () => {
    const core = fakeCore()
    const f = makeFlags(() => core)
    const v = await f.experiment('checkout')
    expect(v).toBe(variantOf(EXP, core.anon))
    await Promise.all([f.experiment('checkout'), f.experiment('checkout')])
    expect(core.sent).toEqual([['$experiment_exposure', { $experiment_id: EXP, $variant: v }]])
    // reading a flag records nothing
    await f.flag('half')
    expect(core.sent).toHaveLength(1)
  })

  test('identity: identify keeps the version; logout is a new visitor with its own exposure', async () => {
    const core = fakeCore()
    const f = makeFlags(() => core)
    const before = await f.experiment('checkout')
    // identify() keeps the anon_id, so nothing changes and nothing new is recorded
    expect(await f.experiment('checkout')).toBe(before)
    expect(core.sent).toHaveLength(1)
    // reset() at logout: a new anon_id, assigned and recorded afresh
    core.anon = crypto.randomUUID()
    expect(await f.experiment('checkout')).toBe(variantOf(EXP, core.anon))
    expect(core.sent).toHaveLength(2)
  })

  test('both versions occur, about half each', async () => {
    let b = 0
    for (let i = 0; i < 2000; i++) {
      const f = makeFlags(() => fakeCore())
      if ((await f.experiment('checkout')) === 'B') b++
    }
    expect(b).toBeGreaterThan(900)
    expect(b).toBeLessThan(1100)
  })

  test('network failure with nothing cached: off and A; an error answer too', async () => {
    answer = () => Promise.reject(new TypeError('offline'))
    const core = fakeCore()
    const f = makeFlags(() => core)
    expect(await f.flag('on')).toBe(false)
    expect(await f.experiment('checkout')).toBe('A')
    // a failure is remembered for 10 s: the next calls answer at once, with no new request
    expect(calls).toHaveLength(1)
    answer = () => Promise.resolve(Response.json({ error: 'origin_not_allowed' }, { status: 403 }))
    const g = makeFlags(() => core)
    expect(await g.flag('on')).toBe(false)
    expect(core.sent).toHaveLength(0)
  })

  test('a change arrives after the cache expires; a failed refresh keeps the last answer', async () => {
    const realNow = Date.now
    let t = realNow()
    Date.now = () => t
    try {
      const f = makeFlags(() => fakeCore())
      expect(await f.flag('on')).toBe(true)
      answer = ok({ flags: {}, experiments: {} })
      t += 10_000
      expect(await f.flag('on')).toBe(true) // fresh: no request
      expect(calls).toHaveLength(1)
      t += 25_000
      // stale: answered at once from the cache, refreshed behind it
      expect(await f.flag('on')).toBe(true)
      expect(calls).toHaveLength(2)
      await new Promise((r) => setTimeout(r, 10))
      expect(await f.flag('on')).toBe(false) // turned off
      answer = ok({ flags: { on: 100 }, experiments: {} })
      t += 31_000
      await f.flag('on')
      await new Promise((r) => setTimeout(r, 10))
      expect(await f.flag('on')).toBe(true) // turned back on
      answer = () => Promise.reject(new TypeError('offline'))
      t += 31_000
      await f.flag('on')
      await new Promise((r) => setTimeout(r, 10))
      expect(await f.flag('on')).toBe(true) // offline: the last good answer stays
    } finally {
      Date.now = realNow
    }
  })

  test('a stopped experiment shows A and records nothing more', async () => {
    const realNow = Date.now
    let t = realNow()
    Date.now = () => t
    try {
      const core = fakeCore()
      const f = makeFlags(() => core)
      await f.experiment('checkout')
      answer = ok({ flags: {}, experiments: {} })
      t += 31_000
      await f.experiment('checkout')
      await new Promise((r) => setTimeout(r, 10))
      expect(await f.experiment('checkout')).toBe('A')
      expect(core.sent).toHaveLength(1)
    } finally {
      Date.now = realNow
    }
  })

  test('called before the SDK starts: waits for init()', async () => {
    let core: ReturnType<typeof fakeCore> | unknown[] = []
    const f = makeFlags(() => core)
    const pending = f.flag('on')
    setTimeout(() => {
      core = fakeCore()
    }, 120)
    expect(await pending).toBe(true)
  })

  test('the SDK never starts: off after the wait, never a rejection', async () => {
    const f = makeFlags(() => undefined)
    expect(await f.flag('on')).toBe(false)
    expect(await f.experiment('checkout')).toBe('A')
    expect(calls).toHaveLength(0)
  }, 15_000)
})
