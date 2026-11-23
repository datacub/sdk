import { expect, type Page, test } from '@playwright/test'
import { newRun, waitFor } from './helpers.ts'

// One script tag: the core loads the feedback widget itself, only when the batch answer says the
// project has a live question or the page opens the "Send feedback" card, and only while tracking.

const QUESTION = {
  id: '6f1c1c52-5b7e-4a52-9d0f-0c5d6c3a1b2e',
  version: 1,
  q: {
    lang: 'en',
    type: 'thumbs',
    title: 'Is this page useful?',
    trigger: { kind: 'page', path: '/feedback.html' },
  },
}

type Fb = { hint: boolean; questions: unknown[]; script: number; asks: number; seen: number }
const fb = async (page: Page, run: string) =>
  ((await (await page.request.get(`/r/${run}/log`)).json()) as { fb: Fb }).fb
const setup = (page: Page, run: string, o: Partial<Fb>) =>
  page.request.post(`/r/${run}/feedback`, { data: o })
const widgets = (page: Page) => page.locator('[data-datacub-feedback-widget]')

test('no live question: the widget is never downloaded', async ({ page }) => {
  const run = newRun()
  await page.goto(`/feedback.html?run=${run}`)
  await waitFor(page, run, 1, '$pageview')
  await page.waitForTimeout(500)
  expect((await fb(page, run)).script).toBe(0)
  expect(await page.locator('script[src*="/v1/feedback.js"]').count()).toBe(0)
})

test('a live question: the widget loads once and shows it', async ({ page }) => {
  const run = newRun()
  await setup(page, run, { hint: true, questions: [QUESTION] })
  await page.goto(`/feedback.html?run=${run}`)
  await expect(widgets(page)).toHaveCount(1)
  await expect(widgets(page).locator('.t')).toHaveText(QUESTION.q.title)
  const f = await fb(page, run)
  expect(f.script).toBe(1)
  expect(f.asks).toBe(1)
  expect(f.seen).toBe(1)
})

test('data-feedback="off": never loaded, even with a live question or a click', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, { hint: true, questions: [QUESTION] })
  await page.goto(`/feedback.html?run=${run}&off`)
  await waitFor(page, run, 1, '$pageview')
  await page.click('#send')
  await page.evaluate(() => window.datacub.feedback?.())
  await page.waitForTimeout(500)
  expect((await fb(page, run)).script).toBe(0)
  await expect(widgets(page)).toHaveCount(0)
})

test('an older install with its own feedback.js tag: one widget, no second download', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, { hint: true, questions: [QUESTION] })
  await page.goto(`/feedback.html?run=${run}&both`)
  await expect(widgets(page)).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expect(widgets(page)).toHaveCount(1)
  const f = await fb(page, run)
  expect(f.script).toBe(1)
  expect(f.asks).toBe(1)
})

test('no question, a "Send feedback" button: the click loads the widget and opens the card', async ({
  page,
}) => {
  const run = newRun()
  await page.goto(`/feedback.html?run=${run}`)
  await waitFor(page, run, 1, '$pageview')
  expect((await fb(page, run)).script).toBe(0)
  await page.click('#send')
  await expect(widgets(page)).toHaveCount(1)
  await expect(widgets(page).locator('textarea')).toBeVisible()
  // the widget took over the button: another click does not open a second card
  await page.click('#send')
  await page.waitForTimeout(300)
  await expect(widgets(page)).toHaveCount(1)
  expect((await fb(page, run)).script).toBe(1)
})

test('consent mode: nothing loads before grant(), the widget comes after it', async ({ page }) => {
  const run = newRun()
  await setup(page, run, { hint: true, questions: [QUESTION] })
  await page.goto(`/feedback.html?run=${run}&consent`)
  await page.waitForFunction(() => typeof window.datacub?.consent === 'object')
  await page.click('#send')
  await page.evaluate(() => {
    window.datacub.feedback?.()
    window.datacub.ask?.('6f1c1c52-5b7e-4a52-9d0f-0c5d6c3a1b2e')
  })
  await page.waitForTimeout(800)
  expect(await fb(page, run)).toMatchObject({ script: 0, asks: 0 })
  await page.evaluate(() => window.datacub.consent.grant())
  await expect(widgets(page)).toHaveCount(1)
  expect((await fb(page, run)).script).toBe(1)
})

test('datacub.ask() before the widget is here: it loads, waits for the questions, then asks', async ({
  page,
}) => {
  const run = newRun()
  const manual = { ...QUESTION, q: { ...QUESTION.q, trigger: { kind: 'manual' } } }
  // no batch answer yet says there is a question: the call itself loads the widget
  await setup(page, run, { questions: [manual] })
  await page.goto(`/feedback.html?run=${run}`)
  await page.waitForFunction(() => typeof window.datacub?.ask === 'function')
  await page.evaluate((id) => window.datacub.ask?.(id), manual.id)
  await expect(widgets(page).locator('.t')).toHaveText(QUESTION.q.title)
  expect((await fb(page, run)).script).toBe(1)
})
