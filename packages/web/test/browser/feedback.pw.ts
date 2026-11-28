import { expect, type Page, test } from '@playwright/test'
import { events, newRun, waitFor } from './helpers.ts'

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

type Fb = {
  hint: boolean
  questions: unknown[]
  script: number
  asks: number
  seen: number
  settings?: Record<string, unknown>
}
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

const card = (page: Page) => widgets(page).locator('.w')
const vars = (page: Page, ...k: string[]) =>
  card(page).evaluate((w, k) => k.map((x) => (w as HTMLElement).style.getPropertyValue(x)), k)

test('the look from datacub styles the card; values it does not know are ignored', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, {
    hint: true,
    questions: [QUESTION],
    settings: {
      accent: '#2563eb',
      position: 'start',
      theme: 'light',
      font: 'serif',
      radius: 'small',
      size: 'large',
      background: '#102a43',
      // too dark to read on that card: datacub picks the readable text colour
      text: '#000000',
    },
  })
  await page.goto(`/feedback.html?run=${run}`)
  await expect(card(page)).toHaveCount(1)
  expect(await vars(page, '--a', '--bg', '--fg', '--r', '--ri', '--wd')).toEqual([
    '#2563eb',
    '#102a43',
    '#fafafa',
    '6px',
    '4px',
    '400px',
  ])
  expect(await vars(page, '--ff')).toEqual([expect.stringContaining('Georgia')])
  await expect(card(page)).toHaveClass(/\bs\b/)
  expect(
    await card(page)
      .locator('.c')
      .evaluate((c) => getComputedStyle(c).borderRadius),
  ).toBe('6px')
})

test('feedback.look in init wins over datacub; a bad value is dropped, not used', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, {
    hint: true,
    questions: [QUESTION],
    settings: { accent: '#2563eb', position: 'end', theme: 'light', radius: 'large' },
  })
  const look = { theme: 'dark', radius: 'none', accent: 'red;background:url(x)', font: 'comic' }
  await page.goto(`/feedback.html?run=${run}&look=${encodeURIComponent(JSON.stringify(look))}`)
  await expect(card(page)).toHaveCount(1)
  await expect(card(page)).toHaveClass(/\bdk\b/)
  // the bad accent falls back to datacub's near black, which turns light on a dark card
  expect(await vars(page, '--a', '--r')).toEqual(['#fafafa', '0px'])
  // an unknown font falls back to the default, the page's own font as the browser computed it
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(await vars(page, '--ff')).toEqual([body])
})

test('the send button: their own words as text, the default when too long or not text', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, {
    hint: true,
    questions: [{ ...QUESTION, q: { ...QUESTION.q, type: 'text' } }],
    settings: { accent: '#2563eb', sendLabel: '<b>Go</b>' },
  })
  await page.goto(`/feedback.html?run=${run}`)
  await expect(card(page)).toHaveCount(1)
  const send = card(page).locator('.b')
  await expect(send).toHaveText('<b>Go</b>')
  await expect(send.locator('b')).toHaveCount(0)
  // disabled until they type, still in their colour
  expect(await send.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(37, 99, 235)')
  const long = { sendLabel: 'x'.repeat(21) }
  await page.goto(`/feedback.html?run=${run}&look=${encodeURIComponent(JSON.stringify(long))}`)
  await expect(card(page).locator('.b')).toHaveText('Send')
})

test('the full look: colours per part, shape, type, icons, placement; out of range values are dropped', async ({
  page,
}) => {
  const run = newRun()
  await setup(page, run, {
    hint: true,
    questions: [QUESTION],
    settings: {
      accent: '#2563eb',
      theme: 'light',
      title: '#0f766e',
      option: '#eef2ff',
      optionText: '#1e1b4b',
      selected: '#7c3aed',
      button: '#db2777',
      // unreadable on that button: the readable one is used
      buttonText: '#db2777',
      close: '#0f766e',
      border: '#2563eb',
      borderWidth: 2,
      shadow: 'none',
      width: 420,
      density: 'roomy',
      font: 'custom',
      fontName: 'IBM Plex Sans Arabic',
      titleSize: 'large',
      titleWeight: 'bold',
      align: 'center',
      icons: 'faces',
      animation: 'fade',
      offsetX: 40,
      offsetY: 96,
      layer: 'normal',
      dark: { background: '#000000' },
    },
  })
  await page.goto(`/feedback.html?run=${run}`)
  await expect(card(page)).toHaveCount(1)
  expect(
    await vars(page, '--tc', '--opt', '--ot', '--sel', '--btn', '--bt', '--xc', '--edge', '--bw'),
  ).toEqual([
    '#0f766e',
    '#eef2ff',
    '#1e1b4b',
    '#7c3aed',
    '#db2777',
    '#ffffff',
    '#0f766e',
    '#2563eb',
    '2px',
  ])
  expect(await vars(page, '--sh', '--wd', '--pad', '--ts', '--tw', '--z', '--ox', '--oy')).toEqual([
    'none',
    '420px',
    '20px',
    '4px',
    '700',
    '999',
    '40px',
    '96px',
  ])
  expect(await vars(page, '--ff', '--bg')).toEqual([
    expect.stringContaining('"IBM Plex Sans Arabic"'),
    '',
  ])
  await expect(card(page)).toHaveClass(/\baf\b/)
  await expect(card(page)).toHaveClass(/\bce\b/)
  // faces: a drawn icon, no emoji or words
  await expect(card(page).locator('.th .o1 svg')).toHaveCount(2)

  const bad = {
    width: 9999,
    borderWidth: 1.5,
    offsetY: -10,
    fontName: 'x";background:url(//e)',
    font: 'custom',
    shadow: 'url(x)',
    layer: 'max',
    title: 'red',
  }
  await page.goto(`/feedback.html?run=${run}&look=${encodeURIComponent(JSON.stringify(bad))}`)
  await expect(card(page)).toHaveCount(1)
  // a value in code replaces the one from datacub, and a bad one is dropped: the default look
  expect(await vars(page, '--wd', '--bw', '--oy', '--sh', '--z', '--tc')).toEqual([
    '360px',
    '',
    '',
    '',
    '2147483000',
    '',
  ])
  expect(await vars(page, '--ff')).toEqual([expect.not.stringContaining('background')])
})

test('theme auto takes the dark colours in dark mode', async ({ page }) => {
  const run = newRun()
  await page.emulateMedia({ colorScheme: 'dark' })
  await setup(page, run, {
    hint: true,
    questions: [QUESTION],
    settings: {
      theme: 'auto',
      accent: '#1f1f1f',
      background: '#fff7ed',
      dark: { background: '#0b1220', accent: '#f59e0b', button: '#22c55e' },
    },
  })
  await page.goto(`/feedback.html?run=${run}`)
  await expect(card(page)).toHaveCount(1)
  expect(await vars(page, '--bg', '--a', '--btn')).toEqual(['#0b1220', '#f59e0b', '#22c55e'])

  // no dark colours: the theme's dark card, the brand colour carried over
  const look = { theme: 'auto', accent: '#2563eb', background: '#fff7ed', dark: null }
  await page.goto(`/feedback.html?run=${run}&look=${encodeURIComponent(JSON.stringify(look))}`)
  await expect(card(page)).toHaveCount(1)
  expect(await vars(page, '--bg', '--a')).toEqual(['', '#2563eb'])
})

test('a site with its own UI: shown, send and dismissed reach the same endpoints and events, no widget', async ({
  page,
}) => {
  const run = newRun()
  await page.goto(`/feedback.html?run=${run}`)
  await waitFor(page, run, 1, '$pageview')
  const r = await page.evaluate(async (id) => {
    const f = window.datacub.feedback
    if (!f) return null
    const shown = await f.shown(id)
    const sent = await f.send({ question: id, choice: 'yes', text: 'great' })
    const general = await f.send({ text: 'add exports', choice: 'idea' })
    f.dismissed(id)
    return { shown, sent, general }
  }, QUESTION.id)
  expect(r).toEqual({ shown: true, sent: true, general: true })
  await waitFor(page, run, 1, '$feedback_dismissed')
  const posts = (
    (await (await page.request.get(`/r/${run}/log`)).json()) as {
      fb: { posts: { path: string; body: Record<string, unknown> }[] }
    }
  ).fb.posts
  expect(posts.map((p) => p.path)).toEqual([
    'v1/feedback/seen',
    'v1/feedback/answer',
    'v1/feedback/answer',
    'v1/feedback/seen',
  ])
  const [shown, answer, general, closed] = posts.map((p) => p.body)
  expect(shown).toMatchObject({ question: QUESTION.id, kind: 'shown' })
  expect(answer).toMatchObject({
    question: QUESTION.id,
    version: null,
    choice: 'yes',
    text: 'great',
  })
  expect(answer?.anon_id).toBe(shown?.anon_id)
  expect(general).toMatchObject({ question: null, choice: 'idea', text: 'add exports' })
  expect(closed).toMatchObject({ question: QUESTION.id, kind: 'dismissed' })
  const ev = await events(page, run)
  const of = (n: string) => ev.filter((e) => e.event === n).map((e) => e.properties)
  expect(of('$feedback_shown')).toEqual([{ $question_id: QUESTION.id, $version: 3 }])
  expect(of('$feedback_dismissed')).toEqual([{ $question_id: QUESTION.id, $version: 3 }])
  expect(of('$feedback_answered')).toHaveLength(2)
  expect(of('$feedback_answered')[0]).toMatchObject({
    $question_id: QUESTION.id,
    $version: 3,
    $choice: 'yes',
  })
  expect((await fb(page, run)).script).toBe(0)
})
