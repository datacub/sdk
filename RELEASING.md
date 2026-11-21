# Releasing @datacub/web

Releases are automatic. Nobody publishes from a laptop, and no long-lived npm token is stored (the first version of each package was published with a short-lived token that was deleted right after): GitHub Actions publishes through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), and every version carries an npm [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) that links it to the commit and workflow run that built it.

## The short version

1. Merge pull requests that include a changeset (`bunx changeset`).
2. The **Release** workflow opens or updates a pull request titled **chore: release**. It bumps the version in `package.json` and writes `CHANGELOG.md` from the pending changesets.
3. Review that pull request and merge it once CI is green.
4. The Release workflow runs again on `main`, sees a version that npm does not have yet, and publishes it. It then creates the git tag `v<version>` and the GitHub release with the changelog entry.

A commit that does not change the `version` in `package.json` publishes nothing. The version changes through the release pull request; a pull request that edits it by hand would also publish once merged, so reviewers treat any change to `version` as a release.

## How it works

| Piece | What it does |
|---|---|
| `.changeset/*.md` | One file per pending change: the bump type (patch, minor, major) and the changelog text |
| `.github/workflows/ci.yml` | Lint, type check, tests, package content check, dependency audit and secret scan on every pull request and every push to `main` |
| `.github/workflows/release.yml`, job `version` | With pending changesets, runs [changesets/action](https://github.com/changesets/action) to open or update the release pull request (`bun run version`, which runs `changeset version` and regenerates any file that carries the version) |
| job `build` | Without pending changesets: checks whether npm has `package.json`'s version and whether its GitHub release exists. If npm lacks it, runs the checks again and packs the tarball. Read-only permissions |
| job `publish` | Runs in the `npm` environment. Publishes that exact tarball with provenance and creates the tag and GitHub release. It installs no dependencies and runs no project code |
| GitHub environment `npm` | The only place the publish job runs. Limited to the `main` branch |
| npm trusted publisher | npm accepts a publish of `@datacub/web` only from this repository, the workflow file `release.yml` and the environment `npm` |

Commits that the workflow pushes with `GITHUB_TOKEN` do not start other workflows, so after it updates the release pull request it starts CI on it explicitly (`workflow_dispatch`). The required checks then report on the pull request as usual.

## Stable and prerelease versions

- A version without a prerelease suffix (`1.2.3`) is published to the `latest` dist-tag, which `npm install @datacub/web` installs.
- A version with a suffix (`1.2.3-beta.1`) is published to the `next` dist-tag and marked as a prerelease on GitHub. Users opt in with `npm install @datacub/web@next`.

To start a prerelease line, run `bunx changeset pre enter beta` and merge that change. Every release pull request then produces `-beta.N` versions. To finish the line, run `bunx changeset pre exit` and merge; the next release is stable.

## If a release fails

Every step can be re-run safely: open the failed **Release** run in the Actions tab and choose **Re-run jobs**.

- **Failed before publishing** (checks, build, npm unreachable): nothing was published. Fix the cause on `main`; the next push or a re-run publishes.
- **Published, but the tag or GitHub release is missing:** re-run. The build job sees the version on npm and the missing release, so the publish job skips npm and only creates the tag and the release.
- **A broken version reached npm:** do not unpublish. Release a fixed patch version through the normal flow, then deprecate the broken one: `npm deprecate @datacub/web@<version> "Broken, use <fixed version>"`. Unpublishing breaks everyone who installed it and npm allows it only within 72 hours.

## Access

- **npm:** the `datacub` organization owns the package. Organization owners manage maintainers at https://www.npmjs.com/settings/datacub/members. Two-factor authentication is required for every maintainer, and the package setting **Require two-factor authentication and disallow tokens** keeps token-based publishing switched off.
- **GitHub:** members of the `@datacub/maintainers` team review and merge. `main` is protected: changes arrive through pull requests with passing checks.
- **Changing the trusted publisher** (for example after renaming the workflow file): an npm organization owner runs `npm trust list @datacub/web` and `npm trust revoke`, then `npm trust github @datacub/web --repo datacub/web-sdk --file release.yml --env npm --allow-publish`, or uses the package's Settings page on npmjs.com.
