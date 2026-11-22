# @datacub/web

datacub product analytics for websites. Page views, route changes, clicks, forms and errors are tracked automatically.

```sh
npm install @datacub/web
```

```ts
import datacub from '@datacub/web'

datacub.init('pk_live_YOUR_KEY')

datacub.track('signup_completed', { plan: 'pro' }) // a custom event
datacub.identify(user.id, { email, name }) // after login
datacub.reset() // at logout

// only when the project asks for consent first: init(key, { requireConsent: true })
datacub.consent.grant()
datacub.consent.revoke()
```

Feature flags: `import { flag, experiment } from '@datacub/web/flags'`, then `await flag('new_checkout')`.

No form values, passwords, card numbers or IDs are collected. First-party cookies, no fingerprinting.

Install with an AI agent, options, cookies, proxy and CSP: [docs.datacub.to](https://docs.datacub.to/install-web). Source: [datacub/sdk](https://github.com/datacub/sdk).
