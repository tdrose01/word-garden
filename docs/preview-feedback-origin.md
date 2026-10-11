# Word Garden Preview feedback origin

Authorized target: Cloudflare Pages project `word-garden-6fl`, Preview environment,
the existing `ALLOWED_FEEDBACK_ORIGINS` variable. Append only
`https://gcp-preview.word-garden-6fl.pages.dev` if it is not already present.
Preserve every existing entry, all other Preview settings and credentials, and
all Production settings. Do not replace the allow-list with the single origin.
Do not add wildcards, alternate schemes, sibling previews or deployment origins.

## Why the handler returns 403

`functions/api/feedback.js` resolves the request's Origin against its default
allow-list plus the comma-separated `env.ALLOWED_FEEDBACK_ORIGINS` value.
The target preview origin is not a default. OPTIONS returns 403 for an unlisted
origin; POST returns 403 with `Origin is not allowed.` before payload validation
or any GitHub request. A GitHub-side 403 is translated to 429, not returned as 403.
This identifies the handler's origin-check behavior; a failed live connection
cannot establish the current deployed configuration or exclude an edge/WAF error.

Run `npm run test:feedback` for mocked regression coverage. The tests reproduce
the exact preview's denied OPTIONS/POST before the config change and accepted
OPTIONS/POST after it. They verify existing origins remain accepted, sibling
previews, lookalike suffixes, HTTP, null and missing origins remain rejected,
and a separate Production fixture remains unchanged. The suite intercepts fetch
before any origin checks; upstream success and failures use only local mocks.
No live feedback or GitHub test issues are necessary.

## Scoped configuration operation

Using the already-configured Cloudflare access, read the project with
`GET /client/v4/accounts/{account_id}/pages/projects/word-garden-6fl`.
Retain the Production deployment ID, production branch, full deployment settings,
and the current Preview variable in memory; do not log or persist secrets.
Check that the target variable is plaintext and construct its new value by
preserving the existing string and appending the exact origin once.

Use the [Pages project PATCH endpoint](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)
for the same project. Send only this field shape, with the actual retained-plus-
appended string substituted for `newValue`:

```js
{
  deployment_configs: {
    preview: {
      env_vars: {
        ALLOWED_FEEDBACK_ORIGINS: { type: 'plain_text', value: newValue }
      }
    }
  }
}
```

Do not send Production configuration, other environment variables, credentials,
null entries, binding maps, deployment changes or project creation requests.
Re-read the project and verify the sole configuration difference is the expected
Preview variable value and that the canonical Production deployment is unchanged.
Without existing access and a readable current value, the change is blocked;
do not guess the existing entries or alter credentials to work around it.

## Redeployment and safe live verification

Plan a new **Preview deployment** after saving the environment setting so the
Pages Function receives the new binding. Existing deployment bindings may retain
the old value. Cloudflare documents environment variables as Pages Function
[bindings](https://developers.cloudflare.com/pages/functions/bindings/#environment-variables).
Keep the production branch and deployment untouched; verify the new deployment
is a Preview of the intended exact commit before updating/returning its URL.

For live verification, use only OPTIONS on `/api/feedback` with the exact Origin
and `Access-Control-Request-Method: POST`. Expect 204 and the identical
`Access-Control-Allow-Origin`; an unlisted sibling origin must still return 403
with no allow-origin header. Do not send live POSTs, report payloads or create
issues as probes. Record separately whether configuration readback, preview
redeploy and live preflight succeeded; local mocks prove none of those live steps.
