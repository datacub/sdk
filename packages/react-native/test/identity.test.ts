import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { advance, sdk, server, storage, stored, tick, reset as tidy, warnings } from './harness.ts'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let srv: ReturnType<typeof server>
beforeEach(() => {
  tidy()
  srv = server()
})
afterEach(() => {
  expect(srv.invalid).toEqual([])
  jest.useRealTimers()
})

describe('identity', () => {
  test('rotate_anon_id from capture: a deleted install starts a new anon_id', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('before')
    srv.plan.push({ status: 200, body: '{"accepted":0,"directives":["rotate_anon_id"]}' })
    await datacub.flush()
    const old = srv.events[0]?.anon_id as string
    datacub.track('after')
    await datacub.flush()
    const after = srv.events.find((e) => e.event === 'after')
    expect(after?.anon_id).toMatch(V4)
    expect(after?.anon_id).not.toBe(old)
    expect(stored(s).a).toBe(after?.anon_id as string)
  })

  test('first install: a random v4 anon_id, stored, on every event', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('opened_cart')
    await datacub.flush()
    const [a, b] = srv.events
    expect(a?.event).toBe('$consent')
    expect(a?.anon_id).toMatch(V4)
    expect(b?.anon_id).toBe(a?.anon_id as string)
    expect(b?.persistence).toBe('storage')
    expect(stored(s).a).toBe(a?.anon_id)
  })

  test('restart keeps the anon_id and the user', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.identify('user_42')
    await datacub.flush()
    const first = srv.events[0]?.anon_id

    const y = await sdk({ store: s })
    y.consent.grant()
    y.track('came_back')
    await y.flush()
    const last = srv.events.at(-1)
    expect(last?.anon_id).toBe(first as string)
    expect(last?.user_id).toBe('user_42')
    // the same consent and the same user at a later launch send nothing new
    expect(srv.names()).toEqual(['$consent', '$identify', 'came_back'])
  })

  test('login links the anon_id; logout starts a new one', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.track('browsed')
    datacub.identify('user_42', { account: 'org_7' })
    datacub.track('paid')
    datacub.reset()
    datacub.track('browsed_again')
    await datacub.flush()
    const [, browsed, identify, paid, again] = srv.events
    expect(browsed?.user_id).toBeNull()
    expect(identify?.event).toBe('$identify')
    expect(identify?.user_id).toBe('user_42')
    expect(identify?.account_id).toBe('org_7')
    expect(identify?.properties.$anon_id).toBe(browsed?.anon_id)
    expect(paid?.user_id).toBe('user_42')
    expect(again?.user_id).toBeNull()
    expect(again?.account_id).toBeNull()
    expect(again?.anon_id).not.toBe(browsed?.anon_id as string)
    expect(again?.session_id).not.toBe(browsed?.session_id)
  })

  test('a second account on the same device never inherits the first one', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.identify('alice')
    datacub.identify('bob') // no reset() in between: the SDK resets itself
    await datacub.flush()
    const [, a, b] = srv.events
    expect(a?.user_id).toBe('alice')
    expect(b?.user_id).toBe('bob')
    expect(b?.properties.$anon_id).toBe(b?.anon_id)
    expect(b?.anon_id).not.toBe(a?.anon_id)
  })

  test('identify before grant waits; refused ids never leave', async () => {
    const datacub = await sdk()
    datacub.identify('user_42')
    for (const bad of ['a@b.sa', '0551234567', '+966551234567', '1012345678', 'null', 'guest'])
      datacub.identify(bad)
    expect(srv.requests).toBe(0)
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$identify'])
    expect(srv.events[1]?.user_id).toBe('user_42')
  })

  test('reset before grant only forgets the pending user', async () => {
    const datacub = await sdk()
    datacub.identify('user_42')
    datacub.reset()
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent'])
  })

  test('without storage: memory only, said once, every launch a new anon_id', async () => {
    const datacub = await sdk({ store: null })
    datacub.consent.grant()
    await datacub.flush()
    const y = await sdk({ store: null })
    y.consent.grant()
    await y.flush()
    const [a, b] = srv.events
    expect(a?.persistence).toBe('memory')
    expect(b?.anon_id).not.toBe(a?.anon_id as string)
    expect(warnings).toContain(
      '[datacub] no storage: ids and queued events last only until the app closes. Pass init(key, { storage })',
    )
  })

  test('a storage that fails to read runs in memory', async () => {
    const s = storage()
    s.fail.get = true
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    await datacub.flush()
    expect(srv.events[0]?.persistence).toBe('memory')
    expect(s.writes).toBe(0)
  })

  test('a storage that fails to write says so and stops claiming persistence', async () => {
    const s = storage()
    s.fail.set = true
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    await advance(200)
    datacub.track('next')
    await datacub.flush()
    expect(srv.events.map((e) => e.persistence)).toEqual(['storage', 'memory'])
    expect(warnings.some((w) => w.includes('storage write failed'))).toBe(true)
  })

  test('corrupt storage is ignored, never trusted', async () => {
    for (const raw of [
      'not json',
      '[]',
      '{"a":"not-a-uuid","u":"user_1"}',
      '{"a":42}',
      JSON.stringify({ a: '5b0f1a8e-3c2d-4e6f-8a9b-0c1d2e3f4a5b', u: 'a@b.sa', q: 'x' }),
    ]) {
      const s = storage({ datacub_state: raw })
      const datacub = await sdk({ store: s })
      datacub.consent.grant()
      await datacub.flush()
      const e = srv.events.at(-1)
      expect(e?.anon_id).toMatch(/^[0-9a-f-]{36}$/)
      // an email-shaped stored user is not restored
      expect(e?.user_id).toBeNull()
    }
  })

  test('a stored queue with broken entries keeps the good ones and counts the rest', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('good')
    await advance(200) // stored, not sent yet
    const state = stored(s)
    state.q.push({ uuid: 1 }, null, 'junk')
    s.m.set('datacub_state', JSON.stringify(state))

    const y = await sdk({ store: s })
    y.consent.grant()
    await y.flush()
    expect(srv.names()).toEqual(['$consent', 'good'])
    expect(srv.batches[0]?.dropped).toBe(3)
  })

  test('calls before init are kept in order', async () => {
    const { default: datacub } = await import(`../src/index.ts?early=${Date.now()}`)
    datacub.consent.grant()
    datacub.track('before_init')
    datacub.init('pk_test_abcdefghijklmnopqrstuvwx', {
      apiHost: 'https://ingest.example.com',
      app: { applicationId: 'sa.example.shop' },
    })
    await tick()
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', 'before_init'])
  })

  // the web SDK's wire format: traits on $identify, the same user again as $set
  test('traits: email, name, phone on $identify, changes as $set, nothing on other events', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    const traits = {
      email: ' Sara@Example.SA ',
      name: 'سارة',
      phone: '0551234567',
      plan: 'pro',
      password: 'hunter2',
      account: 'org_7',
    }
    datacub.identify('user_t', traits)
    datacub.identify('user_t', traits)
    datacub.identify('user_t', { email: 'sara@example.sa', plan: 'team' })
    datacub.identify('user_t') // the same user, no traits: nothing to send
    datacub.track('after_traits', { note: 'x' })
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$identify', '$set', '$set', 'after_traits'])
    const [, id, set1, set2, after] = srv.events
    // $dropped_count also counts the email and phone the floor removed from their plain keys (PRR limit 4)
    expect(id?.properties).toEqual({
      $email: ' Sara@Example.SA ',
      $name: 'سارة',
      $phone: '0551234567',
      plan: 'pro',
      $anon_id: id?.anon_id,
      $dropped_count: 3,
    })
    expect(id?.account_id).toBe('org_7')
    expect(set1?.user_id).toBe('user_t')
    expect(set1?.properties.$anon_id).toBeUndefined()
    expect(set2?.properties).toEqual({ $email: 'sara@example.sa', plan: 'team', $dropped_count: 1 })
    // traits never ride other events
    expect(JSON.stringify(after)).not.toMatch(/example|0551234567|سارة/i)
  })

  test('traits before grant wait with the user; a different user with the same email is a new person', async () => {
    const datacub = await sdk()
    datacub.identify('user_a', { email: 'same@example.sa' })
    datacub.consent.grant()
    datacub.identify('user_b', { email: 'same@example.sa' })
    await datacub.flush()
    const ids = srv.events.filter((e) => e.event === '$identify')
    expect(ids.map((e) => e.user_id)).toEqual(['user_a', 'user_b'])
    expect(ids.map((e) => e.properties.$email)).toEqual(['same@example.sa', 'same@example.sa'])
    expect(ids[1]?.anon_id).not.toBe(ids[0]?.anon_id as string)
  })
})
