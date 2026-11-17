# One-click package releases

Automate the current manual version/build/publish process for `@equall-ai/svelte-pdf-viewer`.

## Approach

The user selected a manual GitHub Actions workflow with a patch/minor/major choice. Automatic releases on every merge would publish more often; release PRs would add a review step to each release. A manual workflow preserves the current decision about when to release while automating the work.

## Design

Release only the selected `main` revision. Use the existing Node 22/pnpm 10 toolchain, frozen dependency installation, lint, type checks, tests, and package build. Update both version manifests and push the version commit and annotated tag atomically before publishing to the existing GitHub Packages registry with `GITHUB_TOKEN`.

Serialize release runs. Refuse a fresh release if `main` advanced during checks. Identify version commits by workflow run ID so rerunning the same run reuses its tag, and skip an already published version. Fail on registry errors other than a missing version. Keep demo deployment separate. Document required package access and retry behavior.

## Validation

Check workflow syntax and shell, exercise first-release/retry/conflict paths with a disposable Git repository, and run the project's checks and package build. Do not publish a real package as a test.
