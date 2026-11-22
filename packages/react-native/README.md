# @datacub/react-native

datacub product analytics for React Native and Expo. Pure JavaScript, no device identifiers.

**Beta**, on the `next` tag. Not yet tested on physical devices.

```sh
npx expo install @datacub/react-native@next @react-native-async-storage/async-storage expo-application
```

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import datacub from '@datacub/react-native'

datacub.init('pk_live_YOUR_KEY', { storage: AsyncStorage, app: Application })

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

Add your app's bundle ID or package name under **Settings → General** in datacub.

Install with an AI agent, Expo Router, options and what gets sent: [docs.datacub.to](https://docs.datacub.to/install-mobile). Source: [datacub/sdk](https://github.com/datacub/sdk).
