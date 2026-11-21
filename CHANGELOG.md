# @datacub/web

## 0.3.1

First release on npm.

- Install from npm with `npm install @datacub/web`, or keep using the script tag. Both are built from the same source, and the script-tag files at `https://in.datacub.to/v1/sdk/datacub-0.3.1.min.js` are the same bytes as `dist/datacub.js` in the package.
- The default ingestion host is now `https://in.datacub.to`. Sites that pass `apiHost` (or `data-api-host`) are unaffected.
- Entry points: `@datacub/web` (the SDK), `@datacub/web/flags` (feature flags and experiments) and `@datacub/web/feedback` (the feedback widget's renderer).
