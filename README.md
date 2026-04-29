# Claude Workbench

A native desktop app for running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as a persistent, multi-session agent — built with Tauri 2, React, and Rust.

![Claude Workbench](docs/screenshot.png)

## What it does

- **Multiple concurrent sessions** — run Claude against several projects simultaneously, each with its own conversation, file diff, and terminal
- **Session rail** — live status per session: what tool is running, streaming indicator, working/review/awaiting states
- **Right-side panel** — file browser, diff viewer, and inline file editor
- **Terminal** — integrated PTY terminal per session
- **Automations** — saved prompts that can be run on demand against any project
- **Token usage footer** — context window %, input/output/cache counts per session

## Requirements

- macOS 13+ (Tauri 2 / WebKit)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code` then `claude`)
- Rust toolchain (`rustup`) + Node.js 18+

## Build

```bash
# Install JS dependencies
npm install

# Run in development
npm run tauri dev

# Build a release app bundle
npm run tauri build
```

## Release gates

Every pull request must pass the CI workflow (`.github/workflows/ci.yml`) before merge. The checks are:

| Gate | What it verifies |
|---|---|
| `tsc --noEmit` | TypeScript compiles with no type errors under `strict: true` |
| `npm run build` | Vite produces a clean frontend bundle (no missing imports, no build-time errors) |
| `cargo check` | All Rust crates type-check; no missing dependencies |
| `cargo test` | All Rust unit tests pass (currently zero tests; new tests added in Phase 4) |

**What CI does NOT cover yet (known gaps):**

- No frontend unit tests — Vitest/RTL added in Phase 4.
- No end-to-end tests — Tauri's desktop window cannot be driven headlessly in GitHub Actions without additional infrastructure.
- No release build (`tauri build`) in CI — the Tauri bundler requires macOS code-signing credentials not available in the shared runner.
- No `cargo clippy` lint enforcement — added in Phase 4 once the codebase is stable.

**Current security posture (as of this baseline):**

- **Worktree isolation: NOT enforced.** Claude runs directly in the project root. The `create_worktree` / `remove_worktree` commands exist in Rust but are not called automatically on task start. Implemented in Phase 1.
- **Permission gating: NOT enforced.** Claude Code is launched with `--dangerously-skip-permissions`; the permission UI is wired to emit events but does not pause execution or block tool calls. Implemented in Phase 2.
- **Path security: PARTIAL.** `write_file` rejects paths outside `$HOME` via `canonicalize()` + `starts_with(home)`. `read_file` and `open_path` have no equivalent guard. Tightened in Phase 3.
- **CSP: DISABLED.** `tauri.conf.json` sets `"csp": null`. A strict policy is added in Phase 3.
- **API key storage: NOT hardened.** The Anthropic key is read from the environment / Claude Code CLI config; it is not stored in the OS keychain by this app. Addressed in Phase 3.

## Known limitations

This is an early-stage release. Several features are stubbed or in progress:

- **Permission gating is not yet enforced.** Claude runs with `--dangerously-skip-permissions` — the permission UI (banners and modals) is wired but does not currently block tool calls. Do not run against sensitive codebases without reviewing Claude's actions.
- **Search** is not yet implemented.
- **Settings** — only Account and Appearance panes are functional. Other sections are coming.
- **⌘N** opens a new chat. **⌘J** toggles the terminal panel. **⌘T** opens a new terminal tab.

## Data stored locally

All data is stored in `~/.workbench/`:

| File | Contents |
|---|---|
| `profile.json` | Project list, layout preferences |
| `sessions.json` | Conversation history, diffs, terminal state |
| `automations.json` | Saved automation prompts |

## License

MIT — see [LICENSE](LICENSE).
