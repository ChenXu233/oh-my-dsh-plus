// Placeholder frontend for the standalone Tauri shell.
// In dev, tauri.conf.json points at the dsh web UI (http://127.0.0.1:3080),
// so this file is only used for the static fallback build.
const status = document.getElementById('status')
if (status) {
  status.textContent = `Tauri shell loaded at ${new Date().toISOString()}.`
}
