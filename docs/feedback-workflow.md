# Tester Feedback Workflow

Word Garden includes a floating Feedback panel for web/PWA playtests. It captures
category, device, browser, build, mode/level, performance notes, and the report
text without changing puzzle state or level behavior.

The GitHub action posts bounded JSON to the Cloudflare Pages Function at
`POST /api/feedback`. The browser never receives a GitHub token. The function uses
the server-side `GITHUB_TOKEN` or `GH_TOKEN` secret and always creates issues in
`tdrose01/word-garden` with controlled title/body formatting and these labels:

- `type:test`
- `area:testing`
- `closed-test`
- `word-garden`

If the token is missing or GitHub rejects the request, the response includes a
public prefilled GitHub issue draft URL so testers can submit manually. Copy Report
and Web Share remain local browser actions.

Required Cloudflare Pages environment:

```bash
GITHUB_TOKEN=<repo-scoped issue creation token>
ALLOWED_FEEDBACK_ORIGINS=https://word-garden.pages.dev
```

`ALLOWED_FEEDBACK_ORIGINS` is optional for the default Pages origin and can be a
comma-separated allow-list for custom production domains. Local Vite, Pages
preview, and Wrangler dev origins on `localhost` or `127.0.0.1` are allowed for
development.

Focused validation:

```bash
npm run test:feedback
```
