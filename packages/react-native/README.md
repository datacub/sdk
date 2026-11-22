<p align="center">
  <a href="https://datacub.to">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/datacub/react-native-sdk/main/.github/assets/wordmark-dark.svg">
      <img alt="datacub" src="https://raw.githubusercontent.com/datacub/react-native-sdk/main/.github/assets/wordmark.svg" height="48">
    </picture>
  </a>
</p>

<p align="center">Product analytics for React Native and Expo apps. Pure JavaScript, no device identifiers.</p>

> **Beta.** Published on the `next` tag. The API is small and should stay stable, but it is not yet tested on physical devices.

## Install with AI

Paste this into Claude Code, Cursor, Codex or any coding agent:

```text
Add datacub analytics to this project. Follow https://raw.githubusercontent.com/datacub/web-sdk/main/skills/datacub/SKILL.md
My datacub project key: pk_live_YOUR_KEY
```

The agent installs the SDK, wires up screens, adds your key events and tells you how to check them.

## Install by hand

```sh
npx expo install @datacub/react-native@next @react-native-async-storage/async-storage expo-application
```

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import datacub from '@datacub/react-native'

datacub.init('pk_live_YOUR_KEY', { storage: AsyncStorage, app: Application })
```

Add your app's bundle ID or package name under **Settings → General** in datacub.

## API

```ts
datacub.screen('Home') // a screen view
datacub.track('signup_completed', { plan: 'pro' }) // a custom event
datacub.identify(user.id, { email, name }) // after login
datacub.reset() // at logout
await datacub.flush() // send now

// only when the project asks for consent first: init(key, { ..., requireConsent: true })
datacub.consent.grant()
datacub.consent.revoke()
```

React Navigation: `onReady={() => trackNavigation(ref)}`, with `trackNavigation` from `@datacub/react-native/navigation`.

## Docs

[datacub.to/docs/install-mobile](https://datacub.to/docs/install-mobile) covers Expo Router, options, what gets sent and Android backup.

[MIT](./LICENSE)
