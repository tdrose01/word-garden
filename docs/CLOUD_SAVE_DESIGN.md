# Optional sign-in and cloud saves — proposed design

Status: **proposal for review**. This change does not select, configure, or deploy an identity or storage provider.

Issue: [#33](https://github.com/tdrose01/word-garden/issues/33)

## Existing constraints

Word Garden is a Vite browser game with a Capacitor Android build. Gameplay writes the complete state to `word-garden-state` in local storage after every change. Portable backup/import already validates a versioned, complete save before replacing progress. Cloudflare Pages Functions are currently used only for tester feedback.

Cloud saves must be an optional backup layer around that model. Guest play, local autosave, offline play, downloaded backups, imported backups, and legacy save migration remain fully functional without an account or network request.

## Recommendation

Use **Clerk for optional email-code sign-in** and **Cloudflare D1 behind Pages Functions for save storage**, subject to owner approval and a small proof of concept.

Why this fits:

- The app already deploys on Cloudflare Pages and already has a Pages Function. D1 is available to Pages Functions through a binding, so save data does not need a second application backend.
- Clerk supplies account recovery, sessions, and email verification instead of Word Garden implementing credential handling. Prefer email verification codes because they work across browser and native-webview contexts; do not enable SMS or paid MFA for the first release.
- The browser never receives D1 credentials. The Function verifies the session, derives the account key from the verified subject, and every query includes that key.
- Both services have enough free capacity for a small game. As checked 2026-10-02, Clerk Hobby includes 50,000 monthly retained users; Pro is $20/month billed annually or $25 month-to-month. D1 Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB storage. D1 Paid includes 25 billion reads/month, 50 million writes/month, and 5 GB storage before usage charges.

Costs and tradeoffs:

- This introduces two managed services and makes account availability dependent on Clerk. A paid Clerk plan is required for some advanced auth features, but they are intentionally out of scope.
- D1 has no row-level-security policy layer. Account isolation must be enforced and tested in every Function query; the verified account subject must never be accepted from request JSON.
- Cloudflare Free limits fail closed when exceeded. Before launch, configure usage alerts and decide whether production should use Workers Paid.
- Provider setup requires a Clerk application, publishable/secret keys, a D1 database/binding, allowed origins/redirects, privacy copy, and retention/deletion policy. Those are external security/configuration changes and require explicit approval.

Alternatives considered:

1. **Supabase Auth + Postgres** provides one vendor and row-level security. Its Free plan includes 50,000 monthly active users and a 500 MB database but pauses after one inactive week; Pro starts at $25/month. It is a strong fallback if defense-in-depth RLS is preferred over the existing Cloudflare fit.
2. **Firebase Auth + Firestore** is mature and has offline SDK support, but adds a larger client/runtime dependency and operation-based billing. Firestore's free quota is 1 GiB, 50,000 reads/day, and 20,000 writes/day; certain backup/recovery features require billing. Its automatic document synchronization still does not safely merge Word Garden's reward ledger.

Official references:

- <https://clerk.com/pricing>
- <https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options>
- <https://developers.cloudflare.com/pages/functions/bindings/#d1-databases>
- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://firebase.google.com/docs/auth>
- <https://firebase.google.com/docs/firestore/pricing>

## User flow

### Guest and offline

- The game starts and saves locally exactly as it does today. No account prompt blocks play.
- Settings offers `Back up online (optional)`. Before sign-in it explains what is stored and that local backup/import remains available.
- Network/auth failures never block a puzzle action. Status is concise: `Saved on this device`, `Waiting to back up`, `Backed up`, or `Needs your choice`.

### First sign-in

1. Authenticate without changing progress.
2. Fetch the account's current cloud revision.
3. Show a preview with last-updated time, campaign clearing, daily date/completion, coins, garden plants/species, and device label. The preview is informational and never used to award progress.
4. If the account has no cloud save, offer `Back up this device` or `Not now`.
5. If this device is fresh/default and the cloud has a save, offer `Use cloud save` or `Keep this device`.
6. If both differ, show both summaries and require `Use this device`, `Use cloud save`, or `Cancel`. There is no automatic field merge.
7. Before replacing either side, retain a recoverable portable backup of the displaced save and offer it for download.

Cancel leaves local and cloud progress unchanged.

### Normal sync

- Continue local writes immediately. Debounce cloud backup after local changes and retry only while the same account session is active.
- Each upload carries `baseRevision` and a stable `requestId`. The server transaction accepts it only when `baseRevision` equals the stored revision, increments the revision once, and returns the previous accepted result for a repeated `requestId`.
- A stale revision returns `409 Conflict` with the current cloud snapshot. The client stops automatic uploads and asks the player to choose. It never applies “furthest progress,” maximum coins, or a field-level merge.
- A transient failure leaves the local save intact and marked pending. Reconnect fetches current cloud state before retrying.

### Sign-out and account switching

- Sign-out cancels/ignores in-flight requests, clears provider session data, and leaves the last playable state on the device as an explicit guest copy. The UI states that anyone using the device can play that copy and offers `Remove account progress from this device` only after a downloaded recovery backup is available.
- Signing into a different account never uploads the current local copy automatically. It always runs the first-sign-in comparison flow.
- Every response is discarded if its session generation/account subject no longer matches the active session.

## Save and API contract

The cloud payload embeds the existing `word-garden-backup` version 1 object. Import validation remains the canonical schema/migration boundary, so campaign, in-flight campaign/daily/replay boards, daily history/objectives, garden plots/design/unlocks, coins, hints, settings, and reward records travel together.

Proposed tables:

```sql
cloud_saves(
  account_id text primary key,
  revision integer not null,
  save_json text not null,
  saved_at text not null,
  device_id text not null,
  request_id text not null unique
)

cloud_save_versions(
  account_id text not null,
  revision integer not null,
  save_json text not null,
  saved_at text not null,
  primary key(account_id, revision)
)
```

Keep at least the prior accepted revision for server-side recovery. A later retention limit can be chosen after measuring save size. The current import ceiling is 1 MiB, so the API must reject larger bodies before parsing.

Endpoints, all `Cache-Control: no-store`:

- `GET /api/cloud-save` → current validated snapshot and revision, or `404`.
- `PUT /api/cloud-save` → conditional write with `baseRevision` and `requestId`; returns `201/200`, `409`, `413`, `422`, or auth/rate-limit errors.
- `DELETE /api/cloud-save` is not part of sign-out. Account/data deletion needs a separate, re-authenticated confirmation design.

The server validates Clerk tokens, derives `account_id` from the verified token subject, checks issuer/audience/expiry, validates the full backup with server-compatible schema code, and uses one D1 transaction/batch for history plus compare-and-swap. Logs exclude save JSON, email, tokens, and puzzle contents.

## Conflict and reward safety

Coins and rewards are a ledger-like result of completed puzzles, objective dates, bloom records, and claim flags. Combining independently edited saves could duplicate rewards or invent a cleared board. Therefore:

- Whole-save selection is the only v1 resolution policy.
- A conflict never silently uploads or overwrites.
- The selected save is revalidated before use.
- The displaced save is preserved as a portable recovery backup.
- Repeated requests are idempotent by `(account_id, request_id)`.
- Conditional revision writes prevent stale devices from overwriting newer progress.

## Privacy and operations

- Store provider subject, save JSON, revision metadata, and coarse operational timestamps only. Do not copy email/profile data into D1.
- Publish what is stored, the providers involved, retention, deletion route, and support/recovery limitations before launch.
- Rate-limit reads/writes per verified account and IP; cap bodies at 1 MiB; use generic auth errors; set restrictive CORS to production/preview origins.
- Add metrics for accepted writes, conflicts, validation failures, auth failures, latency, and provider errors without save contents.
- Rollout behind a disabled-by-default build flag. Removing the flag/provider code leaves all local and backup behavior intact.

## Approval gates and rollout

No provider-specific code, account, secret, database, binding, grant, or deployment should be created until the owner approves:

1. Clerk + D1 versus an alternative.
2. Email-code sign-in and the account recovery limitations.
3. Guest-copy behavior on sign-out/account switch.
4. Whole-save conflict resolution and recovery retention.
5. Privacy copy, deletion/retention policy, budget, and production plan.

After approval:

1. Build a local fake-adapter UI and automated acceptance tests.
2. Add Clerk/D1 adapters behind the feature flag and run isolation, stale-write, retry, migration, offline, account-switch, accessibility, and mobile tests.
3. Use a preview deployment with test provider resources; complete a two-device recovery drill.
4. Perform independent release review. Production deployment remains a separate approval/release step.
