import { expect, test } from 'bun:test'
import { version } from '../package.json' with { type: 'json' }

// Tracking never starts at import time: loading the SDK must not touch the network, storage or the DOM.
// Bun has no window, so this is also the server-side rendering case: every call must be a no-op.
test('import and calls on a server have no side effects and never throw', async () => {
  let fetched = 0
  const saved = globalThis.fetch
  globalThis.fetch = (() => {
    fetched++
    return Promise.resolve(new Response())
  }) as unknown as typeof fetch
  try {
    const { default: datacub, VERSION } = await import(`./index.ts?ssr=${Date.now()}`)
    expect(VERSION).toBe(version)
    datacub.init('pk_test_abcdefghijklmnopqrstuvwx')
    datacub.consent.grant()
    datacub.track('server_side', { a: 1 })
    datacub.identify('user_1')
    datacub.reset()
    datacub.consent.revoke()
    expect(fetched).toBe(0)
  } finally {
    globalThis.fetch = saved
  }
})

// bun test defines __VERSION__ from package.json (test/version.ts); the build does the same
test('VERSION matches package.json', async () => {
  const { VERSION } = await import('./index.ts')
  expect(VERSION).toBe(version)
})

test('browser bundles use no Node or Bun APIs', async () => {
  for (const entry of ['index.ts', 'global.ts']) {
    const out = await Bun.build({
      entrypoints: [`${import.meta.dir}/${entry}`],
      target: 'browser',
      minify: true,
    })
    expect(out.success).toBe(true)
    expect(await out.outputs[0]?.text()).not.toMatch(/\bnode:|\bBun\.|require\(/)
  }
})

// capture builds the feedback and flags modules at runtime, in an image installed without dev
// dependencies: they may import files beside them only, never a package name
test('runtime-built modules import only files beside them', async () => {
  const seen = new Set<string>()
  const walk = async (f: string) => {
    if (seen.has(f)) return
    seen.add(f)
    const src = await Bun.file(`${import.meta.dir}/${f}`).text()
    for (const [, spec] of src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      expect(spec, `${f} imports ${spec}`).toMatch(/^\.\/[\w-]+\.ts$/)
      await walk((spec as string).slice(2))
    }
  }
  for (const f of ['feedback-global.ts', 'flags-global.ts']) await walk(f)
  expect(seen.has('bucket.ts')).toBe(true)
})
