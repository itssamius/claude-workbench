# Phase 5: UI Truthfulness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every claim in the UI true: appearance changes apply instantly (not only on Save), persistence loads from disk on startup, Account copy accurately reflects how the API key is managed, Search is visibly disabled, and runtime errors surface as dismissible banners instead of silently going to `console.error`.

**Architecture:** Theming is already driven by `data-theme` on `<html>` and `--accent` on `:root` (see `src/index.css`); the `AppearancePane` in `Settings.tsx` only needs to call `document.documentElement.setAttribute` on every control change rather than waiting for Save. A new `load_appearance` Rust command mirrors `save_appearance` and is called at the end of the existing startup `useEffect` in `App.tsx`, applying tokens before the first paint. Error visibility is handled by adding an `errorBanners` prop to `Conversation` (following the identical pattern of `permissionBanners`) and threading a dismissible `<AppErrorBanner>` component from `App.tsx`. No new dependencies are added.

**Tech Stack:** Tauri 2, React 18, TypeScript, CSS custom properties

---

### Task 1: Appearance — apply changes to the DOM instantly on control change

**Files:**
- Modify: `src/components/Settings.tsx`

**Why:** The subtitle text already promises "Changes apply instantly." but right now the theme/density/accent only take effect when the user clicks "Save preferences". This task wires each control's `update()` call to also push the new values into the live DOM immediately.

**Key facts from reading the code:**
- `[data-theme="dark"]` selector on `src/index.css:51` drives the dark palette. Light mode is the default `:root`, so removing the attribute restores light.
- `[data-density="compact"]` on `src/index.css:65` shrinks the spacing unit. No `data-density` attribute = comfortable. There is no `spacious` CSS rule yet — adding the attribute with value `spacious` is harmless.
- `--accent` is a CSS custom property on `:root` (`src/index.css:21`). Setting it via `document.documentElement.style.setProperty` overrides the root value.

- [ ] **Step 1: Add `applyAppearanceToDom` helper and call it on every `update()`**

In `src/components/Settings.tsx`, replace the `AppearancePane` component:

```tsx
function applyAppearanceToDom(state: AppearanceState) {
  const root = document.documentElement;

  // Theme: add data-theme="dark" or remove for light; system follows OS
  if (state.theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (state.theme === 'light') {
    root.removeAttribute('data-theme');
  } else {
    // system: match prefers-color-scheme
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }

  // Density: set or remove data-density attribute
  if (state.density === 'comfortable') {
    root.removeAttribute('data-density');
  } else {
    root.setAttribute('data-density', state.density);
  }

  // Accent: override the CSS custom property inline
  root.style.setProperty('--accent', state.accent);
}

function AppearancePane() {
  const [state, setState] = useState<AppearanceState>(loadAppearance);

  // Apply current saved state on mount so the pane reflects reality
  useEffect(() => {
    applyAppearanceToDom(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch: Partial<AppearanceState>) {
    const next = { ...state, ...patch };
    setState(next);
    applyAppearanceToDom(next);
  }

  async function handleSave() {
    await saveAppearance(state);
  }

  // ... rest of JSX unchanged
```

The `THEME_CARDS`, `Density` segment picker, and `Accent color` swatch buttons all call `update(...)` — they need no other changes; `update` now both sets state AND calls `applyAppearanceToDom`.

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` — should produce zero errors.

**Commit:** `feat(settings): apply appearance changes to DOM instantly on control change`

---

### Task 2: Rust — add `load_appearance` command

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Why:** `save_appearance` writes `~/.workbench/appearance.json` but there is no Rust command to read it back. Without this, the file is written but never loaded, so appearance resets every launch.

- [ ] **Step 1: Add `load_appearance` function after `save_appearance`**

In `src-tauri/src/lib.rs`, insert the following immediately after the closing `}` of `save_appearance` (currently at line 481):

```rust
#[tauri::command]
async fn load_appearance() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".workbench").join("appearance.json");
    match std::fs::read_to_string(&path) {
        Ok(s)  => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}
```

- [ ] **Step 2: Register `load_appearance` in the Tauri builder**

In `src-tauri/src/lib.rs`, find the `.invoke_handler(tauri::generate_handler![` block (around line 1165). It currently lists `save_appearance`. Add `load_appearance` to that list:

```rust
            save_appearance,
            load_appearance,
```

- [ ] **Step 3: Verify**

Run `cargo build` (or `cargo check`) in `src-tauri/` — should compile without errors.

**Commit:** `feat(rust): add load_appearance Tauri command`

---

### Task 3: Frontend — load appearance from disk on startup, apply before first paint

**Files:**
- Modify: `src/App.tsx`

**Why:** `App.tsx` loads profile on startup (the `useEffect` at line 257) but never calls `load_appearance`. This means every launch starts with the default light/comfortable/teal theme regardless of what the user saved. We also need to export `applyAppearanceToDom` from `Settings.tsx` (or duplicate a small inline version) so `App.tsx` can call it.

**Key facts from reading the code:**
- `loadAppearance()` in `Settings.tsx` (line 41) reads from `localStorage` as a fallback, but the canonical source of truth after Phase 2/3 is `~/.workbench/appearance.json` via the new `load_appearance` Tauri command.
- The startup `useEffect` in `App.tsx` (line 257) resolves `onboardingDone`. Appearance should load regardless of onboarding state so the flash is avoided even on first run.
- `applyAppearanceToDom` is defined in `Settings.tsx` in Task 1. We will move it to a shared util file to avoid a circular import.

- [ ] **Step 1: Move `applyAppearanceToDom` to a shared utility**

Create `src/utils/appearance.ts` with:

```ts
export interface AppearanceState {
  theme: 'light' | 'dark' | 'system';
  density: 'compact' | 'comfortable' | 'spacious';
  accent: string;
}

export const DEFAULT_APPEARANCE: AppearanceState = {
  theme: 'light',
  density: 'comfortable',
  accent: '#2d6b5d',
};

export function applyAppearanceToDom(state: AppearanceState): void {
  const root = document.documentElement;

  if (state.theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (state.theme === 'light') {
    root.removeAttribute('data-theme');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }

  if (state.density === 'comfortable') {
    root.removeAttribute('data-density');
  } else {
    root.setAttribute('data-density', state.density);
  }

  root.style.setProperty('--accent', state.accent);
}
```

- [ ] **Step 2: Update `Settings.tsx` to import from the shared util**

In `src/components/Settings.tsx`:

Remove the local `AppearanceState` interface definition and the local `applyAppearanceToDom` function added in Task 1. Replace with imports:

```ts
import { applyAppearanceToDom, DEFAULT_APPEARANCE } from '../utils/appearance';
import type { AppearanceState } from '../utils/appearance';
```

Also update the `loadAppearance()` function's fallback return to use `DEFAULT_APPEARANCE`:

```ts
function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem('workbench-appearance');
    if (raw) return JSON.parse(raw) as AppearanceState;
  } catch {
    // ignore
  }
  return { ...DEFAULT_APPEARANCE };
}
```

Remove the local `type Theme = ...`, `type Density = ...`, and `interface AppearanceState { ... }` declarations from `Settings.tsx` since they are now imported.

- [ ] **Step 3: Add appearance loading to `App.tsx` startup**

In `src/App.tsx`, add the import at the top:

```ts
import { applyAppearanceToDom, DEFAULT_APPEARANCE } from './utils/appearance';
import type { AppearanceState } from './utils/appearance';
```

Then add a second `useEffect` (after imports, alongside the existing profile-load effect) that runs once on mount, independent of `onboardingDone`:

```ts
// ── Load appearance on startup (independent of onboarding) ────────────────
useEffect(() => {
  invoke<string | null>('load_appearance')
    .then((raw) => {
      if (!raw) {
        // No saved appearance — still apply defaults to keep DOM in sync
        applyAppearanceToDom(DEFAULT_APPEARANCE);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as AppearanceState;
        applyAppearanceToDom(parsed);
        // Mirror to localStorage so Settings.tsx loadAppearance() reads it
        localStorage.setItem('workbench-appearance', raw);
      } catch {
        applyAppearanceToDom(DEFAULT_APPEARANCE);
      }
    })
    .catch(() => {
      applyAppearanceToDom(DEFAULT_APPEARANCE);
    });
}, []); // empty deps — runs once on mount, before first paint via React batching
```

Place this `useEffect` immediately after the existing profile-load `useEffect` (around line 296 in the original file).

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` — zero errors expected.

**Commit:** `feat(app): load appearance from disk on startup and apply to DOM`

---

### Task 4: Account pane — fix "Stored in OS keychain" copy and remove editable API key input

**Files:**
- Modify: `src/components/Settings.tsx`

**Why:** The Account pane shows an editable text input for the API key with the helper text "Stored in OS keychain" (line 255). This is false on two counts: (1) the key is stored in `~/.workbench/profile.json`, not the OS keychain; (2) Phase 3 removes the API key from the profile entirely — the key is managed by the Claude CLI environment. The input and its Save button should be replaced with an informational callout.

- [ ] **Step 1: Replace the API Key `<section>` in `AccountPane`**

In `src/components/Settings.tsx`, replace the entire `{/* API Key */}` section (lines 198–257) with:

```tsx
      {/* API Key */}
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
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            maxWidth: 480,
          }}
        >
          <div
            style={{
              flex: 1,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            Managed by Claude CLI. Set{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: 'var(--bg-paper)',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--border)',
              }}
            >
              ANTHROPIC_API_KEY
            </code>{' '}
            in your shell environment, or run{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: 'var(--bg-paper)',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--border)',
              }}
            >
              claude setup
            </code>
            .
          </div>
        </div>
      </section>
```

- [ ] **Step 2: Remove dead state and handler from `AccountPane`**

Remove these lines from `AccountPane` (they are no longer needed):

```tsx
const [apiKey, setApiKey] = useState('sk-ant-••••••••••••••••••••');
```

and:

```tsx
async function handleSave() {
  try {
    const existing = await invoke<string>('load_profile').catch(() => '{}');
    const profile = JSON.parse(existing || '{}');
    profile.apiKey = apiKey;
    await invoke('save_profile', { data: JSON.stringify(profile) });
  } catch {
    // ignore
  }
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` — zero errors. Confirm the `invoke` import in `Settings.tsx` is still used by `saveAppearance`; if `AccountPane` was its only other user, the import is still needed.

**Commit:** `fix(settings): replace editable API key input with "Managed by Claude CLI" callout`

---

### Task 5: Search — disable navigation item with "Coming soon" tooltip

**Files:**
- Modify: `src/components/SessionRail.tsx`
- Modify: `src/components/Pages.tsx`

**Why:** The Search `NavRow` is fully clickable and navigates to a `SearchPage` that renders a disabled `<input>` with placeholder text "Search coming soon…" — but the user can still activate the view. The nav item should be visually disabled and non-interactive. The `SearchPage` body should be replaced with a cleaner empty state so there is no fake search bar at all.

**Key facts from reading the code:**
- `NavRow` in `SessionRail.tsx` (line 176) renders a `<button>` with `cursor: pointer`. Disabling requires `disabled` attribute, `cursor: not-allowed`, and reduced opacity.
- The `hint="⌘K"` prop on the Search NavRow implies a keyboard shortcut that does not exist — remove the hint too.
- `SearchPage` in `Pages.tsx` (line 281) renders a `PageShell` with a disabled input. Replace the body with a centered empty state.

- [ ] **Step 1: Update `NavRow` to accept a `disabled` prop**

In `src/components/SessionRail.tsx`, update the `NavRow` props interface and component:

```tsx
function NavRow({
  icon,
  label,
  hint,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Coming soon' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        height: 30,
        padding: '0 12px',
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border)' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        color: disabled ? 'var(--text-mute)' : (active ? 'var(--text)' : 'var(--text-dim)'),
        borderRadius: 6,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          color: disabled ? 'var(--text-mute)' : (active ? 'var(--text)' : 'var(--text-mute)'),
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: disabled ? 'var(--text-mute)' : (active ? 'var(--text)' : 'var(--text-dim)'),
        }}
      >
        {label}
      </span>
      {hint && !disabled && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-mute)',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Mark the Search `NavRow` as disabled and remove its hint**

In the `SessionRail` render body, change the Search NavRow from:

```tsx
        <NavRow
          icon={<Search size={14} strokeWidth={1.6} />}
          label="Search"
          hint="⌘K"
          active={view.kind === 'search'}
          onClick={() => onNavigate({ kind: 'search' })}
        />
```

to:

```tsx
        <NavRow
          icon={<Search size={14} strokeWidth={1.6} />}
          label="Search"
          disabled
        />
```

- [ ] **Step 3: Replace `SearchPage` body with a "Coming soon" empty state**

In `src/components/Pages.tsx`, replace the `SearchPage` component:

```tsx
/* ── Search page ── */
export function SearchPage() {
  return (
    <PageShell title="Search">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 64,
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 20,
            fontWeight: 400,
            color: 'var(--text-dim)',
          }}
        >
          Search coming soon
        </div>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-mute)',
            lineHeight: 1.6,
            textAlign: 'center',
            maxWidth: 340,
          }}
        >
          Full-text search across conversations, files, and tool calls is in development.
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` — zero errors. Confirm the `SearchIcon` import in `Pages.tsx` is removed if it is no longer referenced.

**Commit:** `fix(nav): disable Search item with coming-soon tooltip, replace search page placeholder`

---

### Task 6: Surface runtime errors as dismissible banners in the conversation view

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Conversation.tsx`

**Why:** Three categories of `console.error` calls in `App.tsx` relate to operations that directly affect the user: `git_commit` failure (`doCommit`), `start_task` failure (the `catch` in `handleSubmit`), and terminal startup failure (`term_open` in `Terminal.tsx`). Additionally `stop_task` failures silently fall back. These errors are invisible to the user. The app already has a `permissionBanners` slot in `Conversation` — we follow the same pattern to add an `errorBanners` slot, then drive it from `App.tsx` state.

**Note on `start_task` and `term_open`:** `start_task` errors already inject an error message into the session's `messages` array (see lines 879–896 in `App.tsx`), making them visible in the chat. We leave that path intact. The new banner is for `git_commit` failures which currently have no user-visible feedback at all. `term_open` failures are inside `Terminal.tsx` — we add error callback support there.

- [ ] **Step 1: Add a shared `AppErrorBanner` component**

In `src/App.tsx`, add the following component definition above the `App` function (near other inline component definitions):

```tsx
interface AppError {
  id: string;
  message: string;
}

function AppErrorBanner({ error, onDismiss }: { error: AppError; onDismiss: (id: string) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--red-bg)',
        border: '1px solid var(--red)',
        borderRadius: 8,
        color: 'var(--red)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{error.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(error.id)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--red)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add `appErrors` state and `pushError` / `dismissError` helpers to `App`**

Inside the `App` function, add state alongside the existing permission state:

```tsx
// App-level error banners (git commit failures, etc.)
const [appErrors, setAppErrors] = useState<AppError[]>([]);

function pushError(message: string) {
  const id = `err-${Date.now()}`;
  setAppErrors(prev => [...prev, { id, message }]);
}

function dismissError(id: string) {
  setAppErrors(prev => prev.filter(e => e.id !== id));
}
```

- [ ] **Step 3: Replace `console.error('git commit failed', ...)` with `pushError`**

In `doCommit`, change:

```tsx
    } catch (err) {
      console.error('git commit failed:', err);
    }
```

to:

```tsx
    } catch (err) {
      pushError(`Git commit failed: ${String(err)}`);
      return; // don't clear the diff or close the modal if commit failed
    }
```

- [ ] **Step 4: Add `errorBanners` prop to `Conversation` component**

In `src/components/Conversation.tsx`, add `errorBanners` to the props interface alongside `permissionBanners`:

```tsx
  permissionBanners?: React.ReactNode;
  errorBanners?: React.ReactNode;
```

Update the destructure:

```tsx
export default function Conversation({
  task, messages, onSubmit, onStop, isRunning, permissionBanners, errorBanners, cwd, sessionId,
  model, onModelChange, onOpenFile, zoom, onMouseEnter, onMouseLeave,
}: Props) {
```

In the render, add `errorBanners` above `permissionBanners` in the bottom input area (around line 1279):

```tsx
        {errorBanners && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {errorBanners}
          </div>
        )}
        {permissionBanners && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {permissionBanners}
          </div>
        )}
```

- [ ] **Step 5: Pass `errorBanners` from `App.tsx` to `Conversation`**

In `App.tsx`, in the `<Conversation ... />` JSX (around line 1316), add:

```tsx
              errorBanners={appErrors.length > 0 ? appErrors.map(err => (
                <AppErrorBanner key={err.id} error={err} onDismiss={dismissError} />
              )) : undefined}
```

- [ ] **Step 6: Verify**

Run `npx tsc --noEmit` — zero errors.

**Commit:** `feat(app): surface git-commit errors as dismissible banners in the conversation view`

---

### Task 7: `summarize_session` — guard against title regression on failure

**Files:**
- Modify: `src/App.tsx`

**Why:** The `invoke('summarize_session', ...)` call inside the `'done'` event handler (line 813) already has a `.catch(() => {})`. This is correct — the title is not updated on failure. However, the catch is empty and provides no confirmation that the existing derived title is preserved. This task verifies the existing behavior is sufficient and adds a brief comment for future readers.

**Key facts from reading the code:**
- Lines 806–819: on `done`, if the session has not been titled yet (`!sess.titleLocked && !sess.summarizedAtTurn`), `summarize_session` is invoked. The `.then` sets the title; the `.catch(() => {})` swallows any error.
- The heuristic title (`deriveHeuristicTitle(prompt)`, line 665) is already set when the user submits (in the `setSessions` call at line 659). So if `summarize_session` fails, the heuristic title persists — which is the correct behavior.

- [ ] **Step 1: Annotate the existing catch and confirm it is correct**

In `src/App.tsx`, change the existing catch clause (line 819):

```ts
                  .catch(() => {});
```

to:

```ts
                  .catch(() => {
                    // summarize_session failed — keep the heuristic title set at submit time
                  });
```

This is a no-op behavior change but documents intent clearly.

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` — zero errors.

**Commit:** `docs(app): annotate summarize_session catch to clarify title-fallback intent`

---

### Completion checklist

After all tasks are merged, verify manually:

- [ ] Open Settings > Appearance, change theme to Dark — the app turns dark immediately without clicking Save
- [ ] Change accent color — `--accent` updates immediately across all UI
- [ ] Close Settings, relaunch the app — dark theme and chosen accent persist
- [ ] Open Settings > Account — no editable API key input; see "Managed by Claude CLI" callout
- [ ] Hover over Search in the session rail — tooltip says "Coming soon"; clicking does nothing
- [ ] Trigger a git commit in a session with no git repo (or corrupt the project path) — a red banner appears above the composer, dismissible with ×
- [ ] `npm run build` passes with zero TypeScript errors
