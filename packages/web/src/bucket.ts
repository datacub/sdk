// Assignment for feature flags and experiments. One function, shared by
// the web SDK and the ingestion server, so every runtime puts a
// visitor in the same bucket.
//
// Algorithm v1, fixed forever (a change is a new version with a new seed prefix, never an edit):
//   bucket = fmix32(FNV-1a 32 over the UTF-16 code units of `${seed}:${id}`) mod 10,000
// FNV-1a alone mixes its low bits poorly; MurmurHash3's 32-bit finalizer fixes that. The modulo
// bias over 2^32 is below 1 in 400,000. Not a secret and not a security control.

export function bucket(seed: string, id: string): number {
  const s = `${seed}:${id}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) % 10_000
}

/** Is a flag on for this visitor? rollout is a whole percentage. Raising it only adds visitors. */
export const flagOn = (key: string, rollout: number, id: string) =>
  rollout >= 100 || (rollout > 0 && bucket(`f1:${key}`, id) < rollout * 100)

/** An experiment's version for this visitor: 50/50, seeded by the experiment's id, so a new
 * experiment under an old key starts a fresh split. */
export const variantOf = (experimentId: string, id: string): 'A' | 'B' =>
  bucket(`e1:${experimentId}`, id) < 5_000 ? 'A' : 'B'
