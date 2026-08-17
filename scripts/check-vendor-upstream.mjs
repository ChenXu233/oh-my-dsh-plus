#!/usr/bin/env node
// Vendor upstream check for oh-my-dsh-plus.
//
// Parses the manifest table in vendor/README.md and checks whether any pinned
// upstream commit has moved. When updates are available (or an upstream repo
// is no longer reachable) it opens a single labelled issue, de-duplicated by
// issue title among open issues.
//
// Dependency-free plain Node so the workflow does not need pnpm install.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

function gh(args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return stdout.trim()
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? ''
    if (allowFailure) return stderr
    console.error(`gh ${args.join(' ')} failed`)
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

function parseManifest() {
  const text = readFileSync(path.join(root, 'vendor', 'README.md'), 'utf8')
  const rows = []
  let inTable = false

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('| Directory')) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (!line.startsWith('|')) break

    const cols = line.split('|').slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, ''))
    if (cols.length < 6) continue
    if (cols[0] === '---' || cols[0] === '') continue

    const repoUrl = cols[4].split(/\s+/)[0]
    if (!repoUrl || !cols[5]) continue

    rows.push({
      directory: cols[0].replace(/\/$/, ''),
      repoUrl,
      commit: cols[5],
    })
  }

  return rows
}

function lsRemoteHead(repoUrl) {
  try {
    const stdout = execFileSync('git', ['ls-remote', repoUrl, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const head = stdout.trim().split(/\s+/)[0]
    return head || null
  } catch {
    return null
  }
}

function main() {
  const rows = parseManifest()
  console.log(`Checking ${rows.length} vendored upstream entries...`)

  const updates = []
  const unreachable = []
  const current = new Map()

  for (const row of rows) {
    const head = lsRemoteHead(row.repoUrl)
    if (!head) {
      unreachable.push(row)
      console.log(`UNREACHABLE ${row.directory} (${row.repoUrl})`)
      continue
    }
    current.set(row.directory, head)
    if (head !== row.commit) {
      updates.push({ ...row, head })
      console.log(`UPDATE ${row.directory}: ${row.commit.slice(0, 8)} -> ${head.slice(0, 8)}`)
    } else {
      console.log(`OK ${row.directory}`)
    }
  }

  if (updates.length === 0 && unreachable.length === 0) {
    console.log('All vendored upstream commits are current')
    return
  }

  const repo = githubRepo()
  const title = 'Vendor upstream updates available'

  const openTitles = gh(
    ['issue', 'list', '--repo', repo, '--state', 'open', '--label', 'sync/upstream', '--json', 'title', '--jq', '.[].title'],
    { allowFailure: true },
  )
  if (openTitles.includes(title)) {
    console.log(`Issue already open: ${title}`)
    return
  }

  const lines = [
    '## Vendor upstream check',
    '',
    '`scripts/check-vendor-upstream.mjs` compared `vendor/README.md` pins against upstream HEADs.',
    '',
  ]

  if (updates.length > 0) {
    lines.push('### Updates available', '', '| Directory | Upstream repo | Pinned | Current HEAD |', '|---|---|---|---|')
    for (const row of updates) {
      lines.push(
        `| ${row.directory} | ${row.repoUrl} | \`${row.commit.slice(0, 8)}\` | \`${row.head.slice(0, 8)}\` |`,
      )
    }
    lines.push('')
  }

  if (unreachable.length > 0) {
    lines.push('### Unreachable upstream repos', '', 'These manifest entries could not be queried; the URLs may be stale or private.', '', '| Directory | Upstream repo |', '|---|---|')
    for (const row of unreachable) {
      lines.push(`| ${row.directory} | ${row.repoUrl} |`)
    }
    lines.push('')
  }

  lines.push(
    '### Follow-up',
    '',
    'Update `vendor/README.md` through the vendoring procedure, or open a sync PR for the vendored package.',
    '',
    'This issue was opened automatically and is de-duplicated by title.',
  )

  const body = lines.join('\n')
  const bodyFile = path.join(os.tmpdir(), 'vendor-upstream-check-issue.md')
  writeFileSync(bodyFile, body, 'utf8')

  try {
    gh(['issue', 'create', '--repo', repo, '--title', title, '--label', 'sync/upstream', '--body-file', bodyFile])
    console.log(`Opened issue: ${title}`)
  } finally {
    unlinkSync(bodyFile)
  }
}

main()
