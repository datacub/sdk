// @datacub/web/feedback: the feedback widget. Opt-in and loaded apart from
// the core SDK, so a site without feedback never downloads it. It runs only while the core
// is tracking (not pending or revoked) and the browser keeps cookies; it never reads the page, and nothing it shows is HTML
// from the server: every string goes in as text. The dashboard's preview renders with `mount`, the
// same code a visitor sees.

import { segment } from './scrub.ts'

type Lang = 'ar' | 'en'
export type CardType = 'choice' | 'thumbs' | 'text' | 'nps' | 'general'
export interface Card {
  lang: Lang
  type: CardType
  title: string
  options?: { id: string; label: string }[]
  followup?: string | null
  // the answers that open the follow-up; null: any answer
  followupOn?: string[] | null
}
export interface Look {
  accent: string
  position: 'end' | 'start'
  theme?: 'light' | 'dark' | 'auto'
}
/** An editor edits the card itself: the same card, with its words as fields. */
export interface Edit {
  title(v: string): void
  option(id: string, v: string): void
  // the card adds the field at once and names it, so fast typing has somewhere to go
  add(id: string): void
  remove(id: string): void
  followup(v: string): void
  // where the caret goes once drawn: 'title', 'followup' or an answer id
  focus?: string | null
  ph: {
    title: string
    option: (n: number) => string
    add: string
    remove: string
    followup: string
  }
}
interface Live {
  id: string
  version: number
  q: Card & {
    trigger: { kind: string; event?: string; path?: string; delay?: number }
    delivery?: { waitForIdle?: boolean }
  }
}
interface Client {
  track: (...a: unknown[]) => void
  identify: (...a: unknown[]) => void
  reset: (...a: unknown[]) => void
  consent: { grant: (...a: unknown[]) => void }
  ask?: (id: string, o?: { into?: Element | string }) => void
  feedback?: () => void
  _fb?: () => unknown[]
}

const WORDS = {
  en: {
    close: 'Close',
    send: 'Send',
    sending: 'Sending',
    thanks: 'Thanks for sharing!',
    failed: 'Could not send. Try again.',
    yes: 'Yes',
    no: 'No',
    low: 'Not likely',
    high: 'Very likely',
    type: 'Type your answer',
    general: 'What’s on your mind?',
    tell: 'Tell us anything',
  },
  ar: {
    close: 'إغلاق',
    send: 'إرسال',
    sending: 'جارٍ الإرسال',
    thanks: 'شكرًا على مشاركتك!',
    failed: 'تعذّر الإرسال، حاول مرة ثانية.',
    yes: 'نعم',
    no: 'لا',
    low: 'غير محتمل',
    high: 'محتمل جدًا',
    type: 'اكتب إجابتك',
    general: 'ما الذي يدور في بالك؟',
    tell: 'اكتب ما تريد',
  },
}

const DARK =
  '--bg:#1c1c1f;--fg:#fafafa;--mut:#a1a1aa;--opt:#2a2a2e;--opt-h:#333338;--edge:rgba(255,255,255,.08);--x:#8b8b93;--line:#55555c'
const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.w{--a:#1f1f1f;--on:#fff;--bg:#fff;--fg:#18181b;--mut:#71717a;--opt:#f4f4f5;--opt-h:#ebebee;--edge:rgba(24,24,27,.07);--x:#a1a1aa;--line:#d4d4d8;
position:fixed;z-index:2147483000;bottom:16px;right:16px;width:360px;max-width:calc(100vw - 24px);
font:14px/1.45 system-ui,-apple-system,"Segoe UI","SF Arabic","Noto Sans Arabic",Tahoma,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased;transition:bottom .2s}
.w.dk{${DARK}}
@media (prefers-color-scheme:dark){.w.au{${DARK}}}
.w.s{right:auto;left:16px}
.w.p{position:relative;inset:auto;bottom:auto;right:auto;left:auto;width:100%}
.c{position:relative;background:var(--bg);border-radius:16px;padding:16px;box-shadow:0 0 0 1px var(--edge),0 12px 32px -8px rgba(24,24,27,.22),0 2px 6px rgba(24,24,27,.06);
animation:in .32s cubic-bezier(.2,.9,.25,1) both;transform-origin:bottom}
.c.o{animation:out .18s ease-in both}
.c.q{animation:none}
@keyframes in{from{opacity:0;transform:translateY(10px) scale(.98)}}
@keyframes out{to{opacity:0;transform:translateY(6px) scale(.98)}}
.t{display:block;width:100%;font-family:inherit;font-weight:600;font-size:15px;line-height:1.35;padding:0;padding-inline-end:28px;color:var(--fg);overflow-wrap:anywhere;background:none;border:0;resize:none;min-height:0;max-height:none;box-shadow:none}
.x{position:absolute;top:10px;inset-inline-end:10px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--x);cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s}
.x:hover{background:var(--opt);color:var(--fg)}
button,input{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.g{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.o1{position:relative;display:flex;align-items:center;gap:10px;min-height:40px;width:100%;padding:8px 12px;border:0;border-radius:10px;background:var(--opt);text-align:start;cursor:pointer;
transition:background .15s,box-shadow .15s,transform .12s}
.o1:hover{background:var(--opt-h)}
.o1:active{transform:scale(.985)}
.o1[aria-pressed=true]{background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--a)}
.d{flex:none;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--line);display:grid;place-items:center;transition:box-shadow .15s,background .15s}
.o1[aria-pressed=true] .d{background:var(--a);box-shadow:none}
.d svg{width:10px;height:10px;color:var(--on);transform:scale(0);transition:transform .2s cubic-bezier(.3,1.6,.5,1)}
.o1[aria-pressed=true] .d svg{transform:scale(1)}
.th{display:flex;gap:8px;margin-top:12px}
.th .o1{justify-content:center;flex:1}
.th svg{width:20px;height:20px}
.n{display:grid;grid-template-columns:repeat(11,1fr);gap:4px;margin-top:12px;direction:ltr}
.n .o1{min-height:36px;padding:0;justify-content:center;font-variant-numeric:tabular-nums;font-size:13px}
.n .o1[aria-pressed=true]{background:var(--a);color:var(--on);box-shadow:none}
.nl{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--mut)}
.f{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s cubic-bezier(.2,.9,.25,1)}
.f.on{grid-template-rows:1fr}
.f>div{overflow:hidden;min-height:0}
.fi{padding-top:12px}
textarea{display:block;width:100%;min-height:76px;max-height:180px;resize:vertical;padding:10px 12px;border:0;border-radius:10px;background:var(--opt);font:inherit;color:var(--fg);
box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s,background .15s}
textarea:focus{background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--a);outline:0}
textarea::placeholder,input::placeholder{color:var(--x)}
.r{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
.e{font-size:12px;color:#d1453b}
.b{margin-inline-start:auto;height:34px;padding:0 14px;border:0;border-radius:10px;background:var(--a);color:var(--on);font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:opacity .15s,transform .12s}
.b:active{transform:scale(.97)}
.b[disabled]{opacity:.45;cursor:default}
.b[aria-busy=true]{opacity:.7}
.sp{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-inline-end-color:transparent;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(1turn)}}
.k{display:flex;align-items:center;gap:12px;padding:6px 0;animation:in .3s cubic-bezier(.2,.9,.25,1) both}
.k svg{flex:none;width:28px;height:28px;color:var(--a)}
.k path{stroke-dasharray:24;stroke-dashoffset:24;animation:ck .4s .1s ease-out forwards}
@keyframes ck{to{stroke-dashoffset:0}}
.k strong{color:var(--fg);font-size:15px;font-weight:600}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){.w:not(.p){bottom:max(12px,env(safe-area-inset-bottom));left:12px;right:12px;width:auto;max-width:none}
.o1{min-height:44px}.n .o1{min-height:40px}}
@media (prefers-reduced-motion:reduce){*,.c,.k{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`

const SVG = 'http://www.w3.org/2000/svg'
export const ICONS = {
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  plus: 'M8 3.5v9M3.5 8h9',
  up: 'M7 10v10H4V10h3zm0 0l4-7c1.3 0 2.2 1.1 2 2.4L12.4 9H18a2 2 0 0 1 2 2.3l-1.2 6.9A2 2 0 0 1 16.8 20H7',
  down: 'M17 14V4h3v10h-3zm0 0l-4 7c-1.3 0-2.2-1.1-2-2.4l.6-3.6H6a2 2 0 0 1-2-2.3l1.2-6.9A2 2 0 0 1 7.2 4H17',
}

// The editing parts, filled in by an editor that imports this module. The visitor build
// (feedback.js) never loads them, so a page that only shows questions does not download an editor.
export interface Parts {
  css: string
  title(card: Card, ed: Edit, c: HTMLElement): HTMLElement
  followup(card: Card, ed: Edit): HTMLElement
  choices(card: Card, ed: Edit): HTMLElement
  focus(ed: Edit, c: HTMLElement): void
}
export const parts: Partial<Parts> = {}

export function icon(d: string, box = 16, width = 1.6): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('viewBox', `0 0 ${box} ${box}`)
  s.setAttribute('aria-hidden', 'true')
  s.setAttribute('fill', 'none')
  const p = document.createElementNS(SVG, 'path')
  p.setAttribute('d', d)
  p.setAttribute('stroke', 'currentColor')
  p.setAttribute('stroke-width', String(width))
  p.setAttribute('stroke-linecap', 'round')
  p.setAttribute('stroke-linejoin', 'round')
  s.append(p)
  return s
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

// Constructable stylesheets are not inline styles, so a strict style-src CSP does not block them.
let sheet: CSSStyleSheet | null = null
function styled(root: ShadowRoot) {
  try {
    sheet ??= new CSSStyleSheet()
    if (!sheet.cssRules.length) sheet.replaceSync(CSS + (parts.css ?? ''))
    root.adoptedStyleSheets = [sheet]
  } catch {
    // Very old browsers only; a strict CSP leaves them unstyled
    root.append(el('style', undefined, CSS + (parts.css ?? '')))
  }
}

const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// readable text on the brand colour
const onColor = (hex: string) => (luminance(hex) > 0.4 ? '#18181b' : '#fff')

export interface Mounted {
  close(): void
}

/** The look on a card or the button: brand colour, corner, theme. */
function dress(node: HTMLElement, look: Look) {
  let accent = /^#[0-9a-f]{6}$/i.test(look.accent) ? look.accent : '#1f1f1f'
  const dark =
    look.theme === 'dark' ||
    (look.theme === 'auto' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  // a near-black brand colour would vanish on a dark card
  if (dark && luminance(accent) < 0.05) accent = '#fafafa'
  node.style.setProperty('--a', accent)
  node.style.setProperty('--on', onColor(accent))
  if (look.theme === 'dark') node.classList.add('dk')
  if (look.theme === 'auto') node.classList.add('au')
}

/**
 * One question card inside `root`. `send` stores the answer (it rejects to show a retry); `done`
 * runs once when the card goes away, with whether an answer was sent. With `edit`, the same card
 * is the composer's editor: its words are fields and nothing is sent.
 */
export function mount(
  root: ShadowRoot,
  card: Card,
  look: Look,
  o: {
    send: (choice: string | null, text: string | null) => Promise<void>
    done?: (answered: boolean) => void
    preview?: boolean
    // placed in the page by the developer (datacub.ask(id, {into})): in the flow, stays after thanks
    inline?: boolean
    // redrawn while someone edits it: no entrance
    quiet?: boolean
    // opened by the person (the button, datacub.feedback()): focus moves in. A question datacub shows on its
    // own never takes focus from the page
    focus?: boolean
    edit?: Edit
  },
): Mounted {
  styled(root)
  const w = WORDS[card.lang] ?? WORDS.en
  const ed = o.edit
  const wrap = el(
    'div',
    `w${look.position === 'start' ? ' s' : ''}${o.preview || o.inline || ed ? ' p' : ''}${ed ? ' ed' : ''}`,
  )
  wrap.dir = card.lang === 'ar' ? 'rtl' : 'ltr'
  wrap.lang = card.lang
  dress(wrap, look)
  const c = el('div', o.quiet || ed ? 'c q' : 'c')
  const titleId = `datacub-fb-${Math.random().toString(36).slice(2, 8)}`
  c.setAttribute('role', o.preview || o.inline || ed ? 'group' : 'dialog')
  c.setAttribute('aria-labelledby', titleId)
  const live = el('p', 'sr')
  live.setAttribute('aria-live', 'polite')
  const close = el('button', 'x')
  close.type = 'button'
  close.setAttribute('aria-label', w.close)
  close.append(icon(ICONS.x))
  if (ed) {
    close.tabIndex = -1
    close.setAttribute('aria-hidden', 'true')
  }
  let title: HTMLElement
  if (ed) title = (parts.title as Parts['title'])(card, ed, c)
  else title = el('p', 't', card.type === 'general' ? w.general : card.title)
  title.id = titleId
  c.append(close, title)
  wrap.append(c, live)
  root.append(wrap)

  let choice: string | null = null
  let sent = false
  let gone = false
  const ask = card.type === 'general' ? w.tell : card.followup
  const opens = (id: string | null) =>
    !!card.followup && (!card.followupOn || (id !== null && card.followupOn.includes(id)))
  const needsText = card.type === 'text' || card.type === 'general'
  const buttons: HTMLButtonElement[] = []
  let fit: (() => void) | null = null

  const finish = (answered: boolean) => {
    if (gone) return
    gone = true
    if (fit) visualViewport?.removeEventListener('resize', fit)
    c.classList.add('o')
    setTimeout(() => wrap.remove(), 200)
    o.done?.(answered)
  }

  // the written part: always for text and general feedback, after a choice when there is a follow-up
  const fold = el('div', `f${needsText || (ed && card.followup != null) ? ' on' : ''}`)
  const inner = el('div')
  const fi = el('div', 'fi')
  const area = el('textarea')
  area.maxLength = 1000
  area.placeholder = card.type === 'text' ? w.type : (ask ?? w.type)
  area.setAttribute('aria-label', card.type === 'text' ? card.title : (ask ?? w.type))
  const row = el('div', 'r')
  const err = el('span', 'e')
  err.setAttribute('role', 'status')
  const sendBtn = el('button', 'b', w.send)
  sendBtn.type = 'button'
  row.append(err, sendBtn)
  if (ed && card.followup != null && card.type !== 'text') {
    fi.append((parts.followup as Parts['followup'])(card, ed))
    area.placeholder = w.type
  }
  fi.append(area, row)
  inner.append(fi)
  fold.append(inner)
  if (!needsText && !ask) fold.hidden = true
  if (ed) {
    area.disabled = true
    sendBtn.disabled = true
    sendBtn.tabIndex = -1
  }

  const sync = () => {
    if (ed) return
    sendBtn.disabled = needsText ? !area.value.trim() : !choice
  }
  area.addEventListener('input', sync)

  const submit = async () => {
    if (sent || sendBtn.disabled || ed) return
    sent = true
    sendBtn.setAttribute('aria-busy', 'true')
    sendBtn.textContent = ''
    sendBtn.append(el('span', 'sp'), document.createTextNode(w.sending))
    err.textContent = ''
    try {
      await o.send(
        choice,
        (opens(choice) || needsText) && area.value.trim() ? area.value.trim() : null,
      )
    } catch {
      sent = false
      sendBtn.removeAttribute('aria-busy')
      sendBtn.textContent = w.send
      err.textContent = w.failed
      return
    }
    const k = el('div', 'k')
    k.setAttribute('role', 'status')
    k.append(icon('M7 16.5l5.5 5.5L25 9.5', 32, 2.4), el('strong', undefined, w.thanks))
    // the card settles to its new height instead of jumping
    const from = c.offsetHeight
    c.replaceChildren(k)
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      c.animate?.([{ height: `${from}px` }, { height: `${c.offsetHeight}px` }], {
        duration: 280,
        easing: 'cubic-bezier(.2,.9,.25,1)',
      })
    if (!o.preview && !o.inline) setTimeout(() => finish(true), 2400)
  }
  sendBtn.addEventListener('click', submit)
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  })

  const pick = (id: string) => {
    choice = id
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === id))
    sync()
    // nothing more to ask after this answer: the choice is the answer
    if (!opens(id)) return void submit()
    const opening = !fold.classList.contains('on')
    fold.classList.add('on')
    // they are answering: the written part is the next thing to do
    if (opening && !o.preview) setTimeout(() => area.focus({ preventScroll: true }), 120)
  }
  const option = (id: string, label: string, cls = 'o1', content?: Node) => {
    const b = el('button', cls)
    b.type = 'button'
    b.dataset.id = id
    b.setAttribute('aria-pressed', 'false')
    if (content) {
      b.append(content)
      b.setAttribute('aria-label', label)
    } else {
      const d = el('span', 'd')
      d.append(icon(ICONS.check, 16, 2.4))
      b.append(d, el('span', undefined, label))
    }
    if (ed) b.tabIndex = -1
    else b.addEventListener('click', () => !sent && pick(id))
    buttons.push(b)
    return b
  }

  if (card.type === 'choice' && ed) c.append((parts.choices as Parts['choices'])(card, ed))
  else if (card.type === 'choice') {
    const g = el('div', 'g')
    g.setAttribute('role', 'group')
    g.setAttribute('aria-labelledby', titleId)
    for (const x of card.options ?? []) g.append(option(x.id, x.label))
    c.append(g)
  } else if (card.type === 'thumbs') {
    const g = el('div', 'th')
    g.setAttribute('role', 'group')
    g.setAttribute('aria-labelledby', titleId)
    g.append(
      option('up', w.yes, 'o1', icon(ICONS.up, 24)),
      option('down', w.no, 'o1', icon(ICONS.down, 24)),
    )
    c.append(g)
  } else if (card.type === 'nps') {
    const g = el('div', 'n')
    g.setAttribute('role', 'group')
    g.setAttribute('aria-labelledby', titleId)
    for (let i = 0; i <= 10; i++)
      g.append(option(String(i), String(i), 'o1', el('span', undefined, String(i))))
    const nl = el('div', 'nl')
    nl.append(el('span', undefined, w.low), el('span', undefined, w.high))
    c.append(g, nl)
  }
  c.append(fold)
  sync()

  // a choice already made is an answer, even if they skip the written part or leave the page
  const flush = () => {
    if (!choice || sent || needsText || ed) return
    // marked first: a second click, Escape or pagehide must not send the answer again
    sent = true
    void o
      .send(choice, opens(choice) && area.value.trim() ? area.value.trim() : null)
      .catch(() => {})
  }
  close.addEventListener('click', () => {
    if (ed) return
    flush()
    finish(!!choice || sent)
  })
  addEventListener('pagehide', flush)
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ed) {
      e.stopPropagation()
      close.click()
    }
  })
  // phones: the card stays above the on-screen keyboard while they write
  if (!o.preview && !o.inline && !ed && typeof visualViewport !== 'undefined' && visualViewport) {
    const vv = visualViewport
    fit = () => {
      const kb = innerHeight - vv.height - vv.offsetTop
      wrap.style.bottom = innerWidth <= 480 && kb > 40 ? `${kb + 12}px` : ''
    }
    vv.addEventListener('resize', fit)
  }
  if (!o.preview && !ed) live.textContent = card.type === 'general' ? w.general : card.title
  if (o.focus) setTimeout(() => (needsText ? area : buttons[0])?.focus(), 50)
  if (ed?.focus) (parts.focus as Parts['focus'])(ed, c)
  return { close: () => finish(sent) }
}

// ---------------------------------------------------------------------------------------------
// The live widget

const HOLD_MS = 60_000
let started = false

function busy(): boolean {
  const a = document.activeElement
  // never in the middle of typing, a form or a dialog: those are the flows people came to finish
  return (
    document.visibilityState !== 'visible' ||
    !!a?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable=false])') ||
    !!document.querySelector('dialog[open],[aria-modal=true]')
  )
}

/** Start the widget for this SDK client; the script build calls it with window.datacub. */
export function start(datacub: Client) {
  if (started || typeof window === 'undefined' || !datacub?._fb) return
  started = true
  const bridge = datacub._fb
  let live: Live[] = []
  let look: Look = { accent: '#1f1f1f', position: 'end' }
  let loaded = ''
  // failed loads back off (2 s doubling to 5 minutes); a 4xx (bad key, site not allowed) stops them
  let fails = 0
  let retryAt = 0
  let open: Mounted | null = null
  let shownHere = false
  // the card is going away because consent ended: that is not the person closing it
  let revoked = false
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const me = () => {
    const [, cookies, key, endpoint, anon, user, sid, emit] = bridge()
    return cookies && anon
      ? {
          key: key as string,
          base: (endpoint as string).replace(/batch$/, 'feedback'),
          anon: anon as string,
          user: (user as string | null) ?? null,
          sid: (sid as string) || null,
          emit: emit as (e: string, p: Record<string, unknown>, c: object, u: boolean) => void,
        }
      : null
  }

  // capture answers without a CORS preflight, like the SDK's batches
  const post = async (path: string, body: object) => {
    const r = await fetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
      credentials: 'omit',
      keepalive: true,
    })
    if (!r.ok) throw new Error(String(r.status))
    return r.json() as Promise<Record<string, unknown>>
  }

  const host = () => {
    const h = document.createElement('div')
    h.setAttribute('data-datacub-feedback-widget', '')
    document.body.append(h)
    return h
  }

  async function load() {
    const m = me()
    if (!m) {
      hide()
      return
    }
    const who = `${m.anon}|${m.user ?? ''}`
    if (who === loaded || Date.now() < retryAt) return
    loaded = who
    try {
      const r = await post(m.base, { api_key: m.key, anon_id: m.anon, user_id: m.user })
      live = (r.questions as Live[]) ?? []
      const s = r.settings as { accent: string; position: 'end' | 'start'; theme?: Look['theme'] }
      look = { accent: s.accent, position: s.position, theme: s.theme ?? 'light' }
    } catch (e) {
      loaded = ''
      retryAt = /^4/.test((e as Error)?.message)
        ? Number.POSITIVE_INFINITY
        : Date.now() + Math.min(1000 * 2 ** ++fails, 3e5)
      return
    }
    fails = 0
    page()
  }

  function hide() {
    revoked = true
    open?.close()
    revoked = false
    for (const t of timers) clearTimeout(t)
    timers.clear()
  }

  function openGeneral() {
    const m = me()
    if (!m || open) return
    const back = document.activeElement as HTMLElement | null
    // general feedback speaks the page's language
    const lang: Lang = /^ar\b/i.test(document.documentElement.lang) ? 'ar' : 'en'
    show({ lang, type: 'general', title: '' }, null, m, back)
  }

  function show(
    card: Card,
    q: Live | null,
    m: NonNullable<ReturnType<typeof me>>,
    back?: HTMLElement | null,
    into?: Element | null,
  ) {
    const h = host()
    // inline: in the developer's element, in the page's flow
    if (into) into.append(h)
    const root = h.attachShadow({ mode: 'open' })
    const id =
      crypto.randomUUID?.() ??
      // not a secure context: randomUUID is missing; the id only deduplicates retries
      '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (
          +c ^
          ((crypto.getRandomValues(new Uint8Array(1))[0] as number) & (15 >> (+c / 4)))
        ).toString(16),
      )
    const ids = q ? { $question_id: q.id, $version: q.version } : {}
    open = mount(root, card, look, {
      focus: !q,
      inline: !!into,
      send: async (choice, text) => {
        const body = {
          api_key: m.key,
          id,
          question: q?.id ?? null,
          version: q?.version ?? null,
          anon_id: m.anon,
          user_id: m.user,
          session_id: m.sid,
          choice,
          text,
          // the same cleaning as page views: ids become :id, tokens never leave the page
          path: location.pathname.split('/').map(segment).join('/'),
        }
        // the same id on every try: the server stores one answer
        for (let i = 0; ; i++) {
          try {
            await post(`${m.base}/answer`, body)
            break
          } catch (e) {
            if (i >= 2 || /^4/.test((e as Error).message)) throw e
            await new Promise((r) => setTimeout(r, 800 * 2 ** i))
          }
        }
        m.emit('$feedback_answered', { ...ids, $response_id: id, $choice: choice }, {}, true)
      },
      done: (answered) => {
        open = null
        h.remove()
        back?.focus?.()
        if (q && !answered && !revoked) {
          void post(`${m.base}/seen`, {
            api_key: m.key,
            anon_id: m.anon,
            question: q.id,
            kind: 'dismissed',
          }).catch(() => {})
          m.emit('$feedback_dismissed', ids, {}, true)
        }
      },
    })
  }

  // The server decides, at the moment of showing, whether this browser may see it now (caps,
  // dismissals and answers are kept there), so two tabs cannot both show a question.
  async function attempt(q: Live, until: number, into?: Element | null) {
    const m = me()
    if (!m || open || shownHere) return
    // the customer may choose not to wait for typing to stop
    if (!into && q.q.delivery?.waitForIdle !== false && busy()) {
      if (Date.now() < until) later(() => attempt(q, until, into), 2000)
      return
    }
    try {
      const r = await post(`${m.base}/seen`, {
        api_key: m.key,
        anon_id: m.anon,
        question: q.id,
        kind: 'shown',
        user_id: m.user,
      })
      if (!r.ok || open || shownHere) return
    } catch {
      return
    }
    shownHere = true
    live = live.filter((x) => x.id !== q.id)
    m.emit('$feedback_shown', { $question_id: q.id, $version: q.version }, {}, true)
    show(q.q, q, m, null, into)
  }

  function later(f: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.delete(t)
      f()
    }, ms)
    timers.add(t)
  }

  const due = (q: Live) =>
    later(() => attempt(q, Date.now() + HOLD_MS), (q.q.trigger.delay ?? 0) * 1000)

  function matches(path: string, rule: string) {
    return rule.endsWith('*')
      ? path.startsWith(rule.slice(0, -1))
      : path === rule || path === `${rule}/`
  }

  function page() {
    const p = location.pathname
    for (const q of live)
      if (q.q.trigger.kind === 'page' && matches(p, q.q.trigger.path ?? '')) due(q)
    // <div data-datacub-ask="question id">: the developer's own place for a question, no code needed
    for (const slot of document.querySelectorAll('[data-datacub-ask]')) {
      const q = live.find(
        (x) => x.id === slot.getAttribute('data-datacub-ask') && x.q.trigger.kind === 'manual',
      )
      if (q && !slot.querySelector('[data-datacub-feedback-widget]'))
        void attempt(q, Date.now(), slot)
    }
  }

  // the SDK's own calls are wrapped: the original always runs first, and its result is untouched
  const after = <K extends 'track' | 'identify' | 'reset'>(k: K, f: (...a: unknown[]) => void) => {
    const orig = datacub[k]
    datacub[k] = (...a: unknown[]) => {
      orig(...a)
      try {
        f(...a)
      } catch {}
    }
  }
  after('track', (name) => {
    for (const q of live)
      if (q.q.trigger.kind === 'event' && q.q.trigger.event === String(name).trim()) due(q)
  })
  after('identify', () => setTimeout(load, 0))
  after('reset', () => setTimeout(load, 0))
  const grant = datacub.consent.grant
  datacub.consent.grant = (...a: unknown[]) => {
    grant(...a)
    setTimeout(load, 0)
  }
  datacub.ask = (id: string, o?: { into?: Element | string }) => {
    const q = live.find((x) => x.id === id && x.q.trigger.kind === 'manual')
    let into: Element | null = null
    try {
      into = typeof o?.into === 'string' ? document.querySelector(o.into) : (o?.into ?? null)
    } catch {} // an invalid selector must not throw into the page
    // inline is the developer's own placement: it does not wait for the person to stop typing
    if (q) void attempt(q, Date.now() + HOLD_MS, into instanceof Element ? into : null)
  }
  datacub.feedback = openGeneral
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null
    if (t?.closest?.('[data-datacub-feedback]')) openGeneral()
  })

  // routes change without a page load in single-page apps; the core SDK wraps the same calls
  let last = location.pathname
  const moved = () =>
    setTimeout(() => {
      if (location.pathname === last) return
      last = location.pathname
      shownHere = false
      page()
    }, 150)
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k]
    history[k] = function (this: History, ...a: Parameters<History['pushState']>) {
      orig.apply(this, a)
      moved()
    }
  }
  addEventListener('popstate', moved)
  // consent can be revoked from anywhere; the widget follows within a second
  setInterval(() => {
    if (me()) void load()
    else if (loaded) {
      loaded = ''
      hide()
    }
  }, 1000)
  void load()
}
