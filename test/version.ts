// bun test preload: the build injects __VERSION__ from package.json; tests run the sources, so
// they get the same value here.
import { version } from '../package.json' with { type: 'json' }
;(globalThis as { __VERSION__?: string }).__VERSION__ = version
// no integrity pin for the sources: the build computes it from dist/insights.js
;(globalThis as { __INSIGHTS_SRI__?: string }).__INSIGHTS_SRI__ = ''
