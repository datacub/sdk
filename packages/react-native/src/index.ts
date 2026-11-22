// @datacub/react-native: observe, sanitise, queue, deliver. Everything else happens on the server.
// Same wire contract as @datacub/web, with an app context instead of a page.
// Importing this module has no side effects. No public method throws or rejects.

import { AppState, Dimensions, Platform } from 'react-native'
import { badText, clean, eventName, segment, tally, text, validId } from './scrub.ts'

// Injected from package.json at build time (scripts/build.ts); the fallback is for running the source.
declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev'

export type Property =
  | string
  | number
  | boolean
  | null
  | Date
  | Property[]
  | { [key: string]: Property }
export type Properties = Record<string, Property>

/** AsyncStorage's shape. Sync or async both work, so an MMKV wrapper fits too. */
export interface Storage {
  getItem(key: string): string | null | undefined | Promise<string | null | undefined>
  setItem(key: string, value: string): unknown
  removeItem(key: string): unknown
}

/** expo-application's shape: pass `import * as Application from 'expo-application'`, or your own values. */
export interface AppInfo {
  applicationId: string | null
  nativeApplicationVersion?: string | null
  nativeBuildVersion?: string | null
}

export interface InitOptions {
  /** Ingestion origin or your proxy. Default https://in.datacub.to */
  apiHost?: string
  /** Where ids and unsent events live between launches. Without it nothing survives a restart. */
  storage?: Storage
  /** Your app id (bundle id or package name), version and build. */
  app?: AppInfo
  /**
   * Store and send nothing until datacub.consent.grant(). Default false: tracking starts at once.
   * Turn it on with "Ask for consent first" in the project's settings, which makes datacub refuse events
   * sent without a grant.
   */
  requireConsent?: boolean
}

/**
 * Who the user is, beyond the ID. email, name and phone are shown on their profile and are
 * searchable; they never link two people. Any other key is a user property and passes the same
 * privacy rules as track() properties.
 */
export interface IdentifyOptions {
  /** Opaque workspace or organisation ID. Never a name or email. */
  account?: string | number
  email?: string
  name?: string
  phone?: string
  [trait: string]: Property | undefined
}

export interface GrantOptions {
  method?: 'banner' | 'settings' | 'api' | 'cmp'
  /** Your privacy notice version, at most 64 characters. */
  policyVersion?: string
}

export interface DatacubClient {
  init(publicKey: string, options?: InitOptions): void
  track(event: string, properties?: Properties): void
  screen(name: string, properties?: Properties): void
  identify(userId: string | number, options?: IdentifyOptions): void
  reset(): void
  /** Sends what is queued. Resolves when done or when sending failed; never rejects. */
  flush(): Promise<void>
  consent: { grant(options?: GrantOptions): void; revoke(): void }
}

type Ev = Record<string, unknown>

const IDLE = 18e5 // 30 minutes, as the web and the server's session rule
const DAY = 864e5 // session maximum
const MAX_AGE = 29 * DAY // the server refuses events older than 30 days
const KEY = 'datacub_state'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let started = false
let ready = false
let loaded: Promise<void> = Promise.resolve()
let key = ''
let endpoint = ''
let appId: string | null = null
let store: Storage | undefined
let persistent = false
let context: Ev = {}
// While tracking, what events carry: 'granted' after datacub.consent.grant(), 'not_required' when it
// started at init. Tracking is on in those two states only.
let state: 'pending' | 'granted' | 'not_required' | 'denied' = 'pending'
const on = () => state === 'granted' || state === 'not_required'
// a revoke remembered on this device: the stored value is then only { o: 1 }
let optout = false
let requireConsent = false
// the consent last recorded on this device, so a grant at every launch sends $consent only once
let granted: string | null = null
let anon = ''
let user: string | null = null
let account: string | null = null
let pendingUser: [string, string | null, Ev] | null = null
let sid = ''
let sStart = 0
let sLast = 0
let current: string | null = null
// a screen shown while the app was not in the foreground, sent when it comes back
let unsent = false
// the properties of that screen, sent with it when the app comes to the foreground
let unsentProps: Ev = {}
let active = true
let seq = 0
let queue: Ev[] = []
let sending: Ev[] = []
// Events the SDK discarded (queue overflow, over-size, too old); sent as the batch's `dropped`.
let lost = 0
let attempts = 0
let stopped = false
let timer: ReturnType<typeof setTimeout> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<boolean> | null = null
const sizes = new WeakMap<Ev, number>()
const early: [string, unknown[]][] = []

const now = () => Date.now()

const dev = () => typeof __DEV__ !== 'undefined' && !!__DEV__
function warn(msg: string, always?: boolean) {
  // biome-ignore lint/suspicious/noConsole: development builds only, except the storage warning
  if (always || dev()) console.warn(`[datacub] ${msg}`)
}

// Every entry point is wrapped: an SDK fault must never reach the app.
const guard =
  <A extends unknown[]>(f: (...a: A) => unknown) =>
  (...a: A) => {
    try {
      f(...a)
    } catch {}
  }

// v4 for anon_id, v7 for time-ordered session and event ids. Hermes has no crypto.getRandomValues
// unless the app polyfills it; Math.random is then the source. The ids only need to be unique.
function uuid(v7?: number): string {
  const b = new Uint8Array(16)
  const c = globalThis.crypto
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0
  for (let i = 5, t = v7 as number; v7 && i >= 0; i--, t = Math.floor(t / 256)) b[i] = t & 255
  b[6] = ((b[6] as number) & 15) | (v7 ? 0x70 : 0x40)
  b[8] = ((b[8] as number) & 63) | 128
  const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// UTF-8 bytes, as the server counts them
function bytes(s: string) {
  let n = s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0x7f) n += c > 0x7ff && (c < 0xd800 || c > 0xdfff) ? 2 : 1
  }
  return n
}
const size = (e: Ev) => {
  let n = sizes.get(e)
  if (n === undefined) {
    n = bytes(JSON.stringify(e))
    sizes.set(e, n)
  }
  return n
}

// ---- device and app (RN core only; nothing that identifies the device)

function deviceContext(app: AppInfo | undefined): Ev {
  const s = Dimensions.get('screen')
  let locale = ''
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale
  } catch {}
  const v = (x: unknown) => (typeof x === 'string' && x && !badText(x) ? x.slice(0, 64) : null)
  return {
    locale: locale.slice(0, 35),
    platform: Platform.OS,
    // Android's Platform.Version is the API level; Release is the version people know
    os_version: String(
      (Platform.OS === 'android' ? Platform.constants?.Release : Platform.Version) ?? '',
    ).slice(0, 32),
    // 600 points on the short side is where Android and iPad layouts call a device a tablet
    device_class: Math.min(s.width, s.height) >= 600 ? 'tablet' : 'mobile',
    app_version: v(app?.nativeApplicationVersion),
    app_build: v(app?.nativeBuildVersion),
  }
}

// ---- storage: one JSON value; with requireConsent nothing is written before grant()

async function load() {
  if (!store) {
    warn(
      'no storage: ids and queued events last only until the app closes. Pass init(key, { storage })',
      true,
    )
    return
  }
  let raw: unknown
  try {
    raw = await store.getItem(KEY)
    persistent = true
  } catch {
    warn('storage read failed: running in memory', true)
    return
  }
  let s: Record<string, unknown> = {}
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : null
    if (o && typeof o === 'object' && !Array.isArray(o)) s = o
  } catch {}
  // anything that does not look like what the SDK wrote is ignored, never trusted
  if (typeof s.a === 'string' && UUID.test(s.a)) {
    anon = s.a
    user = validId(s.u, [])
    account = validId(s.c, [])
    if (
      typeof s.s === 'string' &&
      UUID.test(s.s) &&
      Number.isFinite(s.ss) &&
      Number.isFinite(s.sl)
    ) {
      sid = s.s
      sStart = s.ss as number
      sLast = s.sl as number
    }
  }
  optout = s.o === 1
  granted = typeof s.g === 'string' ? s.g : null
  if (Array.isArray(s.q))
    for (const e of s.q)
      if (
        e &&
        typeof e === 'object' &&
        typeof e.uuid === 'string' &&
        typeof e.event === 'string' &&
        typeof e.ts === 'string' &&
        typeof e.anon_id === 'string'
      )
        queue.push(e)
      else lost++
  cap()
}

// At most one write per 100 ms, so a burst of events is one write; a kill inside that window loses
// what it holds. Leaving the foreground writes at once.
function save(now?: boolean) {
  if (now) write()
  else saveTimer ||= setTimeout(guard(write), 100)
}

async function write() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  if (!store || !persistent || !on()) return
  try {
    await store.setItem(
      KEY,
      JSON.stringify({
        a: anon,
        u: user,
        c: account,
        s: sid,
        ss: sStart,
        sl: sLast,
        g: granted,
        // the batch being sent stays stored until the server has it
        q: sending.concat(queue),
      }),
    )
  } catch {
    persistent = false
    warn('storage write failed: ids and queued events now last only until the app closes', true)
  }
}

// after a revoke the one stored value is the opt-out flag and nothing else
async function wipe() {
  try {
    await store?.setItem(KEY, '{"o":1}')
  } catch {}
}

// ---- events

// Session rules as on the web: 30 minutes idle, 24 hours maximum. Only events count as activity,
// never app state changes, so a passive launch never starts or extends a session.
const expired = (t: number) => !sid || t - sLast > IDLE || t - sStart > DAY

function session(t: number) {
  if (expired(t)) {
    sid = uuid(t)
    sStart = sLast = t
  } else if (t > sLast) sLast = t
}

function emit(event: string, properties: Ev) {
  if (!on() || stopped) return
  const t = now()
  session(t)
  if (tally.n) properties.$dropped_count = tally.n
  tally.n = 0
  const e: Ev = {
    uuid: uuid(t),
    event,
    ts: new Date(t).toISOString(),
    anon_id: anon,
    user_id: user,
    account_id: account,
    session_id: sid,
    page_id: null,
    seq: seq++,
    consent_state: state,
    persistence: persistent ? 'storage' : 'memory',
    context: current ? { ...context, screen: current } : context,
    properties,
  }
  // 32 KB per serialised event: an over-size event is dropped whole and counted
  if (size(e) > 32768) {
    lost++
    return
  }
  queue.push(e)
  cap()
  save()
  schedule()
}

const props = (p: unknown): Ev =>
  p && typeof p === 'object' && !Array.isArray(p) ? (clean(p) as Ev) : {}

function track(name: unknown, p?: unknown) {
  if (typeof name !== 'string') return
  const n = eventName(name)
  if (!n) return warn(`track: invalid event name "${name.slice(0, 40)}"`)
  emit(n, props(p))
}

// Screen names come from the code (route names), never from what the screen shows. Segments that
// look like ids or personal data are templated as on the web: "Product/4512" is "Product/:id".
function screen(name: unknown, p?: unknown) {
  if (typeof name !== 'string') return
  const raw = name.trim().normalize('NFC')
  if (!raw || raw.length > 200 || badText(raw)) return warn('screen: invalid name')
  const n = text(
    raw
      .split('/')
      .map((s) => s && segment(s))
      .join('/'),
    200,
  )
  if (n === current) return
  const prev = current
  current = n
  showScreen(props(p), prev)
}

function showScreen(p: Ev, prev?: string | null) {
  // a screen mounted while the app is in the background (a background launch) is not a view yet
  unsent = !active
  if (prev) p.$prev_screen = prev
  if (unsent) unsentProps = p
  else emit('$screen', p)
}

// ---- delivery: batched, bounded, at least once, idempotent by event uuid

// Bounded: 1,000 events and 1 MB, the oldest go first and are counted. Events the server would refuse
// as too old are dropped here instead of being sent.
function cap() {
  const t = now()
  let total = 0
  for (let i = queue.length - 1; i >= 0; i--) {
    const e = queue[i] as Ev
    total += size(e)
    if (queue.length - i > 1000 || total > 1048576 || t - Date.parse(e.ts as string) > MAX_AGE) {
      lost += i + 1
      queue.splice(0, i + 1)
      break
    }
  }
}

function schedule() {
  // Nothing runs in the background: what is queued waits, stored, for the next foreground.
  // During a backoff the retry timer stands, so an outage is not a storm.
  if (!active || stopped || attempts || !queue.length) return
  if (queue.length > 19) {
    clearTimeout(timer)
    timer = setTimeout(guard(send), 0)
  } else timer ||= setTimeout(guard(send), 10000)
}

// At most 50 events and 30 KB per request, at least one: small requests survive weak networks and
// stay under the server's per-person rate limit.
function take() {
  let n = 0
  let b = 200
  while (n < queue.length && n < 50) {
    b += size(queue[n] as Ev) + 1
    if (b > 30720) break
    n++
  }
  return queue.splice(0, n || 1)
}

function send(): Promise<boolean> {
  clearTimeout(timer)
  timer = undefined
  inflight ??= post().then((ok) => {
    inflight = null
    if (ok) schedule()
    return ok
  })
  return inflight
}

// Resolves true when the batch left the queue (stored, or refused for good). Never rejects.
async function post(): Promise<boolean> {
  if (stopped || !on() || !queue.length) return false
  sending = take()
  const dropped = lost
  lost = 0
  let wait = 0
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          sent_at: new Date().toISOString(),
          lib: { name: '@datacub/react-native', version: VERSION },
          ...(appId ? { app_id: appId } : {}),
          events: sending,
          ...(dropped ? { dropped } : {}),
        }),
        signal: ctrl.signal as never,
      })
      const s = res.status
      // bad key, app not allowed, project suspended or in review: stop until the next launch
      // (the queue stays stored: a short-lived 403 from a proxy must not wipe the offline queue)
      if (s === 401 || s === 403) {
        stopped = true
        warn(`ingestion refused this app (${s}); sending stopped`)
      } else if (s === 408 || s === 429 || s > 499)
        wait = Math.min(+(res.headers.get('Retry-After') || 0), 3600) * 1000 || -1
      else {
        attempts = 0
        // a 4xx a retry cannot fix: the events are gone, so they are counted
        if (s > 299) lost += sending.length + dropped
        // a deleted install starts over, never linked to the deleted history
        else if (
          ((await res.json().catch(() => 0)) as { directives?: string[] }).directives?.includes(
            'rotate_anon_id',
          )
        )
          reset()
      }
    } finally {
      clearTimeout(t)
    }
  } catch {
    wait = -1 // offline, timeout or any network failure
  }
  const batch = sending
  sending = []
  // never re-queue after a revoke: those events must not leave later
  if (wait && on() && !stopped) {
    queue = batch.concat(queue)
    lost += dropped
    cap()
    // Full-jitter backoff from 1 s to 5 minutes, or Retry-After. After 10 failed tries in a row only
    // a new foreground or flush() tries again. Same events, same uuids: the server deduplicates.
    if (++attempts < 10 && active)
      timer = setTimeout(
        guard(send),
        wait > 0 ? wait : Math.random() * Math.min(1000 * 2 ** attempts, 3e5),
      )
  }
  if (on()) save()
  else if (state === 'denied') wipe()
  return !wait && !stopped
}

async function flush() {
  await loaded
  attempts = 0
  while (queue.length && (await send()));
  await write()
}

// ---- app state

function onAppState(s: string) {
  if (s === 'active') {
    if (active) return
    active = true
    attempts = 0
    // back after the session ran out (or after a background launch): the screen on show is the
    // first view of the new session
    if (current && on() && (unsent || expired(now())))
      showScreen(unsent ? unsentProps : { $resumed: true })
    if (queue.length) schedule()
  } else if (s === 'background' || s === 'inactive') {
    active = false
    clearTimeout(timer)
    timer = undefined
    // best effort: the OS may suspend the app before this request finishes. What is stored is sent
    // at the next launch with the same uuids.
    if (ready) {
      save(true)
      if (queue.length && on()) send()
    }
  }
}

// ---- consent (as on the web): tracking starts at init unless requireConsent; then nothing is
// captured or written before grant. A revoke is remembered on the device either way.

function begin() {
  state = 'not_required'
  anon ||= uuid()
  save()
}

function grant(o: GrantOptions = {}) {
  if (state === 'granted') return
  state = 'granted'
  optout = false
  if (!anon) anon = uuid()
  const pv = typeof o.policyVersion === 'string' ? text(o.policyVersion, 64) : null
  if (granted !== (pv ?? '')) {
    granted = pv ?? ''
    emit('$consent', {
      $state: 'granted',
      $method: /^(?:banner|settings|api|cmp)$/.test(`${o.method}`) ? o.method : 'api',
      $policy_version: pv,
      $purposes: ['analytics'],
    })
  }
  if (pendingUser) setUser(...pendingUser)
  pendingUser = null
  if (current) showScreen({})
  save()
  schedule()
}

function revoke() {
  state = 'denied'
  optout = true
  clearTimeout(timer)
  timer = undefined
  queue = []
  sending = []
  anon = sid = ''
  user = account = pendingUser = granted = null
  wipe()
}

// ---- identity (as on the web)

function setUser(id: string, acct: string | null, t: Ev) {
  if (user && user !== id) reset() // user switch: never link two users
  account = acct
  // the same user: traits alone, as $set, never a second $identify. Not deduplicated,
  // as on the web: pass traits at login or when they change
  if (user !== id) {
    user = id
    t.$anon_id = anon
  }
  for (const _ in t) return emit(t.$anon_id ? '$identify' : '$set', t)
  save()
}

// email, name and phone are what the app's code passes on purpose: sent as given,
// normalised and checked on the server, never an identity key. Other traits get track()'s floor.
function identify(userId: unknown, o?: IdentifyOptions) {
  const own = [anon, sid]
  const id = validId(userId, own)
  const acct = o?.account == null ? null : validId(o.account, own)
  if (!id || (o?.account != null && !acct))
    return warn('identify: ID refused (personal data shape or placeholder)')
  const t = props(o)
  delete t.account
  // the floor redacted these three in t; the raw values go under their own keys instead
  for (const k of ['email', 'name', 'phone'])
    if (k in t) {
      const v = (o as Ev)[k]
      // strings only, capped: anything else (an object, a number) is dropped, never sent raw
      if (typeof v === 'string' && v.length <= 256) t[`$${k}`] = v
      delete t[k]
    }
  if (on()) setUser(id, acct, t)
  else if (state === 'pending') pendingUser = [id, acct, t]
}

// Logout: new anon_id and session, user and account forgotten. Queued events keep the ids they
// were stamped with.
function reset() {
  pendingUser = null
  if (!on()) return
  anon = uuid()
  user = account = null
  sid = ''
  save()
}

// ---- init

function start(publicKey: unknown, o: InitOptions = {}) {
  if (started || typeof publicKey !== 'string') return
  // A secret key in an app is a leaked credential: refused loudly, in every build.
  if (/^sk_/.test(publicKey))
    // biome-ignore lint/suspicious/noConsole: the one error a release build ever prints
    return console.error('[datacub] refused a secret key. Use your project ID.')
  const host = (o.apiHost || 'https://in.datacub.to').replace(/\/+$/, '')
  // plain http only to this machine, the Android emulator's host or a private network, for development
  if (
    !/^(?:pk_(?:live|test)_[A-Za-z0-9]{24,48}|[a-z0-9]{8})$/.test(publicKey) ||
    // no user info: http://10.0.0.2@evil.example would be evil.example
    /^[a-z]+:\/\/[^/]*@/i.test(host) ||
    !/^https:\/\/|^http:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)[:/]/.test(
      `${host}/`,
    )
  )
    return warn('init: expected a project ID and an https apiHost')
  if (Platform.OS !== 'ios' && Platform.OS !== 'android')
    return warn(`init: ${Platform.OS} is not supported; on the web use @datacub/web`)
  started = true
  key = publicKey
  endpoint = `${host}/v1/batch`
  store = o.storage
  requireConsent = o.requireConsent === true
  const id = o.app?.applicationId
  appId = typeof id === 'string' && /^[A-Za-z0-9_.-]{1,155}$/.test(id) ? id : null
  if (!appId)
    warn('init: no app id. Pass app: Application from expo-application, or { applicationId }')
  context = deviceContext(o.app)
  // null before the first change event on the old architecture; only a known background is passive
  const s = AppState.currentState
  active = s !== 'background' && s !== 'inactive'
  AppState.addEventListener('change', guard(onAppState))
  loaded = load()
    .catch(() => {})
    .then(() => {
      ready = true
      if (optout) state = 'denied'
      else if (!requireConsent) begin()
      for (const [m, a] of early.splice(0)) run(m, a)
      if (state === 'pending' && requireConsent)
        warn('consent pending: nothing is stored or sent until datacub.consent.grant()')
    })
}

const methods: Record<string, (...a: unknown[]) => void> = {
  track,
  screen,
  identify,
  reset,
  grant,
  revoke,
} as never

function run(m: string, a: unknown[]) {
  try {
    methods[m]?.(...a)
  } catch {}
}

// Calls before init, or before storage has loaded, wait in order: up to 100 tracking calls, and
// grant, revoke and reset always (a revoke must never be lost to a full buffer).
const api = (m: string) =>
  guard((...a: unknown[]) => {
    if (ready) run(m, a)
    else if (early.length < 100 || m === 'grant' || m === 'revoke' || m === 'reset')
      early.push([m, a])
  })

const datacub: DatacubClient = {
  init: guard(start),
  track: api('track'),
  screen: api('screen'),
  identify: api('identify'),
  reset: api('reset'),
  flush: () => flush().catch(() => {}),
  consent: { grant: api('grant'), revoke: api('revoke') },
}

export default datacub
