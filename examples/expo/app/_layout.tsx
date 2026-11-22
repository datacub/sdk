// Expo Router root layout with datacub. Install:
//   npx expo install @datacub/react-native@next @react-native-async-storage/async-storage expo-application

import datacub from '@datacub/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import { Stack, useSegments } from 'expo-router'
import { useEffect } from 'react'

datacub.init(process.env.EXPO_PUBLIC_DATACUB_ID ?? 'YOUR_PROJECT_ID', {
  storage: AsyncStorage,
  app: Application,
})

export default function RootLayout() {
  const segments = useSegments()
  // route templates, never values: profile/[user], not profile/sara
  useEffect(() => {
    datacub.screen(segments.join('/') || 'index')
  }, [segments])
  return <Stack />
}
