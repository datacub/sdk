// sdk.size_budget: builds every artefact the package ships (dist/) and fails above the budget.
// It also regenerates types/, so the type files always carry the package version.
// The budget is the measured size plus a small margin, so any growth is a deliberate change. Measures
// the real shipped files, not an entry point.
import { createHash } from 'node:crypto'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { version } from '../package.json' with { type: 'json' }
import { writeTypes } from './types.ts'

// 0.3.1: 9216 to 9472 for the insights integrity hash and the cookie-free page-hide send
// 0.5.0: 9472 to 9728 for loading the feedback widget itself (one script tag instead of two)
// 0.8.0: 9728 to 10048 for datacub.feedback.shown, send and dismissed (a site's own feedback UI)
const BUDGET = 10048
// 0.7.0: 8192 to 9728 for the card's full look (colours per part, dark mode colours, border, shadow,
// width, spacing, title type, icon sets, score colours, entrance, offsets, layer). Every value is
// checked in the widget, so the checks ship with it; sites without a live question never load it.
const FEEDBACK = 9728
const dir = `${import.meta.dir}/..`

// The feedback widget is opt-in and loads apart from the core, with its own budget.
const builds = [
  { file: 'datacub.js', entry: 'src/global.ts', format: 'iife', use: 'script tag', budget: BUDGET },
  { file: 'datacub.mjs', entry: 'src/index.ts', format: 'esm', use: 'npm import', budget: BUDGET },
  // flags and experiments: opt-in like the widget, its own budget
  {
    file: 'flags.js',
    entry: 'src/flags-global.ts',
    format: 'iife',
    use: 'flags module',
    budget: 1536,
  },
  {
    file: 'flags.mjs',
    entry: 'src/flags-npm.ts',
    format: 'esm',
    use: 'npm import of @datacub/web/flags',
    budget: 1536,
    external: ['@datacub/web'],
  },
  // insights: vitals, client hints and field-level forms, injected by the core
  {
    file: 'insights.js',
    entry: 'src/insights.ts',
    format: 'iife',
    use: 'insights module',
    budget: 1888,
  },
  {
    file: 'feedback.mjs',
    entry: 'src/feedback.ts',
    format: 'esm',
    use: 'npm import of @datacub/web/feedback',
    budget: FEEDBACK,
  },
  {
    file: 'feedback.js',
    entry: 'src/feedback-global.ts',
    format: 'iife',
    use: 'feedback widget',
    budget: FEEDBACK,
  },
] as const

let failed = false
const rows: string[] = []
// insights.js first: the core pins its hash as the script's integrity, so the module the core loads
// from the ingestion host must be exactly the file in this package.
let sri = ''
for (const b of [
  ...builds.filter((x) => x.file === 'insights.js'),
  ...builds.filter((x) => x.file !== 'insights.js'),
]) {
  const out = await Bun.build({
    entrypoints: [`${dir}/${b.entry}`],
    target: 'browser',
    format: b.format,
    minify: true,
    sourcemap: 'none',
    // the package version, read by `VERSION` in src/index.ts: a version bump needs no source edit
    define: { __VERSION__: JSON.stringify(version), __INSIGHTS_SRI__: JSON.stringify(sri) },
    outdir: `${dir}/dist`,
    naming: b.file,
    external: 'external' in b ? [...b.external] : [],
  })
  if (!out.success) throw new AggregateError(out.logs, `build failed: ${b.entry}`)
  // ASCII only: every non-ASCII character becomes a \uXXXX escape (valid in strings, regular
  // expressions and template literals alike), so the files work even when a server sends them
  // without a UTF-8 charset and a page has no <meta charset>.
  const code = (await Bun.file(`${dir}/dist/${b.file}`).text()).replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  await Bun.write(`${dir}/dist/${b.file}`, code)
  if (b.file === 'insights.js') sri = `sha384-${createHash('sha384').update(code).digest('base64')}`
  const bytes = new TextEncoder().encode(code)
  const gz = gzipSync(bytes, { level: 9 }).length
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  if (gz > b.budget) failed = true
  rows.push(
    `| ${b.file} | ${b.use} | ${bytes.length} | ${gz} | ${br} | ${gz <= b.budget ? 'pass' : 'FAIL'} (${b.budget}) |`,
  )
}

await writeTypes()
process.stdout.write(
  `| File | Used by | Minified bytes | gzip -9 | brotli 11 | Budget, gzip bytes |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`,
)
if (failed) process.exit(1)
