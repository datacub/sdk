// Insights module: web vitals merged into every $pageleave, client hints for the device
// context, and field-level form analytics ($form_fields). The core injects it as soon as tracking begins
// and hands over window.__datacub = { e: emit, v: VERSION }; without that handshake the module does
// nothing. It never reads a field value, a value length or key data, and never throws into the page.
//
// Early coverage: every observer is registered with buffered: true, so entries from before this
// script ran are replayed. Limits of that buffer, by entry type:
// - event: only entries of 104 ms or more are buffered, so first-input is observed too (always
//   buffered, carries the interactionId) to keep the first early interaction.
// - layout-shift and largest-contentful-paint: buffered in Chromium only, and only Chromium exposes
//   layout-shift; Firefox buffers LCP; WebKit exposes neither before Safari 26.
// - longtask and long-animation-frame: Chromium only; buffered up to its timeline buffer.
// - resource: replays the resource timing buffer, 250 entries by default; a page that loaded more
//   before the module ran under-counts the first segment.
// - navigation and paint are read from the performance timeline at the first snapshot instead.
// biome-ignore lint/suspicious/noExplicitAny: browser entries the DOM lib does not type yet
type A = any
const w = window as A
const datacub = w.__datacub
const now = () => performance.now()
const R = Math.round

if (datacub && !datacub.l)
  try {
    const S: readonly string[] = PerformanceObserver.supportedEntryTypes || []
    const obs: [PerformanceObserver, (e: A) => void][] = []
    const po = (t: string, f: (e: A) => void, o?: object) => {
      if (S.includes(t)) {
        const p = new PerformanceObserver((l) => l.getEntries().forEach(f))
        p.observe({ type: t, buffered: true, ...o })
        obs.push([p, f])
        return 1
      }
    }
    // initial page
    let first = 1
    let lcp = 0
    // per segment: CLS (max, current window, window start, last shift), INP, long tasks, resources
    let cls = 0
    let cw = 0
    let cf = 0
    let cl = 0
    let ni = 0 // interactions this segment
    let last = 0 // highest interactionId seen: ids only grow
    let top: [number, number, string][] = [] // [id, duration, tag], the 10 longest
    let lt = 0
    let ltm = 0
    let rc = 0
    let rb = 0
    // datacub's own requests (batch, flags, this module) share the prefix before /v1/
    const src: string = (document.currentScript as HTMLScriptElement | null)?.src || ''
    const own = src.slice(0, src.lastIndexOf('/v1/') + 4) || ' '

    po('largest-contentful-paint', (e) => {
      lcp = e.startTime // the browser stops reporting after the first input
    })
    const hasCls = po('layout-shift', (e) => {
      if (e.hadRecentInput) return
      const t = e.startTime
      if (cw && t - cl < 1000 && t - cf < 5000) cw += e.value
      else {
        cw = e.value
        cf = t
      }
      cl = t
      if (cw > cls) cls = cw
    })
    const int = (e: A) => {
      const id = e.interactionId
      if (!id) return
      if (id > last) {
        last = id
        ni++
      }
      const i = top.find((x) => x[0] === id)
      if (i) {
        if (e.duration > i[1]) i[1] = e.duration
      } else top.push([id, e.duration, e.target?.localName || ''])
      top = top.sort((a, b) => b[1] - a[1]).slice(0, 10)
    }
    po('event', int, { durationThreshold: 40 })
    po('first-input', int)
    const long = (e: A) => {
      lt++
      ltm += e.duration
    }
    const hasLt = po('long-animation-frame', long) || po('longtask', long)
    po('resource', (e) => {
      if (!e.name.startsWith(own)) {
        rc++
        rb += e.transferSize || 0
      }
    })

    // Forms: per field [dwell ms, edits, invalid reason, focused at, touched, edited this focus]. The
    // invalid reason is the first one the field failed with, kept after it is fixed: where people
    // struggled is the point.
    // edits counts visits that changed the field, never input events, which would give the length
    // of what was typed one key at a time.
    const F = new WeakMap<Element, [number, number, string, number, number, number]>()
    const started = new Set<HTMLFormElement>() // had input, no $form_fields yet
    // a form is sent once as abandoned (a hide may be the last moment) and once more if submitted later
    const done = new WeakMap<HTMLFormElement, string>()
    const NO = '.datacub-no-capture,[data-datacub-no-capture]'
    const send = (f: HTMLFormElement, o: string) => {
      if (done.get(f) === 'submit' || done.get(f) === o || f.closest(NO)) return
      done.set(f, o)
      started.delete(f)
      const t = now()
      const ff: A[] = []
      // radio and checkbox: one entry per group, so which option was picked never shows. A radio
      // group keeps whether it was answered; a checkbox's touch is its answer, so it keeps nothing.
      const groups = new Map<string, A[]>()
      for (const el of f.querySelectorAll('input,select,textarea') as NodeListOf<A>) {
        const ty: string = el.type
        if (ff.length > 49 || /^(hidden|submit|button|reset|image)$/.test(ty) || el.closest(NO))
          continue
        const s = F.get(el) || [0, 0, '', 0, 0, 0]
        const a = (el.getAttribute('autocomplete') || '').toLowerCase()
        const n: string = el.getAttribute('name') || el.id || ''
        if (/^(?:radio|checkbox)$/.test(ty)) {
          // grouped by name only: an id names the option itself (`gender-female`)
          const n: string = el.getAttribute('name') || ''
          const key = ty + n
          const g = groups.get(key)
          if (g) {
            if (ty === 'radio') g[4] |= s[4]
            g[7] ||= s[2]
            continue
          }
          const e: A = [ty, n.slice(0, 64), '', +el.required, ty === 'radio' ? s[4] : 0, 0, 0, s[2]]
          groups.set(key, e)
          ff.push(e)
          continue
        }
        ff.push([
          ty,
          ty === 'password' || /cc-|one-time-code/.test(a) || /@|\d{5}|[\da-f]{16}/i.test(n)
            ? ''
            : n.slice(0, 64),
          a.trim().split(/\s+/).pop()?.slice(0, 32),
          +el.required,
          s[4],
          R(s[0] + (s[3] && t - s[3])),
          s[1],
          s[2],
        ])
      }
      // the core's own form description ($f, $a, $i): scrubbed name, templated action path
      datacub.e('$form_fields', { ...datacub.f(f), $ff: ff, $fo: o })
    }
    const on = (e: Event) => {
      try {
        const el = e.target as A
        const k = e.type
        if (k === 'submit') return send(el, 'submit')
        const f = el.form
        if (!f) return
        const s = F.get(el) || [0, 0, '', 0, 0, 0]
        F.set(el, s)
        if (k === 'focusin') {
          s[3] = now()
          s[4] = 1
          s[5] = 0
        } else if (k === 'focusout') {
          if (s[3]) s[0] += now() - s[3]
          s[3] = 0
        } else if (k === 'input') {
          if (!s[5]) s[1]++
          s[4] = s[5] = 1
          started.add(f)
        } else
          for (const v in el.validity)
            if (el.validity[v]) {
              s[2] = v
              break
            }
      } catch {}
    }
    for (const k of ['focusin', 'focusout', 'input', 'invalid', 'submit'])
      document.addEventListener(k, on, { capture: true, passive: true })

    datacub.l = () => {
      const r: A = {}
      try {
        // entries the browser has not delivered to the callbacks yet
        for (const [p, f] of obs) p.takeRecords().forEach(f)
        if (first) {
          first = 0
          const n = performance.getEntriesByType('navigation')[0] as A
          const put = (k: string, v: number) => {
            if (v > 0) r[k] = R(v)
          }
          put('$lcp', lcp)
          put('$fcp', performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0)
          if (n) {
            put('$ttfb', n.responseStart)
            r.$dns = R(n.domainLookupEnd - n.domainLookupStart)
            r.$tcp = R(n.connectEnd - n.connectStart)
            put('$dcl', n.domContentLoadedEventEnd)
            put('$load', n.loadEventEnd)
          }
        }
        if (ni) {
          const i = top[Math.min(ni / 50, 9) | 0] as [number, number, string]
          r.$inp = R(i[1])
          if (i[2]) r.$ie = i[2]
        }
        if (hasCls) r.$cls = R(cls * 1e4) / 1e4
        if (hasLt) {
          r.$lt = lt
          r.$ltm = R(ltm)
        }
        r.$rc = rc
        r.$rkb = R(rb / 1024)
        cls = cw = ni = lt = ltm = rc = rb = 0
        top = []
        for (const f of started) send(f, 'abandon')
      } catch {}
      return r
    }

    ;(navigator as A).userAgentData?.getHighEntropyValues(['model', 'platformVersion']).then(
      (v: A) => {
        datacub.h = [v.model || '', v.platformVersion || '']
      },
      () => {},
    )
  } catch {}
