import { jest, mock } from 'bun:test'
import { appBatch } from './schema.ts'

// A fake React Native (AppState, Platform, Dimensions), a scripted ingestion endpoint and an
// in-memory storage. Each sdk() call loads a fresh copy of the SDK, as a cold start does.

// before any test swaps it for the scripted endpoint
export const realFetch = globalThis.fetch

type State = 'active' | 'background' | 'inactive' | 'unknown'
export const rn = {
  state: 'active' as State | null,
  os: 'ios' as string,
  listeners: [] as ((s: State) => void)[],
  width: 390,
}

mock.module('react-native', () => ({
  AppState: {
    get currentState() {
      return rn.state
    },
    addEventListener: (_: string, f: (s: State) => void) => {
      rn.listeners.push(f)
      return { remove() {} }
    },
  },
  Platform: {
    get OS() {
      return rn.os
    },
    get Version() {
      return rn.os === 'android' ? 34 : '17.4'
    },
    constants: { Release: '14' },
  },
  Dimensions: { get: () => ({ width: rn.width, height: 844 }) },
}))

export function appState(s: State) {
  rn.state = s
  for (const f of rn.listeners) f(s)
}

const KEY = 'pk_test_abcdefghijklmnopqrstuvwx'
export const APP = {
  applicationId: 'sa.example.shop',
  nativeApplicationVersion: '2.3.0',
  nativeBuildVersion: '87',
}

export function storage(init?: Record<string, string>) {
  const m = new Map(Object.entries(init ?? {}))
  return {
    m,
    writes: 0,
    fail: { get: false, set: false },
    async getItem(k: string) {
      if (this.fail.get) throw new Error('read')
      return m.get(k) ?? null
    },
    async setItem(k: string, v: string) {
      if (this.fail.set) throw new Error('write')
      this.writes++
      m.set(k, v)
    },
    async removeItem(k: string) {
      m.delete(k)
    },
  }
}
export type Store = ReturnType<typeof storage>
export const stored = (s: Store) => JSON.parse(s.m.get('datacub_state') ?? 'null')

type Ev = Record<string, unknown> & {
  event: string
  uuid: string
  anon_id: string
  user_id: string | null
  session_id: string
  context: Record<string, unknown>
  properties: Record<string, unknown>
}
interface Batch {
  api_key: string
  sent_at: string
  lib: { name: string; version: string }
  app_id?: string
  dropped?: number
  events: Ev[]
}

// Answers in order from `plan`; when it runs out, 200. 'network' throws as fetch does offline,
// 'hang' never answers until the SDK aborts it.
export function server() {
  const s = {
    batches: [] as Batch[],
    urls: [] as string[],
    invalid: [] as string[],
    requests: 0,
    plan: [] as (
      | number
      | 'network'
      | 'hang'
      | { status: number; retryAfter: number }
      | { status: number; body: string }
    )[],
    get events() {
      return s.batches.flatMap((b) => b.events)
    },
    names() {
      return s.events.map((e) => e.event)
    },
  }
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    // only the SDK's batches are faked: anything else still reaches the real fetch
    if (!String(url).includes('/v1/batch')) return realFetch(url, init)
    s.requests++
    s.urls.push(String(url))
    const body = JSON.parse(init.body as string)
    // every request the SDK makes must be a valid app batch for the real capture schema
    const v = appBatch.safeParse(body)
    if (!v.success) {
      s.invalid.push(JSON.stringify(v.error.issues))
      return new Response('{"error":"schema"}', { status: 400 })
    }
    const step = s.plan.shift() ?? 200
    if (step === 'network') throw new TypeError('Network request failed')
    if (step === 'hang')
      return new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      )
    const status = typeof step === 'number' ? step : step.status
    if (status < 300) s.batches.push(body)
    const headers: Record<string, string> =
      typeof step === 'object' && 'retryAfter' in step
        ? { 'Retry-After': String(step.retryAfter) }
        : {}
    return new Response(typeof step === 'object' && 'body' in step ? step.body : '{}', {
      status,
      headers,
    })
  }) as unknown as typeof fetch
  return s
}

export const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
export async function advance(ms: number) {
  jest.advanceTimersByTime(ms)
  await tick()
}
// time passes with the app suspended: no timers run
export const jump = (ms: number) => jest.setSystemTime(new Date(Date.now() + ms))

let n = 0
type X = typeof import('../src/index.ts').default
export async function sdk(
  o: {
    store?: Store | null
    app?: unknown
    apiHost?: string
    key?: string
    requireConsent?: boolean
  } = {},
): Promise<X> {
  rn.listeners = []
  const { default: datacub } = (await import(`../src/index.ts?cold=${n++}`)) as { default: X }
  datacub.init(o.key ?? KEY, {
    apiHost: o.apiHost ?? 'https://ingest.example.com',
    ...(o.store === null ? {} : { storage: o.store ?? storage() }),
    app: (o.app ?? APP) as never,
    // the suites test the consent flow, so they ask for it; pass false for the default
    requireConsent: o.requireConsent ?? true,
  })
  await tick()
  return datacub
}

export const warnings: string[] = []
console.warn = (m: string) => warnings.push(m)

export function reset() {
  warnings.length = 0
  rn.state = 'active'
  rn.os = 'ios'
  rn.width = 390
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-11-01T09:00:00Z'))
}
