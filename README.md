<p align="center">
  <a href="https://datacub.to">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/datacub/sdk/main/.github/assets/wordmark-dark.svg">
      <img alt="datacub" src="https://raw.githubusercontent.com/datacub/sdk/main/.github/assets/wordmark.svg" height="48">
    </picture>
  </a>
</p>

<p align="center">Product analytics for websites and apps. Private by default, made for Saudi teams.</p>

| Package | For | |
|---|---|---|
| [`@datacub/web`](./packages/web) | Websites and web apps, any framework | stable |
| [`@datacub/react-native`](./packages/react-native) | React Native and Expo | beta |

## Install with AI

Paste this into Claude Code, Cursor, Codex or any coding agent:

```text
Add datacub analytics to this project. Follow https://docs.datacub.to/skill/datacub/SKILL.md
My datacub project ID: YOUR_PROJECT_ID
```

The agent picks the right SDK for your framework, installs it, adds your key events and checks they arrive. To keep the skill installed: `npx skills add datacub/sdk`.

## Install by hand

Web:

```sh
npm install @datacub/web
```

```ts
import datacub from '@datacub/web'

datacub.init('YOUR_PROJECT_ID')
datacub.track('signup_completed', { plan: 'pro' })
```

React Native and Expo:

```sh
npx expo install @datacub/react-native@next @react-native-async-storage/async-storage expo-application
```

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import datacub from '@datacub/react-native'

datacub.init('YOUR_PROJECT_ID', { storage: AsyncStorage, app: Application })
datacub.screen('Home')
```

Your project ID is in datacub under **Settings → Integrations**.

## Docs

[docs.datacub.to](https://docs.datacub.to)

[MIT](./LICENSE)
