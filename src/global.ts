// Script-tag build: window.datacub. Replays calls the inline stub queued before load, and starts itself
// from <script src=".../datacub.js" data-key="pk_live_..." data-api-host="..."> when those are present
// (data-require-consent: wait for datacub.consent.grant()).
import datacub, { type InitOptions } from './index.ts'

const w = window as unknown as { datacub?: { _fb?: unknown } }
// Loaded twice (a snippet pasted twice): the first copy stays, the second does nothing.
if (!w.datacub?._fb) {
  const queued = Array.isArray(w.datacub) ? (w.datacub as unknown[][]) : []
  const tag = document.currentScript?.dataset
  w.datacub = datacub
  // data-require-consent (any value): wait for datacub.consent.grant()
  if (tag?.key)
    datacub.init(tag.key, {
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
