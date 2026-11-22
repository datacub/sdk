import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { reset, server, tick } from './harness.ts'

// The published files may import nothing but react-native (and, for the navigation helper, the core
// build beside it). Needs `bun run build` first; `bun run test` does it.

const dist = `${import.meta.dir}/../dist`
const files = readdirSync(dist)
  .filter((f) => /\.(?:mjs|cjs|d\.ts|d\.cts)$/.test(f))
  .sort()

// every module specifier a file loads: import/export ... from "x", import "x", import("x"), require("x")
function specifiers(code: string): string[] {
  const out: string[] = []
  const re =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"']+)\1|\bimport\s*(["'])([^"']+)\3/g
  for (const m of code.matchAll(re)) out.push((m[2] ?? m[4]) as string)
  return out
}

describe('published files', () => {
  test('the build wrote exactly the public files', () => {
    expect(files).toEqual([
      'index.cjs',
      'index.d.cts',
      'index.d.ts',
      'index.mjs',
      'navigation.cjs',
      'navigation.d.cts',
      'navigation.d.ts',
      'navigation.mjs',
    ])
  })

  for (const f of files)
    test(`${f} imports nothing outside react-native`, async () => {
      let code = await Bun.file(`${dist}/${f}`).text()
      // doc comments in declarations may show import examples; the minified JS has none to strip
      if (f.includes('.d.')) code = code.replace(/\/\*[\s\S]*?\*\//g, '')
      const allowed = new Set(['react-native'])
      // the navigation helper drives the one client in index, never a copy of it
      if (f.startsWith('navigation'))
        allowed.add(`./index.${f.endsWith('cjs') || f.endsWith('cts') ? 'cjs' : 'mjs'}`)
      if (f.startsWith('navigation.d.')) allowed.add('./index.ts').add('./index.js').add('./index')
      for (const s of specifiers(code))
        expect([f, allowed.has(s) ? s : `unexpected ${s}`]).toEqual([f, s])
    })

  test('the scanner sees the specifiers it should', () => {
    expect(
      specifiers('import{a}from"react-native";import("x");require("y");export*from"z"'),
    ).toEqual(['react-native', 'x', 'y', 'z'])
  })

  test('the build embeds the package.json version', async () => {
    const pkg = (await Bun.file(`${import.meta.dir}/../package.json`).json()) as { version: string }
    for (const f of ['index.mjs', 'index.cjs'])
      expect(await Bun.file(`${dist}/${f}`).text()).toContain(JSON.stringify(pkg.version))
  })

  test('no Node, Bun or browser globals, no source references', async () => {
    for (const f of files) {
      const code = await Bun.file(`${dist}/${f}`).text()
      expect([
        f,
        /\bnode:|\bBun\.|\bprocess\.|\bdocument\.|\bwindow\.|sourceMappingURL/.test(code),
      ]).toEqual([f, false])
    }
  })

  // The CommonJS helper must reach the same client the CommonJS core exports (a bundler's Node-style
  // interop once gave it the exports object, and screen() silently did nothing).
  test('navigation.cjs sends screens through index.cjs', async () => {
    reset()
    const srv = server()
    const require = createRequire(import.meta.url)
    const core = require('../dist/index.cjs')
    const { trackNavigation } = require('../dist/navigation.cjs')
    core.default.init('pk_test_abcdefghijklmnopqrstuvwx', {
      apiHost: 'https://ingest.example.com',
      app: { applicationId: 'com.example.app' },
      requireConsent: false,
    })
    await tick()
    let notify = () => {}
    trackNavigation({
      isReady: () => true,
      getCurrentRoute: () => ({ name: 'Cart' }),
      addListener: (_: string, f: () => void) => {
        notify = f
        return () => {}
      },
    })
    notify()
    await core.default.flush()
    expect(srv.events.map((e) => [e.event, e.context.screen])).toEqual([['$screen', 'Cart']])
  })
})
