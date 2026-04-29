# Phase 0: CI / Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that validates every PR with a frontend TypeScript build, a Rust type-check, and Rust tests, and document the project's current security gates in README.md.

**Architecture:** The project has no `.github/` directory today. We create `.github/workflows/ci.yml` with three parallel jobs — `frontend-build`, `rust-check`, and `rust-test` — all running on `ubuntu-latest` using the tools already required by the project (Node 20, the Rust toolchain pinned to `rust-version` in `Cargo.toml`). The README gains a "Release gates" section that honestly lists what is and is not enforced today.

**Tech Stack:** GitHub Actions, Node 20, npm, TypeScript 5.6 (`tsc --noEmit`), Rust 1.77.2 (`cargo check`, `cargo test`), Tauri 2 (build artefacts not produced in CI — only type-level correctness is checked).

---

### Task 1: Create the GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file with exact content**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  frontend-build:
    name: Frontend — build + typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: TypeScript typecheck
        run: npx tsc --noEmit

      - name: Vite build
        run: npm run build
        env:
          # Tauri's vite plugin tries to connect to the Tauri backend during
          # build. Skip the Tauri-specific integration; plain vite build is
          # sufficient to verify the frontend compiles.
          TAURI_SKIP_DEVSERVER_CHECK: "true"

  rust-check:
    name: Rust — cargo check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install system dependencies (Tauri 2 on Linux)
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y --no-install-recommends \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          # Pin to the minimum version declared in Cargo.toml
          toolchain: "1.77.2"

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: "src-tauri -> target"

      - name: cargo check
        run: cargo check --manifest-path src-tauri/Cargo.toml

  rust-test:
    name: Rust — cargo test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install system dependencies (Tauri 2 on Linux)
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y --no-install-recommends \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.77.2"

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: "src-tauri -> target"

      - name: cargo test
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (frontend build, cargo check, cargo test)"
```

---

### Task 2: Update README.md — add "Release gates" section

**Files:**
- Modify: `README.md`

Current state of the section to be replaced (the "Known limitations" section starts at line 38):

```markdown
## Known limitations

This is an early-stage release. Several features are stubbed or in progress:

- **Permission gating is not yet enforced.** Claude runs with `--dangerously-skip-permissions` — the permission UI (banners and modals) is wired but does not currently block tool calls. Do not run against sensitive codebases without reviewing Claude's actions.
- **Search** is not yet implemented.
- **Settings** — only Account and Appearance panes are functional. Other sections are coming.
- **⌘N** opens a new chat. **⌘J** toggles the terminal panel. **⌘T** opens a new terminal tab.
```

- [ ] **Step 1: Insert the "Release gates" section before "Known limitations"**

The new section goes between the `## Build` section and `## Known limitations`. Edit `README.md` to insert the following block (add it after the closing ` ``` ` of the Build section and before `## Known limitations`):

```markdown

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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add release gates and current security posture to README"
```

---

### Task 3: Verify CI passes locally before pushing

- [ ] **Step 1: Run the frontend checks locally**

```bash
cd /path/to/claude-window
npm ci
npx tsc --noEmit
npm run build
```

Expected: exits 0 with no TypeScript errors and a populated `dist/` directory.

- [ ] **Step 2: Run the Rust checks locally**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both exit 0. `cargo test` will print `running 0 tests` — this is correct; it will not fail.

- [ ] **Step 3: Push branch and confirm Actions green**

```bash
git push origin HEAD
```

Open the repository on GitHub → Actions tab → confirm both `frontend-build`, `rust-check`, and `rust-test` jobs show green.

---

## Notes for implementer

**Why `dtolnay/rust-toolchain` instead of `actions-rs/toolchain`?** The `actions-rs` action is archived and unmaintained. `dtolnay/rust-toolchain` is the current community standard and supports `toolchain:` pinning identically.

**Why `TAURI_SKIP_DEVSERVER_CHECK=true`?** The `@tauri-apps/cli` vite plugin, when imported, tries to read the Tauri config and optionally reach the dev server. Setting this env var tells the CLI not to attempt that connection, allowing a plain `vite build` to complete in CI without a running Tauri backend.

**Why no `cargo build --release` in CI?** A full Tauri release build requires the macOS SDK for `.app` bundling and `libssl` variants that differ per platform. The `cargo check` job covers type correctness at a fraction of the time and without platform-specific tooling. A separate release pipeline (not in scope for Phase 0) will handle actual binary artefacts.

**Why Ubuntu and not macOS runners?** macOS GitHub-hosted runners cost 10× more minutes. Since we are only checking types and running unit tests (not producing a macOS app bundle), Ubuntu is correct and fast. Phase 4 will evaluate whether end-to-end tests require a macOS runner.
