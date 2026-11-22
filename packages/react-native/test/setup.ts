// The build injects the package version as __VERSION__; the tests run the source, so do the same here.
import pkg from '../package.json' with { type: 'json' }

;(globalThis as { __VERSION__?: string }).__VERSION__ = pkg.version
