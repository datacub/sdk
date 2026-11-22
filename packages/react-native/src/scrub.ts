// Client-side privacy floor. The ingestion service repeats every rule; this copy exists so most
// sensitive values never leave the device.

/** Redactions and drops since the last event; sent as $dropped_count, never with the values. */
export const tally = { n: 0 }

// Arabic-Indic, Persian and fullwidth digits all end in 0..9 in their low nibble.
export const toAscii = (s: string) =>
  s.replace(/[٠-٩۰-۹０-９]/g, (d) => String(d.charCodeAt(0) & 15))

// Characters people put inside numbers to hide them from a regex: spaces, dots, slashes, dashes,
// zero-width and bidi marks.
const SEP =
  /[\s./()\u0640\u066b\u066c\u2010-\u2015\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff-]/g

export const digitsOnly = (s: string) => toAscii(s).replace(SEP, '')

// One digit-run rule covers national ID, Iqama, mobile, card and IBAN digits, and one
// long-run rule covers JWTs, API keys and base64 blobs; together they over-redact long order
// numbers and long slugs without separators, which is accepted. The server repeats
// every detector with its type, so the device only needs to redact, not classify.
// UUIDs come first and are kept: they are IDs datacub and customers generate, not personal data
// (an exception to the rules below), and their digit groups would otherwise read as a digit
// run. Then
// secrets, emails (bounded, so a long run of dots cannot backtrack quadratically), JWTs, digit runs with SEP inside, and long runs (hyphens excluded so UUIDs
// survive). One literal, not new RegExp(): the source needs no escaping twice.
const DETECT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|bearer\s+\S{16,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]+|PRIVATE KEY|[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}|eyJ[\w-]+\.[\w-]+\.[\w-]*|\d(?:[\s./()ـ٫٬‐-―​-‏؜‪-‮⁦-⁩﻿-]*\d){8,}|[\w+/=]{32,}/gi

// Detection runs on the digit-normalised copy, which has the same length, so indexes line up and
// the rest of the original string is kept as written.
export function scrub(s: string): string {
  let out = ''
  let i = 0
  for (const m of toAscii(s).matchAll(DETECT)) {
    if (/^[0-9a-f]{8}-/i.test(m[0]) && m[0].length === 36) continue
    out += `${s.slice(i, m.index)}[redacted]`
    i = m.index + m[0].length
    tally.n++
  }
  return out + s.slice(i)
}

// A customer string: NFC, free text of at most 11 words, the detectors, then a cut in UTF-16 units (as the server
// schema counts) that never leaves half a surrogate pair.
export function text(v: string, max = 1024): string {
  v = v.normalize('NFC')
  if (v.length > 256 || v.trim().split(/\s+/).length > 11) {
    tally.n++
    return '[redacted]'
  }
  return scrub(v)
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '')
}

export const badText = (s: string) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  /[\u0000-\u001f\u007f-\u009f‎‏؜‪-‮⁦-⁩]/.test(s)

// Property keys: a subset of the server's key classifier, which is the control and holds the full
// lists and rules. Every key dropped here is blocked there too. Keys only the server blocks
// (compounds before an ordinary word, credit terms) are left out to keep the core small.
// Needs-review keys are sent as they are: a project can approve
// one, and only the server knows which. Trimmed, 1 to 200 characters, no dot or control
// characters, not reserved at the top level, not a prototype key. The key is normalised as the server
// does (NFKD, no marks or tatweel, ة as ه, ى as ي) and cut into words, trailing number words
// dropped ("pin2"); a blocked word at the end of the joined words blocks it ("userpin") unless the
// last word is an ordinary one ("japan"), and a secret word anywhere blocks it ("password_confirm").
// No lookbehind or .at(): older Safari lacks them.
const BLOCKED =
  /(?:passw(?:or)?d|passcode|pwd|pin|pincode|otp|otpcode|onetimecode|mfacode|2facode|tfacode|smscode|secretkey|privatekey|authcode|verificationcode|securitycode|resetcode|cvv|cvc|cardnumber|ccnumber|creditcard|pan|iban|iqama|hawiya|nationalid|nid|idnumber|ssn|token|authorization|secret|apikey|sessionid|cookie|jwt|bearer|csrf|xsrf|passport|كلمهالمرور|كلمهالسر|الرمزالسري|الرقمالسري|رمزالتحقق|رقمالهويه|الهويهالوطنيه|الاقامه|البطاقه|الايبان)$/

export function badKey(k: string, top: boolean): boolean {
  const w = k
    .normalize('NFKD')
    .replace(/[\p{M}\u0640]/gu, '')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(\p{Ll})(?=\p{Lu})|(\p{N}+)/gu, '$1 $2 ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  while (w.length > 1 && /^\p{N}+$/u.test(w[w.length - 1] as string)) w.pop()
  return (
    !k ||
    [...k].length > 200 ||
    /\./.test(k) ||
    badText(k) ||
    /^(?:__proto__|constructor|prototype)$/.test(k) ||
    (top && /^(?:\$|(?:distinct_id|person_id|project_id|timestamp|uuid|ip|api_key)$)/.test(k)) ||
    (BLOCKED.test(w.join('')) &&
      !/^(?:japan|span|timespan|lifespan|wingspan|saucepan|spin|chopin|android)$/.test(
        w[w.length - 1] as string,
      )) ||
    w.some((x) =>
      /^(?:password|passwd|pwd|passcode|otp|pin|secret|iqama|ssn|cvv|cvc|iban)$/.test(x),
    )
  )
}

// Event properties. Returns undefined for dropped values.
export function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return text(v)
  if (typeof v === 'number')
    // only whole numbers can be phone, ID or card numbers; prices and coordinates pass
    return Number.isFinite(v)
      ? Number.isInteger(v) && scrub(`${v}`) !== `${v}`
        ? '[redacted]'
        : v
      : undefined
  if (typeof v === 'boolean' || v === null) return v
  if (v instanceof Date) return Number.isNaN(+v) ? undefined : v.toISOString()
  if (typeof v !== 'object') return
  if (depth > 2) return '[depth]'
  if (Array.isArray(v))
    return v
      .slice(0, 100)
      .map((x) => clean(x, depth + 1))
      .filter((x) => x !== undefined)
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto) return
  const out: Record<string, unknown> = {}
  for (const [raw, val] of Object.entries(v).slice(0, 200)) {
    const k = raw.trim()
    if (badKey(k, !depth)) tally.n++
    else {
      const c = clean(val, depth + 1)
      if (c !== undefined) out[k] = c
    }
  }
  return out
}

// Path segment templates, checked in this order.
export function segment(seg: string): string {
  let d = seg
  try {
    d = decodeURIComponent(seg)
  } catch {}
  d = toAscii(d)
  const n = tally.n
  if (scrub(d) !== d) {
    tally.n = n + 1
    return ':redacted'
  }
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(d)) return ':uuid'
  if (/^[0-9a-f]{16,}$/i.test(d)) return d.length === 24 ? ':id' : ':hash'
  if (/^[\w-]{20,}$/.test(d) && /\d/.test(d) && /[a-z]/.test(d) && /[A-Z]/.test(d)) return ':token'
  const digits = d.replace(/\D/g, '').length
  return digits && (digits === d.length || (digits > 3 && digits * 2 >= d.length)) ? ':id' : seg
}

export interface Url {
  url: string
  path: string
  utm?: Record<string, string>
  click_id_type?: string
  q?: Record<string, string>
}

// Text the site's developers write (titles, button labels, error messages): the detectors and a
// cut, but not the free-text rule, which would redact any label of 12 words or more.
// Query keys whose values are secrets or what someone typed: kept as keys, never with their value.
const TYPED =
  /^(?:reset|invite|sid|token|jwt|otp|code|key|state|sig(?:nature)?|auth\w*|nonce|session\w*|hash|q|query|search\w*|s|keywords?|term|text|msg|message|comments?|\w*name|e?-?mail\w*|phone|mobile|tel|address\w*|city|zip|postcode|dob|birth\w*)$/i

// A value a site put in a link: one lowercase or one upper-case ASCII word (`price_desc`, `shoes`,
// `EN`), never mixed case, other scripts, spaces, `/`, `?` or `=`, and never a mix of letters and
// digits of 8 or more characters (a short reset or invite code). Names and typed words fail it.
export const code = (v: string) =>
  /^(?:[a-z0-9][a-z0-9._~-]*|[A-Z0-9][A-Z0-9_-]*)$/.test(v) &&
  !(v.length >= 8 && /\d/.test(v) && /[a-z]/i.test(v))

export const label = (v: string, max: number) => scrub(v.normalize('NFC')).slice(0, max)

const path = (p: string) =>
  p
    .split('/')
    .map((s) => s && segment(s))
    .join('/')

// URL sanitiser: userinfo, query (except UTM, moved to utm) and fragments are
// removed, click ID values discarded (type kept), path segments templated. mailto:, tel:, sms: and
// whatsapp: keep only the scheme; other schemes are dropped.
export function cleanUrl(href: string, hashRouting?: boolean, query?: boolean): Url | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  const proto = u.protocol
  if (/^(?:mailto|tel|sms|whatsapp):$/.test(proto)) return { url: proto, path: proto }
  if (!/^https?:$/.test(proto)) return null
  let p = path(u.pathname)
  if (hashRouting && /^#!?\//.test(u.hash)) p += `#${path(u.hash.slice(1).split('?')[0] as string)}`
  p = p.slice(0, 1024)
  const r: Url = { url: (u.origin + p).slice(0, 2048), path: p }
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase()
    if (/^utm_(?:source|medium|campaign|term|content)$/.test(key) && v)
      r.utm = { ...r.utm, [key.slice(4)]: text(v, 200) }
    // the value is discarded; only which ad network sent the visit is kept
    else if (/^(?:gclid|gbraid|wbraid|fbclid|ttclid|msclkid|sccid|twclid|li_fat_id)$/.test(key))
      r.click_id_type = key.replace(/^[gw]braid$/, 'gclid')
    // Every other key (30 at most). A value is kept only when it reads as a code a site put in a
    // link, never as text a person typed (a GET form puts what was typed here): no space, at most
    // 40 characters, no detector hit, and not under a key that names a secret, a search, a person or
    // a message. Id-, token- and UUID-like values become their template, as path segments do.
    else if (query && Object.keys(r.q || {}).length < 30) {
      const t = segment(v)
      r.q ??= {}
      r.q[label(k, 64)] =
        badKey(k, false) || TYPED.test(k) || v.length > 40 || !(t[0] === ':' || code(v))
          ? ''
          : t === ':redacted'
            ? ''
            : t
    }
  }
  return r
}

// Custom event names: no reserved prefix, control or bidi characters, or names that
// look like identifiers. The NFC name, or null when refused.
export function eventName(name: string): string | null {
  const n = name.trim().normalize('NFC')
  return !n ||
    [...n].length > 100 ||
    n[0] === '$' ||
    badText(n) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{16}|@/i.test(n) ||
    // 6 or more digits in any script, also when spaced or split by separators
    /\d{6}/.test(digitsOnly(n))
    ? null
    : n
}

// identify() and account IDs: never an email, phone, Saudi ID, card (Luhn) or JWT, never a
// placeholder, never one of the SDK's own ids (`own`). Narrower than the property scrubber on
// purpose, so long numeric database IDs still work.
export function validId(v: unknown, own: string[]): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = `${v}`
  if (typeof v !== 'string') return null
  const id = v.trim().normalize('NFC')
  const n = digitsOnly(id)
  let sum = 0
  for (let i = 0; i < n.length; i++) {
    const x = +(n[n.length - 1 - i] as string)
    sum += i % 2 ? (x > 4 ? x * 2 - 9 : x * 2) : x
  }
  return !id ||
    [...id].length > 128 ||
    /^(?:null|undefined|0|-1|anonymous|guest|\[object object\]|none|nan|false|true|user|test|unknown|not_authenticated|distinct_id|id)$/i.test(
      id,
    ) ||
    badText(id) ||
    /@|^eyJ/.test(id) ||
    /^(?:[12]\d{9}|(?:\+?966|00966|0)5\d{8}|\+\d{8,15})$/.test(n) ||
    // card shapes only (15 or 16 digits, IIN 2 to 6), so snowflake and bigint IDs still work
    (/^[2-6]\d{14,15}$/.test(n) && sum % 10 === 0) ||
    own.includes(id)
    ? null
    : id
}
