# Changelog

## 0.1.0-beta.1

First public beta, on the `next` dist-tag.
- `init`, `screen`, `track`, `identify`, `reset`, `flush` and `consent.grant()` / `consent.revoke()`, with an offline queue that survives restarts when you pass a storage adapter such as AsyncStorage.
- `trackNavigation(ref)` from `@datacub/react-native/navigation` sends a screen view on every React Navigation (and Expo Router) route change.
- Supports React Native 0.75 and later and Expo SDK 52 and later, on iOS and Android. Tested on Hermes and through Metro bundles; testing on physical devices is in progress.
