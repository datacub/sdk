import { afterEach, beforeEach, expect, jest, test } from 'bun:test'
import { reset, server, tick } from './harness.ts'

beforeEach(reset)
afterEach(() => jest.useRealTimers())

test('trackNavigation: the first route and each change, never params, nothing twice', async () => {
  const srv = server()
  // the helper drives the package's default instance, so this test uses that one
  const { default: datacub } = await import('../src/index.ts')
  const { trackNavigation } = await import('../src/navigation.ts')
  datacub.init('pk_test_abcdefghijklmnopqrstuvwx', {
    apiHost: 'https://ingest.example.com',
    app: { applicationId: 'sa.example.shop' },
  })
  await tick()
  datacub.consent.grant()

  let route: { name: string; params?: object } = { name: 'Home' }
  const listeners: (() => void)[] = []
  const ref = {
    isReady: () => true,
    getCurrentRoute: () => route,
    addListener: (_: 'state', f: () => void) => {
      listeners.push(f)
      return () => {}
    },
  }
  const change = () => {
    for (const f of listeners) f()
  }
  trackNavigation(ref)
  route = { name: 'Product', params: { email: 'a@b.sa' } }
  change()
  change() // a state change that keeps the route
  route = { name: 'Cart' }
  change()
  await datacub.flush()
  expect(srv.names()).toEqual(['$consent', '$screen', '$screen', '$screen'])
  expect(srv.events.map((e) => e.context.screen)).toEqual([undefined, 'Home', 'Product', 'Cart'])
  expect(JSON.stringify(srv.batches)).not.toContain('a@b.sa')
})

test('a broken ref never throws into the app', async () => {
  const { trackNavigation } = await import('../src/navigation.ts')
  const bad = {
    isReady: () => {
      throw new Error('x')
    },
    getCurrentRoute: () => undefined,
    addListener: () => {
      throw new Error('y')
    },
  }
  expect(() => trackNavigation(bad as never)()).not.toThrow()
})
