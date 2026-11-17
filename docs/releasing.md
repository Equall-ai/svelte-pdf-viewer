# Releasing the package

Use this workflow to version, build, and publish `@equall-ai/svelte-pdf-viewer` to GitHub Packages.

1. Merge the changes you want to release into `main`.
2. Open **Actions → Release package → Run workflow**.
3. Select **main** and choose **patch**, **minor**, or **major**. For example, patch increments `4.2.7` to `4.2.8`.
4. Select **Run workflow**. The run summary confirms the published version.

The workflow installs from the frozen pnpm lockfile, runs lint, type checks and tests, and builds the library with `svelte-package` and `publint`. It updates `package.json` and `package-lock.json`, commits the version, creates an annotated `vX.Y.Z` tag, and publishes the built package. It does not deploy the demo site.

Releases are serialized. Only `main` can release. If `main` advances during the build, the release stops before recording the version or publishing; start a new run from the latest `main`.

## Retrying a failed release

Use **Re-run failed jobs** on the **same run**. The workflow recognizes its own version commit and tag and reuses that version. If publication already succeeded, it skips publishing again. Authentication and network errors stop the run rather than being treated as a missing package.

A new workflow run requests a new version bump. Do not start a new run to retry a failure after the version commit and tag were pushed.

If a later release version has already been committed to `main`, retrying an older unpublished release stops instead of moving the registry's `latest` tag backward. Use the newer release run.

## Repository permissions

The workflow uses the built-in `GITHUB_TOKEN` with `contents: write` and `packages: write`; no personal access token is needed. The existing package must allow this repository to publish: in the GitHub package settings, check **Manage Actions access** for `Equall-ai/svelte-pdf-viewer` and grant write access if it is not inherited from the linked repository.

The workflow pushes its version commit to `main`. If branch protection is introduced later, adapt the release process to satisfy it; do not disable protection to make a release succeed. Pushes made with `GITHUB_TOKEN` do not trigger the ordinary push-based CI or demo deployment workflows, so the release workflow runs its own checks.
