import { describe, expect, test } from 'bun:test'
import { env } from 'node:process'
import { clean, cleanUrl, scrub, segment, tally, text } from '../src/scrub.ts'

// PII corpus: generated here from a seeded PRNG so it is identical on every machine, and committed
// as corpus/pii.json. Regenerate with UPDATE_CORPUS=1.
// `sdk` is this SDK's exact output (plain [redacted]).
interface Case {
  id: string
  kind: string
  input: string
  mustNotContain: string[]
  mustContain: string[]
  sdk?: string
}

const CORPUS = `${import.meta.dir}/corpus/pii.json`

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shift = (base: number) => (s: string) =>
  s.replace(/\d/g, (d) => String.fromCharCode(base + Number(d)))
const SCRIPTS: Record<string, (s: string) => string> = {
  ascii: (s) => s,
  arabic: shift(0x660),
  persian: shift(0x6f0),
  fullwidth: shift(0xff10),
  mixed: (s) => {
    let i = 0
    return s.replace(/\d/g, (d) => (i++ % 2 ? shift(0x660)(d) : d))
  },
}
const SEPS: [string, string, number][] = [
  ['none', '', 4],
  ['space', ' ', 4],
  ['hyphen', '-', 3],
  ['dot', '.', 3],
  ['slash', '/', 4],
  ['nbsp', ' ', 4],
  ['rlm', '‏', 1],
  ['zwsp', '​', 2],
  ['tatweel', 'ـ', 1],
  ['ar_thousands', '٬', 3],
  ['alm', '؜', 2],
  ['en_dash', '–', 4],
]
const NUM_SENTENCES: [string, string][] = [
  ['my national id is ', ' thanks'],
  ['رقم الهوية ', ' شكرا لك'],
  ['call me on ', ' after lunch'],
  ['جوالي: ', ' (مساءً)'],
  ['رقم:', '،شكرا'],
  ['', ''],
  ['payment details ', ' ok'],
  ['حسابي ', ' في البنك'],
]
const TOKEN_SENTENCES: [string, string][] = [
  ['email me at ', ' today'],
  ['راسلني على ', ' اليوم'],
  ['', ''],
  ['the key is ', ' do not share'],
  ['المفتاح ', ' سري'],
]
const NEGATIVES = [
  '149.50',
  'السعر ١٤٩٫٥٠ ريال',
  '99.99 SAR',
  'qty 3',
  '42',
  '1234',
  '920000',
  '12345678',
  '1234 5678',
  '١٢٣٤٥٦٧٨',
  '۱۲۳۴۵۶۷۸',
  '#12345678',
  'ORD-1234567',
  '2026-10-31',
  '٢٠٢٦-١٠-٣١',
  '31/10/2026',
  '2026-10-31T10:30:00Z',
  '10:30',
  '3f2b9c4e-8a1d-4e5f-b6c7-d8e9fa0b1c2d',
  'c0ffee4e-bead-4abc-9def-deadbeefcafe',
  'uuid a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5 ok',
  '507f1f77bcf86cdabcdefabc',
  'مرحبا بك في متجرنا',
  'عبايات سوداء',
  'الباقة الذهبية',
  'pro_annual',
  'Business Plus',
  'v2.3.1',
  'Room 101, Floor 3',
  'Zoom 4K 2160p',
  'SA tax 15%',
  'sk_test_abc',
  'AKIA',
  'bearer token',
  'user at example dot com',
  '@handle',
  'a@b',
  '#ff00aa',
  'خصم ٢٠٪ على الطلب',
  'shipping to Riyadh',
  // digit-heavy UUID: its hyphen-joined digit groups must not read as one digit run
  '123e4567-e89b-12d3-a456-426614174000',
  'order 123e4567-e89b-12d3-a456-426614174000 shipped',
]

export function generate(): Case[] {
  const r = prng(20261031)
  const int = (n: number) => Math.floor(r() * n)
  const pick = <T>(a: readonly T[]) => a[int(a.length)] as T
  const digits = (n: number) => Array.from({ length: n }, () => int(10)).join('')
  const chars = (n: number, set: string) => Array.from({ length: n }, () => pick([...set])).join('')
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const luhn = (body: string) => {
    let s = 0
    for (let i = 0; i < body.length; i++) {
      let x = Number(body[body.length - 1 - i])
      if (i % 2 === 0) x = x * 2 > 9 ? x * 2 - 9 : x * 2
      s += x
    }
    return body + ((10 - (s % 10)) % 10)
  }
  // real ISO 7064 check digits: S=28, A=10
  const iban = () => {
    const bban = digits(20)
    return `SA${String(98n - (BigInt(`${bban}281000`) % 97n)).padStart(2, '0')}${bban}`
  }
  const card = () => {
    const len = 13 + int(7)
    const pre = pick(['4', '51', '37', '6011', '35'])
    return luhn(pre + digits(len - pre.length - 1))
  }
  const group = (s: string, sep: string, size: number) =>
    sep ? (s.match(new RegExp(`.{1,${size}}`, 'g')) as string[]).join(sep) : s

  const out: Case[] = []
  const kinds: [string, number, () => string][] = [
    ['sa_id', 60, () => luhn(`${1 + int(2)}${digits(8)}`)],
    ['mobile_local', 24, () => `05${digits(8)}`],
    ['mobile_intl', 24, () => `+9665${digits(8)}`],
    ['mobile_00', 24, () => `009665${digits(8)}`],
    ['iban', 36, iban],
    ['card', 48, card],
  ]
  let i = 0
  for (const [kind, n, make] of kinds)
    for (let k = 0; k < n; k++, i++) {
      const raw = make()
      const script = Object.keys(SCRIPTS)[i % 5] as string
      const [sepName, sep, size] = SEPS[Math.floor(i / 5) % SEPS.length] as [string, string, number]
      const plus = raw.match(/^(?:\+|SA)/)?.[0] ?? ''
      const written =
        plus + (SCRIPTS[script] as (s: string) => string)(group(raw.slice(plus.length), sep, size))
      const [pre, post] = pick(NUM_SENTENCES)
      out.push({
        id: `${kind}-${k + 1}-${script}-${sepName}`,
        kind,
        input: pre + written + post,
        mustNotContain: [written, raw.replace(/\D/g, '')],
        mustContain: [pre, post].filter(Boolean),
        sdk: `${pre}${plus}[redacted]${post}`,
      })
    }

  const tokens: [string, number, () => string][] = [
    [
      'email',
      30,
      () =>
        `${pick(['ahmed', 'fatima.alharbi', 'm.alotaibi+shop', `user_${digits(4)}`, 'نورة', 'user١٢٣'])}@${pick(['example.com', 'mail.example.sa', 'شركة.السعودية', 'example.co.uk'])}`,
    ],
    [
      'jwt',
      20,
      () => {
        const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
        const payload = { sub: `user_${digits(6)}`, name: pick(['Ahmed', 'سارة']), iat: 1790000000 }
        return `${b({ alg: 'HS256', typ: 'JWT' })}.${b(payload)}.${chars(43, `${ALNUM}_`)}`
      },
    ],
    ['sk_live', 15, () => `sk_${pick(['live', 'test'])}_${chars(24 + int(16), ALNUM)}`],
    ['aws', 15, () => `AKIA${chars(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}`],
    [
      'bearer',
      20,
      () => `${pick(['Bearer', 'bearer', 'BEARER'])} ${chars(20 + int(20), `${ALNUM}._~+/-`)}`,
    ],
  ]
  for (const [kind, n, make] of tokens)
    for (let k = 0; k < n; k++) {
      const v = make()
      const [pre, post] = pick(TOKEN_SENTENCES)
      const secret = kind === 'bearer' ? v.split(' ')[1] : v
      out.push({
        id: `${kind}-${k + 1}`,
        kind,
        input: pre + v + post,
        mustNotContain: kind === 'jwt' ? [v, v.split('.')[1] as string] : [secret as string],
        mustContain: [pre, post].filter(Boolean),
        // a JWT is matched whole by the eyJ detector
        sdk: `${pre}[redacted]${post}`,
      })
    }
  // short JWT segments (under 32 characters each), common for small payloads
  for (const [k, sub] of ['1012345678', 'u_42'].entries()) {
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const v = `${b({ alg: 'HS256' })}.${b({ sub })}.${chars(22, ALNUM)}`
    out.push({
      id: `jwt-short-${k + 1}`,
      kind: 'jwt',
      input: `token ${v} end`,
      mustNotContain: [v, v.split('.')[1] as string],
      mustContain: ['token ', ' end'],
    })
  }
  const key = `MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7${chars(12, ALNUM)}`
  out.push(
    {
      id: 'private-key-1',
      kind: 'secret',
      input: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,
      mustNotContain: ['PRIVATE KEY', key],
      mustContain: [],
    },
    {
      id: 'slack-1',
      kind: 'secret',
      input: `slack xoxb-${digits(12)}-${chars(24, ALNUM)} here`,
      mustNotContain: ['xoxb-'],
      mustContain: ['slack ', ' here'],
      sdk: 'slack [redacted] here',
    },
  )
  for (const [k, v] of NEGATIVES.entries())
    out.push({
      id: `negative-${k + 1}`,
      kind: 'negative',
      input: v,
      mustNotContain: [],
      mustContain: [v],
      sdk: v,
    })
  return out
}

// Independent of the SDK's own normaliser on purpose.
const norm = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\s./()ـ٫٬‐-―​-‏؜‪-‮⁦-⁩﻿-]/g, '')
const leaks = (s: string) =>
  /\d{9,}/.test(norm(s)) ||
  /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(s) ||
  /eyJ[\w-]{8,}/.test(s) ||
  /AKIA[0-9A-Z]{16}|sk_(?:live|test)_\w{16,}|bearer\s+\S{16,}/i.test(s)

// Cases this SDK gets wrong today. Each is a real defect, reported; the test flips when fixed.
// Corpus cases pinned as known SDK defects (test.failing). Empty: the JWT leak found by the
// adversarial suite is fixed by the eyJ detector.
const KNOWN: Record<string, string> = {}

const corpus: Case[] = await Bun.file(CORPUS)
  .json()
  .catch(() => [])
if (env.UPDATE_CORPUS) await Bun.write(CORPUS, `${JSON.stringify(generate(), null, 2)}\n`)

describe('PII corpus', () => {
  test('the committed corpus is the generated one, at least 300 cases', () => {
    expect(corpus).toEqual(generate())
    expect(corpus.length).toBeGreaterThanOrEqual(300)
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length)
  })

  for (const c of corpus)
    (KNOWN[c.id] ? test.failing : test)(`${c.id}${KNOWN[c.id] ? ` (${KNOWN[c.id]})` : ''}`, () => {
      const out = scrub(c.input)
      for (const s of c.mustNotContain) expect(out).not.toContain(s)
      for (const s of c.mustContain) expect(out).toContain(s)
      if (c.kind !== 'negative') expect(leaks(out)).toBe(false)
      if (c.sdk !== undefined) expect(out).toBe(c.sdk)
    })
})

describe('text', () => {
  test('free text limits', () => {
    expect(text('a b c d e f g h i j k')).toBe('a b c d e f g h i j k')
    expect(text('a b c d e f g h i j k l')).toBe('[redacted]')
    expect(text('ك '.repeat(12))).toBe('[redacted]')
    expect(text(`${'ab '.repeat(85)}a`)).toBe('[redacted]')
    expect(text('x'.repeat(257))).toBe('[redacted]')
    expect(text('é')).toBe('é')
  })

  test('long values are cut at the limit in UTF-16 units, never splitting a surrogate pair', () => {
    expect(text('ab-'.repeat(50), 100)).toBe(`${'ab-'.repeat(33)}a`)
    expect(text(`${'-'.repeat(63)}😀`, 64)).toBe('-'.repeat(63))
    expect(text('سَلَامٌ'.repeat(20), 64)).toHaveLength(64)
  })
})

describe('clean', () => {
  const run = (v: unknown) => {
    tally.n = 0
    return { out: clean(v), n: tally.n }
  }

  test('depth is capped at three levels', () => {
    expect(clean({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: '[depth]' } } })
    expect(clean({ a: [[[1]]] })).toEqual({ a: [['[depth]']] })
    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ
    expect(clean({ circ })).toEqual({ circ: { a: 1, self: { a: 1, self: '[depth]' } } })
  })

  test('200 keys and 100 array items', () => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, i]))
    const out = clean(many) as Record<string, unknown>
    expect(Object.keys(out)).toHaveLength(200)
    expect(out.k199).toBe(199)
    expect(out.k200).toBeUndefined()
    expect(clean({ a: Array.from({ length: 150 }, (_, i) => i) })).toEqual({
      a: Array.from({ length: 100 }, (_, i) => i),
    })
  })

  test('values that are not data are dropped', () => {
    class Thing {
      x = 1
    }
    expect(
      clean({
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        ninf: Number.NEGATIVE_INFINITY,
        fn: () => 1,
        sym: Symbol('s'),
        big: 10n,
        undef: undefined,
        cls: new Thing(),
        map: new Map([['a', 1]]),
        set: new Set([1]),
        re: /x/,
        bad: new Date(Number.NaN),
        arr: [1, Number.NaN, 'a', () => 1],
        date: new Date(0),
        nul: null,
        bool: false,
        bare: Object.assign(Object.create(null), { a: 1 }),
      }),
    ).toEqual({
      arr: [1, 'a'],
      date: '1970-01-01T00:00:00.000Z',
      nul: null,
      bool: false,
      bare: { a: 1 },
    })
  })

  test('numbers that are long digit runs are redacted', () => {
    expect(clean({ a: 1012345678, b: 149.5, c: 12345678, d: 1e21, e: -0 })).toEqual({
      a: '[redacted]',
      b: 149.5,
      c: 12345678,
      d: 1e21,
      e: -0,
    })
  })

  test('decimals are data, not identifiers: prices, coordinates and float noise pass', () => {
    const v = { a: 0.1 + 0.2, b: 24.7135517, c: 12.345678901 }
    expect(clean(v)).toEqual(v)
  })

  test('PII in nested values', () => {
    const { out, n } = run({
      note: 'contact ahmed@example.com now',
      ar: 'هويتي ١٠١٢٣٤٥٦٧٨',
      list: ['0551234567', { x: '4111 1111 1111 1111' }],
    })
    expect(out).toEqual({
      note: 'contact [redacted] now',
      ar: 'هويتي [redacted]',
      list: ['[redacted]', { x: '[redacted]' }],
    })
    expect(n).toBe(4)
  })

  const BLOCKED = [
    'password',
    'passwd',
    'pwd',
    'pin',
    'otp',
    'totp',
    'mfa_code',
    'cvv',
    'cvc',
    'card_number',
    'cardNumber',
    'pan',
    'iban',
    'iqama',
    'hawiya',
    'national_id',
    'nationalId',
    'nid',
    'id_number',
    'ssn',
    'token',
    'authorization',
    'secret',
    'apikey',
    'session_id',
    'cookie',
    'jwt',
    'bearer',
    'csrf',
    'xsrf',
    'passport',
    // suffix rule after removing separators, any case
    'user_password',
    'newPassword',
    'Card-Number',
    'access token',
    'X-CSRF',
    'refresh_token',
    'client secret',
    'customer_iban',
    // Arabic
    'كلمة المرور',
    'الرقم السري',
    'رمز التحقق',
    'رقم الهوية',
    'الهوية الوطنية',
    'الإقامة',
    'رقم الإقامة',
    'رقم البطاقة',
    'الآيبان',
    'رقم_الآيبان',
    // joined words, separators and trailing numbers do not hide a blocked word
    'userpin',
    'smsotp',
    'user:pin',
    'auth/otp',
    'p_w_d',
    '2fa_code',
    'password_confirm',
    'pin_number',
    'pin_code_length',
    'pin2',
    // documented over-match of the suffix rule
    'dropin',
    // Arabic spellings, normalised (tatweel, marks, hamza, ة, ى)
    'كلمـة_المرور',
    'كلمه_المرور',
    'كلمة_السر',
    'الرمز_السري',
    'رقم_الاقامة',
    'الاقامه',
    'رقم_الهويه',
    'الايبان',
    'رقم الهوية الوطنية',
    'كَلِمَة_المرور',
    'x-api-key',
    'cc_number',
    'credit_card',
    'private_key',
    'privateKey',
    // compatibility forms (NFKD)
    'ｐａｓｓｗｏｒｄ',
    'paſſword',
    'pássword',
  ]
  const KEPT = [
    'shipping',
    'company',
    'spinner',
    'opinion',
    'napkin',
    'pumpkin',
    'open',
    'plan',
    'tokens',
    'token_count',
    'passwords_reset_count',
    'ip_country',
    // ordinary words that only end in a blocked word
    'japan',
    'Span',
    'spin',
    'chopin',
    'visited_japan',
    'android',
    'my_timestamp',
    'الاسم',
    'المدينة',
    // ordinary words next to a blocked one stay safe
    'page',
    'plan_name',
    'language',
    'token_usage',
    'said_no',
    'cookie_consent',
    'nonce_count',
    'opinion_poll',
  ]

  test('blocked keys, English and Arabic, exact and suffix, at every depth', () => {
    const v = Object.fromEntries([...BLOCKED, ...KEPT].map((k) => [k, 'v']))
    const { out, n } = run({ ...v, nested: v })
    const expected = Object.fromEntries(KEPT.map((k) => [k, 'v']))
    expect(out).toEqual({ ...expected, nested: expected })
    expect(n).toBe(BLOCKED.length * 2)
  })

  test('reserved keys only at the top level; malformed keys anywhere', () => {
    const reserved = {
      $set: 1,
      $anything: 1,
      distinct_id: 1,
      person_id: 1,
      project_id: 1,
      timestamp: 1,
      uuid: 1,
      ip: 1,
      api_key: 1,
    }
    const bad = { '': 1, ' ': 1, 'a.b': 1, ['x'.repeat(201)]: 1, 'a\u0000b': 1, '‮evil': 1 }
    const { out, n } = run({
      ...reserved,
      ...bad,
      ' plan ': 'pro',
      nested: { ...reserved, ...bad },
    })
    // blocked by name at any depth: api_key (apikey) and person_id ("personid" ends in "nid")
    const { api_key: _, person_id: __, ...nestedKept } = reserved
    expect(out).toEqual({ plan: 'pro', nested: nestedKept })
    expect(n).toBe(9 + 6 + 2 + 6)
  })

  test('__proto__ and constructor keys do not pollute', () => {
    const out = clean(
      JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}'),
    )
    expect(JSON.stringify(out)).toBe('{}')
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
    expect(Object.keys(Object.prototype)).toEqual([])
  })
})

describe('regex cost', () => {
  // the email detector once backtracked quadratically: 100 KB of `a.` froze the tab for seconds
  test('100 KB crafted values scan in well under a second', () => {
    for (const v of [
      'a.'.repeat(5e4),
      'eyJa.'.repeat(2e4),
      'a@'.repeat(5e4),
      `x@${'a.'.repeat(5e4)}`,
    ]) {
      const t = performance.now()
      scrub(v)
      cleanUrl(`https://shop.example/${v}?${v}=1#/${v}`, true, true)
      expect(performance.now() - t).toBeLessThan(500)
    }
    expect(scrub('user.name+tag@example.co.uk')).toBe('[redacted]')
  })
})

describe('segment', () => {
  const cases: [string, string][] = [
    ['ahmed@example.com', ':redacted'],
    ['ahmed%40example.com', ':redacted'],
    ['1012345678', ':redacted'],
    ['0551234567', ':redacted'],
    ['%D9%A1%D9%A0%D9%A1%D9%A2%D9%A3%D9%A4%D9%A5%D9%A6%D9%A7%D9%A8', ':redacted'],
    ['SA0380000000608010167519', ':redacted'],
    ['product-123456789-red', ':redacted'],
    ['3f2b9c4e-8a1d-4e5f-b6c7-d8e9fa0b1c2d', ':uuid'],
    ['507f1f77bcf86cdabcdefabc', ':id'],
    ['deadbeefdeadbeefcafe', ':hash'],
    ['aB3dEfGhIjKlMnOpQrStUv', ':token'],
    ['42', ':id'],
    ['%D9%A4%D9%A2', ':id'],
    ['2026', ':id'],
    ['INV-2026-0045', ':id'],
    ['a1234', ':id'],
    ['order-12345', 'order-12345'],
    ['v2', 'v2'],
    ['abc123', 'abc123'],
    ['checkout', 'checkout'],
    ['%D8%B9%D8%A8%D8%A7%D9%8A%D8%A7%D8%AA', '%D8%B9%D8%A8%D8%A7%D9%8A%D8%A7%D8%AA'],
    ['%E0%A4%A', '%E0%A4%A'],
  ]
  for (const [seg, want] of cases) test(`${seg} -> ${want}`, () => expect(segment(seg)).toBe(want))

  test('digit-heavy UUID is :uuid', () =>
    expect(segment('123e4567-e89b-12d3-a456-426614174000')).toBe(':uuid'))
  // the detector check runs first, so a 24-hex ID with a 9+ digit run is :redacted, not :id
  test('24-hex with a 9-digit run is :redacted (documented)', () =>
    expect(segment('507f1f77bcf86cd799439011')).toBe(':redacted'))
})

describe('cleanUrl', () => {
  test('path and url stay within the envelope limits', () => {
    const r = cleanUrl(`https://a.example/${'abc/'.repeat(800)}`)
    expect(r?.path.length).toBeLessThanOrEqual(1024)
    expect(r?.url.length).toBeLessThanOrEqual(2048)
  })

  test('userinfo, query and fragment are dropped', () => {
    expect(
      cleanUrl('https://user:pass@shop.example/a/b?email=a%40b.co&q=x#access_token=abc'),
    ).toEqual({
      url: 'https://shop.example/a/b',
      path: '/a/b',
    })
  })

  test('utm keys move to utm, scrubbed; other query keys go', () => {
    expect(
      cleanUrl(
        'https://shop.example/?UTM_Source=News&utm_medium=cpc&utm_campaign=ahmed%40example.com&utm_term=&utm_content=%D8%AA%D8%AE%D9%81%D9%8A%D8%B6&utm_id=1&token=x',
      ),
    ).toEqual({
      url: 'https://shop.example/',
      path: '/',
      utm: { source: 'News', medium: 'cpc', campaign: '[redacted]', content: 'تخفيض' },
    })
  })

  const CLICK: [string, string][] = [
    ['gclid', 'gclid'],
    ['gbraid', 'gclid'],
    ['wbraid', 'gclid'],
    ['fbclid', 'fbclid'],
    ['ttclid', 'ttclid'],
    ['msclkid', 'msclkid'],
    ['ScCid', 'sccid'],
    ['twclid', 'twclid'],
    ['li_fat_id', 'li_fat_id'],
  ]
  for (const [k, type] of CLICK)
    test(`click id ${k} keeps only its type`, () => {
      const r = cleanUrl(`https://shop.example/p?${k}=CLICKVALUE123`)
      expect(r).toEqual({ url: 'https://shop.example/p', path: '/p', click_id_type: type })
      expect(JSON.stringify(r)).not.toContain('CLICKVALUE123')
    })

  test('hash routing keeps #/ and #!/ routes, templated, without their query', () => {
    expect(cleanUrl('https://shop.example/#/users/1012345678/edit?email=a@b.co', true)).toEqual({
      url: 'https://shop.example/#/users/:redacted/edit',
      path: '/#/users/:redacted/edit',
    })
    expect(cleanUrl('https://shop.example/app#!/orders/42', true)?.path).toBe('/app#!/orders/:id')
    expect(cleanUrl('https://shop.example/#section', true)?.path).toBe('/')
    expect(cleanUrl('https://shop.example/#access_token=abc', true)?.path).toBe('/')
    expect(cleanUrl('https://shop.example/#/users/1', false)?.path).toBe('/')
  })

  test('every template type in one path; Arabic slugs kept', () => {
    const href =
      'https://shop.example/u/ahmed%40example.com/o/1012345678/r/3f2b9c4e-8a1d-4e5f-b6c7-d8e9fa0b1c2d/m/507f1f77bcf86cdabcdefabc/h/deadbeefdeadbeefcafe/t/aB3dEfGhIjKlMnOpQrStUv/n/42/منتجات/عبايات-سوداء'
    const slug = new URL('https://datacub.example/منتجات/عبايات-سوداء').pathname
    expect(cleanUrl(href)?.path).toBe(
      `/u/:redacted/o/:redacted/r/:uuid/m/:id/h/:hash/t/:token/n/:id${slug}`,
    )
  })

  test('mailto, tel, sms and whatsapp keep only the scheme; other schemes are refused', () => {
    expect(cleanUrl('mailto:ahmed@example.com?subject=x')).toEqual({
      url: 'mailto:',
      path: 'mailto:',
    })
    expect(cleanUrl('tel:+966551234567')).toEqual({ url: 'tel:', path: 'tel:' })
    expect(cleanUrl('sms:+966551234567')?.url).toBe('sms:')
    expect(cleanUrl('whatsapp://send?phone=966551234567')?.url).toBe('whatsapp:')
    for (const u of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://a.example/x',
      '/relative',
      'nope',
    ])
      expect(cleanUrl(u)).toBeNull()
  })

  test('a redacted segment is counted', () => {
    tally.n = 0
    cleanUrl('https://shop.example/u/ahmed%40example.com/o/1012345678')
    expect(tally.n).toBe(2)
  })
})
