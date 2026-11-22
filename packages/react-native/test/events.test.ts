import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test'
import {
  advance,
  rn,
  sdk,
  server,
  storage,
  stored,
  tick,
  reset as tidy,
  warnings,
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

describe('events', () => {
  test('custom properties are cleaned before they leave the device', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('checkout', {
      plan: 'pro',
      items: 3,
      price: 49.5,
      ok: true,
      when: new Date('2026-11-01T10:00:00Z'),
      note: 'call me on 0551234567',
      password: 'hunter2',
      $set: 'no',
      deep: { a: { b: { c: { d: 1 } } } },
    })
    await datacub.flush()
    const p = srv.events[1]?.properties
    expect(p).toEqual({
      plan: 'pro',
      items: 3,
      price: 49.5,
      ok: true,
      when: '2026-11-01T10:00:00.000Z',
      note: 'call me on [redacted]',
      deep: { a: { b: '[depth]' } },
      $dropped_count: 3,
    })
  })

  test('invalid event names are refused, valid ones normalised', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    for (const bad of ['', '  ', '$pageview', 'user@x.sa', 'order_1234567', 'a‮b', 42, null])
      datacub.track(bad as string)
    datacub.track('  signed_up ')
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', 'signed_up'])
  })

  test('screens: one $screen per change, ids templated, later events carry the screen', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home')
    datacub.screen('Home') // a re-render with the same route
    datacub.screen('Product/4512')
    datacub.track('added_to_cart')
    datacub.screen('Profile/a@b.sa')
    datacub.screen('')
    datacub.screen(7 as unknown as string)
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$screen', '$screen', 'added_to_cart', '$screen'])
    const [, home, product, add, profile] = srv.events
    expect(home?.context.screen).toBe('Home')
    expect(home?.properties.$prev_screen).toBeUndefined()
    expect(product?.context.screen).toBe('Product/:id')
    expect(product?.properties.$prev_screen).toBe('Home')
    expect(add?.context.screen).toBe('Product/:id')
    expect(profile?.context.screen).toBe('Profile/:redacted')
    // the screen name is never a URL
    expect(JSON.stringify(srv.events)).not.toContain('http')
  })

  test('a screen shown before grant is the first view after it', async () => {
    const datacub = await sdk()
    datacub.screen('Onboarding')
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$screen'])
    expect(srv.events[1]?.context.screen).toBe('Onboarding')
  })

  test('order: seq rises across batches, 20 queued go at once, a batch is at most 50', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    for (let i = 0; i < 19; i++) datacub.track('step', { i })
    await advance(1)
    expect(srv.batches.map((b) => b.events.length)).toEqual([20])
    for (let i = 19; i < 120; i++) datacub.track('step', { i })
    await datacub.flush()
    expect(srv.batches.map((b) => b.events.length)).toEqual([20, 50, 50, 1])
    const seqs = srv.events.map((e) => e.seq as number)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(srv.events.map((e) => e.uuid)).size).toBe(121)
  })

  test('iOS metadata from React Native itself; nothing that identifies the device', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    await datacub.flush()
    const b = srv.batches[0]
    expect(b?.app_id).toBe('sa.example.shop')
    expect(srv.events[0]?.context).toEqual({
      locale: expect.any(String),
      platform: 'ios',
      os_version: '17.4',
      device_class: 'mobile',
      app_version: '2.3.0',
      app_build: '87',
    })
  })

  test('Android reports the release, not the API level; a wide screen is a tablet', async () => {
    rn.os = 'android'
    rn.width = 800
    const datacub = await sdk({ app: { applicationId: 'sa.example.shop' } })
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.events[0]?.context).toMatchObject({
      platform: 'android',
      os_version: '14',
      device_class: 'tablet',
      app_version: null,
      app_build: null,
    })
  })

  test('an over-size event is dropped and counted', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    const big: Record<string, string> = {}
    for (let i = 0; i < 200; i++) big[`k${i}`] = 'abc-'.repeat(50)
    datacub.track('huge', big)
    datacub.track('fine')
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', 'fine'])
    expect(srv.batches[0]?.dropped).toBe(1)
  })
})

describe('consent', () => {
  test('nothing is sent or written before grant', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.screen('Home')
    datacub.track('early')
    datacub.identify('user_1')
    await advance(60_000)
    await datacub.flush()
    expect(srv.requests).toBe(0)
    expect(s.writes).toBe(0)
  })

  test('default: tracking starts at init with consent_state not_required and no $consent', async () => {
    const s = storage()
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    const datacub = await sdk({ store: s, requireConsent: false })
    datacub.screen('Home')
    datacub.track('early')
    await datacub.flush()
    expect(srv.names()).toEqual(['$screen', 'early'])
    expect(srv.events.every((e) => e.consent_state === 'not_required')).toBe(true)
    expect(s.writes).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('consent pending'))).toBe(false)
    delete (globalThis as { __DEV__?: boolean }).__DEV__
  })

  test('requireConsent: the pending warning shows and events wait for grant', async () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    const datacub = await sdk()
    expect(warnings.some((w) => w.includes('consent pending'))).toBe(true)
    delete (globalThis as { __DEV__?: boolean }).__DEV__
    datacub.track('early')
    datacub.consent.grant()
    datacub.track('late')
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', 'late'])
    expect(srv.events.every((e) => e.consent_state === 'granted')).toBe(true)
  })

  test('grant in the default mode sends $consent and later events say granted', async () => {
    const datacub = await sdk({ requireConsent: false })
    datacub.track('a')
    datacub.consent.grant()
    datacub.track('b')
    await datacub.flush()
    expect(srv.names()).toEqual(['a', '$consent', 'b'])
    expect(srv.events.map((e) => e.consent_state)).toEqual(['not_required', 'granted', 'granted'])
  })

  test('revoke is remembered: the next launch sends nothing, in either mode', async () => {
    const s = storage()
    const datacub = await sdk({ store: s, requireConsent: false })
    datacub.track('a')
    await datacub.flush()
    datacub.consent.revoke()
    await tick()
    expect(stored(s)).toEqual({ o: 1 })
    const before = srv.requests
    for (const requireConsent of [false, true]) {
      const y = await sdk({ store: s, requireConsent })
      y.screen('Home')
      y.track('b')
      await advance(60_000)
      await y.flush()
    }
    expect(srv.requests).toBe(before)
    expect(stored(s)).toEqual({ o: 1 })
  })

  test('grant after revoke clears the opt-out, with a new anon_id', async () => {
    const s = storage()
    const datacub = await sdk({ store: s, requireConsent: false })
    datacub.track('a')
    await datacub.flush()
    datacub.consent.revoke()
    await tick()
    const y = await sdk({ store: s, requireConsent: false })
    y.consent.grant()
    y.track('b')
    await y.flush()
    expect(stored(s).o).toBeUndefined()
    const [a, , b] = srv.events
    expect(srv.names()).toEqual(['a', '$consent', 'b'])
    expect(b?.anon_id).not.toBe(a?.anon_id as string)
    const z = await sdk({ store: s, requireConsent: false })
    z.track('c')
    await z.flush()
    expect(srv.names()).toEqual(['a', '$consent', 'b', 'c'])
  })

  test('revoke drops the queue and the stored state; nothing leaves after it', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('queued')
    await advance(200)
    expect(stored(s).q).toHaveLength(2)
    datacub.consent.revoke()
    await tick()
    datacub.track('after')
    await advance(60_000)
    await datacub.flush()
    expect(srv.requests).toBe(0)
    expect(stored(s)).toEqual({ o: 1 })
  })

  test('revoke while a batch is in flight: it is not retried and not stored again', async () => {
    const s = storage()
    srv.plan = ['hang']
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    await advance(10_000) // the timed send starts and hangs
    datacub.consent.revoke()
    await advance(10_000) // the request times out
    await advance(600_000)
    expect(srv.requests).toBe(1)
    expect(stored(s)).toEqual({ o: 1 })
  })

  test('grant after revoke is a new anon_id; $consent once per change, not per launch', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant({ method: 'banner', policyVersion: 'v1' })
    await datacub.flush()
    const y = await sdk({ store: s })
    y.consent.grant({ method: 'banner', policyVersion: 'v1' })
    y.consent.grant() // twice in one launch
    await y.flush()
    expect(srv.names()).toEqual(['$consent'])
    const z = await sdk({ store: s })
    z.consent.grant({ policyVersion: 'v2' }) // a new notice is a new consent
    await z.flush()
    z.consent.revoke()
    z.consent.grant()
    await z.flush()
    const [a, b, c] = srv.events
    expect(srv.names()).toEqual(['$consent', '$consent', '$consent'])
    expect(a?.properties).toMatchObject({ $method: 'banner', $policy_version: 'v1' })
    expect(b?.anon_id).toBe(a?.anon_id as string)
    expect(c?.anon_id).not.toBe(a?.anon_id as string)
  })
})

describe('setup', () => {
  test('importing the SDK touches nothing', async () => {
    let fetched = 0
    globalThis.fetch = (() => {
      fetched++
    }) as never
    await import(`../src/index.ts?import=${Date.now()}`)
    await tick()
    expect(fetched).toBe(0)
  })

  test('refuses secret keys, bad keys, plain http to the internet and the web platform', async () => {
    const errors: string[] = []
    const spy = spyOn(console, 'error').mockImplementation((m: string) => errors.push(m))
    try {
      for (const o of [
        // built at runtime so secret scanners do not mistake the fixture for a real key
        { key: ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_') },
        { key: 'pk_live_short' },
        { apiHost: 'http://ingest.example.com' },
        // user info hides the real host: this is evil.example over plain http
        { apiHost: 'http://10.0.2.2:4100@evil.example' },
      ]) {
        const datacub = await sdk(o)
        datacub.consent.grant()
        datacub.track('nope')
        await datacub.flush()
      }
      rn.os = 'web'
      const datacub = await sdk()
      datacub.consent.grant()
      await datacub.flush()
    } finally {
      spy.mockRestore()
    }
    expect(srv.requests).toBe(0)
    expect(errors).toEqual(['[datacub] refused a secret key. Use your project ID.'])
  })

  test('sends to https://in.datacub.to when no apiHost is given', async () => {
    const datacub = await sdk({ apiHost: '' })
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.urls).toEqual(['https://in.datacub.to/v1/batch'])
  })

  test('the batch reports the library name and the package.json version', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    await datacub.flush()
    const pkg = (await Bun.file(`${import.meta.dir}/../package.json`).json()) as { version: string }
    expect(srv.batches[0]?.lib).toEqual({ name: '@datacub/react-native', version: pkg.version })
  })

  test('plain http works for development hosts', async () => {
    for (const apiHost of [
      'http://localhost:4100',
      'http://10.0.2.2:4100',
      'http://192.168.1.20:4100',
    ]) {
      const datacub = await sdk({ apiHost })
      datacub.consent.grant()
      await datacub.flush()
    }
    expect(srv.requests).toBe(3)
    expect(warnings.filter((w) => w.includes('init:'))).toEqual([])
  })
})
