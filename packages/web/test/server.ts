import { expandBatch } from './wire.ts'

// Fixture server for browser tests: serves the built SDK and fixture pages, and a fake ingestion
// endpoint per test run (/r/<run>/v1/batch) that records batches and answers from a scripted plan.
const dir = `${import.meta.dir}/..`
const port = Number(process.env.PORT ?? 4173)
const { version } = await Bun.file(`${dir}/package.json`).json()

interface Run {
  batches: { events: Record<string, unknown>[]; body: string; at: number }[]
  requests: number
  plan: { status: number; retryAfter?: number; delay?: number; body?: string }[]
  // feedback.pw.ts: whether batches answer feedback: 1, the questions /v1/feedback offers, and what
  // the widget fetched
  fb: {
    hint: boolean
    questions: unknown[]
    script: number
    asks: number
    seen: number
    posts: { path: string; body: Record<string, unknown> }[]
    settings?: Record<string, unknown>
  }
}
const runs = new Map<string, Run>()
const apps: Record<string, Promise<string>> = {}
const run = (id: string) => {
  let r = runs.get(id)
  if (!r) {
    r = {
      batches: [],
      requests: 0,
      plan: [],
      fb: { hint: false, questions: [], script: 0, asks: 0, seen: 0, posts: [] },
    }
    runs.set(id, r)
  }
  return r
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    // The insights module, at the immutable path the core loads it from: {apiHost}/v1/sdk/…, so also
    // under a run's /r/<run> apiHost.
    if (url.pathname.endsWith(`/v1/sdk/insights-${version}.min.js`))
      return new Response(Bun.file(`${dir}/dist/insights.js`), {
        headers: { 'Content-Type': 'text/javascript' },
      })
    // signals.pw.ts: a failing endpoint and a missing image
    if (url.pathname === '/status/500') return new Response('no', { status: 500 })
    if (url.pathname === '/missing.png') return new Response('', { status: 404 })
    const [, scope, id, ...rest] = url.pathname.split('/')
    if (scope === 'r' && id) {
      const r = run(id)
      const tail = rest.join('/')
      if (tail === 'v1/batch' && req.method === 'POST') {
        r.requests++
        const body = await req.text()
        const step = r.plan.shift() ?? { status: 200 }
        if (step.delay) await Bun.sleep(step.delay)
        // Only accepted batches count as received, like the real ingestion service.
        if (step.status === 200)
          r.batches.push({
            // the compact batch expanded as the server does, so tests read the envelope
            events: (expandBatch(JSON.parse(body)) as { events: Record<string, unknown>[] }).events,
            body,
            at: Date.now(),
          })
        const ok = r.fb.hint ? '{"accepted":1,"feedback":1}' : '{"accepted":1}'
        return new Response(step.body ?? (step.status === 200 ? ok : '{}'), {
          status: step.status,
          headers: step.retryAfter ? { 'Retry-After': String(step.retryAfter) } : {},
        })
      }
      // the feedback widget and its endpoints, as capture serves them
      if (tail === 'v1/feedback.js') {
        r.fb.script++
        return new Response(Bun.file(`${dir}/dist/feedback.js`), {
          headers: { 'Content-Type': 'text/javascript' },
        })
      }
      if (tail === 'v1/feedback' && req.method === 'POST') {
        r.fb.asks++
        return Response.json({
          questions: r.fb.questions,
          settings: r.fb.settings ?? { accent: '#1f1f1f', position: 'end', theme: 'light' },
        })
      }
      if (tail.startsWith('v1/feedback/') && req.method === 'POST') {
        if (tail === 'v1/feedback/seen') r.fb.seen++
        // what was sent, for a site's own UI (datacub.feedback.shown, send, dismissed)
        r.fb.posts.push({ path: tail, body: await req.json() })
        return Response.json({ ok: true, version: 3 })
      }
      if (tail === 'feedback' && req.method === 'POST') {
        Object.assign(r.fb, await req.json())
        return new Response('ok')
      }
      if (tail === 'plan' && req.method === 'POST') {
        r.plan = await req.json()
        return new Response('ok')
      }
      if (tail === 'log') return Response.json(r)
    }
    // Framework fixtures: bundled on first request; their routes all serve the app's HTML.
    const app = url.pathname.match(/^\/apps\/(\w+)\.js$/)?.[1]
    if (app) {
      apps[app] ??= Bun.build({
        entrypoints: [`${dir}/test/fixtures/apps/${app}.${app === 'vue' ? 'ts' : 'tsx'}`],
        target: 'browser',
        minify: true,
        define: {
          'process.env.NODE_ENV': '"production"',
          __VUE_OPTIONS_API__: 'true',
          __VUE_PROD_DEVTOOLS__: 'false',
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
      }).then((r) => r.outputs[0]?.text() ?? '')
      return new Response(await apps[app], { headers: { 'Content-Type': 'text/javascript' } })
    }
    const spa = url.pathname.match(/^\/(app|vue)(?:\/|$)/)?.[1]
    if (spa)
      return new Response(
        Bun.file(`${dir}/test/fixtures/${spa === 'app' ? 'tanstack' : 'vue'}.html`),
      )
    const file = Bun.file(
      /^\/(?:datacub\.js|datacub\.mjs|flags\.js)$/.test(url.pathname)
        ? `${dir}/dist${url.pathname}`
        : `${dir}/test/fixtures${url.pathname}`,
    )
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
  },
})
process.stdout.write(`fixtures on http://localhost:${port}\n`)
