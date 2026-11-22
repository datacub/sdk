// Bundles a minimal app that imports @datacub/react-native and @datacub/react-native/navigation with
// Metro (the bundler of React Native and Expo) for android and ios, in both resolution modes:
//   exports  - package "exports" on (React Native 0.79+ and Expo SDK 53+): the ESM files are used
//   main     - package "exports" off (older Metro): `main` and the navigation/ folder: CommonJS files
// The package under test is the tarball `npm pack` makes, unpacked into the app's node_modules, so
// what is bundled is what would be published. `react-native` is a stub: the SDK treats it as an
// external, and the real one would only add a few hundred MB of Metro work. Metro fails the build
// on any import it cannot resolve, so a Node-only or browser-only import in the package fails here.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = join(here, '.out')
const app = join(out, 'app')
const require = createRequire(import.meta.url)
const Metro = require('metro')
const { getDefaultConfig } = require('@react-native/metro-config')
const { mergeConfig } = require('metro-config')

// Metro's own require polyfill, which it adds to every bundle
const metroRuntime = dirname(
  require.resolve('metro-runtime/package.json', { paths: [dirname(require.resolve('metro'))] }),
)
const metroRuntimeRoot = dirname(require.resolve('metro-runtime/package.json'))
const babelRuntime = dirname(require.resolve('@babel/runtime/package.json'))

rmSync(out, { recursive: true, force: true })
mkdirSync(app, { recursive: true })

// the published files, from a real pack
const pack = JSON.parse(
  execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], {
    cwd: root,
    encoding: 'utf8',
  }),
)[0]
const pkgDir = join(app, 'node_modules/@datacub/react-native')
mkdirSync(pkgDir, { recursive: true })
execFileSync('tar', ['xzf', join(out, pack.filename), '-C', pkgDir, '--strip-components=1'])

// a stand-in for react-native: the three modules the SDK reads
const rn = join(app, 'node_modules/react-native')
mkdirSync(rn, { recursive: true })
writeFileSync(
  join(rn, 'package.json'),
  '{"name":"react-native","version":"0.0.0","main":"index.js"}',
)
writeFileSync(
  join(rn, 'index.js'),
  `module.exports = {
  AppState: { currentState: 'active', addEventListener() { return { remove() {} } } },
  Platform: { OS: require('./os.js'), Version: 34, constants: { Release: '14' } },
  Dimensions: { get() { return { width: 412, height: 915 } } },
}
`,
)
cpSync(join(here, 'App.js'), join(app, 'index.js'))

for (const mode of ['exports', 'main'])
  for (const platform of ['android', 'ios']) {
    // Metro cannot see the platform from the stub, so the stub's os.js is chosen per bundle
    writeFileSync(join(rn, 'os.js'), `module.exports = ${JSON.stringify(platform)}\n`)
    const file = join(out, `${mode}.${platform}.js`)
    const config = mergeConfig(await getDefaultConfig(app), {
      projectRoot: app,
      // @babel/runtime is what every app has next to react-native; only that folder is watched
      watchFolders: [app, babelRuntime, metroRuntime, metroRuntimeRoot],
      resetCache: true,
      cacheStores: [],
      maxWorkers: 2,
      resolver: {
        unstable_enablePackageExports: mode === 'exports',
        useWatchman: false,
        extraNodeModules: { '@babel/runtime': babelRuntime },
      },
      watcher: { watchman: { deferStates: [] }, healthCheck: { enabled: false } },
      serializer: {
        getModulesRunBeforeMainModule: () => [],
        getPolyfills: () => [],
        ...(env.METRO_DEBUG ? { createModuleIdFactory: () => (p) => p.replace(app, '') } : {}),
      },
      transformer: { unstable_transformProfile: 'hermes-stable' },
      reporter: { update() {} },
    })
    await Metro.runBuild(config, {
      entry: 'index.js',
      platform,
      dev: false,
      minify: true,
      out: file,
      sourceMap: false,
    })
    const code = readFileSync(file, 'utf8')
    const used = ['datacub_state', 'in.datacub.to', '/v1/batch'].filter((s) => code.includes(s))
    const bad = code.match(
      /\b(?:node:[a-z_/]+|require\(["'](?:fs|path|os|crypto|http|https|net|zlib|buffer|stream|util|events|child_process)["']\))/,
    )
    // one copy of the client: a second would be a client the app never initialised
    const copies = code.split('datacub_state').length - 1
    if (copies !== 1) {
      process.stderr.write(
        `FAIL ${mode}/${platform}: ${copies} copies of the client in the bundle\n`,
      )
      process.exit(1)
    }
    if (used.length !== 3 || bad) {
      process.stderr.write(
        `FAIL ${mode}/${platform}: SDK markers ${used.length}/3${bad ? `, Node import ${bad[0]}` : ''}`,
      )
      process.exit(1)
    }
    process.stdout.write(
      `ok   metro ${mode} ${platform}: ${code.length} bytes (whole app incl. Metro runtime)\n`,
    )
  }
// the packed tarball is part of the evidence
process.stdout.write(
  `ok   packed ${pack.filename}: ${pack.files.length} files, ${pack.size} bytes\n`,
)
