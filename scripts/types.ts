// Type definitions, committed in types/ (package.test.ts fails when they are stale): the package's
// types, and datacub.d.ts for the script tag (the ingestion server serves it at /v1/sdk/datacub-<version>.d.ts) that types
// the global `datacub`. Run: bun scripts/types.ts (bun run build does it too)
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { version } from '../package.json' with { type: 'json' }

const dir = `${import.meta.dir}/..`

export function generate(): Record<string, string> {
  const out = mkdtempSync(`${tmpdir()}/datacub-types-`)
  try {
    // flags-npm.ts imports the package by name; map that to the source for this run
    writeFileSync(
      `${out}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'preserve',
          moduleResolution: 'bundler',
          lib: ['ES2023', 'DOM'],
          allowImportingTsExtensions: true,
          rewriteRelativeImportExtensions: true,
          skipLibCheck: true,
          strict: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: `${out}/d`,
          rootDir: `${dir}/src`,
          paths: { '@datacub/web': [`${dir}/src/index.ts`] },
        },
        files: ['index.ts', 'feedback.ts', 'flags-npm.ts'].map((f) => `${dir}/src/${f}`),
      }),
    )
    const r = Bun.spawnSync([`${dir}/node_modules/.bin/tsc`, '-p', `${out}/tsconfig.json`])
    if (r.exitCode) throw new Error(`tsc failed: ${r.stdout}${r.stderr}`)
    const files: Record<string, string> = {}
    for (const f of readdirSync(`${out}/d`)) files[f] = readFileSync(`${out}/d/${f}`, 'utf8')
    // VERSION is injected at build time, so the compiler sees only `string`: write the literal
    const index = (files['index.d.ts'] as string).replace(
      'export declare const VERSION: string;',
      `export declare const VERSION = ${JSON.stringify(version)};`,
    )
    files['index.d.ts'] = index
    // the script tag's globals: the same types, with `datacub` on window
    // instead of a default export
    files['datacub.d.ts'] =
      `// datacub web SDK ${version}, for the script tag. Save as datacub.d.ts in your project: \`datacub\` is then typed.
${index.replace(/declare const datacub: DatacubClient;\nexport default datacub;\n?$/, '')}declare global {
    var datacub: DatacubClient;
}
`
    return files
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

export async function writeTypes() {
  mkdirSync(`${dir}/types`, { recursive: true })
  for (const [f, text] of Object.entries(generate())) writeFileSync(`${dir}/types/${f}`, text)
}

if (import.meta.main) await writeTypes()
