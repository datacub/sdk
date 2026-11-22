// Script-tag build of the flags module: <script src=".../v1/flags.js"></script> after datacub's snippet.
// datacub.flag and datacub.experiment exist as soon as this file runs, on the head snippet's queue
// or on the SDK itself, and wait for the SDK when it has not loaded yet. When the SDK replaces the
// queue (global.ts assigns window.datacub), a setter puts them on the SDK in the same moment, so no
// call can find them missing.
import { makeFlags } from './flags.ts'

type Host = { _fb?: () => unknown[]; flag?: unknown; experiment?: unknown }
const w = window as unknown as Record<'datacub', Host | unknown[] | undefined>
const f = makeFlags(() => w.datacub)

const attach = (h: Host) => {
  // loaded twice: the first copy stays
  if (h && typeof h === 'object' && !h.flag) {
    h.flag = f.flag
    h.experiment = f.experiment
  }
}

// a page that never set the snippet gets its own queue
let cur = w.datacub ?? []
attach(cur as Host)
try {
  Object.defineProperty(window, 'datacub', {
    configurable: true,
    enumerable: true,
    get: () => cur,
    set(v) {
      cur = v
      attach(v as Host)
    },
  })
} catch {
  // a page that declared `var datacub` itself: fall back to looking again for 30 seconds
  w.datacub = cur
  let n = 0
  const t = setInterval(() => {
    attach(w.datacub as Host)
    if ((w.datacub as Host)?._fb || ++n > 300) clearInterval(t)
  }, 100)
}
