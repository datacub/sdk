// Takes the four bundles Metro made (bundle.mjs) and does what a release build does with them:
// compiles each to Hermes bytecode (with the Hermes of React Native 0.75 and of 0.88) and runs it in
// the Hermes 0.13 VM against a stubbed fetch, to see the app's SDK calls reach the network.
import { mkdirSync } from 'node:fs'
import { $ } from 'bun'
import { hermes013 } from '../hermes/fetch.ts'

const root = `${import.meta.dir}/../..`
const out = `${import.meta.dir}/.out`
mkdirSync(`${out}/hbc`, { recursive: true })
const { hermes, hermesc: old } = await hermes013()
const compilers = [
  ['0.75', old],
  ['0.88', `${root}/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc`],
] as const

const prelude = `var fetched = [];
var nativeClear = clearTimeout;
globalThis.clearTimeout = function (id) { if (typeof id === 'number') nativeClear(id) };
globalThis.fetch = function (url, init) {
  fetched.push({ url: url, init: init });
  return Promise.resolve({ status: 200, headers: { get: function () { return null } }, json: function () { return Promise.resolve({}) } });
};
globalThis.AbortController = function () { this.signal = {}; this.abort = function () {} };
globalThis.__done = function () {
  var b = JSON.parse(fetched[0].init.body);
  print('RESULT ' + JSON.stringify({ requests: fetched.length, url: fetched[0].url, events: b.events.map(function (e) { return e.event }), screen: b.events[1] && b.events[1].context.screen, platform: b.events[0].context.platform, lib: b.lib.name }));
};
`
let failed = false
for (const mode of ['exports', 'main'])
  for (const platform of ['android', 'ios']) {
    const name = `${mode}.${platform}`
    await Bun.write(`${out}/${name}.run.js`, prelude + (await Bun.file(`${out}/${name}.js`).text()))
    for (const [v, hc] of compilers) {
      const r = await $`${hc} -emit-binary -out ${out}/hbc/${name}.${v}.hbc ${out}/${name}.run.js`
        .nothrow()
        .quiet()
      if (r.exitCode) {
        failed = true
        process.stdout.write(`FAIL hermesc ${v} ${name}: ${r.stderr.toString().slice(0, 300)}\n`)
      }
    }
    const run = await $`${hermes} ${out}/hbc/${name}.0.75.hbc`.nothrow().quiet()
    const line = run.stdout
      .toString()
      .split('\n')
      .find((l) => l.startsWith('RESULT '))
    const got = line ? JSON.parse(line.slice(7)) : null
    const ok =
      got?.requests === 1 &&
      got.url === 'https://in.datacub.to/v1/batch' &&
      got.events.join() === 'app_opened,$screen' &&
      got.screen === 'Home' &&
      got.platform === platform &&
      got.lib === '@datacub/react-native'
    failed ||= !ok
    process.stdout.write(
      `${ok ? 'ok  ' : 'FAIL'} metro bundle ${name}: hermesc 0.75 and 0.88 compile it, Hermes VM sends ${ok ? 'app_opened and $screen Home to https://in.datacub.to' : `${line ?? run.stderr.toString().slice(0, 300)}`}\n`,
    )
  }
process.exit(failed ? 1 : 0)
