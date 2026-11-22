import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { generate } from '../scripts/types.ts'

const dir = `${import.meta.dir}/..`

// the version is stamped in by the build, so a version bump alone does not make types stale
const unversioned = (t: string) =>
  t.replace(/VERSION = "[^"]+"/, 'VERSION = "x"').replace(/SDK \d[^,]*,/, 'SDK x,')

test('committed type definitions match the source (bun scripts/types.ts)', () => {
  for (const [f, text] of Object.entries(generate()))
    expect(unversioned(readFileSync(`${dir}/types/${f}`, 'utf8')), `types/${f} is stale`).toBe(
      unversioned(text),
    )
}, 60_000)

test('the build stamps the package version into every bundle that reports it', async () => {
  const build = Bun.spawnSync(['bun', 'scripts/build.ts'], { cwd: dir })
  expect(build.exitCode).toBe(0)
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
  for (const f of ['datacub.js', 'datacub.mjs']) {
    const code = readFileSync(`${dir}/dist/${f}`, 'utf8')
    expect(code, f).toContain(version)
    expect(code, f).not.toContain('__VERSION__')
  }
}, 60_000)

// what npm would publish holds every file the exports name, types included
test('the package tarball holds every export and its types', () => {
  const build = Bun.spawnSync(['bun', 'scripts/build.ts'], { cwd: dir })
  expect(build.exitCode).toBe(0)
  const pack = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
  })
  expect(pack.exitCode).toBe(0)
  const files = new Set(
    (JSON.parse(pack.stdout.toString()) as { files: { path: string }[] }[])[0]?.files.map(
      (f) => f.path,
    ),
  )
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
  for (const target of Object.values(pkg.exports) as (string | Record<string, string>)[])
    for (const path of typeof target === 'string' ? [target] : Object.values(target))
      expect(files).toContain(path.replace(/^\.\//, ''))
  // a type file's own imports ship too
  for (const f of files)
    if (f.endsWith('.d.ts'))
      for (const [, rel] of readFileSync(`${dir}/${f}`, 'utf8').matchAll(/from '\.\/([^']+)'/g))
        expect(files).toContain(`types/${(rel as string).replace(/\.ts$/, '.d.ts')}`)
}, 60_000)

// A page served without a UTF-8 charset must still parse the files: they are ASCII only.
test('built files are ASCII only', () => {
  expect(Bun.spawnSync(['bun', 'scripts/build.ts'], { cwd: dir }).exitCode).toBe(0)
  for (const f of readdirSync(`${dir}/dist`).filter((f) => /\.m?js$/.test(f)))
    expect(
      [...readFileSync(`${dir}/dist/${f}`, 'utf8')].some((c) => c.charCodeAt(0) > 127),
      f,
    ).toBe(false)
}, 60_000)
