// Screen views from React Navigation (and Expo Router, which runs on it) without depending on
// either: pass the navigation container ref. The route name is sent, never its params.

import datacub from './index.ts'

export interface NavigationRef {
  isReady(): boolean
  getCurrentRoute(): { name: string } | undefined
  addListener(event: 'state', callback: () => void): () => void
}

/**
 * Sends a screen view for each route change; call it from the container's onReady so the first
 * screen counts. Returns the unsubscribe function.
 */
export function trackNavigation(ref: NavigationRef) {
  const go = () => {
    try {
      const r = ref.isReady() ? ref.getCurrentRoute() : undefined
      if (r) datacub.screen(r.name)
    } catch {}
  }
  go()
  try {
    return ref.addListener('state', go)
  } catch {
    return () => {}
  }
}
