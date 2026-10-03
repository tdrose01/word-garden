# Cloud save preview setup handoff

The owner approved continuing both projects on 2026-10-03. This handoff records the remaining setup inputs; it does not itself perform resource creation or credential entry. No paid-plan upgrade is authorized.

## Live setup checks on 2026-10-03

The established Cloudflare Pages credential successfully lists Void Swarm deployments, but `wrangler d1 list --json` returns Cloudflare authentication error 10000 for the existing account. The operator must update the established credential securely with Account D1 Edit permission before D1 setup can proceed. Do not paste the token into chat or repository files.

No Clerk instance domain or publishable key has been supplied. The operator must create or identify the Word Garden Clerk application and provide those public configuration values. Enter passwords, verification codes, and secret keys directly in provider settings.

Complete code, fake-adapter validation, and independent review while these inputs are pending. Keep online backup disabled in production until the real two-device restore/conflict/recovery drills and release gates pass.

## Verified existing targets

- Repository: `tdrose01/word-garden`, draft PR #34.
- Production site: `https://word-garden-6fl.pages.dev`.
- Immutable production receipt previously reported: `https://a4f09833.word-garden-6fl.pages.dev`.
- Existing application backend shape: Cloudflare Pages Functions.

Not yet verified or created:

- The owning Cloudflare account/project identity and the operator's permission to create D1 databases or preview bindings.
- A Clerk account/application for Word Garden, its instance domain/issuer, allowed origins, or email-code configuration.
- Any D1 database named for Word Garden cloud saves.
- Any preview environment variables, secrets, or persistent Codex access to Clerk or Cloudflare.

## Requested preview resources and budget

Use preview/test resources only:

1. One Clerk Hobby application configured for email verification codes, with production SMS, MFA, social providers, and paid add-ons disabled.
2. One Cloudflare D1 database dedicated to Word Garden preview cloud saves, bound to preview Pages Functions as `CLOUD_SAVES`.
3. A hard **$0 expected spend** for the proof of concept. Do not upgrade either service or disable a spend cap without a new approval.

Current free allowances checked during design review were Clerk Hobby up to 50,000 monthly retained users, and D1 Free at 5 million rows read/day, 100,000 rows written/day, and 5 GB stored. Recheck provider pricing at action time.

## Data sent and stored

Clerk receives:

- email address entered for sign-in;
- verification-code and session/account security data handled by Clerk;
- allowed origin/redirect information and ordinary provider security logs.

D1 stores:

- the pseudonymous verified Clerk subject, not the player's email;
- the complete validated Word Garden backup JSON, including campaign/daily/replay progress, coins, hints, garden/reward records, and settings;
- revision, server timestamp, opaque device ID, request ID, payload hash, accepted response, and recovery versions.

Do not log or store session tokens, email addresses, verification codes, save JSON, puzzle contents, passwords, or provider secret keys outside their required systems.

## Configuration and credential ownership

Expected non-secret client/build configuration:

- Clerk publishable key;
- the preview feature flag;
- preview origin and redirect URLs.

Expected server configuration:

- `CLERK_ISSUER`;
- `CLERK_AUTHORIZED_PARTIES`;
- optional `CLERK_AUDIENCE` and `CLERK_JWKS_URL` if the chosen Clerk configuration requires them;
- D1 binding `CLOUD_SAVES`;
- explicit `ALLOWED_CLOUD_SAVE_ORIGINS` for any nonstandard preview origin.

The current JWT design does not require a Clerk secret key. Future administrative account deletion might, but it is out of scope and needs a separate design and approval.

The owner/operator must sign in to Clerk and Cloudflare and enter any password, one-time code, recovery factor, or secret directly in the provider UI. Do not paste those into chat, repository files, issues, PRs, logs, or shell history. If Codex is asked to configure persistent access or transmit a credential, request action-time confirmation for that exact operation and destination.

## Work separable from provider setup

Safe before credentials/resources:

- provider-neutral flow and accessible panel implementation;
- fake auth/API adapter tests;
- local save, conflict, recovery, retry, stale-response, sign-out, and account-switch tests;
- review of SQL, CORS, JWT claims, privacy copy, and failure messages.

Requires preview resources and action-time approval:

- creating the Clerk application or D1 database;
- configuring Clerk email delivery, origins, redirects, or account policies;
- applying the D1 migration or attaching a Pages binding;
- entering build/server configuration in Cloudflare;
- deploying a preview or sending any real email/code/save to providers;
- granting Codex persistent Clerk or Cloudflare access.

Requires a later, separate production release approval:

- production Clerk origins/redirects and email configuration;
- production D1 migration/binding and retention/deletion operations;
- enabling the feature flag for players;
- production deployment, monitoring, paid-plan changes, or rollback.
