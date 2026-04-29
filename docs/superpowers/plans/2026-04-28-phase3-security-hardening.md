# Phase 3: Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six concrete attack surfaces in Claude Workbench — missing CSP, over-broad Tauri permissions, unconstrained file-op paths, plaintext API key storage in profile.json, shell injection in plugin commands, and unchecked `open_path` — without breaking any existing functionality.

**Architecture:** Each fix is isolated to a single surface: config files (`tauri.conf.json`, `capabilities/default.json`) are edited in-place; Rust commands in `src-tauri/src/lib.rs` gain inline path-validation helpers that abort early rather than touch the filesystem; the TypeScript `AccountPane` in `Settings.tsx` drops its API-key input and replaces it with an informational callout; `App.tsx` removes the `apiKey` state variable and its profile load/save paths. No new crates are required; the Tauri v2 plugin permission system covers the capabilities changes.

**Tech Stack:** Tauri 2, Rust, JSON (capabilities), TypeScript

---

### Task 1: Add strict Content Security Policy to `tauri.conf.json`

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Why:** `"csp": null` means any injected script or rogue `<script>` tag runs unchecked. The strict policy below allows exactly what the app needs and blocks everything else.

- [ ] **Step 1: Replace the `"csp": null` value**

In `src-tauri/tauri.conf.json`, replace:

```json
    "security": {
      "csp": null
    }
```

with:

```json
    "security": {
      "csp": "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost"
    }
```

Full updated `src-tauri/tauri.conf.json` after change:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Claude Workbench",
  "version": "0.42.1",
  "identifier": "com.claude.workbench",
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Claude Workbench",
        "width": 1440,
        "height": 900,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "decorations": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  }
}
```

**CSP rationale (directive by directive):**

| Directive | Value | Reason |
|---|---|---|
| `default-src` | `'self'` | Catch-all fallback: deny unlisted resource types |
| `script-src` | `'self' blob:` | xterm.js spawns WebGL workers via `blob:` URLs; no remote scripts |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind and inline `style={}` props require `'unsafe-inline'`; `nonce`-based CSP is not feasible with React/Vite without a build-time nonce pipeline |
| `img-src` | `'self' data: blob:` | Inline base64 avatars (`data:`) and blob attachment previews |
| `connect-src` | `'self' ipc: http://ipc.localhost` | Tauri IPC bridge uses both `ipc:` and `http://ipc.localhost` on macOS |

- [ ] **Step 2: Verify build still passes**

```bash
cd src-tauri && cargo check
npm run build
```

If xterm.js or any other WebWorker breaks in dev mode (`npm run dev`), check the browser console for CSP violations. The `blob:` in `script-src` covers the common xterm.js WebGL worker pattern. If violations appear for a specific source, add the minimal required allowance rather than widening to `'unsafe-eval'`.

**Commit:** `security: enforce strict CSP in tauri.conf.json`

---

### Task 2: Tighten Tauri capability permissions

**Files:**
- Modify: `src-tauri/capabilities/default.json`

**Why:** `fs:default` grants read/write to the entire filesystem via the Tauri FS plugin API surface. `shell:default` + `shell:allow-execute` allow the frontend to execute arbitrary shell commands via `@tauri-apps/plugin-shell`. The app's own Rust commands handle all file and shell operations; the JS-side plugin APIs are not used by any frontend code, so these grants can be dropped.

> **Note on Tauri v2 permission identifiers:** The exact permission identifiers for scoped FS access (e.g. `fs:allow-read-home`, `fs:allow-write-appdata`) depend on the version of `tauri-plugin-fs` in use and may differ from the names shown here. Before committing, verify available permissions with:
> ```bash
> cat src-tauri/gen/schemas/acl-manifests.json | python3 -m json.tool | grep '"identifier"' | grep -E 'fs:|shell:'
> ```
> Adjust the identifiers in the JSON below to match whatever that command returns. If no scoped fs identifiers exist, remove `"fs:default"` entirely (the Rust commands use `std::fs` directly, not the Tauri FS plugin).

- [ ] **Step 1: Replace the permissions array**

Replace the full contents of `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
}
```

**Explanation of removals:**

- `"fs:default"` — removed. The frontend never calls `@tauri-apps/plugin-fs` directly. All file I/O goes through the custom Rust commands (`read_file`, `write_file`, `list_dir`, `list_project_files`) which use `std::fs` and will gain path constraints in Task 3.
- `"shell:default"` and `"shell:allow-execute"` — removed. The frontend never calls `@tauri-apps/plugin-shell` directly. All shell execution (git, claude CLI, plugin commands) happens inside Rust commands using `std::process::Command` and `tokio::process::Command`. Removing these permissions closes the JS-side arbitrary command execution surface entirely.
- `"opener:default"` — kept. Used by `tauri-plugin-opener` which backs the `open_path` command's internal implementation path (macOS `open`, Linux `xdg-open`). Kept because `opener::init()` is registered in `lib.rs`.
- `"dialog:default"` — kept. Used by `choose_directory` which calls `app.dialog().file().pick_folder(...)`.

- [ ] **Step 2: Verify build still passes**

```bash
cd src-tauri && cargo check
npm run build
```

Run the app and confirm: directory picker works, file tree loads, the agent runs. If any JS code was silently using the plugin APIs, a runtime error will appear in the dev console — fix by routing through the Rust command layer instead.

**Commit:** `security: drop fs:default and shell permissions from capabilities`

---

### Task 3: Add path constraints to `read_file`, `write_file`, and `list_dir`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Why:** `read_file` has no path constraint — it will return any file on disk. `write_file` constrains to `$HOME` which is too broad (the whole home directory). `list_dir` has no constraint at all. All three should be limited to the active project directory or `~/.workbench`.

**Approach:** Add a `fn is_allowed_path(p: &Path) -> bool` helper that checks the resolved canonical path against an allowed-roots list. Both the project path (passed by the caller) and `~/.workbench` are always allowed roots. Rather than changing command signatures (which would require frontend changes), the existing `base_path` / `path` parameters supply the project root; a separate `allowed_roots` parameter is added to `read_file` and `write_file` and made optional (defaults to project dir only).

The cleanest solution that requires no frontend changes is: add a module-level helper that accepts the resolved path plus the `base_path` argument, and uses `base_path` as the allowed project root. `~/.workbench` is always allowed as a second root. `read_file` already receives `base_path: Option<String>` and resolves relative paths against it — we extend that to also validate the resolved absolute path.

- [ ] **Step 1: Add `is_path_allowed` helper function**

In `src-tauri/src/lib.rs`, immediately after the `shell_escape` function (around line 1149), add the following helper:

```rust
/// Returns `true` if `candidate` (already canonicalized or best-effort resolved)
/// falls inside one of the `allowed_roots`.  Both `candidate` and each root are
/// compared as byte-prefix strings with a trailing-separator guard so that
/// `/home/user/proj-extra` is NOT inside `/home/user/proj`.
fn is_path_allowed(candidate: &Path, allowed_roots: &[std::path::PathBuf]) -> bool {
    for root in allowed_roots {
        // Use starts_with from std::path::Path, which does component-level
        // prefix matching (no trailing-slash confusion).
        if candidate.starts_with(root) {
            return true;
        }
    }
    false
}

/// Build the two always-allowed roots: the project/base dir and `~/.workbench`.
fn allowed_roots(base_path: Option<&str>) -> Vec<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();

    if let Some(base) = base_path {
        let p = std::path::PathBuf::from(base);
        // Try to canonicalize; if the dir doesn't exist yet, use as-is.
        roots.push(p.canonicalize().unwrap_or(p));
    }

    if let Ok(home) = std::env::var("HOME") {
        let wb = Path::new(&home).join(".workbench");
        roots.push(wb.canonicalize().unwrap_or_else(|_| Path::new(&home).join(".workbench")));
    }

    roots
}
```

- [ ] **Step 2: Add path check to `read_file`**

Replace the existing `read_file` function (lines 882–924) with:

```rust
#[tauri::command]
async fn read_file(path: String, base_path: Option<String>) -> Result<FilePreview, String> {
    const MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MB cap

    let resolved: std::path::PathBuf = if Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(ref base) = base_path {
        Path::new(base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    // Canonicalize to resolve symlinks and `..` traversals before the
    // allow-list check.  If the file doesn't exist yet, fall back to the
    // non-canonicalized path (the metadata call below will fail with a
    // clear "file not found" error in that case).
    let canonical = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());

    let roots = allowed_roots(base_path.as_deref());
    if !is_path_allowed(&canonical, &roots) {
        return Err(format!(
            "read_file: path '{}' is outside allowed directories",
            resolved.display()
        ));
    }

    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("stat {}: {e}", resolved.display()))?;
    let size = meta.len();

    let bytes_to_read = std::cmp::min(size, MAX_BYTES) as usize;
    let mut buf = vec![0u8; bytes_to_read];
    use std::io::Read;
    let mut f = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;

    // Heuristic: if the chunk has any NUL bytes treat as binary.
    let binary = buf.contains(&0u8);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&buf).to_string()
    };

    let language = resolved.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    Ok(FilePreview {
        path: resolved.to_string_lossy().to_string(),
        content,
        language,
        size_bytes: size,
        truncated: size > MAX_BYTES,
        binary,
    })
}
```

- [ ] **Step 3: Add path check to `write_file`**

Replace the existing `write_file` function (lines 1097–1117) with:

```rust
#[tauri::command]
async fn write_file(path: String, content: String, base_path: Option<String>) -> Result<(), String> {
    let resolved: std::path::PathBuf = if std::path::Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(ref base) = base_path {
        std::path::Path::new(base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    // For the allow-list check we canonicalize the parent directory (which
    // must exist) and re-join the file name, because the file itself may not
    // exist yet.
    let canonical = if resolved.exists() {
        resolved.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = resolved.parent()
            .ok_or_else(|| "write_file: path has no parent directory".to_string())?;
        let canon_parent = parent.canonicalize()
            .map_err(|e| format!("write_file: cannot canonicalize parent '{}': {e}", parent.display()))?;
        canon_parent.join(resolved.file_name().ok_or("write_file: path has no file name")?)
    };

    let roots = allowed_roots(base_path.as_deref());
    if !is_path_allowed(&canonical, &roots) {
        return Err(format!(
            "write_file: path '{}' is outside allowed directories",
            resolved.display()
        ));
    }

    let tmp = resolved.with_extension("tmp.wb");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &resolved).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Add path check to `list_dir`**

`list_dir` currently takes only a `path: String` with no base path, so the only allowed root derivable from the call is the path itself — which is circular. The right fix is to add an optional `base_path` parameter so the caller can declare the project root. The `FilesTab.tsx` caller already passes `basePath` as a prop; it just doesn't forward it to `list_dir`.

Replace the existing `list_dir` function (lines 1071–1095) with:

```rust
#[tauri::command]
async fn list_dir(path: String, base_path: Option<String>) -> Result<Vec<DirEntry>, String> {
    const SKIP: &[&str] = &[
        ".git", "node_modules", "target", "dist", "build",
        ".next", ".nuxt", ".cache", ".turbo", ".vite",
        "__pycache__", ".venv", "venv", ".worktrees",
    ];

    let resolved = std::path::PathBuf::from(&path);
    let canonical = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());

    let roots = allowed_roots(base_path.as_deref());
    if !is_path_allowed(&canonical, &roots) {
        return Err(format!(
            "list_dir: path '{}' is outside allowed directories",
            resolved.display()
        ));
    }

    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if SKIP.iter().any(|s| *s == name) { continue; }
        let meta = match ent.metadata() { Ok(m) => m, Err(_) => continue };
        entries.push(DirEntry {
            name: name.clone(),
            path: ent.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });
    Ok(entries)
}
```

- [ ] **Step 5: Update `FilesTab.tsx` to pass `basePath` to `list_dir`**

In `src/components/FilesTab.tsx`, in the `loadDir` callback (line 62–73), add `basePath` to the invoke call:

Replace:
```typescript
  const loadDir = useCallback(async (path: string) => {
    try {
      const result = await invoke<DirEntry[]>('list_dir', { path });
```

With:
```typescript
  const loadDir = useCallback(async (path: string) => {
    try {
      const result = await invoke<DirEntry[]>('list_dir', { path, basePath });
```

The `basePath` prop is already available in scope (it is in the `Props` interface and destructured in the function signature on line 49).

- [ ] **Step 6: Verify build still passes**

```bash
cd src-tauri && cargo check
npm run build
```

Open the app, navigate to the Files tab, confirm the file tree loads. Click a file to confirm `read_file` works. Edit and save a file to confirm `write_file` works. Attempt to open a path outside the project (e.g. `/etc/hosts`) from the dev console — it should be rejected with the "outside allowed directories" error.

**Commit:** `security: constrain read_file, write_file, list_dir to project + ~/.workbench`

---

### Task 4: Strip `apiKey` from `profile.json` — backend

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Why:** The API key is stored as plaintext JSON in `~/.workbench/profile.json`. The Claude CLI manages its own auth independently (via `~/.claude/` config); the app does not need to pass `ANTHROPIC_API_KEY` explicitly. The field should be silently dropped on save and migrated out (not re-persisted) on load.

- [ ] **Step 1: Update `save_profile` to strip `apiKey` before writing**

Replace the existing `save_profile` function (lines 466–472) with:

```rust
#[tauri::command]
async fn save_profile(data: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Strip the apiKey field before persisting.  The Claude CLI manages its
    // own authentication; we must not store the key as plaintext JSON.
    let cleaned: String = match serde_json::from_str::<serde_json::Map<String, Value>>(&data) {
        Ok(mut map) => {
            if map.remove("apiKey").is_some() {
                eprintln!("[workbench] save_profile: stripped apiKey from profile (use Claude CLI auth instead)");
            }
            serde_json::to_string(&map).unwrap_or(data)
        }
        Err(_) => data, // not valid JSON — write as-is; load_profile will handle it
    };

    std::fs::write(dir.join("profile.json"), cleaned).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Update `load_profile` to migrate out `apiKey` if found**

Replace the existing `load_profile` function (lines 483–491) with:

```rust
#[tauri::command]
async fn load_profile() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".workbench").join("profile.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s)  => s,
        Err(_) => return Ok(None),
    };

    // If the stored JSON still contains apiKey (from a previous version of the
    // app), strip it from the returned value so the frontend never receives it.
    // We do NOT rewrite the file here to avoid a write on every startup;
    // the next save_profile call will persist the clean version.
    let cleaned = match serde_json::from_str::<serde_json::Map<String, Value>>(&raw) {
        Ok(mut map) => {
            if map.remove("apiKey").is_some() {
                eprintln!("[workbench] load_profile: found apiKey in profile.json — stripping from response. It will be removed on next save.");
            }
            serde_json::to_string(&map).unwrap_or(raw)
        }
        Err(_) => raw,
    };

    Ok(Some(cleaned))
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd src-tauri && cargo check
```

**Commit:** `security: strip apiKey from profile.json on load and save`

---

### Task 5: Remove `apiKey` state from the frontend

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Settings.tsx`

**Why:** `App.tsx` currently loads `profile.apiKey` into React state and re-passes it on onboarding completion. Since the backend now strips the field, these code paths become dead. Leaving them in place is confusing and risks them being re-wired in the future.

- [ ] **Step 1: Remove `apiKey` state and all references from `App.tsx`**

In `src/App.tsx`:

**Remove** the state declaration (line 211):
```typescript
  const [apiKey, setApiKey] = useState('');
```

**Remove** the profile load line that sets it (line 264):
```typescript
            if (profile.apiKey) setApiKey(profile.apiKey);
```

**Remove** the onboarding completion line that sets it (line 1224):
```typescript
                if (p.apiKey) setApiKey(p.apiKey);
```

After removing those three lines, do a project-wide search to confirm `apiKey` and `setApiKey` have no remaining references:
```bash
grep -rn "apiKey\|setApiKey" src/
```
The output should be empty (or only appear in comments).

- [ ] **Step 2: Replace the API Key section in `Settings.tsx` `AccountPane`**

In `src/components/Settings.tsx`, the `AccountPane` function currently renders an API key input field (lines 63–257 of the component). Replace it with a read-only informational section.

Replace the entire `AccountPane` function with:

```typescript
function AccountPane() {
  async function handleSignOut() {
    try {
      await invoke('save_profile', { data: JSON.stringify({}) });
    } catch {
      // ignore
    }
    window.location.reload();
  }

  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        Account
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-dim)',
          marginBottom: 32,
        }}
      >
        Your Anthropic identity, billing, and team membership.
      </p>

      {/* Plan */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          Plan
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              background: 'var(--accent)',
              borderRadius: 6,
              padding: '6px 10px',
            }}
          >
            Pro
          </span>
          <a
            href="https://claude.ai"
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            claude.ai
          </a>
        </div>
      </section>

      {/* API Key — informational only */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          API Key
        </div>
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 16px',
            maxWidth: 480,
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--text-dim)',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            API key: managed by environment or Claude CLI config.
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-mute)',
              margin: '8px 0 0 0',
            }}
          >
            Run <code>claude auth login</code> in your terminal to authenticate.
          </p>
        </div>
      </section>

      {/* Danger zone */}
      <section>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--red)',
            marginBottom: 10,
          }}
        >
          Danger zone
        </div>
        <button
          onClick={handleSignOut}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--red)',
            background: 'transparent',
            border: '1px solid var(--red)',
            borderRadius: 8,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-bg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
```

Also remove the now-unused `useState` import line **only if** `useState` has no other uses in `Settings.tsx`. Check first:
```bash
grep -c "useState" src/components/Settings.tsx
```
If the count drops to 1 (the `AppearancePane` still uses it for `state`), leave the import. If it drops to 0, remove it.

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Open Settings > Account and confirm the API key input is gone and the informational callout is shown.

**Commit:** `security: remove apiKey from frontend state and Settings UI`

---

### Task 6: Fix shell injection in `install_plugin` and `uninstall_plugin`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Why:** `install_plugin(name, marketplace)` builds `arg = "{name}@{marketplace}"` and passes it through `shell_escape`, but `shell_escape` single-quote-escapes the combined string. The individual `name` and `marketplace` components are not validated before concatenation. A name like `foo'; rm -rf ~; echo '` would produce a string that, after `shell_escape`, becomes `'foo'\'''; rm -rf ~; echo '\'''`. While `shell_escape` closes off the immediate injection, the `@marketplace` part makes the regex pattern for the combined arg complex. The safer and simpler fix is to validate `name` and `marketplace` individually against a strict allowlist regex before any string building.

- [ ] **Step 1: Add `validate_plugin_name` helper**

In `src-tauri/src/lib.rs`, immediately after the `shell_escape` function, add:

```rust
/// Validates that a plugin name or marketplace identifier contains only
/// safe characters.  Allowed: ASCII letters, digits, hyphens, underscores,
/// and dots (dots cover scoped names like `@scope/pkg` would need `@` and `/`
/// but the current claude plugin system uses simple names).
/// Rejects empty strings and anything containing shell-special characters.
fn validate_plugin_component(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("plugin name/marketplace must not be empty".to_string());
    }
    let valid = s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !valid {
        return Err(format!(
            "invalid plugin name/marketplace '{}': only [a-zA-Z0-9._-] are allowed",
            s
        ));
    }
    Ok(())
}
```

- [ ] **Step 2: Add validation to `install_plugin`**

Replace the existing `install_plugin` function (lines 802–819) with:

```rust
/// Run `claude plugin install <name>@<marketplace>` and return combined output.
#[tauri::command]
async fn install_plugin(name: String, marketplace: String) -> Result<String, String> {
    validate_plugin_component(&name)?;
    if !marketplace.is_empty() {
        validate_plugin_component(&marketplace)?;
    }

    let arg = if marketplace.is_empty() {
        name
    } else {
        format!("{name}@{marketplace}")
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("claude plugin install {} 2>&1", shell_escape(&arg))])
        .output()
        .map_err(|e| e.to_string())?;
    let combined = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(if combined.trim().is_empty() {
            "claude plugin install failed".to_string()
        } else {
            combined
        });
    }
    Ok(combined)
}
```

- [ ] **Step 3: Add validation to `uninstall_plugin`**

Replace the existing `uninstall_plugin` function (lines 821–838) with:

```rust
#[tauri::command]
async fn uninstall_plugin(name: String, marketplace: String) -> Result<String, String> {
    validate_plugin_component(&name)?;
    if !marketplace.is_empty() {
        validate_plugin_component(&marketplace)?;
    }

    let arg = if marketplace.is_empty() {
        name
    } else {
        format!("{name}@{marketplace}")
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("claude plugin uninstall {} 2>&1", shell_escape(&arg))])
        .output()
        .map_err(|e| e.to_string())?;
    let combined = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(if combined.trim().is_empty() {
            "claude plugin uninstall failed".to_string()
        } else {
            combined
        });
    }
    Ok(combined)
}
```

- [ ] **Step 4: Verify build passes**

```bash
cd src-tauri && cargo check
```

**Commit:** `security: validate plugin name/marketplace before shell interpolation`

---

### Task 7: Add path constraint to `open_path`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Why:** `open_path` resolves relative paths against `base_path` but performs no further validation. A constructed absolute path (e.g. `/etc/passwd`) is passed directly to `open` / `xdg-open`. While the OS will just open the file in a viewer, combined with a path-traversal in a future bug this becomes exploitable. The fix allows opening only paths inside the project directory or `~/.workbench`, OR paths with a safe file extension regardless of location (for cases where the project path is not known at call time, such as clicking links in agent output).

The current callers in `Conversation.tsx` always pass `basePath: cwd` which is the project worktree path. That makes the project-root check work for all real call sites.

- [ ] **Step 1: Define the safe extension allowlist and replace `open_path`**

Replace the existing `open_path` function (lines 845–868) with:

```rust
/// File extensions that are safe to open in the OS default handler regardless
/// of directory.  This covers image/document types that cannot execute code.
const SAFE_OPEN_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff",
    "pdf",
    "txt", "md", "markdown", "rst", "log",
    "csv", "json", "toml", "yaml", "yml", "xml",
    "html", "htm",
];

/// Open `path` in the OS-default handler. Used to make tool-call file paths
/// clickable (e.g. opens the file in the user's default editor).
/// Resolves relative paths against `base_path` if provided.
///
/// Security: only opens paths that are either (a) inside the project dir or
/// ~/.workbench, or (b) have a known-safe file extension.
#[tauri::command]
async fn open_path(path: String, base_path: Option<String>) -> Result<(), String> {
    let resolved = if Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(ref base) = base_path {
        Path::new(base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    // Check 1: is it inside an allowed root?
    let canonical = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());
    let roots = allowed_roots(base_path.as_deref());
    let in_allowed_root = is_path_allowed(&canonical, &roots);

    // Check 2: does it have a safe extension?
    let ext = resolved.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let safe_ext = SAFE_OPEN_EXTENSIONS.contains(&ext.as_str());

    if !in_allowed_root && !safe_ext {
        return Err(format!(
            "open_path: '{}' is outside allowed directories and has no safe extension",
            resolved.display()
        ));
    }

    let p = resolved.to_string_lossy().to_string();
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&p).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", &p]).status()
    } else {
        std::process::Command::new("xdg-open").arg(&p).status()
    };
    match result {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("open failed with exit code {}", s.code().unwrap_or(-1))),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd src-tauri && cargo check
npm run build
```

In the app, Cmd-click a file path in agent output — it should open. Attempt to open `/etc/hosts` from the browser console: `window.__TAURI__.core.invoke('open_path', { path: '/etc/hosts' })` — it should be rejected.

**Commit:** `security: constrain open_path to project dir or safe extensions`

---

### Task 8: Final integration check

**Files:** none changed

- [ ] **Step 1: Full build verification**

```bash
cd /path/to/claude-window
npm run build
cd src-tauri && cargo check
```

Both must pass with zero errors and zero new warnings introduced by this work.

- [ ] **Step 2: Manual smoke test checklist**

Run `npm run tauri dev` and verify:

1. **CSP**: Open DevTools. No CSP violation errors in the Console. The app loads fully (xterm.js terminal works, Tailwind styles apply).
2. **File tree**: Files tab shows project files. Nested directories expand. No errors in the console.
3. **File editor**: Click a file in the Files tab to open it. Edit text and click Save. Confirm the change persists.
4. **Agent**: Start a task. Verify the agent runs and produces output. Confirm tool events appear.
5. **Plugin page**: Navigate to the MCP & plugins section. Installing/uninstalling a plugin with a valid name succeeds. Attempt a name with a semicolon (`;`) — confirm it is rejected with "invalid plugin name" error.
6. **open_path**: Cmd-click a file path link in agent output — file opens in the OS default app. Attempt to open `/etc/hosts` via the dev console — confirm it is rejected.
7. **Settings > Account**: The API key input field is gone. The "managed by environment or Claude CLI config" callout is shown. Sign out button still works.
8. **profile.json**: After saving any setting, inspect `~/.workbench/profile.json` — confirm no `apiKey` field is present.

- [ ] **Step 3: Confirm no `ANTHROPIC_API_KEY` env var is injected by the app**

```bash
grep -rn "ANTHROPIC_API_KEY\|apiKey" src-tauri/src/lib.rs src/App.tsx src/components/Settings.tsx
```

The only remaining matches should be the `eprintln!` log messages in `save_profile` / `load_profile` (Task 4), and the migration-removal comments. No code path should set `ANTHROPIC_API_KEY` in the environment.

**Commit:** `security: Phase 3 integration verified — no further changes`

---

## Summary of changes

| # | File | Change |
|---|------|--------|
| 1 | `src-tauri/tauri.conf.json` | `"csp": null` → strict CSP string |
| 2 | `src-tauri/capabilities/default.json` | Remove `fs:default`, `shell:default`, `shell:allow-execute` |
| 3 | `src-tauri/src/lib.rs` | Add `is_path_allowed` + `allowed_roots` helpers; constrain `read_file`, `write_file`, `list_dir` |
| 4 | `src-tauri/src/lib.rs` | `save_profile` strips `apiKey`; `load_profile` migrates it out |
| 5 | `src/App.tsx` + `src/components/Settings.tsx` | Remove `apiKey` state; replace API key input with informational callout |
| 6 | `src-tauri/src/lib.rs` | Add `validate_plugin_component` helper; validate `install_plugin` + `uninstall_plugin` args |
| 7 | `src-tauri/src/lib.rs` | Add `SAFE_OPEN_EXTENSIONS` allowlist; constrain `open_path` |
| 8 | `src/components/FilesTab.tsx` | Pass `basePath` to `list_dir` invoke call |
