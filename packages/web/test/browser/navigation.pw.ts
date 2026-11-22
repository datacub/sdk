import { expect, test } from '@playwright/test'
import { events, hide, newRun, show, start, waitFor } from './helpers.ts'

const pageviews = async (page: import('@playwright/test').Page, run: string) =>
  (await events(page, run)).filter((e) => e.event === '$pageview')

// Route changes are debounced 100 ms; this waits past that and flushes through sendBeacon.
async function settle(page: import('@playwright/test').Page) {
  await page.waitForTimeout(250)
  await hide(page)
  await show(page)
}

test('exactly one initial pageview per page load, with landing context', async ({ page }) => {
  const run = newRun()
  await start(page, run, {
    path: '/page.html?utm_source=snapchat&utm_campaign=white_friday&gclid=abc123&email=a%40b.co',
  })
  await settle(page)
  const pv = await pageviews(page, run)
  expect(pv).toHaveLength(1)
  expect(pv[0]?.context).toMatchObject({
    url: `${new URL(page.url()).origin}/page.html`,
    path: '/page.html',
    utm: { source: 'snapchat', campaign: 'white_friday' },
    click_id_type: 'gclid',
    referrer_host: null,
  })
  expect(JSON.stringify(pv)).not.toContain('abc123')
  expect(JSON.stringify(pv)).not.toContain('a@b.co')
})

test('SPA: one pageview per real route change, none for same-URL or query-only updates', async ({
  page,
}) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => {
    history.pushState({}, '', '/products')
  })
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    history.pushState({ scroll: 1 }, '', '/products') // same URL: no pageview
    history.replaceState({ filter: 1 }, '', '/products?color=red') // non-allowlisted query only
    history.replaceState({}, '', '/products#reviews') // fragment only, hash routing off
  })
  await page.waitForTimeout(250)
  await page.evaluate(() => history.replaceState({}, '', '/checkout')) // a real route transition
  await settle(page)
  const pv = await pageviews(page, run)
  expect(pv.map((e) => e.context.path)).toEqual(['/page.html', '/products', '/checkout'])
  expect(pv.map((e) => e.properties.$prev_path)).toEqual([undefined, '/page.html', '/products'])
})

test('SPA: two items of one template are two pageviews', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => history.pushState({}, '', '/product/123'))
  await page.waitForTimeout(250)
  await page.evaluate(() => history.pushState({}, '', '/product/456'))
  await settle(page)
  const pv = await pageviews(page, run)
  expect(pv.map((e) => e.context.path)).toEqual(['/page.html', '/product/:id', '/product/:id'])
})

test('a burst of history calls in one tick is one pageview for the final URL', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) history.pushState({}, '', `/step/${i}`)
    history.replaceState({}, '', '/done')
  })
  await settle(page)
  expect((await pageviews(page, run)).map((e) => e.context.path)).toEqual(['/page.html', '/done'])
})

test('back and forward navigation each produce a pageview', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => history.pushState({}, '', '/a'))
  await page.waitForTimeout(250)
  await page.evaluate(() => history.pushState({}, '', '/b'))
  await page.waitForTimeout(250)
  await page.goBack()
  await page.waitForTimeout(250)
  await page.goForward()
  await settle(page)
  expect((await pageviews(page, run)).map((e) => e.context.path)).toEqual([
    '/page.html',
    '/a',
    '/b',
    '/a',
    '/b',
  ])
})

test('hash routing: #/ routes are pageviews only when enabled, and are templated', async ({
  page,
}) => {
  const off = newRun()
  await start(page, off)
  await page.evaluate(() => {
    location.hash = '#/orders/1012345678'
  })
  await settle(page)
  expect(await pageviews(page, off)).toHaveLength(1)

  const on = newRun()
  await start(page, on, { init: { hashRouting: true } })
  await page.evaluate(() => {
    location.hash = '#/orders/12345'
  })
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    location.hash = '#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc'
  })
  await settle(page)
  const paths = (await pageviews(page, on)).map((e) => e.context.path)
  expect(paths).toEqual(['/page.html', '/page.html#/orders/:id', '/page.html'])
  expect(JSON.stringify(await events(page, on))).not.toContain('eyJ')
})

test('$pageleave closes the previous page before the next $pageview', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => window.scrollTo(0, 2000)) // mouse.wheel is unsupported in mobile WebKit
  await page.waitForTimeout(150)
  await page.evaluate(() => history.pushState({}, '', '/next'))
  await settle(page)
  const all = (await events(page, run)).sort((a, b) => a.seq - b.seq)
  const names = all.map((e) => e.event)
  const first = all.find((e) => e.event === '$pageview')
  const leave = all.find((e) => e.event === '$pageleave')
  expect(names.slice(0, 4)).toEqual(['$consent', '$pageview', '$pageleave', '$pageview'])
  expect(leave?.properties.$closes_page_id).toBe(first?.page_id)
  expect(leave?.properties.$visible_ms).toBeGreaterThanOrEqual(100)
  expect(leave?.properties.$scroll_depth).toBeGreaterThan(0)
  expect((leave?.properties.$scroll_depth as number) % 10).toBe(0)
})

test('$pageleave: a second hide adds nothing; coming back then hiding sends only the new time', async ({
  page,
}) => {
  const run = newRun()
  await start(page, run)
  await page.waitForTimeout(150)
  await hide(page)
  await hide(page)
  await show(page)
  await page.waitForTimeout(300)
  await hide(page)
  await waitFor(page, run, 2, '$pageleave')
  const [first, again] = (await events(page, run)).filter((e) => e.event === '$pageleave')
  expect(first?.properties.$returned).toBeUndefined()
  expect(again?.properties.$returned).toBe(true)
  expect(again?.page_id).toBe(first?.page_id)
  expect(again?.properties.$visible_ms).toBeGreaterThanOrEqual(250)
  expect(again?.properties.$visible_ms).toBeLessThan(2000)
})

test('bfcache restore is a new pageview with a new page_id', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await settle(page)
  const pv = await pageviews(page, run)
  expect(pv).toHaveLength(2)
  expect(pv[1]?.properties.$bfcache).toBe(true)
  expect(pv[1]?.page_id).not.toBe(pv[0]?.page_id)
})

test('full page navigation: queued events leave on pagehide; the next page keeps anon and session', async ({
  page,
}) => {
  const run = newRun()
  await start(page, run)
  await waitFor(page, run, 2) // $consent and the initial $pageview go out at once
  // Five events wait for the 5 s batch timer, then the page is left before it fires.
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.datacub.track('queued_before_unload', { i })
  })
  await start(page, run, { path: '/page.html?second=1' })
  const all = await waitFor(page, run, 5, 'queued_before_unload')
  expect(
    all
      .filter((e) => e.event === 'queued_before_unload')
      .map((e) => e.properties.i)
      .sort(),
  ).toEqual([0, 1, 2, 3, 4])
  const pv = await waitFor(page, run, 2, '$pageview').then((a) =>
    a.filter((e) => e.event === '$pageview'),
  )
  expect(pv).toHaveLength(2)
  expect(pv[1]?.anon_id).toBe(pv[0]?.anon_id)
  expect(pv[1]?.session_id).toBe(pv[0]?.session_id)
  expect(pv[1]?.page_id).not.toBe(pv[0]?.page_id)
})

test('pageview ids, sequence and timestamps are well formed', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => {
    window.datacub.track('a')
    window.datacub.track('b')
  })
  await settle(page)
  const all = (await events(page, run)).sort((a, b) => a.seq - b.seq)
  const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  expect(new Set(all.map((e) => e.uuid)).size).toBe(all.length)
  for (const [i, e] of all.entries()) {
    expect(e.uuid).toMatch(v7)
    expect(e.session_id).toMatch(v7)
    expect(e.seq).toBe(i)
    // the uuid's 48-bit prefix is the event time in ms
    expect(Number.parseInt(e.uuid.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.parse(e.ts))
  }
})
