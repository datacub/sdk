import { expect, test } from '@playwright/test'
import { events, hide, KEY, log, newRun, start, waitFor } from './helpers.ts'

test('script-tag stub: calls queued before load are replayed in order', async ({ page }) => {
  const run = newRun()
  await page.goto(`/stub.html?run=${run}`)
  await page.click('#buy')
  await hide(page)
  const all = await waitFor(page, run, 1, '$click')
  const names = all.sort((a, b) => a.seq - b.seq).map((e) => e.event)
  // grant emits the page's $pageview at once, so it precedes the calls queued after grant
  expect(names).toEqual([
    '$consent',
    '$pageview',
    'queued_before_load',
    '$identify',
    '$click',
    '$pageleave',
  ])
  expect(all.find((e) => e.event === '$click')?.user_id).toBe('user_7')
})

test('datacub.flag works on the snippet queue before the SDK has loaded', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/datacub.js', (r) => r.abort()) // the SDK never arrives
  await page.goto('/page.html')
  const r = await page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>
    w.datacub = []
    await new Promise((ok) => {
      const s = document.createElement('script')
      s.src = '/flags.js'
      s.onload = ok
      document.head.appendChild(s)
    })
    const d = w.datacub as { flag?: unknown; experiment?: unknown }
    return [typeof d.flag, typeof d.experiment]
  })
  expect(r).toEqual(['function', 'function'])
  expect(errors).toEqual([])
})

test('script tag with data-key starts the SDK without an init call', async ({ page }) => {
  const run = newRun()
  await page.goto(`/datakey.html?run=${run}`)
  expect((await waitFor(page, run, 1, '$pageview')).length).toBeGreaterThan(0)
})

test('misuse never throws into the page', async ({ page }) => {
  const run = newRun()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/page.html')
  const thrown = await page.evaluate(
    ([key, run]) => {
      type F = (...a: unknown[]) => unknown
      const datacub = window.datacub as unknown as {
        init: F
        track: F
        identify: F
        reset: F
        consent: { grant: F; revoke: F }
      }
      const calls: (() => unknown)[] = [
        () => datacub.track('before_init'),
        () => datacub.reset(),
        () => datacub.init(),
        () => datacub.init(null),
        () => datacub.init(42, 'options'),
        () =>
          datacub.init(key, {
            apiHost: `${location.origin}/r/${run}`,
            release: { toString: () => 'x' },
          }),
        () => datacub.consent.grant('banner'),
        () => datacub.track(),
        () => datacub.track(null),
        () => datacub.track({}),
        () => datacub.track('ok', 'not an object'),
        () => datacub.track('ok', [1, 2, 3]),
        () => datacub.track('ok', { bad: () => 1, sym: Symbol('s'), big: 10n }),
        () => {
          const loop: Record<string, unknown> = {}
          loop.self = loop
          return datacub.track('circular', loop)
        },
        () =>
          datacub.track('getter', {
            get boom() {
              throw new Error('getter')
            },
          }),
        () =>
          datacub.track(
            'proxy',
            new Proxy(
              {},
              {
                ownKeys: () => {
                  throw new Error('trap')
                },
              },
            ),
          ),
        () => datacub.identify(),
        () => datacub.identify({ id: 1 }),
        () => datacub.identify('user_1', 'not options'),
        () => datacub.identify('user_1', { account: { toString: () => 'boom' } }),
        () => datacub.consent.revoke(1, 2, 3),
        () => datacub.consent.grant({ method: 'carrier pigeon', policyVersion: 7 }),
      ]
      let n = 0
      for (const c of calls)
        try {
          c()
        } catch {
          n++
        }
      return n
    },
    [KEY, run] as const,
  )
  await page.waitForTimeout(300)
  expect(thrown).toBe(0)
  expect(errors).toEqual([])
})

test('invalid event names are refused; valid Arabic names are accepted', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() => {
    for (const n of [
      '',
      '   ',
      '$pageview',
      '$custom',
      'a'.repeat(101),
      'user_123456',
      'order_550e8400-e29b-41d4',
      'deadbeefdeadbeef00',
      'someone@example.com',
      'bad‮name',
      'tab\tname',
    ])
      window.datacub.track(n)
    window.datacub.track('  اشتراك_جديد  ')
    window.datacub.track('plan_upgraded')
  })
  await hide(page)
  await waitFor(page, run, 1, 'plan_upgraded')
  const custom = (await events(page, run)).filter((e) => !e.event.startsWith('$'))
  expect(custom.map((e) => e.event)).toEqual(['اشتراك_جديد', 'plan_upgraded'])
})

test('custom event properties: exact serialisation', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  await page.evaluate(() =>
    window.datacub.track('project_created', {
      projectType: 'personal',
      seats: 3,
      price: 149.5,
      trial: false,
      coupon: null,
      tags: ['a', 'b'],
      created: new Date('2026-10-31T09:00:00Z'),
      nested: { level2: { level3: { level4: 'deep' } } },
      nan: Number.NaN,
      skipped: undefined,
    } as never),
  )
  await hide(page)
  const e = (await waitFor(page, run, 1, 'project_created')).find(
    (x) => x.event === 'project_created',
  )
  expect(e?.properties).toEqual({
    projectType: 'personal',
    seats: 3,
    price: 149.5,
    trial: false,
    coupon: null,
    tags: ['a', 'b'],
    created: '2026-10-31T09:00:00.000Z',
    nested: { level2: { level3: '[depth]' } },
  })
})

test('release and account context travel on every event', async ({ page }) => {
  const run = newRun()
  await start(page, run, { init: { release: '2.4.1+build.88' } })
  await page.evaluate(() => {
    window.datacub.identify('user_1', { account: 'org_42' })
    window.datacub.track('feature_used')
  })
  await hide(page)
  const e = (await waitFor(page, run, 1, 'feature_used')).find((x) => x.event === 'feature_used')
  expect(e?.context.release).toBe('2.4.1+build.88')
  expect(e?.account_id).toBe('org_42')
})

test('rapid interaction burst: 200 clicks are 200 $click events, in order', async ({ page }) => {
  test.setTimeout(90_000) // 200 real clicks are slow in Firefox under a full parallel run
  const run = newRun()
  await start(page, run)
  for (let i = 0; i < 200; i++) await page.click('#buy', { delay: 0 })
  await hide(page)
  await expect
    .poll(async () => (await events(page, run)).filter((e) => e.event === '$click').length)
    .toBe(200)
  const seqs = (await events(page, run)).filter((e) => e.event === '$click').map((e) => e.seq)
  expect(new Set(seqs).size).toBe(200)
})

test('a prerendered page is not a visit until it is shown', async ({ page }) => {
  const run = newRun()
  await page.addInitScript(() =>
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true }),
  )
  await start(page, run)
  await page.waitForTimeout(300)
  expect((await log(page, run)).requests).toBe(0)
  await page.evaluate(() => {
    Object.defineProperty(document, 'prerendering', { value: false, configurable: true })
    document.dispatchEvent(new Event('prerenderingchange'))
    window.datacub.consent.grant()
  })
  const all = await waitFor(page, run, 1, '$pageview')
  expect(all.filter((e) => e.event === '$pageview')).toHaveLength(1)
})

test('the wrapped History API keeps the original behaviour', async ({ page }) => {
  const run = newRun()
  await start(page, run)
  const r = await page.evaluate(() => {
    const ret = history.pushState({ a: 1 }, '', '/kept')
    return { ret: ret === undefined, state: history.state, path: location.pathname }
  })
  expect(r).toEqual({ ret: true, state: { a: 1 }, path: '/kept' })
})

test('datacub.js loaded twice (snippet pasted twice) keeps one SDK: later calls are sent once', async ({
  page,
}) => {
  const run = newRun()
  await page.goto(`/stub.html?run=${run}`)
  await waitFor(page, run, 1, '$pageview')
  await page.evaluate(
    () =>
      new Promise((r) => {
        const s = document.createElement('script')
        s.src = '/datacub.js?again'
        s.onload = r
        document.head.appendChild(s)
      }),
  )
  await page.evaluate(() => window.datacub.track('after_second_load'))
  await page.click('#buy')
  await hide(page)
  await waitFor(page, run, 1, 'after_second_load')
  await page.waitForTimeout(300)
  const all = await events(page, run)
  expect(all.filter((e) => e.event === 'after_second_load')).toHaveLength(1)
  expect(all.filter((e) => e.event === '$click')).toHaveLength(1)
  expect(all.filter((e) => e.event === '$pageview')).toHaveLength(1)
})
