# oh-my-dsh-plus 路线图（ROADMAP）

> 本文档是 **我们自己的 fork（oh-my-dsh-plus）** 的路线图，不是上游 `deepseek-harness` 文档。
> 目标：在保持与上游快速同步的同时，加入 Desktop、Swarm、多语言高性能插件能力。

## 0. 基线（Baseline）

- 当前 `master`：`47f9438`（上游 `deepseek-harness` 历史内）。
- 上游 `master` 最新：`99f6f02`（探测时）。
- 落后：111 个提交，当前无本地独有提交，可 `fast-forward`。
- 已有基础设施：
  - `vendor/README.md` 手工 vendor 同步流程 + 18 条本地修改日志。
  - `scripts/check-vendor-manifest.sh`、`pnpm run rescope-vendor`。
  - Dependabot（npm / uv / github-actions）。
  - CI 门禁：`check:ci:static`、`check:ci:coverage`、`check:ci:snapshot`、`doc-sync`、`hygiene`。
  - AGENTS.md 标准、`CODEOWNERS` 待补强、分支保护待配置。

## 1. 原则

1. **先地基，后功能**：任何新功能不得在“上游同步机制”和“分支保护”落地前开始。
2. **同步优先**：上游预览期迭代快，同步通道必须每日可用；做不到就暂停其它目标。
3. **标准即门禁**：我们的标准通过 `CODEOWNERS`、`.gitattributes merge=ours`、CI gates 硬保证，不靠自觉。
4. **一切皆插件**：Desktop、Swarm、多语言 ABI 都抽象为 Cordis 插件 / 能力 seam，不进入 agent-loop 内核。
5. **编排留在 TS，计算下沉到 Rust/WASM**：保持与上游的架构兼容性。

## 2. 总体阶段

| 阶段 | 目标 | 主要交付物 | 验收标准 |
|---|---|---|---|
| Phase 0 | 同步地基 | upstream remote、快进、rerere、分支保护、CODEOWNERS | `master == upstream/master`，全门禁绿 |
| Phase 1 | 自动化同步与审批 | `sync-upstream.yml`、`scripts/upstream-sync.mjs`、审批库、vendor 同步半自动化 | 每日自动开 PR；已审批差异自动合入；冲突可重放 |
| Phase 2 | Desktop（Tauri） | `apps/desktop`、`packages/desktop/desktop`、三端打包 | Windows/macOS/Linux 可启动桌面应用并跑通 dsh |
| Phase 3 | Swarm | `packages/swarm/swarm`、`swarm-local`、能力令牌 | 两台机器可通过去中心化网络互操作项目 |
| Phase 4 | 多语言插件 | WASM/Extism ABI、Rust/Go/Python SDK、重写热路径插件 | 一个 Rust 插件从 `.wasm` 加载并过全门禁 |

## 3. Phase 0：同步地基

- [x] `git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git`
- [x] `git fetch upstream master` 并 `git merge --ff-only upstream/master`
- [x] 仓库级开启 `git config rerere.enabled true`、`rerere.autoupdate true`
- [x] 建立分支模型：
  - `master`：我们的主干。
  - `upstream/master`：只读跟踪。
  - `sync/upstream-YYYYMMDD-<sha>`：每次同步 PR 分支。
- [x] GitHub 分支保护：`master` 要求 `check:ci:static`、`check:ci:coverage`、`check:ci:snapshot`（或 `check:ci` 主门禁）通过，禁止直接 push。
- [x] 补 `CODEOWNERS`：`vendor/**`、`packages/core/agent-loop/**`、`AGENTS.md`、`.github/workflows/**` 归我们所有。
- [x] `.gitattributes` 对“必须遵循我们标准”的路径设置 `merge=ours`。

## 4. Phase 1：上游同步与自动化审批

### 4.1 全仓同步 workflow

新建 `.github/workflows/sync-upstream.yml`：

- 触发器：`schedule`（预览期建议每 6 小时一次）+ `workflow_dispatch`。
- 步骤：
  1. checkout（`fetch-depth: 0`，bot token）。
  2. fetch `upstream/master`。
  3. 计算 `git rev-list --count master..upstream/master`；为 0 则退出。
  4. 运行 `scripts/upstream-sync.mjs`：
     - 试合并 `git merge --no-ff --no-commit upstream/master`。
     - 失败则 rerere 重放。
     - 计算每个上游 commit 的 `git patch-id --stable` 与归一化 diff hash。
     - 查询审批库 `.github/upstream-sync/approvals.json`。
     - 全部命中且 CI 绿 → `gh pr merge --auto`。
     - 否则创建 PR，附 commit 清单（已审批 / 新差异 / 冲突文件）。
- 需要的 secret：`SYNC_BOT_TOKEN`（可开 PR、合并、触发 CI）。

### 4.2 审批库

文件：`.github/upstream-sync/approvals.json`。

```jsonc
{
  "version": 1,
  "approved": [
    {
      "patchId": "abc123...",
      "normalizedDiffSha256": "def456...",
      "sourceCommit": "99f6f02...",
      "approvedBy": "chenxu",
      "approvedAt": "2026-08-18T00:00:00Z",
      "scope": "auto-merge",
      "note": "与本地 vendor/cordis 修改等价，已人工确认"
    }
  ]
}
```

规则：

- 命中 `approved` 且能干净合并 → 自动合入（前提：required checks 通过）。
- 未命中 → 开 PR 等待人工 review。
- 人工留下 `@dsh-bot approve <sha>` 或打 `auto-merge` label → bot 写回审批库。
- rerere 缓存通过 `actions/cache` 持久化 `.git/rr-cache`，让一次冲突解法可重放。

### 4.3 Cordis 与安全更新单独成线

- **vendored Cordis 同步**：将 `vendor/README.md` 的 18 条本地修改固化为 `.github/vendor-sync/patches/*.patch`，scheduled workflow 读取 manifest 表 → `git ls-remote` 查上游新 commit → 复制 `src` → `git apply --3way` 重放补丁 → `pnpm run rescope-vendor --apply` → 更新 manifest → `pnpm install && pnpm run test && pnpm run build`。
- **安全更新**：
  - 保留 Dependabot（npm/uv/actions）。
  - 新增 workflow 查 GitHub Advisory API，过滤命中依赖的公告。
  - vendored 包不经过 npm，对 `cordiverse/cordis`、`deepseek-harness/cordis`、`cosmokit`、`schemastery` 单独查安全公告。
- **我们标准的硬保证**：`CODEOWNERS` + `.gitattributes merge=ours` + required checks；不符合标准的同步 PR 不允许合并。

## 5. Phase 2：Desktop（Tauri）

- 新建 `apps/desktop/`：
  - `src/`：复用 `apps/web` 前端。
  - `src-tauri/`：Rust 壳，`externalBin` 打包 `dsh` Node sidecar。
- 新建 `packages/desktop/desktop`：
  - Service Definition：`ctx.desktop`。
  - 能力：文件对话框、托盘、通知、自动启动、深链、系统打开、更新。
  - 非 Tauri 环境提供 no-op 或降级 provider。
- WebView 加载 `http://127.0.0.1:3080` 或直接 serve `apps/web` 产物。
- 打包矩阵：Windows NSIS/MSI、macOS dmg/universal、Linux AppImage/deb/rpm。
- 移动端注意：
  - 桌面端：Tauri 壳 + Node sidecar，完整 dsh。
  - iOS 不允许 Node sidecar，移动端定位为 **swarm 远程客户端 / PWA**，不嵌入 Node。

## 6. Phase 3：Swarm

- 新建 `packages/swarm/swarm`：
  - Service Definition：`ctx.swarm`。
  - 方法：`join`、`publish`、`discover`、`rpc`、`gossip`。
  - 事件：`swarm/peer-joined`、`swarm/peer-left`、`swarm/request`、`swarm/gossip`。
- Provider 路线：
  1. `swarm-local`：mDNS + WebSocket/QUIC，局域网 MVP。
  2. `swarm-libp2p` 或 `swarm-iroh`：公网打洞、中继、DHT 发现。
  3. Tailscale/Headscale 风格控制面作为可选 provider。
- 远程操作模型：
  - 远程节点把 `ctx.fs`、`ctx.subprocess`、`ctx.shell`、`ctx.terminals`、`ctx.lsp`、`ctx.tools` 包装为签名 RPC 服务发布。
  - 安全：Ed25519 身份 + Noise/mTLS + 能力令牌（按项目/目录授权）+ 全操作审计（写 session 事件）。
  - 首次连接配对/审批，之后公钥白名单。
- 与 Desktop 的协同：移动端 / 桌面端都可作为 swarm 客户端，连接任意节点的项目。

## 7. Phase 4：多语言插件与高性能重写

### 7.1 ABI 策略

| 层 | 技术 | 适用 |
|---|---|---|
| WASM 插件 | Extism 或 WASI Preview 2 / Wasmtime + WIT | 任意语言，安全沙箱，跨平台 |
| 进程 sidecar | JSON-RPC/gRPC over stdio/Unix socket | 需要完整系统能力或非 WASM 语言 |
| Node 原生 addon | napi-rs | Rust/C/C++ 热路径 |

- 新建 `packages/extensions/cordis-plugin-foreign`（通用加载器）、`cordis-plugin-wasm`、`cordis-plugin-sidecar`。
- 新建 SDK：`dsh-plugin-rust`、`dsh-plugin-go`、`dsh-plugin-python`。
- 外部插件默认最小权限，通过 host functions 获取受限 `ctx` 能力。

### 7.2 重写候选

| 包 | 重写点 | 方式 |
|---|---|---|
| `packages/fs/fs-local` | glob、hash、大目录遍历 | napi-rs 或 WASM |
| `packages/subprocess/*` | 进程树管理、PTY 缓冲 | napi-rs |
| `packages/session/*` | 事件日志编解码/压缩 | napi-rs 或 WASM |
| `packages/compaction/compaction-basic` | token 计数 / 裁剪 | WASM |
| `packages/sandbox` | 继续强化 `native/landlock-run` | 现有 native 路径 |

**原则**：不重写 Cordis 核心和 agent-loop；把“编排”留在 TypeScript，把“计算/系统密集”下沉到 Rust/WASM。

## 8. 风险与决策

| 风险 | 对策 |
|---|---|
| 上游破坏性变更频繁 | 每 6 小时同步 + rerere + 审批库；同步失败立即告警 |
| 合并冲突集中在本地修改区 | `.gitattributes merge=ours` + 补丁序列化 + 审批库复用 |
| iOS 无法跑 Node sidecar | 移动端定位为 swarm 客户端 / PWA |
| WASM 插件能力受限 | 分层 ABI：WASM 不够时用 sidecar 或 napi-rs |
| 多语言 SDK 维护成本 | 先只提供 Rust SDK + WIT，其它语言用通用 sidecar JSON-RPC |

## 9. 当前进度

1. Phase 0 已完成：upstream、快进、rerere、CODEOWNERS、`.gitattributes merge=ours`、分支保护。
2. Phase 1 最小闭环已完成：`scripts/upstream-sync.mjs` + `.github/workflows/sync-upstream.yml` + `sync/upstream` label + 冲突 issue 路径。
3. Phase 1 剩余：vendor 同步补丁序列化 + 审批库 / 自动合并（按 ROADMAP 第 4 节继续）。
