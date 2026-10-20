# Test and preview from the cloud environment

This is the reusable preview deployment workflow for the existing Cloudflare
Pages API projects `word-garden` and `void-swarm`. Word Garden's API project name
is `word-garden`, while its Cloudflare-generated hostname is the independently
assigned `word-garden-6fl.pages.dev`. The runner keeps those identifiers separate:
Wrangler and Cloudflare API paths receive `word-garden`, while served URL checks
require `word-garden-6fl.pages.dev`. Neither value is derived from the other.
The first live run validates the fixed API project and production branch via the
Cloudflare API. No project is created and no project configuration is written.

## Use

Use a complete Git checkout, Python 3.12+, Node 22+, npm, and a Linux environment
with the libraries required by Playwright Chromium. Preserve the environment's
proxy and CA trust. Use a separate task branch/worktree and commit your changes;
the runner refuses dirty/untracked source. Push the committed task and open a
draft PR before returning the preview. Do not merge or promote the deployment.

```bash
# No Cloudflare credentials needed: installs dependencies/browser, runs gates,
# rebuilds the ordinary game and writes a preparation receipt under /tmp.
python3 scripts/cloud-preview.py --branch preview-issue-123

# Requires the secure Cloudflare settings below. Repeats all gates before upload.
python3 scripts/cloud-preview.py --branch preview-issue-123 --deploy

# Optional evidence destination, always outside the repository.
python3 scripts/cloud-preview.py --branch preview-issue-123 --deploy --receipt /tmp/preview-evidence.json

# Credential-free workflow guard tests only (not a replacement for game gates).
python3 scripts/cloud-preview.test.py
```

There are no arbitrary project, raw deploy argument, skip-test, promotion,
production, or credential command-line options. Branch names must be lowercase
`preview-<task>` with no slash/underscore; production branch collisions, including
slash-to-hyphen aliases, are refused after reading the live project.

## Required gates and evidence

| Repository | Required existing gate |
| --- | --- |
| Word Garden | `npm test`, `npm run test:feedback`, `npm run build` (includes font regression), `npm run test:smoke` |
| Void Swarm | `npm run test:cloud` in full, then `npm run build` |

The runner also executes the credential-free guard tests. It uses `npm ci` from
the committed lockfile and Playwright Chromium/ffmpeg. All commands run in a
temporary detached worktree at the full SHA. Failed gates stop the upload.
Thresholds and test files are not changed. Test logs remain visible in the task;
the JSON receipt records successful completion and exact SHA. Retain task logs
with the receipt for review. Additional existing device/release checks still
apply where required; a web preview does not replace Android release evidence.

Void Swarm's cloud suite intentionally creates QA/sample bundles. After all
gates, the runner deletes its temporary `dist`, removes inherited `VITE_*` flags,
and builds the ordinary game again. It never uploads the test suite's last special
bundle. Test/build subprocesses do not receive token/secret/password variables.
Original source, local saves, branches and generated files remain untouched.
The temporary worktree is removed on completion or failure.

For deployment, pinned Wrangler `4.45.0` is installed without credentials in a
temporary CLI directory. Deployment runs from another configuration-free
directory containing only the final `dist` and existing Pages `functions`.
Repository Wrangler configuration cannot change the destination. The command
always supplies the API project name, explicit preview branch, full commit hash,
clean-commit flag and a unique run message. Wrangler output is captured and never echoed,
including on failure, to prevent credential-bearing diagnostics from leaking.
The wrapper reports the command's exit status if upload fails.

This uses the supported Pages Direct Upload path, `wrangler pages deploy`, for a
prebuilt directory. Wrangler inventories the staged `dist` tree by content hash:
assets already present in Cloudflare's upload store may be reused, while new or
changed files are uploaded. That transfer optimization does not reuse an old
deployment or old build output—the runner always builds the exact committed SHA,
stages that complete output plus the repository's current `functions`, creates a
fresh preview deployment, and verifies the served bundle marker. Do not replace
this with raw upload API calls or copy assets from an earlier deployment.

Before upload, the runner reads the existing project's production branch,
canonical production deployment and production configuration. It compares them
again immediately before upload and after preview verification. It performs no
project updates, production deployments, promotions, binding changes or save writes.

After upload, the runner queries preview deployments and reads the exact matched
deployment ID. It requires `environment=preview`, successful status, ad hoc
trigger, exact full SHA, branch and unique run message. The immutable deployment
origin must be `https://<deployment-id>.word-garden-6fl.pages.dev` for Word
Garden or `https://<deployment-id>.void-swarm.pages.dev` for Void Swarm; aliases and the
production origin are refused. It reads `preview-proof.json` at that origin and
requires the exact commit, unique run ID and final-bundle SHA-256 marker. It then
checks HTML and boots the game in a fresh phone-sized Chromium context, rejecting
runtime/asset errors and a blank Void Swarm canvas. The browser blocks network
writes and off-origin requests; it never submits feedback or cloud saves.

The receipt includes the full commit, branch, bundle digest, unique run ID,
deployment ID, verified preview URL, successful tests/browser boot, and
`production_unchanged: true`. Preparation receipts have `deployed: false` and
contain no preview claim. Use the immutable URL returned in the receipt; do not
guess a URL from the branch or return a stale alias.

## One-time secure environment settings

Enter credentials only in the cloud environment's secure settings. Never put
tokens in chat, repository files, shell arguments, setup scripts or PR bodies.

| Setting | Required value/configuration |
| --- | --- |
| Network secret name and injected environment variable | `CLOUDFLARE_API_TOKEN` |
| Secret allowed destination | **Only `api.cloudflare.com`**, HTTPS; keep inherited proxy injection |
| Cloudflare token permission | **Account → Cloudflare Pages → Edit**, scoped to the one account owning these existing projects; use an expiry |
| Runtime environment variable | `CLOUDFLARE_ACCOUNT_ID`, the non-secret 32-character account ID for that account |
| Runtime/toolchain | Python 3.12+, Node 22+, npm, git, Chromium system libraries |
| Checkout access | Attach/clone `tdrose01/word-garden` and `tdrose01/void-swarm` using a secure GitHub connection; Void Swarm is private. Keep any GitHub credentials separate from the Cloudflare token |

Pages Edit is account-scoped and can affect production. It is not a preview-only
credential. The wrapper enforces the preview restriction; use this wrapper and
do not hand the token to arbitrary deployment commands.

For restricted HTTP egress, allow `api.cloudflare.com`, `registry.npmjs.org`,
`github.com`, `api.github.com`, `codeload.github.com`, `raw.githubusercontent.com`,
`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, and the immutable
deployment hosts under `word-garden-6fl.pages.dev` and `void-swarm.pages.dev` (including
their subdomains). If browser/dependency redirects need another destination,
use the supported network settings after inspecting the denial. Do not bypass
the proxy or disable TLS verification. The Cloudflare secret remains restricted
to its API host even when other destinations are allowed.

No GCP credentials, GitHub Actions deployment secrets, cloud-save credentials,
remote-save storage, account login, or Pages production binding changes are needed.
Existing GitHub Actions test workflows may continue to run on PRs, but this
workflow neither edits them nor uses them as the deployment runner.

Check environment readiness after saving settings and restarting/applying the
environment. A secret/runtime variable is ready only when the current readiness
observation says `ready`; never inspect its value. A refused proxy connection is
an environment networking problem, not proof that a token is invalid. Correct
the supported network configuration and repeat preparation before deployment.

## Review and paused work

Keep cloud saves paused, including the existing Word Garden cloud-save design
branch. Do not reset or repurpose any existing `gcp-preview`, feature, or draft
branches. This workflow uses a new explicitly named Pages preview branch and
does not deploy to those existing branches.

Keep task PRs draft and preserve existing work. Report the draft PR, exact tested
SHA, gate outcome, immutable verified URL and evidence receipt. When networking
or secure settings prevent a live run, report that blocker honestly and retain
the prepared scripts/PR; do not claim that guard tests are a complete game test.
