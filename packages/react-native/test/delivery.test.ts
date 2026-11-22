import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test'
import {
  advance,
  appState,
  jump,
  sdk,
  server,
  storage,
  stored,
  tick,
  reset as tidy,
} from './harness.ts'

let srv: ReturnType<typeof server>
beforeEach(() => {
  tidy()
  srv = server()
})
afterEach(() => {
  expect(srv.invalid).toEqual([])
  jest.useRealTimers()
})

const uuids = () => srv.events.map((e) => e.uuid)

describe('delivery', () => {
  test('batched on a 10 second timer, not one request per event', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('a')
    datacub.track('b')
    await advance(9_999)
    expect(srv.requests).toBe(0)
    await advance(1)
    expect(srv.requests).toBe(1)
    expect(srv.names()).toEqual(['$consent', 'a', 'b'])
  })

  test('offline: events stay queued with their uuids and go when the network is back', async () => {
    srv.plan = ['network', 'network']
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('offline_1')
    await advance(10_000) // first try fails
    await advance(2_000) // backoff (at most 2 s after one failure) fails again
    expect(srv.requests).toBe(2)
    await advance(4_000) // third try, network back
    expect(srv.requests).toBe(3)
    expect(srv.names()).toEqual(['$consent', 'offline_1'])
  })

  test('backoff is full jitter and doubles', async () => {
    const r = spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      srv.plan = Array(9).fill(503)
      const datacub = await sdk()
      datacub.consent.grant()
      await advance(10_000)
      const gaps: number[] = []
      for (let i = 0; i < 8; i++) {
        let waited = 0
        const before = srv.requests
        while (srv.requests === before) {
          await advance(1_000)
          waited += 1_000
        }
        gaps.push(waited)
      }
      // the upper bound of each wait: 2, 4, 8 ... seconds
      expect(gaps).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000])
    } finally {
      r.mockRestore()
    }
  })

  test('Retry-After is honoured', async () => {
    srv.plan = [{ status: 429, retryAfter: 120 }]
    const datacub = await sdk()
    datacub.consent.grant()
    await advance(10_000)
    await advance(119_000)
    expect(srv.requests).toBe(1)
    await advance(1_000)
    expect(srv.requests).toBe(2)
    expect(srv.events).toHaveLength(1)
  })

  test('the same uuids on every retry, so the server keeps one copy', async () => {
    srv.plan = [500, 'network', 502]
    const seen: string[][] = []
    const real = globalThis.fetch
    globalThis.fetch = ((u: string, i: RequestInit) => {
      seen.push(JSON.parse(i.body as string).events.map((e: { uuid: string }) => e.uuid))
      return real(u, i)
    }) as typeof fetch
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('pay_clicked')
    for (let i = 0; i < 4; i++) await datacub.flush()
    expect(seen).toHaveLength(4)
    for (const s of seen) expect(s).toEqual(seen[0] as string[])
  })

  test('a 400 drops that batch only, counted in the next one', async () => {
    srv.plan = [400]
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('bad_batch')
    await datacub.flush()
    datacub.track('next')
    await datacub.flush()
    expect(srv.names()).toEqual(['next'])
    expect(srv.batches[0]?.dropped).toBe(2)
  })

  test('401 or 403: sending stops for this launch and the queue is dropped', async () => {
    for (const status of [401, 403]) {
      srv.plan = [status]
      const s = storage()
      const datacub = await sdk({ store: s })
      datacub.consent.grant()
      datacub.track('refused')
      await datacub.flush()
      datacub.track('after')
      await advance(600_000)
      await datacub.flush()
      expect(stored(s).q).toEqual([])
    }
    expect(srv.requests).toBe(2)
  })

  test('one batch fails, the next is still sent; order kept', async () => {
    srv.plan = [200, 'network']
    const datacub = await sdk()
    datacub.consent.grant()
    for (let i = 0; i < 59; i++) datacub.track('e', { i })
    await datacub.flush() // 50 go, the other 10 fail
    expect(srv.events).toHaveLength(50)
    await datacub.flush()
    expect(srv.events).toHaveLength(60)
    expect(srv.events.map((e) => e.seq)).toEqual([...Array(60).keys()])
  })

  test('the queue holds 1,000 events; the oldest go first and are counted', async () => {
    srv.plan = Array(20).fill('network')
    const datacub = await sdk()
    datacub.consent.grant()
    await advance(10_000)
    for (let i = 0; i < 1199; i++) datacub.track('e', { i })
    srv.plan = []
    await datacub.flush()
    expect(srv.events).toHaveLength(1000)
    expect(srv.events[0]?.properties.i).toBe(199)
    expect(srv.batches[0]?.dropped).toBe(200)
  })

  test('concurrent flushes send each event once', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    for (let i = 0; i < 70; i++) datacub.track('e')
    await Promise.all([datacub.flush(), datacub.flush(), datacub.flush()])
    expect(new Set(uuids()).size).toBe(71)
    expect(uuids()).toHaveLength(71)
  })

  test('a request that never answers is cut at 10 seconds and retried', async () => {
    srv.plan = ['hang']
    const datacub = await sdk()
    datacub.consent.grant()
    await advance(10_000)
    expect(srv.requests).toBe(1)
    await advance(10_000) // aborted
    await advance(2_000) // retried
    expect(srv.requests).toBe(2)
    expect(srv.events).toHaveLength(1)
  })

  test('after 10 failures in a row it waits for the next foreground', async () => {
    srv.plan = Array(10).fill('network')
    const datacub = await sdk()
    datacub.consent.grant()
    await advance(10_000)
    for (let i = 0; i < 20; i++) await advance(300_000)
    expect(srv.requests).toBe(10)
    appState('background')
    appState('active')
    await advance(10_000)
    expect(srv.events).toHaveLength(1)
  })

  test('nothing is retried while the app is in the background', async () => {
    srv.plan = ['network', 'network']
    const datacub = await sdk()
    datacub.consent.grant()
    appState('background') // the background flush fails
    await tick()
    expect(srv.requests).toBe(1)
    await advance(3_600_000)
    expect(srv.requests).toBe(1)
    appState('active')
    await advance(10_000)
    expect(srv.requests).toBe(2)
  })
})

describe('durability', () => {
  test('going to the background stores the queue at once and tries to send it', async () => {
    srv.plan = ['network']
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('last_tap')
    appState('background')
    await tick()
    expect(srv.requests).toBe(1)
    expect(stored(s).q.map((e: { event: string }) => e.event)).toEqual(['$consent', 'last_tap'])
  })

  test('killed while a request is in flight: the next launch sends the same events', async () => {
    srv.plan = ['hang']
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('in_flight')
    appState('background') // the OS suspends the app with the request open
    await tick()
    const pending = stored(s).q.map((e: { uuid: string }) => e.uuid)
    expect(pending).toHaveLength(2)

    rn_relaunch()
    const y = await sdk({ store: s })
    y.consent.grant()
    await y.flush()
    expect(uuids()).toEqual(pending)
  })

  test('events older than capture accepts are dropped on the device', async () => {
    srv.plan = Array(10).fill('network')
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('old')
    await advance(200)
    jump(30 * 864e5)
    srv.plan = []
    const y = await sdk({ store: s })
    y.consent.grant()
    y.track('new')
    await y.flush()
    // the consent was recorded at the first launch; both old events are counted, not sent
    expect(srv.names()).toEqual(['new'])
    expect(srv.batches[0]?.dropped).toBe(2)
  })

  test('a steady stream of events is stored every 100 ms, not only when it stops', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    for (let i = 0; i < 20; i++) {
      datacub.track('scroll_step')
      await advance(50)
    }
    expect(s.writes).toBeGreaterThanOrEqual(9)
    expect(s.writes).toBeLessThanOrEqual(11)
  })

  test('stored state stays bounded at 1 MB', async () => {
    srv.plan = Array(50).fill('network')
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    await advance(10_000)
    for (let i = 0; i < 1000; i++) datacub.track('e', { blob: 'abc-'.repeat(50) })
    await advance(200)
    expect((s.m.get('datacub_state') as string).length).toBeLessThan(1.1 * 1048576)
  })
})

function rn_relaunch() {
  // the old process is gone: its timers never fire
  jest.clearAllTimers()
}
