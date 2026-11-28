# Changelog

## [0.8.0](https://github.com/datacub/sdk/compare/web-v0.7.0...web-v0.8.0) (2026-11-28)


### Features

* **web:** datacub.feedback.shown, send and dismissed for your own feedback ui ([#12](https://github.com/datacub/sdk/issues/12)) ([641c87a](https://github.com/datacub/sdk/commit/641c87a177237d05b537f7d73a12e11f19c13a21))

## [0.7.0](https://github.com/datacub/sdk/compare/web-v0.6.0...web-v0.7.0) (2026-11-24)


### Features

* **web:** much more feedback card look ([#10](https://github.com/datacub/sdk/issues/10)) ([d0f1d20](https://github.com/datacub/sdk/commit/d0f1d2007a0fd899e3dcafef47b083202a5fdabd))

## [0.6.0](https://github.com/datacub/sdk/compare/web-v0.5.0...web-v0.6.0) (2026-11-24)


### Features

* **web:** feedback card look: font, corners, size, card and text colours, and feedback.look in init ([#8](https://github.com/datacub/sdk/issues/8)) ([466ee22](https://github.com/datacub/sdk/commit/466ee226c3081246e6afd075e67ba0917e5ea22c))

## [0.5.0](https://github.com/datacub/sdk/compare/web-v0.4.3...web-v0.5.0) (2026-11-23)


### Features

* **web:** load the feedback widget itself, one script tag is enough ([#6](https://github.com/datacub/sdk/issues/6)) ([68a0dde](https://github.com/datacub/sdk/commit/68a0dde65013078b44e90b5b5a828cbd3c8bce83))

## [0.4.3](https://github.com/datacub/sdk/compare/web-v0.4.2...web-v0.4.3) (2026-11-22)


### Bug Fixes

* **web:** send on page hide while a batch is in flight; a 100% flag is on before consent ([5276091](https://github.com/datacub/sdk/commit/5276091fb45581310bf78e691d7816a6ef59127c))

## [0.4.2](https://github.com/datacub/sdk/compare/web-v0.4.0...web-v0.4.2) (2026-11-22)


### Bug Fixes

* **web:** accept the 8-character project id (data-id), send to the host the script came from ([37df73b](https://github.com/datacub/sdk/commit/37df73bbf498362c55dff04363550ffcf66a7f90))

## 0.4.0

- `datacub.identify({ id, ...traits })` works: the id can be `id`, `userId` or `user_id`, and `fullName` and `phoneNumber` count as `name` and `phone`.
- Visitor cookies are per project key (`datacub_id_<key part>` and so on; `datacub_optout` stays shared), so existing visitors get a new anon_id once.

## 0.3.1

First release on npm.

- Install from npm with `npm install @datacub/web`, or keep using the script tag. Both are built from the same source, and the script-tag files at `https://in.datacub.to/v1/sdk/datacub-0.3.1.min.js` are the same bytes as `dist/datacub.js` in the package.
- The default ingestion host is now `https://in.datacub.to`. Sites that pass `apiHost` (or `data-api-host`) are unaffected.
- Entry points: `@datacub/web` (the SDK), `@datacub/web/flags` (feature flags and experiments) and `@datacub/web/feedback` (the feedback widget's renderer).
