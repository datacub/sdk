import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { advance, appState, jump, rn, sdk, server, storage, reset as tidy } from './harness.ts'

const MIN = 60_000
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let srv: ReturnType<typeof server>
beforeEach(() => {
  tidy()
  srv = server()
})
afterEach(() => {
  expect(srv.invalid).toEqual([])
  jest.useRealTimers()
})

const sessions = () => [...new Set(srv.events.map((e) => e.session_id))]

describe('sessions and app state', () => {
  test('first launch: one v7 session for everything in it', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home')
    datacub.track('tapped')
    await datacub.flush()
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0]).toMatch(V7)
  })

  test('a short trip to another app keeps the session and sends no lifecycle event', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home')
    appState('background')
    jump(5 * MIN)
    appState('active')
    datacub.track('back')
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$screen', 'back'])
    expect(sessions()).toHaveLength(1)
  })

  test('back after 30 minutes away: a new session that starts on the screen on show', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Cart')
    appState('background')
    jump(31 * MIN)
    appState('active')
    await datacub.flush()
    const resumed = srv.events.at(-1)
    expect(resumed?.event).toBe('$screen')
    expect(resumed?.context.screen).toBe('Cart')
    expect(resumed?.properties.$resumed).toBe(true)
    expect(sessions()).toHaveLength(2)
  })

  test('exactly 30 minutes away continues; the rule matches the server (gap > 30 min)', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Cart')
    appState('background')
    jump(30 * MIN)
    appState('active')
    datacub.track('back')
    await datacub.flush()
    expect(sessions()).toHaveLength(1)
    expect(srv.names()).not.toContain('$resumed')
  })

  test('the app killed and reopened inside 30 minutes continues the session', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('before_kill')
    await datacub.flush()
    jump(10 * MIN)
    const y = await sdk({ store: s })
    y.consent.grant()
    y.track('after_relaunch')
    await y.flush()
    expect(sessions()).toHaveLength(1)
  })

  test('reopened after 30 minutes: a new session', async () => {
    const s = storage()
    const datacub = await sdk({ store: s })
    datacub.consent.grant()
    datacub.track('yesterday')
    await datacub.flush()
    jump(45 * MIN)
    const y = await sdk({ store: s })
    y.consent.grant()
    y.track('today')
    await y.flush()
    expect(sessions()).toHaveLength(2)
    expect(srv.events[0]?.anon_id).toBe(srv.events.at(-1)?.anon_id as string)
  })

  test('a session ends at 24 hours even when it never goes idle', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    for (let h = 0; h < 25; h++) {
      datacub.track('busy')
      jump(20 * MIN)
      datacub.track('busy')
      jump(20 * MIN)
      datacub.track('busy')
      jump(20 * MIN)
    }
    await datacub.flush()
    expect(sessions()).toHaveLength(2)
  })

  test('rapid switching sends nothing extra and keeps one session', async () => {
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home')
    for (let i = 0; i < 50; i++) {
      appState(i % 3 ? 'inactive' : 'background')
      appState('active')
    }
    await datacub.flush()
    expect(srv.names()).toEqual(['$consent', '$screen'])
  })

  test('a background launch (push, background fetch) sends nothing until the app is opened', async () => {
    rn.state = 'background'
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home') // the navigator mounts in a background launch on iOS
    await advance(60_000)
    expect(srv.events.filter((e) => e.event !== '$consent')).toEqual([])
    appState('active')
    await datacub.flush()
    const view = srv.events.at(-1)
    expect(view?.event).toBe('$screen')
    expect(view?.properties.$resumed).toBeUndefined()
  })

  test('the old architecture reports no state at launch: treated as the foreground', async () => {
    rn.state = null
    const datacub = await sdk()
    datacub.consent.grant()
    datacub.screen('Home')
    await advance(10_000)
    expect(srv.names()).toEqual(['$consent', '$screen'])
  })
})
