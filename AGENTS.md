# Reader repository instructions

Repository: `Lotus-King-Research/Reader`. Production: `https://reader.padma.io`.

## Changes and release

- Develop on a feature branch and open a pull request targeting `main`. Never update `main` directly through Git, the GitHub API, or the web editor; never force push it.
- Never use `gh pr merge --admin`, bypass checks, or disable or weaken branch protection.
- Keep source modules, configuration, and generated `public/index.html` consistent. Run `npm run build` and relevant tests before opening the PR.
- The required GitHub Actions check is `test`. The branch must be current with `main`, all required checks must pass, and review conversations must be resolved before merge.
- Present the concrete PR for user review. Obtain user approval before merging unless the user has explicitly authorized that merge.
- Merge through the normal PR workflow after protection requirements pass. A required review count of zero does not waive user approval.
- GitHub Actions validates changes. Cloudflare Workers Builds, connected to `main`, automatically builds and deploys merged changes to `reader.padma.io`; check Cloudflare build history before reporting the release complete.
- Do not run `npm run deploy`, `wrangler deploy`, or another manual publish as the normal release process.
