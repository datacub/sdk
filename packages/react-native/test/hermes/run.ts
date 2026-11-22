// Runtime check on the real Hermes engine, not Bun: compiles the built bundles to Hermes bytecode with
// every hermesc we can get, then runs init, track, screen, identify, flush and revoke in the Hermes VM
// against a stubbed react-native, fetch and storage. Needs `bun run build` first (`test:hermes` does it).
import { mkdirSync, rmSync } from 'node:fs'
import { $ } from 'bun'
import { hermes013 } from './fetch.ts'

const root = `${import.meta.dir}/../..`
const out = `${import.meta.dir}/.out`
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const compilers = [
  {
    name: 'hermes-compiler (Hermes 1.0, React Native 0.88)',
    hermesc: Bun.resolveSync('hermes-compiler/package.json', import.meta.dir).replace(
      'package.json',
      'hermesc/linux64-bin/hermesc',
    ),
  },
  {
    name: 'Hermes 0.13 (React Native 0.75, the oldest supported)',
    hermesc: (await hermes013()).hermesc,
  },
]
let failed = false

// 1. syntax: every built CommonJS file must compile
for (const c of compilers)
  for (const f of ['index.cjs', 'navigation.cjs']) {
    const r = await $`${c.hermesc} -emit-binary -out ${out}/${f}.hbc ${root}/dist/${f}`
      .nothrow()
      .quiet()
    const ok = r.exitCode === 0
    failed ||= !ok
    process.stdout.write(
      `${ok ? 'ok  ' : 'FAIL'} hermesc ${f} with ${c.name}${ok ? '' : `\n${r.stderr.toString().slice(0, 400)}`}\n`,
    )
  }

// The peer range starts at React Native 0.75: the Hermes of 0.72 to 0.74 has no \p{...} regex
// escapes, which the privacy floor needs, so its compiler rejects the bundle.

// 2. behaviour: a script of both bundles as modules and a stub react-native, run in the Hermes VM
const read = (f: string) => Bun.file(`${root}/dist/${f}`).text()
const wrap = (name: string, code: string) =>
  `__mods[${JSON.stringify(name)}] = function (module, exports, require) {\n${code}\n};\n`
const prelude = `var __mods = {}, __cache = {};
var __rn = { AppState: { currentState: 'active' }, Platform: { OS: 'android', Version: 34, constants: { Release: '14' } }, Dimensions: { get: function () { return { width: 412, height: 915 } } } };
globalThis.__rn = __rn;
function __require(name) {
  if (name === 'react-native') return __rn;
  name = name.replace(/^\\.\\//, '').replace(/\\.cjs$/, '');
  if (__cache[name]) return __cache[name].exports;
  var m = (__cache[name] = { exports: {} });
  __mods[name](m, m.exports, __require);
  return m.exports;
}
`
const bundle =
  prelude +
  wrap('index', await read('index.cjs')) +
  wrap('navigation', await read('navigation.cjs')) +
  (await Bun.file(`${import.meta.dir}/script.js`).text())
await Bun.write(`${out}/run.js`, bundle)

const { hermes, hermesc } = await hermes013()
const hbc = await $`${hermesc} -emit-binary -out ${out}/run.hbc ${out}/run.js`.nothrow().quiet()
if (hbc.exitCode) {
  process.stdout.write(`FAIL compiling the test script: ${hbc.stderr}\n`)
  process.exit(1)
}
// run the bytecode, as a release app does, and the source, as a debug app does
for (const [label, file] of [
  ['bytecode', `${out}/run.hbc`],
  ['source', `${out}/run.js`],
] as const) {
  const r = await $`${hermes} ${file}`.nothrow().quiet()
  const line = r.stdout
    .toString()
    .split('\n')
    .find((l) => l.startsWith('RESULT '))
  if (!line) {
    failed = true
    process.stdout.write(`FAIL hermes VM (${label}): no result\n${r.stdout}\n${r.stderr}\n`)
    continue
  }
  const results = JSON.parse(line.slice(7)) as { name: string; ok: boolean; detail?: string }[]
  const bad = results.filter((x) => !x.ok)
  failed ||= bad.length > 0
  process.stdout.write(
    `${bad.length ? 'FAIL' : 'ok  '} hermes VM 0.13 (${label}): ${results.length - bad.length}/${results.length} checks\n`,
  )
  for (const b of bad) process.stdout.write(`  - ${b.name}: ${b.detail}\n`)
}
process.exit(failed ? 1 : 0)
