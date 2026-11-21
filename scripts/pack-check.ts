// pack:check: builds, then asks npm what it would publish and fails on any file outside the
// allowed list (dist JS, type files, package.json, README, LICENSE, CHANGELOG), such as a source map.
const dir = `${import.meta.dir}/..`

const build = Bun.spawnSync(['bun', 'scripts/build.ts'], {
  cwd: dir,
  stdio: ['ignore', 'inherit', 'inherit'],
})
if (build.exitCode) process.exit(build.exitCode)

const pack = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir })
if (pack.exitCode) throw new Error(`npm pack failed: ${pack.stderr}`)
const files = (JSON.parse(pack.stdout.toString()) as { files: { path: string }[] }[])[0]?.files.map(
  (f) => f.path,
)
if (!files?.length) throw new Error('npm pack listed no files')

const allowed =
  /^(?:dist\/[\w-]+\.(?:js|mjs)|types\/[\w-]+\.d\.ts|package\.json|README\.md|LICENSE|CHANGELOG\.md)$/
const extra = files.filter((f) => !allowed.test(f))
process.stdout.write(`${files.join('\n')}\n`)
if (extra.length) {
  process.stderr.write(`pack:check failed, not allowed in the package:\n${extra.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`pack:check ok: ${files.length} files\n`)
