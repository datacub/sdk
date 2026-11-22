// Builds, then lists what `npm pack` would publish and fails on anything unexpected.
import { $ } from 'bun'

const dir = `${import.meta.dir}/..`
await $`bun ${dir}/scripts/build.ts`.cwd(dir).quiet()

const out = await $`npm pack --dry-run --json --ignore-scripts`.cwd(dir).quiet().json()
const pack = out[0] as { name: string; version: string; size: number; files: { path: string }[] }
const paths = pack.files.map((f) => f.path).sort()

const allowed = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^navigation\/package\.json$/,
  /^dist\/(?:index|navigation)\.(?:mjs|cjs|d\.ts|d\.cts)$/,
]
const required = [
  'package.json',
  'navigation/package.json',
  ...['index', 'navigation'].flatMap((n) =>
    ['mjs', 'cjs', 'd.ts', 'd.cts'].map((e) => `dist/${n}.${e}`),
  ),
]
const unexpected = paths.filter((p) => !allowed.some((re) => re.test(p)))
const missing = required.filter((p) => !paths.includes(p))

process.stdout.write(
  `${pack.name}@${pack.version}: ${paths.length} files, ${pack.size} bytes packed\n`,
)
for (const p of paths) process.stdout.write(`  ${p}\n`)
if (unexpected.length || missing.length) {
  process.stderr.write(
    `unexpected: ${unexpected.join(', ') || 'none'}\nmissing: ${missing.join(', ') || 'none'}\n`,
  )
  process.exit(1)
}
