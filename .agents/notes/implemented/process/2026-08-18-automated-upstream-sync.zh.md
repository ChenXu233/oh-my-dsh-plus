# Agent Note: 自动化上游同步：合并 PR 与冲突 issue

Status: implemented

[English](2026-08-18-automated-upstream-sync.md) | 中文

## Problem

这个 fork 需要在开发者预览期跟踪 `deepseek-ai/deepseek-harness`，不能落后太多提交。手工同步慢，而且出现冲突时可能一直没人发现。由于我们有了第一个自己的提交（`ROADMAP.md`、`.gitattributes`、`.github/CODEOWNERS`），以后每次同步都是合并，因此机制必须产出可审查的合并 PR，并把冲突显式暴露出来。

## Decision

`.github/workflows/sync-upstream.yml` 每 6 小时拉取 `upstream/master` 并运行 `scripts/upstream-sync.mjs`。当 master 落后时，脚本从 master 创建 `sync/upstream-*` 分支，用 `--no-ff` 合并 `upstream/master`，应用本地的 `merge=ours` 驱动和 `git rerere` 缓存，然后提交合并。它推送分支并创建包含上游提交清单的 PR。当仍有未解决的冲突时，脚本中止合并并创建 issue，列出冲突文件和手工同步命令。workflow 不会自动合并。

`git config merge.ours.driver true` 是必需配置，本地和 workflow 在合并前都会设置。`.gitattributes` 把以下“我们标准”路径标记为 `merge=ours`：vendored 框架源码、`packages/core/agent-loop`、`AGENTS.md`、`ROADMAP.md`、同步 workflow 和同步脚本。

## Alternatives considered

- **只做 fast-forward 同步。** 否决，因为 master 现在已有我们自己的提交，fast-forward 会丢弃或绕过它们。
- **把我们的提交 rebase 到上游上。** 否决，因为 master rebase 需要 force-push，并重写审查历史。
- **自动合并已审批的提交。** 推迟到后续阶段；第一版只创建 PR，让必需检查和人工审查保持最终决定权。
- **创建带冲突标记的 PR。** 否决，因为带冲突的分支会让 CI 失败，且不能清晰展示冲突集合；用 issue 加命令更清楚。

## Consequences

- 上游漂移至少每 6 小时被发现一次，并变成一个带标签的 PR 或 issue。
- 每次同步都是真正的合并提交，因此 `merge=ours` 和 rerere 路径会在“我们的标准”与上游交汇处实际生效。
- 分支保护和我们标准路径上的 owner review 仍然是合并门禁。
- “自动审批以前审批过的差异”有意不在这一版实现。
