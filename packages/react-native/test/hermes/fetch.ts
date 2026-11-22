// Downloads the official Hermes 0.13.0 CLI (the engine of React Native 0.75) from the Hermes GitHub
// release into node_modules/.cache, checks its sha256 and returns the paths of `hermes` and `hermesc`.
// Needs network the first time only. Not part of the published package.
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { $ } from 'bun'

const URL = 'https://github.com/facebook/hermes/releases/download/v0.13.0/hermes-cli-linux.tar.gz'
const SHA256 = 'aead6eb0b8f563bb022354352eae32dad96c933330b6c1941b6db17674ca68ae'

export async function hermes013() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('the Hermes CLI download is linux-x64 only')
  const dir = resolve(import.meta.dir, '..', '..', 'node_modules', '.cache', 'hermes-0.13.0')
  if (!existsSync(`${dir}/hermes`)) {
    mkdirSync(dir, { recursive: true })
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const tgz = new Uint8Array(await res.arrayBuffer())
    const sum = new Bun.CryptoHasher('sha256').update(tgz).digest('hex')
    if (sum !== SHA256) throw new Error(`hermes-cli-linux.tar.gz sha256 mismatch: ${sum}`)
    await Bun.write(`${dir}/cli.tar.gz`, tgz)
    await $`tar xzf ${dir}/cli.tar.gz -C ${dir}`.quiet()
  }
  return { hermes: `${dir}/hermes`, hermesc: `${dir}/hermesc` }
}
