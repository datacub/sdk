// Script-tag build: window.datacub. Replays calls the inline stub queued before load, and starts itself
// from <script src=".../sdk.js" data-id="k7qm2xpa" data-api-host="..."> when those are present
// (data-require-consent: wait for datacub.consent.grant()).
import datacub, { type InitOptions } from './index.ts'

const w = window as unknown as { datacub?: { _fb?: unknown } }
// Loaded twice (a snippet pasted twice): the first copy stays, the second does nothing.
if (!w.datacub?._fb) {
  const queued = Array.isArray(w.datacub) ? (w.datacub as unknown[][]) : []
  const me = document.currentScript as HTMLScriptElement | null
  const tag = me?.dataset
  // the origin that served this file: the ingestion host, unless data-api-host or apiHost names a proxy
  const home = me?.src ? new URL(me.src).origin : undefined
  const init = datacub.init
  datacub.init = (key, o) => {
    const apiHost = o?.apiHost || home
    return init(key, apiHost ? { ...o, apiHost } : o)
  }
  w.datacub = datacub
  // data-require-consent (any value): wait for datacub.consent.grant()
  // data-id: the project's public ID; data-key: a pk_ key from an install before IDs
  const id = tag?.id || tag?.key
  if (id)
    datacub.init(id, {
      apiHost: tag.apiHost,
      requireConsent: tag.requireConsent != null,
    } as InitOptions)
  for (const c of queued) {
    // "track", or a dotted name such as "consent.grant"; only the SDK's own names, and a bad entry
    // never throws into the page
    try {
      const [m, ...a] = c
      const f = String(m)
        .split('.')
        .reduce<unknown>(
          (o, k) => (o && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined),
          datacub,
        )
      if (typeof f === 'function') (f as (...a: unknown[]) => void)(...a)
    } catch {}
  }
}
