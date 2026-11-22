# AGENTS.md

`@datacub/react-native`: the datacub analytics SDK for React Native and Expo. Pure JavaScript (no native code), Bun, TypeScript, no runtime dependencies. Beta, published on npm's `next` tag.
- `src/index.ts`: the SDK (init, screen, track, identify, reset, flush, consent, offline queue, delivery).
- `src/scrub.ts`: removes personal data on the device. `src/navigation.ts`: React Navigation helper.
- `test/`: unit tests against a stubbed React Native; `test/hermes` and `test/metro` compile and bundle the real build.
- Customer install guide for coding agents: `skills/datacub/SKILL.md` in datacub/web-sdk (one guide for both SDKs).

```sh
bun install
bun run lint && bun run typecheck && bun run test   # test builds first
bun run test:hermes && bun run test:bundle          # Hermes VM and Metro bundles
```

Rules:
- Don't break the public API or the batch format the ingestion server accepts (`test/schema.ts`). Keep React Native 0.75+ and Hermes working.
- No device identifiers (IDFA, IDFV, Android ID), no location, no screen text. Consent and revoke must keep working.
- Never republish a version. Stays beta (`0.1.0-beta.N`, `next` tag) until it is tested on real devices.
- Use conventional commit titles (`fix: …`, `feat: …`, `chore: …`). `fix` and `feat` release automatically: release-please bumps the version and CHANGELOG, merges its own release PR, and the workflow publishes to npm with provenance. `chore` releases nothing. Nothing is published by hand.
