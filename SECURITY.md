# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately in one of two ways:

- **GitHub:** open this repository's **Security** tab and choose **Report a vulnerability**. This creates a private advisory that only the maintainers can see.
- **Email:** write to **support@datacub.to** with "Security" in the subject.

Include what you found, how to reproduce it, the version of `@datacub/web` you tested and the impact you expect. Proof-of-concept code is welcome; please do not access other people's data or degrade the service to demonstrate a problem.

## What happens next

1. We aim to acknowledge your report within three working days (Sunday to Thursday, Asia/Riyadh).
2. We confirm the problem, decide its severity and keep you informed while we fix it.
3. We release a fix, publish a GitHub security advisory and credit you if you want to be credited.

datacub has no bug bounty programme.

## Supported versions

Security fixes are released for the latest published version on each npm dist-tag (`latest`, and `next` while a prerelease line is active). Older versions do not receive fixes; upgrade to the latest version.

## Scope

In scope: the code in this repository and the package `@datacub/web` published from it.

Report problems with the datacub service itself (the dashboard, the API or the ingestion endpoints) to the same address.
