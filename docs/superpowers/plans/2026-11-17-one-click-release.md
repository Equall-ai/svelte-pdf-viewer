# One-click release implementation plan

> Implement inline using superpowers:executing-plans; request one final code review.

**Goal:** A manual patch/minor/major release workflow that validates, builds, versions, tags, and publishes the package.

**Architecture:** One GitHub Actions job uses the current package scripts and registry. A run-ID marker makes retries reuse the original version commit.

**Tech stack:** GitHub Actions, Bash, Node 22, pnpm 10, npm registry CLI.

**Spec:** `docs/superpowers/specs/2026-11-17-one-click-release-design.md`

## Constraints and review focus

- Main only; no actual release during setup.
- Preserve current CI, demo deployment, dependency versions, and registry.
- Exercise retries, conflicting tags, main moving, registry errors, and invalid bump inputs.

## Task 1: Release workflow and operating instructions

- [ ] Add `.github/workflows/release.yml` with checks, version preparation, atomic commit/tag push, packing, and publishing.
- [ ] Add `docs/releasing.md` with run, retry, and permission instructions.
- [ ] Validate action syntax and execute shell steps against disposable fixtures.
- [ ] Run lint, type checks, tests, and package build.
- [ ] Review the diff, commit, push a feature branch, and open a PR.
