# Authorized coding tasks in this cloud environment

For Word Garden and Void Swarm, follow [the cloud preview workflow](docs/cloud-preview.md)
after implementing an authorized coding task. This workflow runs here in the cloud
environment. Do not use GitHub Actions or GCP as the deployment runner.

- Preserve existing branches, local edits and untracked files. Use a separate task
  branch/worktree; never reset, force-push, clean or overwrite someone else's work.
- Keep cloud saves paused. Do not resume the cloud-save implementation, enable
  synchronization, migrate remote saves, provision storage/auth or add save secrets.
- Keep all existing test assertions, coverage and performance thresholds intact.
  A failure blocks deployment; fix the cause within scope or report it. Never skip
  a required gate or weaken a threshold to produce a preview.
- Commit the complete task, push its branch, and open/update a **draft PR**. Leave
  it draft and unmerged. Production release requires separate explicit authorization.
- Run `python3 scripts/cloud-preview.py --branch preview-<task>` to prepare without
  deployment credentials. When the secure environment is ready, run the same
  command with `--deploy`. Deployment always repeats the complete gates against
  the committed SHA in an isolated worktree; there is no skip-tests/deploy-only mode.
- Use only the existing allow-listed Pages project. Never deploy without an
  explicit preview branch, run raw Wrangler deployments, create a new project,
  change the project's production branch/settings/bindings or promote a preview.
- Keep proxy and CA settings. Never print secrets, dump the environment, read
  credential files, paste credentials into chat/files/PRs, or start interactive login.
  Network secrets may be proxy placeholders; use the injected environment normally.
- Return the draft PR URL, full tested/deployed commit SHA, required test results,
  immutable working preview URL, and receipt path. Claim a preview only after
  Cloudflare metadata, served proof, browser boot and unchanged-production checks
  pass. If credentials/network are missing, finish all feasible preparation and
  report the precise missing secure settings; never invent a preview URL.

These instructions authorize the tests and preview deployments necessary for an
already-authorized coding task. They do not authorize unrelated coding work,
production releases, merging PRs, cloud saves, or contacting other people.
