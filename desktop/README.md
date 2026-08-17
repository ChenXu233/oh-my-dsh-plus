# dsh-desktop shell (standalone)

Standalone Tauri 2 shell for `oh-my-dsh-plus`. It is intentionally **not** part of the root pnpm workspace yet; the shell must compile and the workspace lockfile must be regenerated before it moves into `apps/desktop`.

## Layout

- `src/` — static frontend fallback. In dev, Tauri loads the dsh web UI from `http://127.0.0.1:3080`.
- `src-tauri/` — Rust shell.
- `src-tauri/capabilities/` — Tauri capability files.

## Dev

```sh
# terminal 1: run the dsh web host from the repo root
pnpm dsh web

# terminal 2: run the desktop shell
cd desktop
npm install
npm run dev
```

## Build

```sh
cd desktop/src-tauri
cargo check

# full bundle (after integration with the dsh web build):
cd desktop
npm run build
```

## Integration plan

1. Keep this scaffold outside the pnpm workspace until `cargo check` passes.
2. Move to `apps/desktop` and add `@deepseek-ai/dsh-desktop` to the workspace lockfile.
3. Add a Cordis `desktop` plugin (`packages/desktop/desktop`) with a `ctx.desktop` service definition.
4. Wire Tauri IPC to the dsh JSON-RPC API and package the Node sidecar.
