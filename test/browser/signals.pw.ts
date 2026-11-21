import { expect, test } from '@playwright/test'
import { events, hide, newRun, start, waitFor } from './helpers.ts'

// Riyadh, so the UTC offset (+180) is never the 0 an unknown value would read as
test.use({ timezoneId: 'Asia/Riyadh' })

// @datacub/web 0.2 signals in every browser project (desktop and mobile): what the core and the insights
// module send, read from the batches as capture expands them.

test('0.2 signals: errors, requests, dead and rage clicks, forms, navigation, device, page summary', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const run = newRun()
  await start(page, run, { path: '/page.html?q=shoes&token=SECRET789', init: { release: 'web@2' } })
  await page.evaluate(() => {
    const add = (html: string) => document.body.insertAdjacentHTML('beforeend', html)
    add('<button id="nothing">لا شيء</button>')
    add('<div id="pic" style="cursor:pointer;width:120px;height:60px;background:#ccc"></div>')
    add(
      `<form id="f" data-datacub-name="join" onsubmit="event.preventDefault(); this.append('ok')">
        <input id="addr" name="email" type="email" required><button id="send">send</button></form>`,
    )
    add('<img src="/missing.png" alt="">')
  })
  // the insights module arrives once tracking began
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as { __datacub?: { l?: unknown } }).__datacub?.l),
    )
    .toBe('function')
  // a scroll right after a click counts as a reaction: bring the targets into view first
  await page.locator('#pic').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.click('#nothing')
  await page.waitForTimeout(1300)
  await page.click('#pic', { clickCount: 3 })
  await page.waitForTimeout(1300)
  await page.evaluate(async () => {
    setTimeout(() => {
      throw new TypeError('broken for someone@example.com')
    })
    Promise.reject(new RangeError('rejected'))
    await fetch('/status/500?token=SECRET123')
    await new Promise((r) => {
      const q = new XMLHttpRequest()
      q.open('GET', '/status/500')
      q.onloadend = r
      q.send()
    })
    await fetch('http://localhost:1/nope').catch(() => {})
  })
  await page.click('#send') // required and empty: blocked by the browser
  await page.fill('#addr', 'typed.person@example.com')
  await page.click('#send')
  await page.evaluate(() => history.pushState({}, '', '/next'))
  await page.waitForTimeout(300)
  await hide(page)
  await waitFor(page, run, 2, '$pageleave')

  const has = await page.evaluate(() => ({
    memory: 'deviceMemory' in navigator,
    connection: 'connection' in navigator,
    lcp: PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint'),
    cls: PerformanceObserver.supportedEntryTypes.includes('layout-shift'),
  }))
  const all = await events(page, run)
  const of = (e: string) => all.filter((x) => x.event === e)

  // device: once per batch, on every event
  for (const e of all) {
    const env = e.context.env as Record<string, unknown>
    expect(env.screen_w).toBeGreaterThan(0)
    expect(env.utc_offset).toBe(180)
    expect(env.cpu_cores).toBeGreaterThan(0)
    expect(['fine', 'coarse']).toContain(env.pointer)
    expect('device_memory' in env).toBe(has.memory)
    expect('connection_type' in env).toBe(has.connection)
    expect(e.context.release).toBe('web@2')
  }

  // the IANA zone is the server's (from the IP's location), never read in the browser
  expect(all.every((e) => !('timezone' in (e.context.env as object)))).toBe(true)

  const [land, next] = of('$pageview')
  expect(land?.properties.$nav_type).toBe('navigate')
  expect(land?.context.query).toEqual({ q: '', token: '' }) // a search is what someone typed
  expect(typeof land?.context.title).toBe('string')
  expect(next?.properties.$nav_type).toBe('push')

  const dead = of('$deadclick').map((e) => String(e.properties.$el_sig))
  expect(
    dead.some((s) => /button#nothing(:\d+)?$/.test(s)),
    dead.join(' | '),
  ).toBe(true)
  expect(
    dead.some((s) => /div#pic(:\d+)?$/.test(s)),
    dead.join(' | '),
  ).toBe(true)
  expect(dead.some((s) => /#send/.test(s))).toBe(false)
  expect(of('$rageclick').map((e) => e.properties.$el_tag)).toContain('div')

  const errs = of('$error').map((e) => e.properties)
  expect(errs.map((e) => e.$error_kind).sort()).toEqual(['js', 'rejection', 'resource'])
  const reqs = of('$request').map((e) => e.properties)
  expect(reqs.map((r) => r.$request_kind).sort()).toEqual([
    'http_error',
    'http_error',
    'network_error',
  ])

  expect(of('$form_start')).toHaveLength(1)
  expect(of('$form_invalid').map((e) => e.properties.$invalid_count)).toEqual([1])
  expect(of('$form_submit')).toHaveLength(1)
  expect(of('$form_fields').map((e) => e.properties.$form_outcome)).toEqual(['submit'])

  const leave = of('$pageleave')[0]?.properties ?? {}
  expect(leave.$error_count).toBe(3)
  expect(leave.$request_failed_count).toBe(3)
  expect(leave.$fcp_ms).toBeGreaterThan(0)
  expect('$lcp_ms' in leave).toBe(has.lcp)
  expect('$cls' in leave).toBe(has.cls)

  const text = JSON.stringify(all)
  for (const s of ['typed.person', 'someone@example.com', 'SECRET123', 'SECRET789'])
    expect(text, s).not.toContain(s)
})

// The 0.2 review's high findings, pinned: typed query values, radio and checkbox answers, text of an
// element that holds a field; and a reused XHR counted once per request.
test('0.2 review: no typed query value, no chosen option, no typed text in a label', async ({
  page,
}) => {
  const run = newRun()
  await start(page, run, {
    path: '/page.html?q=typed+words&name=Noura&category=shoes&page=2&reset=Hq7xLm2pRtZ4&invite=k8PzQ2wXyR&first=Noura&lang=EN&ref=summer2024x',
  })
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="composer" role="button" data-datacub-name="composer" style="padding:30px"><textarea id="msg"></textarea></div>
       <form id="survey" onsubmit="event.preventDefault()">
         <input type="radio" name="gender" value="male" id="m"><input type="radio" name="gender" value="female" id="fem">
         <input type="checkbox" name="condition" value="diabetes" id="cond">
         <input type="radio" id="smoker-yes"><input type="radio" id="smoker-no"><button id="go2">send</button></form>`,
    )
  })
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as { __datacub?: { l?: unknown } }).__datacub?.l),
    )
    .toBe('function')
  await page.fill('#msg', 'TYPED-SECRET-TEXT')
  await page.click('#composer', { position: { x: 5, y: 5 } })
  await page.click('#fem')
  await page.click('#cond')
  await page.click('#smoker-no')
  await page.click('#go2')
  await page.evaluate(async () => {
    const q = new XMLHttpRequest()
    for (let i = 0; i < 2; i++) {
      q.open('GET', '/status/500')
      await new Promise((r) => {
        q.onloadend = r
        q.send()
      })
    }
  })
  await hide(page)
  await waitFor(page, run, 1, '$pageleave')
  const all = await events(page, run)
  const of = (e: string) => all.filter((x) => x.event === e)
  expect(of('$pageview')[0]?.context.query).toEqual({
    q: '',
    name: '',
    category: 'shoes',
    page: ':id',
    reset: '',
    invite: '',
    first: '',
    lang: 'EN',
    ref: '',
  })
  const fields = of('$form_fields')[0]?.properties.$form_fields as unknown[][]
  // one entry per group: the radio group says it was answered, the checkbox says nothing
  expect(fields.map((f) => [f[0], f[1], f[4]])).toEqual([
    ['radio', 'gender', 1],
    ['checkbox', 'condition', 0],
    // radios with no name are one group, never named after the option picked
    ['radio', '', 1],
  ])
  expect(of('$request').filter((e) => e.properties.$request_status === 500)).toHaveLength(2)
  expect(of('$pageleave')[0]?.properties.$request_count).toBe(2)
  const text = JSON.stringify(all)
  for (const s of [
    'TYPED-SECRET',
    'typed words',
    'Noura',
    'female',
    'diabetes',
    'smoker',
    'Hq7x',
    'k8Pz',
  ])
    expect(text, s).not.toContain(s)
})
