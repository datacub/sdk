// Runs inside the Hermes VM (plain script: no modules, no Node, no browser). The runner prepends
// the two built bundles as modules `index` and `navigation`, and a stubbed `react-native`.
var results = []
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: ok ? undefined : String(detail) })
}

// The standalone Hermes CLI's clearTimeout throws on undefined; React Native's accepts anything.
const nativeClear = clearTimeout
globalThis.clearTimeout = (id) => {
  if (typeof id === 'number') nativeClear(id)
}

var fetched = []
// what React Native provides as globals
globalThis.fetch = (url, init) => {
  fetched.push({ url: url, init: init })
  return Promise.resolve({
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({}),
  })
}
globalThis.AbortController = function () {
  this.signal = {}
  this.abort = () => {}
}
globalThis.__DEV__ = false

var store = {}
var storage = {
  getItem: (k) => Promise.resolve(k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = v
    return Promise.resolve()
  },
  removeItem: (k) => {
    delete store[k]
    return Promise.resolve()
  },
}
var listeners = []
globalThis.__rn.AppState.addEventListener = (_type, f) => {
  listeners.push(f)
  return { remove: () => {} }
}

var datacub = __require('index').default
var VERSION = __require('index').VERSION
var trackNavigation = __require('navigation').trackNavigation

datacub.init('pk_test_abcdefghijklmnopqrstuvwx', {
  storage: storage,
  requireConsent: true,
  app: {
    applicationId: 'com.example.app',
    nativeApplicationVersion: '1.2.3',
    nativeBuildVersion: '45',
  },
})
datacub.track('before_grant')
datacub.consent.grant({ method: 'banner', policyVersion: '2026-01' })
datacub.screen('Product/4512')
datacub.track('purchase', { plan: 'pro', note: 'mail me at someone@example.com', amount: 149.5 })
datacub.identify('user_1', { email: 'someone@example.com', plan: 'pro' })

var listenersAtInit = listeners.length
var navListeners = []
var ref = {
  isReady: () => true,
  getCurrentRoute: () => ({ name: 'Settings' }),
  addListener: (_e, f) => {
    navListeners.push(f)
    return () => {}
  },
}
var unsubscribe = trackNavigation(ref)

datacub
  .flush()
  .then(() => {
    var req = fetched[0]
    check('one request was made', fetched.length === 1, fetched.length)
    var body = req ? JSON.parse(req.init.body) : { events: [], lib: {} }
    check('default host', req?.url === 'https://in.datacub.to/v1/batch', req?.url)
    check(
      'lib',
      body.lib.name === '@datacub/react-native' && body.lib.version === VERSION,
      JSON.stringify(body.lib),
    )
    check('version is semver', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(VERSION), VERSION)
    check('app id', body.app_id === 'com.example.app', body.app_id)
    var names = body.events.map((e) => e.event)
    check(
      'events in order',
      names.join() === '$consent,$screen,purchase,$identify,$screen',
      names.join(),
    )
    check('nothing before consent', names.indexOf('before_grant') === -1, names.join())
    var screens = body.events.filter((e) => e.event === '$screen')
    check(
      'screen is templated',
      screens[0]?.context.screen === 'Product/:id',
      screens[0]?.context.screen,
    )
    check(
      'navigation screen',
      screens[1] && screens[1].context.screen === 'Settings',
      screens[1] && JSON.stringify(screens[1].context),
    )
    var purchase = body.events[2] || { properties: {} }
    check(
      'email in text redacted',
      purchase.properties.note === 'mail me at [redacted]',
      purchase.properties.note,
    )
    check('decimal kept', purchase.properties.amount === 149.5, purchase.properties.amount)
    var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    check(
      'uuids from Math.random fallback',
      body.events.every((e) => uuid.test(e.uuid) && uuid.test(e.anon_id)),
      '',
    )
    check(
      'context',
      body.events[0].context.platform === 'android' &&
        body.events[0].context.app_version === '1.2.3',
      JSON.stringify(body.events[0].context),
    )
    check(
      'identify carries user',
      body.events[3].user_id === 'user_1' &&
        body.events[3].properties.$email === 'someone@example.com',
      JSON.stringify(body.events[3]),
    )
    check(
      'storage written',
      typeof store.datacub_state === 'string' &&
        JSON.parse(store.datacub_state).a === body.events[0].anon_id,
      store.datacub_state,
    )
    check('AppState listener registered', listenersAtInit === 1, listenersAtInit)
    check('navigation listener registered', navListeners.length === 1, navListeners.length)
    check('unsubscribe is a function', typeof unsubscribe === 'function', typeof unsubscribe)
    listeners[0]('background')
    datacub.consent.revoke()
    return datacub.flush()
  })
  .then(() => {
    check('revoke wipes storage', store.datacub_state === '{"o":1}', store.datacub_state)
    print(`RESULT ${JSON.stringify(results)}`)
  })
  .catch((e) => {
    print(
      'RESULT ' +
        JSON.stringify([{ name: 'script threw', ok: false, detail: String(e?.stack || e) }]),
    )
  })
