import { expect, test } from '@playwright/test'
import { events, hide, newRun, start } from './helpers.ts'

// Real routers, no framework-specific SDK code: exactly one $pageview per route change.
const cases = [
  {
    name: 'React + TanStack Router',
    path: '/app',
    clicks: ['#to-a', '#to-b', '#to-home'],
    // a 10-digit segment starting with 1 has the Saudi ID shape: redacted, not just templated
    expected: ['/app', '/app/a', '/app/b/:redacted', '/app'],
  },
  {
    name: 'Vue + vue-router',
    path: '/vue',
    clicks: ['#to-a', '#to-order'],
    expected: ['/vue', '/vue/a', '/vue/orders/:uuid'],
  },
]

for (const c of cases)
  test(`${c.name}: one pageview per route, IDs templated, query dropped`, async ({ page }) => {
    const run = newRun()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await start(page, run, { path: c.path })
    await page.locator('h1').first().waitFor()
    for (const sel of c.clicks) {
      await page.click(sel)
      await page.waitForTimeout(200)
    }
    await page.goBack()
    await page.waitForTimeout(200)
    await hide(page)
    const expected = [...c.expected, c.expected.at(-2)]
    await expect
      .poll(async () =>
        (await events(page, run)).filter((e) => e.event === '$pageview').map((e) => e.context.path),
      )
      .toEqual(expected)
    const body = JSON.stringify(await events(page, run))
    expect(body).not.toContain('1012345678')
    expect(body).not.toContain('secret@example.com')
    expect(errors).toEqual([])
  })
