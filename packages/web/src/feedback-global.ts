// Script-tag build of the feedback widget (/v1/feedback.js). The core injects it when the project has a
// live question or the page opens the card; a <script src=".../v1/feedback.js" async> beside datacub.js
// from an older install still works. Either may load first; the widget starts as soon as
// window.datacub is the SDK, and only one copy ever starts.
import { start } from './feedback.ts'

const go = (n = 0) => {
  const d = (window as { datacub?: { _fb?: unknown } }).datacub
  if (d?._fb) start(d as Parameters<typeof start>[0])
  else if (n < 100) setTimeout(() => go(n + 1), 100)
}
go()
