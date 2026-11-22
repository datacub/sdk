// The smallest app that uses the whole public surface. Bundled by Metro, then run in the Hermes VM.
import datacub from '@datacub/react-native'
import { trackNavigation } from '@datacub/react-native/navigation'

datacub.init('pk_test_abcdefghijklmnopqrstuvwx', {
  requireConsent: false,
  app: { applicationId: 'com.example.app' },
})
datacub.track('app_opened', { plan: 'pro' })
trackNavigation({
  isReady: () => true,
  getCurrentRoute: () => ({ name: 'Home' }),
  addListener: () => () => {},
})
datacub.flush().then(() => {
  globalThis.__done?.()
})
