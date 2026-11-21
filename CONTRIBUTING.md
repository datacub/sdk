# Contributing to @datacub/web

Thank you for helping improve datacub. This guide explains how to set up the project, what we expect from a change and how it gets released.

## Ground rules

- Be kind. Everyone taking part follows our [code of conduct](./CODE_OF_CONDUCT.md).
- Report security problems privately, as described in [SECURITY.md](./SECURITY.md), never in a public issue.
- For anything larger than a small fix, open an issue first so we can agree on the approach before you write code.
- **Privacy is part of correctness.** The SDK must never collect form values, passwords, payment data, government ID numbers, tokens or other sensitive data, and it must not fingerprint devices. A change that collects a new kind of data, adds a network request or changes a default needs an issue and a maintainer's agreement first, and must update the README section that lists what is collected.
- Do not add runtime dependencies. The SDK ships with none, and every byte reaches our customers' users.

## Development setup

You need [Bun](https://bun.sh) (the version is pinned in `package.json` under `packageManager`) and Node.js 22 or later for npm.

```sh
git clone https://github.com/datacub/web-sdk.git
cd web-sdk
bun install --frozen-lockfile
```

Common commands:

| Command | What it does |
|---|---|
| `bun run build` | Builds `dist/` (ES modules and the script-tag files), regenerates `types/` and fails if a file grows past its size budget |
| `bun run typecheck` | Type checks the sources and tests |
| `bun run lint` | Lint and formatting checks; `bun run format` fixes what it can |
| `bun run test` | Unit tests |
| `bun run test:browser` | Browser suites in Chromium, Firefox and WebKit, desktop and mobile. Run `bunx playwright install --with-deps` once first |
| `bun run pack:check` | Builds and checks that the npm tarball holds exactly the intended files |

The browser suites run the built script-tag file against a local fixture server (`test/server.ts`) that records what the SDK sends, so they need no datacub account.

## Making a change

1. Create a branch from `main`.
2. Make your change with tests. A bug fix includes a test that fails without it.
3. Run the checks above. CI runs the same ones and every check must pass before a pull request can merge.
4. Add a changeset if the change affects the published package (see below).
5. Open a pull request and fill in the template.

Pull requests are squash-merged, so the pull request title becomes the commit message. Keep it short and descriptive.

## Changesets and versioning

We use [Changesets](https://github.com/changesets/changesets) to version the package and write the changelog. If your change affects what users of `@datacub/web` get (a fix, a feature, a behaviour or type change), add a changeset:

```sh
bunx changeset
```

Choose the bump type and write one or two sentences for the changelog, written for the people who use the SDK. Commit the generated file in `.changeset/` with your change. Changes to tests, CI or documentation only do not need one.

We follow [semantic versioning](https://semver.org). While the major version is `0`, a minor bump may contain breaking changes; call them out clearly in the changeset.

How releases happen after merge is described in [RELEASING.md](./RELEASING.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
