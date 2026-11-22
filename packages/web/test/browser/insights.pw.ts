import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { newRun } from './helpers.ts'

// Insights module: the fixture plays the core's side of the handshake, so these tests
// pin the module's own contract: what each browser reports, early coverage, and $form_fields.
const { version } = JSON.parse(readFileSync(`${import.meta.dirname}/../../package.json`, 'utf8'))

type Snap = Record<string, number | string>
declare global {
  interface Window {
    E: [string, Record<string, unknown>][]
    inject: (src: string) => Promise<void>
    __datacub: { l: () => Snap; h?: string[] }
  }
}

// Loads the fixture and injects the module a second after load, as a slow network would.
async function load(page: Page) {
  await page.goto('/insights.html')
  await page.waitForLoadState('load')
  await page.waitForTimeout(1000)
  await page.evaluate(
    (src) => window.inject(src),
    `/r/${newRun()}/v1/sdk/insights-${version}.min.js`,
  )
}
const snap = (page: Page) => page.evaluate(() => window.__datacub.l())
const emitted = (page: Page) => page.evaluate(() => window.E)
const chromium = (name: string) => name.endsWith('chromium')

test('vitals: early entries are covered, per-segment fields reset, nothing unknown sent as 0', async ({
  page,
}, info) => {
  await load(page)
  await page.click('#busy') // a 120 ms handler: a slow interaction and a long task
  await page.waitForTimeout(300)
  const s = await snap(page)
  info.annotations.push({ type: 'support', description: JSON.stringify(s) })

  // every browser: paint and navigation timing, resources of this page (not the module itself)
  expect(s.$fcp).toBeGreaterThan(0)
  // TTFB on localhost can be under Firefox's timer step and read as 0: then unknown, never sent as 0
  const rs = await page.evaluate(
    () =>
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).responseStart,
  )
  if (rs > 0) expect(s.$ttfb).toBeGreaterThan(0)
  else expect(s.$ttfb).toBeUndefined()
  expect(s.$dcl).toBeGreaterThan(0)
  expect(s.$load).toBeGreaterThan(0)
  // resources of the page (Firefox counts favicon.ico), never the module or datacub's endpoint
  expect(s.$rc).toBe(
    await page.evaluate(
      () => performance.getEntriesByType('resource').filter((e) => !e.name.includes('/v1/')).length,
    ),
  )
  if (chromium(info.project.name)) {
    // LCP and the layout shift happened before the module was injected
    expect(s.$lcp).toBeGreaterThan(0)
    expect(s.$cls).toBeGreaterThan(0)
    expect(s.$inp).toBeGreaterThanOrEqual(100)
    expect(s.$ie).toBe('button')
    expect(s.$lt).toBeGreaterThanOrEqual(1)
    expect(s.$ltm).toBeGreaterThanOrEqual(100)
  }
  for (const v of Object.values(s)) expect(v === 0 || !!v).toBe(true)
  // client hints arrive asynchronously in Chromium; elsewhere h stays unset
  const h = await page.evaluate(() => window.__datacub.h)
  if (chromium(info.project.name)) expect(h).toHaveLength(2)

  // the next segment: no initial-page fields, per-segment counters back to zero, no INP
  const s2 = await snap(page)
  for (const k of ['$lcp', '$fcp', '$ttfb', '$dns', '$tcp', '$dcl', '$load', '$inp', '$ie'])
    expect(s2).not.toHaveProperty(k)
  expect(s2.$rc).toBe(0)
  if (s.$cls !== undefined) expect(s2.$cls).toBe(0)
  if (s.$lt !== undefined) expect(s2.$lt).toBe(0)
})

test('$form_fields on submit: structure only, never values, lengths or sensitive names', async ({
  page,
}) => {
  await load(page)
  const typed = 'Fatimah Zahra'
  await page.fill('[name=full_name]', typed)
  await page.waitForTimeout(60)
  await page.click('[name=plan]')
  await page.click('form#signup button') // email is required and empty: invalid, no submit
  await page.fill('[name=email]', 'fatimah@example.sa')
  await page.fill('[name=password]', 'S3cret!pass')
  await page.click('form#signup button')
  await expect.poll(async () => (await emitted(page)).length).toBe(1)

  const [[name, p]] = (await emitted(page)) as [[string, Record<string, unknown>]]
  expect(name).toBe('$form_fields')
  expect(p).toMatchObject({ $f: 'signup', $fo: 'submit' })
  expect(p.$a).toBe(`${new URL(page.url()).origin}/account/create`)
  const ff = p.$ff as unknown[][]
  // DOM order; hidden and buttons left out; [type, name, autocomplete, required, touched, dwell, edits, invalid]
  expect(ff.map((f) => f.slice(0, 5))).toEqual([
    ['text', 'full_name', 'name', 0, 1],
    ['email', 'email', 'email', 1, 1],
    ['password', '', 'new-password', 0, 1],
    ['text', '', 'one-time-code', 0, 0],
    ['text', '', '', 0, 0], // an ID-like name is blanked
    ['select-one', 'plan', '', 0, 1],
    ['textarea', 'notes', '', 0, 0],
  ])
  const [full, email] = ff as [unknown[], unknown[]]
  expect(full[5]).toBeGreaterThan(0) // dwell
  expect(full[6]).toBeGreaterThan(0) // edits
  expect(email[7]).toBe('valueMissing')
  expect(full[7]).toBe('')

  const json = JSON.stringify(p)
  for (const secret of [typed, 'Fatimah', 'fatimah@example.sa', 'S3cret', 'tok'])
    expect(json).not.toContain(secret)
  // fill() is one input event: edits count events, they do not echo the value's length
  expect(full[6]).not.toBe(typed.length)

  // once per form: a second submit and a leave send nothing more
  await page.click('form#signup button')
  await snap(page)
  expect(await emitted(page)).toHaveLength(1)
})

test('$form_fields abandon: only forms with input, once, at the leave snapshot', async ({
  page,
}) => {
  await load(page)
  await page.fill('#search [name=q]', 'riyadh hotels')
  await page.focus('#other [name=city]') // focus only: no $form_start, so no abandon either
  await page.focus('#search [name=q]')
  expect(await emitted(page)).toHaveLength(0)
  await snap(page)
  const e = await emitted(page)
  expect(e).toHaveLength(1)
  const p = e[0]?.[1] as { $ff: unknown[][] }
  expect(p).toMatchObject({ $f: null, $fo: 'abandon' })
  expect(p.$ff.map((f) => f.slice(0, 5))).toEqual([['text', 'q', '', 0, 1]])
  expect(JSON.stringify(e)).not.toContain('riyadh')
  await snap(page)
  expect(await emitted(page)).toHaveLength(1)
})
