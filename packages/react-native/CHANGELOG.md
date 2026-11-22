# Changelog

## [0.1.0-beta.2](https://github.com/datacub/sdk/compare/react-native-v0.1.0-beta.1...react-native-v0.1.0-beta.2) (2026-11-22)


### Bug Fixes

* **react-native:** accept the 8-character project id ([838deb6](https://github.com/datacub/sdk/commit/838deb6755392728a33c2d79468e8ed2a759b6b3))

## 0.1.0-beta.1

First public beta, on the `next` dist-tag.
- `init`, `screen`, `track`, `identify`, `reset`, `flush` and `consent.grant()` / `consent.revoke()`, with an offline queue that survives restarts when you pass a storage adapter such as AsyncStorage.
- `trackNavigation(ref)` from `@datacub/react-native/navigation` sends a screen view on every React Navigation (and Expo Router) route change.
- Supports React Native 0.75 and later and Expo SDK 52 and later, on iOS and Android. Tested on Hermes and through Metro bundles; testing on physical devices is in progress.
