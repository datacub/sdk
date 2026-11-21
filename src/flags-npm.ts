// `@datacub/web/flags` for apps that import the SDK: the same module as /v1/flags.js, bound to the
// imported client (the package's own entry, so both share one client). Built to dist/flags.mjs with
// @datacub/web left external. Importing it adds nothing to the core and sends nothing.
import datacub from '@datacub/web'
import { makeFlags } from './flags.ts'

export type { Variant } from './flags.ts'
export const { flag, experiment } = makeFlags(() => datacub)
