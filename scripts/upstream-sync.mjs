#!/usr/bin/env node
// Automated upstream sync for oh-my-dsh-plus.
//
// This script is intentionally dependency-free (plain Node) so it can run in a
// GitHub Actions job without pnpm install. It expects:
//   - a git checkout of master with full history (fetch-depth: 0)
//   - an `upstream` remote pointing at deepseek-harness
//   - `gh` CLI with GH_TOKEN, and git push credentials already configured
//   - git config merge.ours.driver true + rerere.enabled/autoupdate true
//
// Behavior:
//   - when master is in sync: exits 0 without changes
//   - when the upstream merge is clean (or rerere resolves all conflicts):
//     pushes a `sync/upstream-*` branch and opens a PR labelled sync/upstream
//   - when conflicts remain: aborts the merge and opens an issue with the
//     conflicting files and the manual sync commands
//
// It does NOT auto-merge. Approval and merge stay human decisions.

import { execFileSync } from 'node:child_process'

const UPSTREAM_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'

function run(cmd, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('bash', ['-c', cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return stdout.trim()
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? ''
    if (allowFailure) return stderr
    console.error(`Command failed: ${cmd}`)
    console.error(stderr)
    process.exit(1)
  }
}

function githubRepo() {
  const fromEnv = process.env.GITHUB_REPOSITORY || process.env.GH_REPO
  if (fromEnv) return fromEnv
  const url = run('git remote get-url origin')
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot derive GitHub repo from origin URL: ${url}`)
  return match[1]
}

function main() {
  // Make sure the upstream remote exists.
  const remotes = run('git remote')
  if (!remotes.split(/\s+/).includes('upstream')) {
    run(`git remote add upstream ${UPSTREAM_REPO}`)
    console.log('Added upstream remote')
  }

  console.log('Fetching upstream/master...')
  run('git fetch upstream master:refs/remotes/upstream/master')

  const behind = Number(run('git rev-list --count master..upstream/master'))
  if (behind === 0) {
    console.log('Already in sync with upstream/master')
    return
  }

  const fullSha = run('git rev-parse upstream/master')
  const shortSha = run('git rev-parse --short upstream/master')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const branch = `sync/upstream-${stamp}-${shortSha}`

  console.log(`master is behind upstream/master by ${behind} commit(s)`)
  const repo = githubRepo()

  // Ensure the sync label exists; PRs and issues both carry it.
  run(`gh label create sync/upstream --repo ${repo} --color 0E8A16 --description "Automated upstream sync" --force`, { allowFailure: true })

  // Always work from master.
  run('git checkout master')

  // Ensure we have a git identity for the merge commit.
  if (!run('git config user.name', { allowFailure: true })) {
    run('git config user.name dsh-sync-bot')
  }
  if (!run('git config user.email', { allowFailure: true })) {
    run('git config user.email dsh-sync-bot@users.noreply.github.com')
  }

  run(`git checkout -B ${branch}`)

  const mergeOk = (() => {
    try {
      run(`git merge --no-ff --no-commit upstream/master`)
      return true
    } catch {
      // The merge may have failed because of conflicts, or it may have
      // resolved them through rerere while still returning non-zero.
      return false
    }
  })()

  const unmerged = run('git ls-files -u')
  if (unmerged.length === 0) {
    // Either a clean merge or rerere auto-resolved everything. Commit it.
    run(`git commit -m "chore: sync upstream ${shortSha}"`)
    run(`git push -u origin ${branch}`)

    const commitList = run('git log --oneline --reverse master..upstream/master')
    const prBody = [
      '## Upstream sync',
      '',
      `- **Upstream commit:** \`${fullSha}\` (${shortSha})`,
      `- **Commits behind:** ${behind}`,
      '',
      '### Upstream commits',
      '',
      '```text',
      commitList,
      '```',
      '',
      'This PR was created by `scripts/upstream-sync.mjs`. It does not auto-merge.',
      '',
      '## Local merge notes',
      '',
      '- `merge=ours` protected paths keep our standards during conflict resolution.',
      '- `git rerere` resolution cache was applied when available.',
      '- Review the merge commit before enabling auto-merge.',
    ].join('\n')

    run(
      `gh pr create --repo ${repo} --base master --head ${branch} ` +
        `--title "chore: sync upstream ${shortSha}" ` +
        `--label sync/upstream ` +
        `--body "${prBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    console.log(`Created sync PR from ${branch}`)
    return
  }

  // Conflicts remain. Capture them before aborting, then open a manual-sync issue.
  const conflictFiles = run('git diff --name-only --diff-filter=U')
  run('git merge --abort')
  run(`git checkout master`)
  run(`git branch -D ${branch}`)

  const issueBody = [
    '## Upstream sync blocked by merge conflicts',
    '',
    `- **Upstream commit:** \`${fullSha}\` (${shortSha})`,
    `- **Commits behind:** ${behind}`,
    '',
    '### Conflicting files',
    '',
    '```text',
    conflictFiles || '(none recorded)',
    '```',
    '',
    '### Upstream commits',
    '',
    '```text',
    run('git log --oneline --reverse master..upstream/master'),
    '```',
    '',
    '### Manual sync',
    '',
    '```bash',
    'git fetch upstream master:refs/remotes/upstream/master',
    `git checkout -b ${branch}`,
    'git merge --no-ff upstream/master',
    '# resolve conflicts, then:',
    'git commit',
    `gh pr create --repo ${repo} --base master --head ${branch} --title "chore: sync upstream ${shortSha}"`,
    '```',
  ].join('\n')

  run(
    `gh issue create --repo ${repo} ` +
      `--title "chore: sync upstream ${shortSha} — merge conflicts need manual sync" ` +
      `--label sync/upstream ` +
      `--body "${issueBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
  )
  console.log('Merge conflicts remain; opened a manual-sync issue.')
}

main()
