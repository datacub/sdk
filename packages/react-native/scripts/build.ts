// Builds dist/ (ESM for Metro, CommonJS for Jest and older tooling, .d.ts) and prints what an app
// pays for the SDK: minified and gzip bytes, react-native excluded since the app has it already.
// Fails above the budget.
import { copyFile, rm } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { $ } from 'bun'

const BUDGET = 6144 // gzip bytes for the core
const dir = `${import.meta.dir}/..`
// the version in package.json is the one the SDK reports; a version bump needs no source edit
const { version } = (await Bun.file(`${dir}/package.json`).json()) as { version: string }
await rm(`${dir}/dist`, { recursive: true, force: true })

const rows: string[] = []
let failed = false
for (const format of ['esm', 'cjs'] as const) {
  const ext = format === 'esm' ? 'mjs' : 'cjs'
  for (const name of ['index', 'navigation']) {
    const out = await Bun.build({
      entrypoints: [`${dir}/src/${name}.ts`],
      format,
      target: 'browser',
      minify: true,
      external: ['react-native'],
      define: { __VERSION__: JSON.stringify(version) },
      // The helper drives the one client in index, never a copy of it. Its import of the core stays an
      // external file. In CommonJS it goes through a require with Babel-style interop: bundler
      // output would otherwise hand the helper the whole exports object as `default`, and every
      // screen call would silently do nothing.
      plugins: [
        {
          name: 'self',
          setup(b) {
            if (name === 'index') return
            b.onResolve({ filter: /^\.\/index\.ts$/ }, () =>
              format === 'esm'
                ? { path: `./index.${ext}`, external: true }
                : { path: 'core', namespace: 'core' },
            )
            b.onResolve({ filter: /^\.\/index\.cjs$/ }, () => ({
              path: './index.cjs',
              external: true,
            }))
            b.onLoad({ filter: /.*/, namespace: 'core' }, () => ({
              contents:
                "const m = require('./index.cjs'); export default m && m.__esModule ? m.default : m",
              loader: 'js',
            }))
          },
        },
      ],
      outdir: `${dir}/dist`,
      naming: `${name}.${ext}`,
    })
    if (!out.success) throw new AggregateError(out.logs, `build failed: ${name} ${format}`)
    const code = await Bun.file(`${dir}/dist/${name}.${ext}`).text()
    if (/\bnode:|\bBun\.|\bprocess\.|\bdocument\.|\bwindow\./.test(code))
      throw new Error(`${name}.${ext} uses a Node, Bun or browser API`)
    const gz = gzipSync(code, { level: 9 }).length
    if (name === 'index' && gz > BUDGET) failed = true
    rows.push(`| ${name}.${ext} | ${code.length} | ${gz} |`)
  }
}

// tsc writes the declarations into dist/types; only the public ones ship, under both names
await $`bunx tsc -p ${dir}/tsconfig.build.json`.quiet()
for (const name of ['index', 'navigation'])
  for (const ext of ['d.ts', 'd.cts'])
    await copyFile(`${dir}/dist/types/${name}.d.ts`, `${dir}/dist/${name}.${ext}`)
await rm(`${dir}/dist/types`, { recursive: true })

process.stdout.write(
  `| File | Minified bytes | gzip -9 |\n|---|---|---|\n${rows.join('\n')}\nBudget for index: ${BUDGET} gzip bytes\n`,
)
if (failed) process.exit(1)
