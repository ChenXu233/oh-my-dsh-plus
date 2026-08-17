# Agent Note: Automated upstream sync with merge PRs and conflict issues

Status: implemented

English | [中文](2026-08-18-automated-upstream-sync.zh.md)

## Problem

The fork must track `deepseek-ai/deepseek-harness` during developer preview without falling many commits behind. Manual sync is slow, and a conflicted sync can sit unnoticed. The first own commit (`ROADMAP.md`, `.gitattributes`, `.github/CODEOWNERS`) means every future sync is a merge, so the mechanism must produce reviewable merge PRs and surface conflicts.

## Decision

`.github/workflows/sync-upstream.yml` fetches `upstream/master` every six hours and runs `scripts/upstream-sync.mjs`. When master is behind, the script creates `sync/upstream-*` from master, merges `upstream/master` with `--no-ff`, applies the local `merge=ours` driver and `git rerere` cache, and commits the merge. It pushes the branch and opens a PR with the upstream commit list. When unresolved conflicts remain, the script aborts the merge and opens an issue listing conflicting files and manual-sync commands. The workflow does not auto-merge. A second workflow, `.github/workflows/vendor-upstream-check.yml`, parses the `vendor/README.md` manifest every six hours and opens a de-duplicated `sync/upstream` issue when a pinned upstream commit has moved or an upstream repo is unreachable.

`git config merge.ours.driver true` is required and is set both in local checkout and in the workflow before merging. `.gitattributes` marks our-standards paths as `merge=ours`: vendored framework sources, `packages/core/agent-loop`, `AGENTS.md`, `ROADMAP.md`, the sync workflow, and the sync script.

## Alternatives considered

- **Fast-forward sync only.** Rejected because master now carries our own commits and fast-forward would drop or bypass them.
- **Rebase own commits on upstream.** Rejected because rebasing master requires force-push and rewrites review history.
- **Auto-merge approved commits.** Deferred to a later phase; the first version only opens PRs so required checks and human review stay authoritative.
- **Open a PR with conflict markers.** Rejected because a conflicted branch fails CI and obscures the exact conflict set; an issue with commands is clearer.

## Consequences

- Upstream drift is detected at least every six hours and becomes a labelled PR or issue.
- Vendored-package drift is detected independently by `vendor-upstream-check.yml` and opened as a `sync/upstream` issue.
- Every sync is a real merge commit, so the `merge=ours` and rerere paths are exercised exactly where our standards meet upstream.
- Required branch protection and owner review on our-standards paths remain the merge gate.
- Auto-approval of previously approved differences is intentionally not part of this first cut.
