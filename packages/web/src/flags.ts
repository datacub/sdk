// Feature flags and A/B experiments. Opt-in: the core SDK never imports this
// file; a site gets it from /v1/flags.js (flags-global.ts) or `@datacub/web/flags` (flags-npm.ts). It
// talks to the core only through datacub._fb(), so the core stays the same bytes with or without it.
// No public function throws or rejects; anything unresolved is off, or version A.

// beside this file, never from a package name: the server builds the module at runtime in an image
// installed without dev dependencies, where a package would not resolve from here
import { flagOn, variantOf } from './bucket.ts'

type Client = { _fb?: () => unknown[] } | unknown[] | undefined
export type Variant = 'A' | 'B'
type Config = { flags: Record<string, number>; experiments: Record<string, string> }
type Emit = (event: string, properties: Record<string, unknown>) => void

const TTL = 30_000 // a running page picks up a change within this, plus 15 s on the server and 15 s
// in the browser's HTTP cache
const RETRY = 10_000 // after a failed request with nothing cached, answer at once until this passes
const WAIT = 2_000 // the longest a call waits for the SDK to start or the network to answer

export function makeFlags(client: () => Client) {
  let cfg: Config | null = null
  let at = 0
  let loading: Promise<void> | null = null
  let failed = 0
  // exposures already recorded on this page, by experiment and visitor
  const seen = new Set<string>()

  // [state, cookies, key, endpoint, anon, user, sid, emit] from the core, or null before it loads
  const core = () => {
    const c = client() as { _fb?: () => unknown[] } | undefined
    return typeof c?._fb === 'function' ? c._fb() : null
  }

  // Waits up to WAIT for init(): a call made in the page's first script still gets an answer.
  async function started(): Promise<unknown[] | null> {
    for (let t = 0; t < WAIT; t += 50) {
      const b = core()
      if (b?.[2]) return b
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }

  async function fetchConfig() {
    const b = await started()
    if (!b) return
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), WAIT)
    try {
      const url = `${(b[3] as string).replace(/batch$/, 'flags')}?api_key=${b[2]}`
      const r = await fetch(url, { credentials: 'omit', signal: ctl.signal })
      if (!r.ok) failed = Date.now()
      else {
        const j = (await r.json()) as Partial<Config>
        cfg = {
          flags: j.flags && typeof j.flags === 'object' ? j.flags : {},
          experiments: j.experiments && typeof j.experiments === 'object' ? j.experiments : {},
        }
        at = Date.now()
      }
      // an error answer or a failed network keeps the last good answer; with none, defaults
    } catch {
      failed = Date.now()
    }
    clearTimeout(timer)
  }

  // Every call in a burst shares one request. A stale answer is used at once and refreshed behind
  // it, so only the first call on a page waits for the network.
  async function config(): Promise<Config | null> {
    if (typeof window === 'undefined') return null // on a server (SSR): defaults, no request
    if (!cfg && Date.now() - failed < RETRY) return null
    if (!cfg || Date.now() - at > TTL) {
      loading ??= fetchConfig().finally(() => {
        loading = null
      })
      if (!cfg) await loading
    }
    return cfg
  }

  // The visitor to assign: only while tracking, with a stored anon_id (the core sets anon only
  // then). Without it (consent pending, revoked, or cookies refused so the id lasts one page) an
  // assignment could not stay the same.
  const visitor = (b: unknown[] | null) =>
    b?.[1] && typeof b[4] === 'string' && b[4] ? b[4] : null

  /** Is this flag on for this visitor? false when it is unknown, off, or cannot be decided. */
  async function flag(key: string): Promise<boolean> {
    try {
      // on a server there is nothing to ask; before tracking starts only a 100% flag can be on
      if (typeof window === 'undefined') return false
      // typeof, not `in`: a key such as "constructor" must not find Object's own members
      const r = (await config())?.flags[key]
      if (typeof r !== 'number') return false
      if (r >= 100) return true
      const id = visitor(core())
      return !!id && flagOn(key, r, id)
    } catch {
      return false
    }
  }

  /** This visitor's version of a running experiment, recorded once per page as an exposure.
   * 'A' (the original) when it is not running, unknown, or cannot be decided; then nothing is
   * recorded, so the results only count people who were really split. */
  async function experiment(key: string): Promise<Variant> {
    try {
      // without a visitor (on a server, before consent) the answer is A: nothing is requested
      if (typeof window === 'undefined' || !visitor(await started())) return 'A'
      const c = await config()
      const id = c?.experiments[key]
      const b = core()
      const who = visitor(b)
      if (typeof id !== 'string' || !who || !b) return 'A'
      const v = variantOf(id, who)
      const once = `${id}:${who}`
      if (!seen.has(once)) {
        ;(b[7] as Emit)('$experiment_exposure', { $experiment_id: id, $variant: v })
        seen.add(once)
      }
      return v
    } catch {
      return 'A'
    }
  }

  return { flag, experiment }
}
