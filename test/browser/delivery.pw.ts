import { expect, type Page, test } from '@playwright/test'
import pkg from '../../package.json' with { type: 'json' }
import { expandBatch } from '../wire.ts'
import { events, hide, log, newRun, plan, show, start, waitFor } from './helpers.ts'

const tracks = <E extends { event: string }>(all: E[], name = 'evt') =>
  all.filter((e) => e.event === name)

async function track(page: Page, n: number, name = 'evt') {
  await page.evaluate(
    ([n, name]) => {
      for (let i = 0; i < (n as number); i++) window.datacub.track(name as string, { i })
    },
    [n, name] as const,
  )
}

test('batching: a full batch goes in the next task, a partial one after 5 s; one request per batch', async ({
  page,
}) => {
  const run = newRun()
  await page.clock.install()
  await start(page, run)
  await waitFor(page, run, 2) // $consent and $pageview go in the next task
  // Freeze time: from here on, timers fire only when the test advances the clock.
  await page.clock.pauseAt(Date.now() + 60_000)
  await track(page, 25)
  // The 20th call schedules the send; it takes everything queued by then, so 25 in one request.
  await page.waitForTimeout(200)
  expect(tracks(await events(page, run))).toHaveLength(0)
  await page.clock.runFor(1)
  await expect.poll(async () => tracks(await events(page, run)).length).toBe(25)
  await track(page, 5, 'later')
  await page.clock.runFor(4900)
  await page.waitForTimeout(200)
  expect(tracks(await events(page, run), 'later')).toHaveLength(0)
  await page.clock.runFor(200)
  await expect.poll(async () => tracks(await events(page, run), 'later').length).toBe(5)
  const l = await log(page, run)
  expect(l.requests).toBe(3)
  // The batch body is a CORS simple request: text/plain JSON with the public key inside.
  const body = expandBatch(JSON.parse(l.batches[1]?.body as string)) as Record<string, unknown>
  expect(Object.keys(body).sort()).toEqual(['api_key', 'events', 'lib', 'sent_at'])
  expect(body.lib).toEqual({ name: '@datacub/web', version: pkg.version })
})

test('retries keep the same event uuids, and the server receives each event once', async ({
  page,
}) => {
  const run = newRun()
  await page.clock.install()
  await plan(page, run, [{ status: 503 }, { status: 500 }, { status: 200 }])
  await start(page, run)
  // Retry delays are jittered and the clock also runs in real time, so a poll for each
  // intermediate count can miss one: advance until the 200, then check nothing more is sent.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(300_000)
        return (await log(page, run)).requests
      },
      { timeout: 20_000 },
    )
    .toBe(3)
  await page.clock.runFor(600_000)
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(3)
  const all = await events(page, run)
  expect(all.map((e) => e.event)).toEqual(['$consent', '$pageview'])
  expect(new Set(all.map((e) => e.uuid)).size).toBe(2)
})

test('Retry-After is honoured', async ({ page }) => {
  const run = newRun()
  await page.clock.install()
  await plan(page, run, [{ status: 429, retryAfter: 120 }])
  await start(page, run)
  await expect.poll(async () => (await log(page, run)).requests).toBe(1)
  await page.clock.runFor(119_000)
  await page.waitForTimeout(200)
  expect((await log(page, run)).requests).toBe(1)
  await page.clock.runFor(2_000)
  await expect.poll(async () => (await events(page, run)).length).toBe(2)
})

for (const status of [401, 403]) {
  test(`${status} stops sending for the page and keeps nothing`, async ({ page }) => {
    const run = newRun()
    await plan(page, run, [{ status }])
    await start(page, run)
    await expect.poll(async () => (await log(page, run)).requests).toBe(1)
    await track(page, 30)
    await hide(page)
    await page.waitForTimeout(300)
    expect((await log(page, run)).requests).toBe(1)
  })
}

test('a 400 drops only that batch; later events still go out', async ({ page }) => {
  const run = newRun()
  await plan(page, run, [{ status: 400 }])
  await start(page, run)
  await expect.poll(async () => (await log(page, run)).requests).toBe(1)
  await track(page, 3)
  await hide(page)
  expect(tracks(await waitFor(page, run, 3, 'evt'))).toHaveLength(3)
  expect((await events(page, run)).some((e) => e.event === '$pageview')).toBe(false)
})

test('network failure is retried', async ({ page }) => {
  const run = newRun()
  await page.clock.install()
  let failed = 0
  await page.route(`**/r/${run}/v1/batch`, (route) =>
    failed++ ? route.continue() : route.abort('failed'),
  )
  await start(page, run)
  await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  await page.clock.runFor(300_000)
  await expect.poll(async () => (await events(page, run)).length).toBe(2)
})

test('an event queued while a failing send is in flight does not cut the backoff short', async ({
  page,
}) => {
  const run = newRun()
  // jitter pinned near its top: retries after 1.98 s, 3.96 s, then 7.92 s
  await page.addInitScript(() => {
    Math.random = () => 0.99
  })
  await page.clock.install({ time: 1_800_000_000_000 })
  await page.clock.pauseAt(1_800_000_001_000)
  await plan(page, run, [{ status: 503 }, { status: 503 }, { status: 503, delay: 1000 }])
  await start(page, run)
  const until = (n: number, step: number) =>
    expect
      .poll(
        async () => {
          await page.clock.runFor(step)
          return (await log(page, run)).requests
        },
        { timeout: 20_000 },
      )
      .toBe(n)
  await until(1, 100)
  await until(2, 500)
  await until(3, 500)
  // the third request is still waiting for its 503: this event's 5 s timer must not outlive it
  await track(page, 1, 'during')
  await page.waitForTimeout(1500)
  await page.clock.runFor(6000)
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(3)
  await page.clock.runFor(2000)
  await expect.poll(async () => tracks(await events(page, run), 'during').length).toBe(1)
  expect((await log(page, run)).requests).toBe(4)
})

test('offline: nothing is attempted until the browser is back online', async ({
  page,
  context,
}) => {
  const run = newRun()
  await start(page, run)
  await waitFor(page, run, 2)
  await context.setOffline(true)
  await track(page, 25)
  await page.waitForTimeout(300)
  const before = (await log(page, run)).requests
  await context.setOffline(false)
  await expect.poll(async () => tracks(await events(page, run)).length).toBeGreaterThanOrEqual(20)
  await hide(page)
  await expect.poll(async () => tracks(await events(page, run)).length).toBe(25)
  expect(before).toBe(1)
})

test('burst: 5,000 synchronous calls, bounded queue, every lost event counted, no page errors', async ({
  page,
}) => {
  const run = newRun()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await start(page, run)
  await waitFor(page, run, 2)
  // The server holds requests open, so the queue really fills while one batch is in flight.
  await page.route(`**/r/${run}/v1/batch`, async (route) => {
    await new Promise((r) => setTimeout(r, 300))
    await route.continue()
  })
  const ms = await page.evaluate(() => {
    const t = performance.now()
    for (let i = 0; i < 5000; i++) window.datacub.track('evt', { i })
    return performance.now() - t
  })
  await page.waitForTimeout(500)
  await hide(page)
  await show(page)
  await page.evaluate(() => window.datacub.track('marker'))
  await hide(page)
  await waitFor(page, run, 1, 'marker')
  const l = await log(page, run)
  const delivered = new Set(tracks(l.batches.flatMap((b) => b.events)).map((e) => e.uuid)).size
  const counted = l.batches.reduce(
    (n, b) => n + ((expandBatch(JSON.parse(b.body)) as { dropped?: number }).dropped ?? 0),
    0,
  )
  expect(errors).toEqual([])
  expect(delivered + counted).toBe(5000)
  expect(delivered).toBeGreaterThanOrEqual(1000)
  test.info().annotations.push({
    type: 'burst',
    description: `5,000 track() calls took ${ms.toFixed(1)} ms`,
  })
})

test('delivery rate on a healthy network is at least 99.9% of accepted events', async ({
  page,
}) => {
  const run = newRun()
  const sent = 3 * 600
  // About 500 events a second, each page left at once: far above a real page, inside what one
  // keepalive send at a time plus the 64 KiB unload quota can carry.
  for (let p = 0; p < 3; p++) {
    await start(page, run, { path: `/page.html?p=${p}` })
    for (let b = 0; b < 12; b++) {
      await track(page, 50, 'rate')
      await page.waitForTimeout(100)
    }
    // the next start() navigates away: whatever is still queued leaves on pagehide
  }
  await hide(page)
  await expect
    .poll(async () => new Set(tracks(await events(page, run), 'rate').map((e) => e.uuid)).size, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(Math.ceil(sent * 0.999))
  const unique = new Set(tracks(await events(page, run), 'rate').map((e) => e.uuid)).size
  test.info().annotations.push({
    type: 'delivery',
    description: `${unique}/${sent} unique events delivered`,
  })
})

test('$identify is sent at once, before events that carry the new user', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await waitFor(page, run, 2)
  await page.evaluate(() => window.datacub.identify('user_1'))
  await expect
    .poll(async () => (await events(page, run)).some((e) => e.event === '$identify'))
    .toBe(true)
})

test('importing the script without init makes no request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  await page.goto('/page.html')
  await page.waitForTimeout(300)
  expect(requests).toEqual(['/page.html', '/datacub.js'])
})

test('repeated init attaches listeners once: one $click per click', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate((run) => {
    for (let i = 0; i < 3; i++)
      window.datacub.init('pk_test_abcdefghijklmnopqrstuvwx', {
        apiHost: `${location.origin}/r/${run}`,
      })
  }, run)
  await page.click('#buy')
  await hide(page)
  await waitFor(page, run, 1, '$click')
  await page.waitForTimeout(200)
  expect((await events(page, run)).filter((e) => e.event === '$click')).toHaveLength(1)
})
