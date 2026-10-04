# Public-site deployment

## Project configuration

Use Vercel project `corridra`, or an existing owner-selected Corridra project. Confirm the authenticated team/account before creating or changing a project. Never change an unrelated existing project because its name resembles Corridra.

- Git repository: `sadat99/corridra`.
- Framework: Next.js.
- Root Directory: `apps/web`.
- Include files outside the Root Directory so the workspace manifest and lockfile are available.
- Install: `pnpm install --frozen-lockfile`.
- Build: `pnpm build`, from the web package root.
- Node: 24.x.
- Production branch after bootstrap: protected `main`.

The initial static page needs no application environment variables. Vercel authentication uses `VERCEL_TOKEN` through the supported HTTPS proxy binding to `api.vercel.com`, or an existing Vercel login. Store values only in secure settings. Never commit `.vercel` project state or an authentication file. Vercel platform authentication is not a website runtime secret.

## Release procedure

1. Run the validation commands from the repository README.
2. Commit and push the intended revision. Verify its remote SHA rather than treating a push request as success.
3. Verify the correct Vercel project with the settings above. A raw token/login can use CLI 62.2.0. Proxy placeholders may fail the CLI's local token-character validation; use the documented REST API with the existing binding in the Authorization header instead of changing or exposing the credential. `GET /v9/projects/corridra` verifies repository association. `PATCH /v9/projects/{id}` updates this project's framework/root settings. `POST /v13/deployments` with the pushed Git source creates a deployment when Git integration has not already done so. Include the project's team ID when required. Inspect current API schemas before changing project fields.
4. Deploy to production only for a release the user has authorized. Record the returned deployment URL and project alias. Confirm Vercel reports the deployment as ready.
5. Make an unauthenticated HTTPS request to the public URL. Verify HTTP 200, the Corridra title/headline and Coming soon status. Run browser checks against that URL if accessible from the task's network policy.
6. Record commit, URL, timestamp, checks and any limits in the current part’s release record under `docs/implementation/`. Check every newly introduced public route, not just the homepage.

Never put a token in a command-line argument or a log. The CLI reads `VERCEL_TOKEN` from its environment. If there is no usable binding/login, finish the deployable work and request secure configuration rather than fabricating a deployment URL. Network settings need `api.vercel.com`, `vercel.com` and the actual deployment hostname under `vercel.app`.

Connecting the repository in Vercel enables Git-driven previews and releases; a standalone CLI deployment does not establish that integration. Verify it separately. Configure protected `main`, required checks and preview isolation before Part 03 introduces data. A successful build or saved cloud environment draft does not prove publication to Vercel.

The initial authenticated REST deployment succeeded. Git-triggered deployment currently encounters Vercel's commit-author/team collaboration check; resolve that association before relying on automatic releases. Do not disable the check or rewrite shared history. Explicitly authorized releases can use an authenticated deployment of the exact pushed Git revision.

## Rollback

Use the actual Vercel project to promote the last known-good deployment or redeploy its Git revision. Confirm the public alias serves that revision. Part 01 has no data migrations or user submissions. Later releases follow their part's database/event compatibility and forward-fix notes.
