# Phase 6: App State Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split App.tsx into focused hooks and typed service modules with no behavior changes.

**Architecture:** Extract each state domain into a dedicated hook, move all invoke() calls into typed service modules, add schema validation for persisted JSON. App.tsx becomes a composition of hooks and render branches.

**Tech Stack:** React 18, TypeScript, Zod (schema validation), Tauri 2

> **Note on zod:** `zod` is NOT in `package.json`. All validators use manual `Result<T, string>` patterns to avoid adding a dependency. If the team wants to add zod later, the validator signatures stay compatible.

---

### Task 1: Create `src/services/tauri.ts` — typed invoke wrappers

**Files:**
- Create: `src/services/tauri.ts`

**Why:** Every `invoke()` call in `App.tsx` uses a raw string and untyped args. One central service module gives a single source of truth for all Tauri command names and their arg/return shapes. All subsequent hooks import from here — no hook ever imports `invoke` directly.

- [ ] **Step 1: Create `src/services/tauri.ts`**

```typescript
/**
 * src/services/tauri.ts
 *
 * Typed wrappers around every Tauri `invoke()` call in the app.
 * No hook or component should import `invoke` directly — use these instead.
 *
 * Return types mirror the Rust command signatures in src-tauri/src/lib.rs.
 */
import { invoke } from '@tauri-apps/api/core';

// ── Profile ──────────────────────────────────────────────────────────────────

/** Returns the raw JSON string from ~/.workbench/profile.json, or null. */
export function loadProfile(): Promise<string | null> {
  return invoke<string | null>('load_profile');
}

/** Overwrites ~/.workbench/profile.json with the given JSON string. */
export function saveProfile(data: string): Promise<void> {
  return invoke<void>('save_profile', { data });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Returns the raw JSON string from ~/.workbench/sessions.json, or null. */
export function loadSessions(): Promise<string | null> {
  return invoke<string | null>('load_sessions');
}

/** Overwrites ~/.workbench/sessions.json with the given JSON string. */
export function saveSessions(data: string): Promise<void> {
  return invoke<void>('save_sessions', { data });
}

// ── Automations ───────────────────────────────────────────────────────────────

/** Returns the raw JSON string from ~/.workbench/automations.json, or null. */
export function loadAutomations(): Promise<string | null> {
  return invoke<string | null>('load_automations');
}

/** Overwrites ~/.workbench/automations.json with the given JSON string. */
export function saveAutomations(data: string): Promise<void> {
  return invoke<void>('save_automations', { data });
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface StartTaskArgs {
  taskId: string;
  projectPath: string;
  worktreePath: string;
  prompt: string;
  resumeSession: string | null;
  model: string;
  yoloMode?: boolean;
}

/** Spawns a Claude Code process for the given session. */
export function startTask(args: StartTaskArgs): Promise<void> {
  return invoke<void>('start_task', args);
}

/** Sends SIGKILL to the running Claude process for the given session. */
export function stopTask(taskId: string): Promise<void> {
  return invoke<void>('stop_task', { taskId });
}

/** Generates a short title for a completed session turn. */
export function summarizeSession(firstUser: string, lastAssistant: string): Promise<string> {
  return invoke<string>('summarize_session', { firstUser, lastAssistant });
}

// ── Git ───────────────────────────────────────────────────────────────────────

/** Returns the current branch name for the given project path. */
export function getCurrentBranch(projectPath: string): Promise<string> {
  return invoke<string>('get_current_branch', { projectPath });
}

/** Commits all staged/unstaged changes inside the session's worktree. */
export function gitCommit(worktreePath: string, message: string): Promise<void> {
  return invoke<void>('git_commit', { worktreePath, message });
}

/** Discards all working-tree changes inside the session's worktree. */
export function gitDiscard(worktreePath: string): Promise<void> {
  return invoke<void>('git_discard', { worktreePath });
}

// ── Permissions ───────────────────────────────────────────────────────────────

/** Resolves a pending permission request (allow or deny). */
export function resolvePermission(id: string, allow: boolean): Promise<void> {
  return invoke<void>('resolve_permission', { id, allow });
}

/** Persists an allow/deny rule for the given tool + path pattern. */
export function savePolicy(projectPath: string, tool: string, pattern: string, allow: boolean): Promise<void> {
  return invoke<void>('save_policy', { projectPath, tool, pattern, allow });
}

// ── File system / UI helpers ──────────────────────────────────────────────────

/** Opens the native directory picker. Returns the chosen path, or null. */
export function chooseDirectory(): Promise<string | null> {
  return invoke<string | null>('choose_directory');
}

// ── Terminal ──────────────────────────────────────────────────────────────────

/** Closes a PTY terminal by its Tauri-issued id. */
export function termClose(id: string): Promise<void> {
  return invoke<void>('term_close', { id });
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit
```

No changes to `App.tsx` yet — this task is purely additive.

---

### Task 2: Create `src/services/storage.ts` — shared debounced save utility

**Files:**
- Create: `src/services/storage.ts`

**Why:** Four separate hooks (profile, sessions, automations, layout widths) all implement the same "debounced write on state change" pattern with manual `setTimeout` refs. Extracting it once eliminates the copy-paste and ensures consistent cleanup.

- [ ] **Step 1: Create `src/services/storage.ts`**

```typescript
/**
 * src/services/storage.ts
 *
 * Shared debounced-save utility.
 *
 * Usage inside a hook:
 *
 *   const save = useDebouncedSave((data) => saveProfile(data), 400);
 *   useEffect(() => { save(JSON.stringify(profilePayload)); }, [deps]);
 */
import { useRef, useCallback } from 'react';

/**
 * Returns a stable callback that, when called with a value, schedules
 * `fn(value)` to run after `delayMs`. Cancels any pending call first.
 * The timer is automatically cleared when the component unmounts.
 */
export function useDebouncedSave<T>(
  fn: (value: T) => Promise<void> | void,
  delayMs: number,
): (value: T) => void {
  const timerRef = useRef<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Register cleanup — hooks can't call useEffect themselves without
  // being a hook, so we expose cleanup for callers to wire into their
  // own useEffect return. See each hook's implementation for the pattern.
  void cleanup; // referenced so bundler doesn't tree-shake

  return useCallback((value: T) => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void fnRef.current(value);
    }, delayMs);
  }, [delayMs]);
}

/**
 * Simple manual Result type for validators (avoids adding zod dep).
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: string): Result<T> {
  return { ok: false, error };
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit
```

---

### Task 3: Create `src/hooks/useProfile.ts`

**Files:**
- Create: `src/hooks/useProfile.ts`
- Modify: `src/App.tsx` (replace inline profile logic with hook call)

**Why:** Profile loading (startup `invoke('load_profile')`), merge-patch persistence (`persistProfile`), layout width/zoom debounced save, and `terminalCollapsed` sync are all logically part of "profile state". Extracting them removes ~70 lines from `App.tsx`.

**Exact state extracted from App.tsx:**
- `onboardingDone` (lines 194, 285–294)
- `projectPath` / `apiKey` (lines 210–211)
- `railWidth`, `reviewWidth`, `railZoom`, `convZoom`, `reviewZoom` (lines 231–237)
- `terminalCollapsed` (line 227)
- Load `useEffect` (lines 257–295)
- `persistProfile` function (lines 298–307)
- Persist `terminalCollapsed` `useEffect` (lines 310–313)
- Debounced width/zoom save `useEffect` + `widthSaveTimerRef` (lines 316–326)

- [ ] **Step 1: Create `src/hooks/useProfile.ts`**

```typescript
/**
 * src/hooks/useProfile.ts
 *
 * Manages ~/.workbench/profile.json: initial load, merge-patch persistence,
 * and debounced saves for layout widths and zoom levels.
 */
import { useState, useEffect, useRef } from 'react';
import { loadProfile, saveProfile } from '../services/tauri';
import type { Project } from '../data/sample';

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export interface ProfileState {
  onboardingDone: boolean | null;
  setOnboardingDone: (v: boolean) => void;

  projectPath: string;
  setProjectPath: (v: string) => void;

  apiKey: string;
  setApiKey: (v: string) => void;

  projects: Project[];
  setProjects: (v: Project[]) => void;

  terminalCollapsed: boolean;
  setTerminalCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  railWidth: number;
  setRailWidth: (v: number) => void;

  reviewWidth: number;
  setReviewWidth: (v: number) => void;

  railZoom: number;
  setRailZoom: React.Dispatch<React.SetStateAction<number>>;

  convZoom: number;
  setConvZoom: React.Dispatch<React.SetStateAction<number>>;

  reviewZoom: number;
  setReviewZoom: React.Dispatch<React.SetStateAction<number>>;

  /** Merge-patches the given fields into the saved profile.json. */
  persistProfile: (patch: Record<string, unknown>) => Promise<void>;
}

export function useProfile(): ProfileState {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [projectPath, setProjectPath] = useState('/tmp');
  const [apiKey, setApiKey] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [terminalCollapsed, setTerminalCollapsed] = useState<boolean>(false);
  const [railWidth, setRailWidth] = useState<number>(240);
  const [reviewWidth, setReviewWidth] = useState<number>(420);
  const [railZoom, setRailZoom] = useState<number>(1);
  const [convZoom, setConvZoom] = useState<number>(1);
  const [reviewZoom, setReviewZoom] = useState<number>(1);

  // ── Load profile on startup ──────────────────────────────────────────────
  useEffect(() => {
    loadProfile()
      .then((raw) => {
        if (raw) {
          try {
            const profile = JSON.parse(raw);
            if (profile.projectPath) setProjectPath(profile.projectPath);
            if (profile.apiKey) setApiKey(profile.apiKey);
            if (Array.isArray(profile.projects) && profile.projects.length > 0) {
              setProjects(profile.projects);
            } else if (profile.projectPath) {
              // Migrate single projectPath → projects array
              const name = basename(profile.projectPath);
              setProjects([{ id: `p-${Date.now()}`, name, path: profile.projectPath, count: 0 }]);
            }
            if (typeof profile.terminalCollapsed === 'boolean') {
              setTerminalCollapsed(profile.terminalCollapsed);
            }
            if (typeof profile.railWidth === 'number') setRailWidth(profile.railWidth);
            if (typeof profile.reviewWidth === 'number') setReviewWidth(profile.reviewWidth);
            if (typeof profile.railZoom === 'number') setRailZoom(profile.railZoom);
            if (typeof profile.convZoom === 'number') setConvZoom(profile.convZoom);
            if (typeof profile.reviewZoom === 'number') setReviewZoom(profile.reviewZoom);
            setOnboardingDone(!!profile.projectPath);
            return;
          } catch {}
        }
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      })
      .catch(() => {
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      });
  }, []);

  // ── Merge-patch persist ──────────────────────────────────────────────────
  async function persistProfile(patch: Record<string, unknown>) {
    try {
      const raw = await loadProfile();
      const existing = raw
        ? (() => { try { return JSON.parse(raw); } catch { return {}; } })()
        : {};
      await saveProfile(JSON.stringify({ ...existing, ...patch }));
    } catch (err) {
      console.error('persistProfile failed:', err);
    }
  }

  // ── Sync terminalCollapsed to profile ────────────────────────────────────
  useEffect(() => {
    if (onboardingDone !== true) return;
    persistProfile({ terminalCollapsed });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalCollapsed, onboardingDone]);

  // ── Debounced width + zoom save ──────────────────────────────────────────
  const widthSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (onboardingDone !== true) return;
    if (widthSaveTimerRef.current != null) window.clearTimeout(widthSaveTimerRef.current);
    widthSaveTimerRef.current = window.setTimeout(() => {
      persistProfile({ railWidth, reviewWidth, railZoom, convZoom, reviewZoom });
    }, 250);
    return () => {
      if (widthSaveTimerRef.current != null) window.clearTimeout(widthSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railWidth, reviewWidth, railZoom, convZoom, reviewZoom, onboardingDone]);

  return {
    onboardingDone, setOnboardingDone,
    projectPath, setProjectPath,
    apiKey, setApiKey,
    projects, setProjects,
    terminalCollapsed, setTerminalCollapsed,
    railWidth, setRailWidth,
    reviewWidth, setReviewWidth,
    railZoom, setRailZoom,
    convZoom, setConvZoom,
    reviewZoom, setReviewZoom,
    persistProfile,
  };
}
```

- [ ] **Step 2: Replace profile state in `App.tsx`**

Remove from `App.tsx` (lines 194, 209–237, 257–326):
```typescript
// Onboarding gate: null = loading, false = needs onboarding, true = done
const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
// ...
const [projectPath, setProjectPath] = useState('/tmp');
const [apiKey, setApiKey] = useState('');
const [projects, setProjects] = useState<Project[]>([]);
// ...
const [terminalCollapsed, setTerminalCollapsed] = useState<boolean>(false);
const [railWidth,   setRailWidth]   = useState<number>(240);
const [reviewWidth, setReviewWidth] = useState<number>(420);
const [railZoom,   setRailZoom]   = useState<number>(1);
const [convZoom,   setConvZoom]   = useState<number>(1);
const [reviewZoom, setReviewZoom] = useState<number>(1);
```

And remove the three `useEffect` blocks (profile load, terminalCollapsed persist, width/zoom debounce) and the `persistProfile` function.

Also remove the top-level `basename` and `tildeify` helper functions from `App.tsx` — they are used only by profile logic. `tildeify` stays in `App.tsx` as an inline render helper (it's used in the render section at line 1238). `basename` moves to `useProfile.ts`.

Replace all removed declarations with one import and one hook call at the top of the `App()` function body:

```typescript
import { useProfile } from './hooks/useProfile';

// inside App():
const {
  onboardingDone, setOnboardingDone,
  projectPath, setProjectPath,
  apiKey: _apiKey,
  projects, setProjects,
  terminalCollapsed, setTerminalCollapsed,
  railWidth, setRailWidth,
  reviewWidth, setReviewWidth,
  railZoom, setRailZoom,
  convZoom, setConvZoom,
  reviewZoom, setReviewZoom,
  persistProfile,
} = useProfile();
```

Also update the `Onboarding` `onComplete` callback in the render (lines 1218–1231) to call `loadProfile` via the service import instead of inline `invoke`:

```typescript
import { loadProfile } from './services/tauri';

// inside onComplete:
loadProfile().then((raw) => {
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p.projectPath) setProjectPath(p.projectPath);
      if (p.apiKey) setApiKey(p.apiKey);
    } catch {}
  }
});
setOnboardingDone(true);
```

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 4: Create `src/hooks/useSessions.ts`

**Files:**
- Create: `src/hooks/useSessions.ts`
- Modify: `src/App.tsx`

**Why:** Sessions CRUD, serialization, load/save, and `activeSessionId` tracking are the largest single state domain in `App.tsx` (~110 lines). Extracting them into `useSessions` removes the biggest chunk and makes session logic independently testable.

**Exact state extracted:**
- `sessions` / `setSessions` (line 223)
- `activeSessionId` / `setActiveSessionId` (line 224)
- `sessionsLoadedRef` (line 393)
- Load `useEffect` (lines 395–450)
- Debounced save `useEffect` + `saveTimerRef` (lines 453–494)
- `updateSession` helper (lines 252–254)

- [ ] **Step 1: Create `src/hooks/useSessions.ts`**

```typescript
/**
 * src/hooks/useSessions.ts
 *
 * Session CRUD, serialization, persistence, and active-session tracking.
 *
 * Schema (sessions.json):
 *   { version: 1, activeSessionId: string, sessions: SerializedSession[] }
 *
 * Ephemeral fields (isRunning, currentTool, streamingText, activeTerminalKey)
 * are stripped on save and reset to safe defaults on load.
 */
import { useState, useEffect, useRef } from 'react';
import { loadSessions, saveSessions } from '../services/tauri';

// ── Types (re-exported so App.tsx and hooks can share them) ─────────────────

export interface TerminalTabState {
  localKey: string;
  cwd: string;
  id?: string;
}

export interface SessionState {
  id: string;
  initials: string;
  avatarBg: string;
  taskState: 'working' | 'review' | 'awaiting' | 'idle' | 'stopped';
  title: string;
  project: string;
  createdAt: number;
  lastActivityAt: number;
  model: string;
  panelTabs: string[];
  panelActive: string;
  panelCollapsed: boolean;
  messages: import('../data/sample').Message[];
  planItems: import('../data/sample').PlanItem[];
  toolCalls: import('../data/sample').ToolCall[];
  diffPatch: string;
  isRunning: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  claudeSessionId?: string;
  terminals: TerminalTabState[];
  activeTerminalKey: string | null;
  currentTool?: { name: string; path: string } | null;
  streamingText?: boolean;
  titleLocked?: boolean;
  summarizedAtTurn?: number;
  tokenUsage?: { input: number; output: number; cacheRead: number; cacheCreation: number };
}

// ── Schema validator (manual, no zod dep) ────────────────────────────────────

const AVATAR_COLORS = ['#c4bfb5', '#b8b0a4', '#bdb6ae', '#c8c2b8', '#b4aca3', '#ccc6bc'];

/**
 * migrateSessionsV1: validates and normalises raw parsed JSON from sessions.json.
 * Unknown/missing fields are filled with safe defaults.
 * Returns null if the input is structurally unusable.
 */
export function migrateSessionsV1(
  raw: unknown,
): { sessions: SessionState[]; activeSessionId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.sessions) || obj.sessions.length === 0) return null;

  const sessions: SessionState[] = obj.sessions.map((s: unknown, i: number) => {
    const r = (s as Record<string, unknown>) ?? {};
    const terminals: TerminalTabState[] = Array.isArray(r.terminals)
      ? r.terminals.map((t: unknown, j: number) => ({
          localKey: `t-${String(r.id)}-${j}-${Date.now()}`,
          cwd: (t as Record<string, unknown>).cwd as string,
        }))
      : [];
    const session: SessionState = {
      id: typeof r.id === 'string' ? r.id : `s-${Date.now()}-${i}`,
      initials: typeof r.initials === 'string' ? r.initials : 'NW',
      avatarBg: typeof r.avatarBg === 'string' ? r.avatarBg : AVATAR_COLORS[i % AVATAR_COLORS.length],
      taskState: 'idle',
      title: typeof r.title === 'string' ? r.title : 'New task',
      project: typeof r.project === 'string' ? r.project : '',
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      lastActivityAt: typeof r.lastActivityAt === 'number'
        ? r.lastActivityAt
        : (typeof r.createdAt === 'number' ? r.createdAt : Date.now()),
      model: typeof r.model === 'string' && r.model ? r.model : 'sonnet',
      panelTabs: Array.isArray(r.panelTabs)
        ? (r.panelTabs as unknown[]).filter((t) => typeof t === 'string') as string[]
        : [],
      panelActive: typeof r.panelActive === 'string' ? r.panelActive : 'review',
      panelCollapsed: typeof r.panelCollapsed === 'boolean' ? r.panelCollapsed : false,
      messages: Array.isArray(r.messages) ? (r.messages as import('../data/sample').Message[]) : [],
      planItems: Array.isArray(r.planItems) ? (r.planItems as import('../data/sample').PlanItem[]) : [],
      toolCalls: Array.isArray(r.toolCalls) ? (r.toolCalls as import('../data/sample').ToolCall[]) : [],
      diffPatch: typeof r.diffPatch === 'string' ? r.diffPatch : '',
      isRunning: false,
      worktreePath: typeof r.worktreePath === 'string' ? r.worktreePath : undefined,
      worktreeBranch: typeof r.worktreeBranch === 'string' ? r.worktreeBranch : undefined,
      claudeSessionId: typeof r.claudeSessionId === 'string' ? r.claudeSessionId : undefined,
      terminals,
      activeTerminalKey: terminals[0]?.localKey ?? null,
      tokenUsage: r.tokenUsage != null
        ? (r.tokenUsage as SessionState['tokenUsage'])
        : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      titleLocked: typeof r.titleLocked === 'boolean' ? r.titleLocked : false,
      summarizedAtTurn: typeof r.summarizedAtTurn === 'number' ? r.summarizedAtTurn : 0,
    };
    return session;
  });

  const savedActiveId = typeof obj.activeSessionId === 'string' ? obj.activeSessionId : '';
  const activeSessionId = sessions.some((s) => s.id === savedActiveId)
    ? savedActiveId
    : (sessions[0]?.id ?? '');

  return { sessions, activeSessionId };
}

// ── Serialiser (strips ephemeral fields) ──────────────────────────────────────

function serialiseSession(s: SessionState) {
  return {
    id: s.id,
    initials: s.initials,
    avatarBg: s.avatarBg,
    taskState: s.taskState,
    title: s.title,
    project: s.project,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    model: s.model,
    panelTabs: s.panelTabs,
    panelActive: s.panelActive,
    panelCollapsed: s.panelCollapsed,
    messages: s.messages,
    planItems: s.planItems,
    toolCalls: s.toolCalls,
    diffPatch: s.diffPatch,
    worktreePath: s.worktreePath,
    worktreeBranch: s.worktreeBranch,
    claudeSessionId: s.claudeSessionId,
    terminals: s.terminals.map((t) => ({ cwd: t.cwd })),
    tokenUsage: s.tokenUsage,
    titleLocked: s.titleLocked,
    summarizedAtTurn: s.summarizedAtTurn,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseSessionsReturn {
  sessions: SessionState[];
  setSessions: React.Dispatch<React.SetStateAction<SessionState[]>>;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  updateSession: (id: string, updates: Partial<SessionState>) => void;
}

export function useSessions(onboardingDone: boolean | null): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const sessionsLoadedRef = useRef(false);

  // ── Load on first ready ───────────────────────────────────────────────────
  useEffect(() => {
    if (onboardingDone !== true || sessionsLoadedRef.current) return;
    sessionsLoadedRef.current = true;
    loadSessions()
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          const result = migrateSessionsV1(parsed);
          if (!result) return;
          setSessions(result.sessions);
          setActiveSessionId(result.activeSessionId);
        } catch (err) {
          console.error('load_sessions parse failed:', err);
        }
      })
      .catch((err) => {
        console.error('load_sessions failed:', err);
      });
  }, [onboardingDone]);

  // ── Debounced save ────────────────────────────────────────────────────────
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (onboardingDone !== true || !sessionsLoadedRef.current) return;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const payload = {
        version: 1,
        activeSessionId,
        sessions: sessions.map(serialiseSession),
      };
      saveSessions(JSON.stringify(payload)).catch((err) => {
        console.error('save_sessions failed:', err);
      });
    }, 400);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, onboardingDone]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function updateSession(id: string, updates: Partial<SessionState>) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }

  return { sessions, setSessions, activeSessionId, setActiveSessionId, updateSession };
}
```

- [ ] **Step 2: Replace session state in `App.tsx`**

Remove from `App.tsx`:
- The `TerminalTabState` interface (lines 24–28)
- The `SessionState` interface (lines 30–76)
- `const [sessions, setSessions] = useState<SessionState[]>([]);` (line 223)
- `const [activeSessionId, setActiveSessionId] = useState<string>('');` (line 224)
- `function updateSession(...)` (lines 252–254)
- `sessionsLoadedRef` declaration (line 393)
- Both session `useEffect` blocks (lines 395–494)

Add import and hook call at the top of `App()`:

```typescript
import { useSessions } from './hooks/useSessions';
import type { SessionState, TerminalTabState } from './hooks/useSessions';

// inside App():
const { sessions, setSessions, activeSessionId, setActiveSessionId, updateSession } =
  useSessions(onboardingDone);
```

> **Note:** `useSessions` must be called after `useProfile` since it depends on `onboardingDone`.

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 5: Create `src/hooks/useAutomations.ts`

**Files:**
- Create: `src/hooks/useAutomations.ts`
- Modify: `src/App.tsx`

**Why:** Automations load/save is a fully self-contained domain — it never touches session or profile state. Clean extraction.

**Exact state extracted:**
- `automations` / `setAutomations` (line 217)
- `automationsLoadedRef` (line 218)
- Load `useEffect` (lines 329–345)
- Debounced save `useEffect` + `automationsSaveTimerRef` (lines 347–364)

- [ ] **Step 1: Create `src/hooks/useAutomations.ts`**

```typescript
/**
 * src/hooks/useAutomations.ts
 *
 * Loads automations from ~/.workbench/automations.json on first ready,
 * seeds from AUTOMATIONS defaults if none saved, and debounce-saves on change.
 */
import { useState, useEffect, useRef } from 'react';
import { loadAutomations, saveAutomations } from '../services/tauri';
import { AUTOMATIONS } from '../data/sample';
import type { Automation } from '../data/sample';

export interface UseAutomationsReturn {
  automations: Automation[];
  setAutomations: React.Dispatch<React.SetStateAction<Automation[]>>;
}

export function useAutomations(onboardingDone: boolean | null): UseAutomationsReturn {
  const [automations, setAutomations] = useState<Automation[]>(AUTOMATIONS);
  const automationsLoadedRef = useRef(false);

  // ── Load on first ready ───────────────────────────────────────────────────
  useEffect(() => {
    if (onboardingDone !== true || automationsLoadedRef.current) return;
    automationsLoadedRef.current = true;
    loadAutomations()
      .then((raw) => {
        if (!raw) return; // keep seed defaults
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.automations)) {
            setAutomations(parsed.automations);
          }
        } catch (err) {
          console.error('load_automations parse failed:', err);
        }
      })
      .catch((err) => {
        console.error('load_automations failed:', err);
      });
  }, [onboardingDone]);

  // ── Debounced save (300ms) ────────────────────────────────────────────────
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (onboardingDone !== true || !automationsLoadedRef.current) return;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const payload = JSON.stringify({ version: 1, automations });
      saveAutomations(payload).catch((err) => {
        console.error('save_automations failed:', err);
      });
    }, 300);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [automations, onboardingDone]);

  return { automations, setAutomations };
}
```

- [ ] **Step 2: Replace automations state in `App.tsx`**

Remove from `App.tsx`:
- `const [automations, setAutomations] = useState<Automation[]>(AUTOMATIONS);` (line 217)
- `const automationsLoadedRef = useRef(false);` (line 218)
- Both automations `useEffect` blocks (lines 329–364)

Add import and hook call in `App()` after `useSessions`:

```typescript
import { useAutomations } from './hooks/useAutomations';

// inside App():
const { automations, setAutomations } = useAutomations(onboardingDone);
```

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 6: Create `src/hooks/usePermissions.ts`

**Files:**
- Create: `src/hooks/usePermissions.ts`
- Modify: `src/App.tsx`

**Why:** Permission state (`pendingPermissions`) and its three action handlers (`handlePermAllow`, `handlePermDeny`, `handlePermAlwaysAllow`) plus `dismissPermission` are fully self-contained relative to other state — the only cross-dependency is reading `activeSessionId` and `setSessions` to flip `taskState` back to `'working'` after all permissions clear.

**Exact state extracted:**
- `pendingPermissions` / `setPendingPermissions` (line 241)
- `dismissPermission` (lines 1175–1187)
- `handlePermAllow` (lines 1189–1192)
- `handlePermDeny` (lines 1194–1197)
- `handlePermAlwaysAllow` (lines 1199–1203)

- [ ] **Step 1: Create `src/hooks/usePermissions.ts`**

```typescript
/**
 * src/hooks/usePermissions.ts
 *
 * Tracks pending permission requests and provides allow/deny/alwaysAllow
 * handlers. Routes to modal (high risk) or banner (low risk) via the
 * returned arrays.
 */
import { useState } from 'react';
import { resolvePermission, savePolicy } from '../services/tauri';
import type { PermissionRequest } from '../types/permissions';
import type { SessionState } from './useSessions';

export interface UsePermissionsReturn {
  pendingPermissions: PermissionRequest[];
  /** Call this from useAgentEvents when a 'permission' event arrives. */
  addPermission: (req: PermissionRequest) => void;
  lowRiskPerms: PermissionRequest[];
  highRiskPerms: PermissionRequest[];
  handlePermAllow: (id: string) => Promise<void>;
  handlePermDeny: (id: string) => Promise<void>;
  handlePermAlwaysAllow: (id: string, tool: string, pattern: string) => Promise<void>;
}

export function usePermissions(
  activeSessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<SessionState[]>>,
  projectPath: string,
): UsePermissionsReturn {
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);

  function addPermission(req: PermissionRequest) {
    setPendingPermissions((prev) => [...prev, req]);
  }

  function dismissPermission(id: string) {
    setPendingPermissions((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) {
        setSessions((prevS) =>
          prevS.map((s) =>
            s.id === activeSessionId && s.isRunning ? { ...s, taskState: 'working' } : s,
          ),
        );
      }
      return next;
    });
  }

  async function handlePermAllow(id: string) {
    await resolvePermission(id, true);
    dismissPermission(id);
  }

  async function handlePermDeny(id: string) {
    await resolvePermission(id, false);
    dismissPermission(id);
  }

  async function handlePermAlwaysAllow(id: string, tool: string, pattern: string) {
    await savePolicy(projectPath, tool, pattern, true);
    await resolvePermission(id, true);
    dismissPermission(id);
  }

  const lowRiskPerms = pendingPermissions.filter((p) => p.risk === 'low');
  const highRiskPerms = pendingPermissions.filter((p) => p.risk === 'high');

  return {
    pendingPermissions,
    addPermission,
    lowRiskPerms,
    highRiskPerms,
    handlePermAllow,
    handlePermDeny,
    handlePermAlwaysAllow,
  };
}
```

- [ ] **Step 2: Replace permissions state in `App.tsx`**

Remove from `App.tsx`:
- `const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);` (line 241)
- `function dismissPermission(...)` (lines 1175–1187)
- `async function handlePermAllow(...)` (lines 1189–1192)
- `async function handlePermDeny(...)` (lines 1194–1197)
- `async function handlePermAlwaysAllow(...)` (lines 1199–1203)
- `const lowRiskPerms = ...` and `const highRiskPerms = ...` (lines 1247–1248 in the render section)

Add import and hook call in `App()`:

```typescript
import { usePermissions } from './hooks/usePermissions';

// inside App() — after useSessions and useProfile are called:
const {
  pendingPermissions,
  addPermission,
  lowRiskPerms,
  highRiskPerms,
  handlePermAllow,
  handlePermDeny,
  handlePermAlwaysAllow,
} = usePermissions(activeSessionId, setSessions, projectPath);
```

> **Note:** The `'permission'` event case in `handleSubmit`'s listener must now call `addPermission(req)` and `updateSession(sessionId, { taskState: 'awaiting' })` instead of the inline `setPendingPermissions` call. This is the only cross-boundary wiring needed.

Change the permission case inside the listener in `handleSubmit` from:

```typescript
case 'permission': {
  const req: PermissionRequest = { id: ev.id, tool: ev.tool, path: ev.path, detail: ev.detail, risk: ev.risk };
  setPendingPermissions(prev => [...prev, req]);
  updateSession(sessionId, { taskState: 'awaiting' });
  break;
}
```

To:

```typescript
case 'permission': {
  const req: PermissionRequest = { id: ev.id, tool: ev.tool, path: ev.path, detail: ev.detail, risk: ev.risk };
  addPermission(req);
  updateSession(sessionId, { taskState: 'awaiting' });
  break;
}
```

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 7: Create `src/hooks/useTerminalTabs.ts`

**Files:**
- Create: `src/hooks/useTerminalTabs.ts`
- Modify: `src/App.tsx`

**Why:** The three terminal-tab helper functions (`termAddTab`, `termCycleTab`, `termCloseActive`) share no state beyond `sessions`/`activeSessionId` and `terminalCollapsed`. Grouping them in one hook makes the keyboard shortcut wiring in `App.tsx` a simple import.

**Exact code extracted:**
- `function termAddTab()` (lines 497–507)
- `function termCycleTab(dir: 1 | -1)` (lines 509–516)
- `function termCloseActive()` (lines 518–528)

- [ ] **Step 1: Create `src/hooks/useTerminalTabs.ts`**

```typescript
/**
 * src/hooks/useTerminalTabs.ts
 *
 * Terminal tab helpers for the active session: add, cycle, and close tabs.
 * Also fires the `term_close` Tauri command on close.
 */
import { termClose } from '../services/tauri';
import type { SessionState } from './useSessions';

export interface UseTerminalTabsReturn {
  termAddTab: () => void;
  termCycleTab: (dir: 1 | -1) => void;
  termCloseActive: () => void;
}

export function useTerminalTabs(
  sessions: SessionState[],
  activeSessionId: string,
  projectPath: string,
  terminalCollapsed: boolean,
  setTerminalCollapsed: (v: boolean) => void,
  updateSession: (id: string, updates: Partial<SessionState>) => void,
): UseTerminalTabsReturn {

  function termAddTab() {
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (!sess) return;
    const cwd = sess.worktreePath ?? projectPath;
    const t = { localKey: `t-${Date.now()}`, cwd };
    updateSession(activeSessionId, {
      terminals: [...sess.terminals, t],
      activeTerminalKey: t.localKey,
    });
    if (terminalCollapsed) setTerminalCollapsed(false);
  }

  function termCycleTab(dir: 1 | -1) {
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (!sess || sess.terminals.length === 0) return;
    const idx = sess.terminals.findIndex((t) => t.localKey === sess.activeTerminalKey);
    const nextIdx = ((idx === -1 ? 0 : idx) + dir + sess.terminals.length) % sess.terminals.length;
    updateSession(activeSessionId, { activeTerminalKey: sess.terminals[nextIdx].localKey });
    if (terminalCollapsed) setTerminalCollapsed(false);
  }

  function termCloseActive() {
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (!sess || !sess.activeTerminalKey) return;
    const tab = sess.terminals.find((t) => t.localKey === sess.activeTerminalKey);
    if (tab?.id) termClose(tab.id).catch(() => {});
    const next = sess.terminals.filter((t) => t.localKey !== sess.activeTerminalKey);
    updateSession(activeSessionId, {
      terminals: next,
      activeTerminalKey: next[0]?.localKey ?? null,
    });
  }

  return { termAddTab, termCycleTab, termCloseActive };
}
```

- [ ] **Step 2: Replace terminal helpers in `App.tsx`**

Remove from `App.tsx`:
- `function termAddTab()` (lines 497–507)
- `function termCycleTab(...)` (lines 509–516)
- `function termCloseActive()` (lines 518–528)

Add import and hook call in `App()` after `useSessions` and `useProfile`:

```typescript
import { useTerminalTabs } from './hooks/useTerminalTabs';

// inside App():
const { termAddTab, termCycleTab, termCloseActive } = useTerminalTabs(
  sessions,
  activeSessionId,
  projectPath,
  terminalCollapsed,
  setTerminalCollapsed,
  updateSession,
);
```

The keyboard shortcut `useEffect` (lines 530–619) references `termAddTab`, `termCycleTab`, `termCloseActive` by name — no changes needed there since the names are preserved.

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 8: Create `src/hooks/useAgentEvents.ts`

**Files:**
- Create: `src/hooks/useAgentEvents.ts`
- Modify: `src/App.tsx`

**Why:** The agent event listener setup (Tauri `listen('agent-event')`, per-session `unlistensBySessionRef`, RAF token batching, `pendingTokensRef`, `lastTokenAtRef`, `flushTokens`, and the `streamingText` interval) is the most complex state domain. Extracting it isolates all streaming logic from CRUD logic and makes it independently testable with fixture events.

**Exact state extracted:**
- `unlistensBySessionRef` (line 199)
- `pendingTokensRef` (line 201)
- `rafScheduledRef` (line 202)
- `lastTokenAtRef` (line 204)
- `streamingText` interval `useEffect` (lines 366–387)
- `function flushTokens()` (lines 622–642)
- The entire `listen('agent-event', ...)` block inside `handleSubmit` (lines 677–861)
- The `unlisten` wiring + `unlistensBySessionRef` management (lines 863–896)

This hook does NOT own `handleSubmit` itself — that function stays in `App.tsx` because it orchestrates session creation, routing, and the `invoke('start_task')` call. `useAgentEvents` returns a `startListening` callback that `handleSubmit` calls to attach a listener for a given session.

- [ ] **Step 1: Create `src/hooks/useAgentEvents.ts`**

```typescript
/**
 * src/hooks/useAgentEvents.ts
 *
 * Manages Tauri agent-event listeners, per-session RAF token batching,
 * and the streamingText status interval.
 *
 * Key design decisions (preserved from original App.tsx):
 * - One listener per session, keyed by sessionId in `unlistensBySessionRef`.
 * - Tokens are buffered in `pendingTokensRef` and flushed via RAF (60fps).
 * - `streamingText` is driven by a 500ms interval that checks the last-token
 *   timestamp — not by event count, so it naturally goes false when streaming stops.
 * - The listener is torn down by the session itself (done/stopped/error events),
 *   NOT by the hook unmount, because sessions outlive individual renders.
 */
import { useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { startTask, summarizeSession } from '../services/tauri';
import type { AgentEvent } from '../types/agent-events';
import type { PermissionRequest } from '../types/permissions';
import type { SessionState } from './useSessions';
import type { Message, PlanItem, ToolCall } from '../data/sample';

export interface StartListeningArgs {
  sessionId: string;
  projectPath: string;
  worktreePath: string;
  prompt: string;
  resumeId: string | undefined;
  model: string;
}

export interface UseAgentEventsReturn {
  /**
   * Attaches a Tauri agent-event listener for the given session, invokes
   * start_task, and manages cleanup. Replaces the inline listen() block
   * that was in handleSubmit.
   */
  startListening: (args: StartListeningArgs) => Promise<void>;
  /** Imperatively detaches the listener for a session (used by handleRemoveSession). */
  detachListener: (sessionId: string) => void;
  /** Removes token buffer entries for a session (used by handleRemoveSession). */
  clearTokenBuffer: (sessionId: string) => void;
}

export function useAgentEvents(
  setSessions: React.Dispatch<React.SetStateAction<SessionState[]>>,
  addPermission: (req: PermissionRequest) => void,
  updateSession: (id: string, updates: Partial<SessionState>) => void,
): UseAgentEventsReturn {
  // Per-session listener unsubscribe functions
  const unlistensBySessionRef = useRef<Map<string, () => void>>(new Map());
  // Token coalescing: buffer incoming token chunks and flush via RAF
  const pendingTokensRef = useRef<Map<string, string>>(new Map());
  const rafScheduledRef = useRef(false);
  // Last-token timestamp per session — drives the streamingText status tick
  const lastTokenAtRef = useRef<Map<string, number>>(new Map());

  // ── streamingText status tick ────────────────────────────────────────────
  // Runs a 500ms interval while any session is running. Flips streamingText
  // to false when no token has arrived in the last 600ms.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setSessions((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (!s.isRunning) return s;
          const streaming = (now - (lastTokenAtRef.current.get(s.id) ?? 0)) < 600;
          if (streaming === (s.streamingText ?? false)) return s;
          changed = true;
          return { ...s, streamingText: streaming };
        });
        return changed ? next : prev;
      });
    }, 500);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Note: intentionally no deps — the interval runs once for the app lifetime.
  // Original code gated on `sessions.some(s => s.isRunning)` to avoid the
  // interval when idle; the check inside the interval body is equivalent and
  // avoids re-registering on every session change.

  // ── Token flush via requestAnimationFrame ────────────────────────────────
  function flushTokens() {
    rafScheduledRef.current = false;
    if (pendingTokensRef.current.size === 0) return;
    const pending = new Map(pendingTokensRef.current);
    pendingTokensRef.current.clear();
    setSessions((prev) =>
      prev.map((s) => {
        const chunk = pending.get(s.id);
        if (!chunk) return s;
        const last = s.messages[s.messages.length - 1];
        if (last?.role === 'assistant') {
          return {
            ...s,
            messages: [
              ...s.messages.slice(0, -1),
              { ...last, content: (last.content ?? '') + chunk },
            ],
          };
        }
        return {
          ...s,
          messages: [
            ...s.messages,
            {
              id: `msg-${Date.now()}-a`,
              role: 'assistant' as const,
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: chunk,
            },
          ],
        };
      }),
    );
  }

  // ── startListening ────────────────────────────────────────────────────────
  async function startListening({
    sessionId,
    projectPath,
    worktreePath,
    prompt,
    resumeId,
    model,
  }: StartListeningArgs): Promise<void> {
    const unlisten = await listen<AgentEvent>('agent-event', (event) => {
      const ev = event.payload;
      if (ev.task_id !== sessionId) return;

      switch (ev.type) {
        case 'token': {
          lastTokenAtRef.current.set(sessionId, Date.now());
          pendingTokensRef.current.set(
            sessionId,
            (pendingTokensRef.current.get(sessionId) ?? '') + ev.content,
          );
          if (!rafScheduledRef.current) {
            rafScheduledRef.current = true;
            requestAnimationFrame(flushTokens);
          }
          break;
        }
        case 'plan': {
          const mapped: PlanItem[] = ev.items.map((item, i) => ({
            id: i + 1,
            status: item.status as PlanItem['status'],
            text: item.label,
          }));
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              if (s.messages.some((m) => m.role === 'plan')) return { ...s, planItems: mapped };
              return {
                ...s,
                planItems: mapped,
                messages: [
                  ...s.messages,
                  {
                    id: `msg-plan-${Date.now()}`,
                    role: 'plan' as const,
                    author: 'Claude',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: "Here's my plan. I'll mark each step done as I go.",
                    planItems: mapped,
                    planLabel: `0 OF ${mapped.length} COMPLETE`,
                  },
                ],
              };
            }),
          );
          break;
        }
        case 'tool': {
          if (ev.status === 'done') {
            updateSession(sessionId, { currentTool: null });
          } else if (ev.tool) {
            const tc: ToolCall = {
              id: ev.id,
              tool: ev.tool as ToolCall['tool'],
              path: ev.path,
              detail: ev.detail,
            };
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                const alreadyHas = s.toolCalls.some((t) => t.id === ev.id);
                const newToolCalls = alreadyHas ? s.toolCalls : [...s.toolCalls, tc];
                const last = s.messages[s.messages.length - 1];
                const newMessages =
                  last?.role === 'tools'
                    ? [
                        ...s.messages.slice(0, -1),
                        { ...last, tools: [...(last.tools ?? []), tc] },
                      ]
                    : [
                        ...s.messages,
                        { id: `msg-tools-${Date.now()}`, role: 'tools' as const, tools: [tc] },
                      ];
                return {
                  ...s,
                  toolCalls: newToolCalls,
                  messages: newMessages,
                  currentTool: { name: ev.tool, path: ev.path },
                };
              }),
            );
          }
          break;
        }
        case 'diff': {
          updateSession(sessionId, { diffPatch: ev.patch, taskState: 'review' });
          break;
        }
        case 'session': {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId && !s.claudeSessionId ? { ...s, claudeSessionId: ev.id } : s,
            ),
          );
          break;
        }
        case 'permission': {
          const req: PermissionRequest = {
            id: ev.id,
            tool: ev.tool,
            path: ev.path,
            detail: ev.detail,
            risk: ev.risk,
          };
          addPermission(req);
          updateSession(sessionId, { taskState: 'awaiting' });
          break;
        }
        case 'thinking': {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const last = s.messages[s.messages.length - 1];
              const appendToLast =
                last?.role === 'assistant' && !(last.content ?? '').trim();
              const newThinking = {
                content:
                  (appendToLast ? (last.thinking?.content ?? '') : '') + ev.content,
                finishedAt: ev.done ? Date.now() : undefined,
              };
              if (appendToLast) {
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    { ...last, thinking: newThinking },
                  ],
                };
              }
              return {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: `msg-${Date.now()}-a`,
                    role: 'assistant' as const,
                    author: 'Claude',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: '',
                    thinking: newThinking,
                  },
                ],
              };
            }),
          );
          break;
        }
        case 'usage': {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                tokenUsage: {
                  input: (s.tokenUsage?.input ?? 0) + ev.input,
                  output: (s.tokenUsage?.output ?? 0) + ev.output,
                  cacheRead: (s.tokenUsage?.cacheRead ?? 0) + ev.cache_read,
                  cacheCreation: (s.tokenUsage?.cacheCreation ?? 0) + ev.cache_creation,
                },
              };
            }),
          );
          break;
        }
        case 'done': {
          flushTokens();
          setSessions((prev) => {
            const sess = prev.find((s) => s.id === sessionId);
            if (
              sess &&
              !sess.titleLocked &&
              !sess.summarizedAtTurn &&
              sess.messages.length >= 2
            ) {
              const firstUser =
                sess.messages.find((m) => m.role === 'user')?.content ?? '';
              const lastAssistant =
                [...sess.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
              if (firstUser && lastAssistant) {
                const turnCount = sess.messages.length;
                summarizeSession(firstUser, lastAssistant)
                  .then((title) => {
                    setSessions((prev2) =>
                      prev2.map((s2) =>
                        s2.id !== sessionId || s2.titleLocked
                          ? s2
                          : { ...s2, title, summarizedAtTurn: turnCount },
                      ),
                    );
                  })
                  .catch(() => {});
              }
            }
            return prev.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    isRunning: false,
                    taskState: 'idle',
                    lastActivityAt: Date.now(),
                    currentTool: null,
                    streamingText: false,
                  },
            );
          });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
        case 'stopped': {
          flushTokens();
          updateSession(sessionId, {
            isRunning: false,
            taskState: 'idle',
            lastActivityAt: Date.now(),
            currentTool: null,
            streamingText: false,
          });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
        case 'error': {
          flushTokens();
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                isRunning: false,
                taskState: 'idle',
                currentTool: null,
                streamingText: false,
                messages: [
                  ...s.messages,
                  {
                    id: `msg-err-${Date.now()}`,
                    role: 'assistant' as const,
                    author: 'Claude',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    content: `Error: ${ev.message}`,
                  },
                ],
              };
            }),
          );
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
      }
    });

    unlistensBySessionRef.current.set(sessionId, unlisten);

    try {
      await startTask({ taskId: sessionId, projectPath: workDir, worktreePath: workDir, prompt, resumeSession: resumeId ?? null, model });
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            isRunning: false,
            messages: [
              ...s.messages,
              {
                id: `msg-err-${Date.now()}`,
                role: 'assistant' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: `Failed to start task: ${String(err)}`,
              },
            ],
          };
        }),
      );
      unlisten();
      unlistensBySessionRef.current.delete(sessionId);
    }
  }

  function detachListener(sessionId: string) {
    unlistensBySessionRef.current.get(sessionId)?.();
    unlistensBySessionRef.current.delete(sessionId);
  }

  function clearTokenBuffer(sessionId: string) {
    pendingTokensRef.current.delete(sessionId);
    lastTokenAtRef.current.delete(sessionId);
  }

  return { startListening, detachListener, clearTokenBuffer };
}
```

- [ ] **Step 2: Replace agent-event logic in `App.tsx`**

Remove from `App.tsx`:
- `unlistensBySessionRef` (line 199)
- `pendingTokensRef` (line 201)
- `rafScheduledRef` (line 202)
- `lastTokenAtRef` (line 204)
- The `streamingText` interval `useEffect` (lines 366–387)
- `function flushTokens()` (lines 622–642)
- The entire `listen('agent-event', ...)` block inside `handleSubmit`, up to and including `unlistensBySessionRef.current.set(sessionId, unlisten)` (lines 677–863)
- The `invoke('start_task', {...})` try/catch block (lines 865–896)
- The inline `addPermission` call in the old `'permission'` case — replaced by hook's internal handling

Add import and hook call in `App()`:

```typescript
import { useAgentEvents } from './hooks/useAgentEvents';

// inside App() — after usePermissions:
const { startListening, detachListener, clearTokenBuffer } = useAgentEvents(
  setSessions,
  addPermission,
  updateSession,
);
```

Simplify `handleSubmit` in `App.tsx` to:

```typescript
async function handleSubmit(
  prompt: string,
  override?: { sessionId: string; workDir: string },
) {
  if (!prompt.trim()) return;
  if (!override && (isRunning || !currentSession)) return;

  const sessionId = override?.sessionId ?? activeSessionId;

  setSessions((prev) =>
    prev.map((s) => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        isRunning: true,
        taskState: 'working',
        title: s.messages.length === 0 ? deriveHeuristicTitle(prompt) : s.title,
        lastActivityAt: Date.now(),
        messages: [
          ...s.messages,
          {
            id: `msg-${Date.now()}`,
            role: 'user' as const,
            author: 'You',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: prompt,
          },
        ],
      };
    }),
  );

  const liveSession = sessions.find((s) => s.id === sessionId);
  const projectRoot = projects.find(p => p.name === liveSession?.project)?.path ?? projectPath;
  const worktreeDir = liveSession?.worktreePath ?? projectRoot;
  await startListening({
    sessionId,
    projectPath: projectRoot,
    worktreePath: worktreeDir,
    prompt,
    resumeId: liveSession?.claudeSessionId,
    model: liveSession?.model ?? DEFAULT_MODEL,
  });
}
```

Update `handleRemoveSession` to use `detachListener` and `clearTokenBuffer`:

```typescript
function handleRemoveSession(id: string) {
  detachListener(id);
  clearTokenBuffer(id);
  const removingActive = id === activeSessionId;
  setSessions((prev) => prev.filter((s) => s.id !== id));
  if (removingActive) {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length > 0) setActiveSessionId(remaining[0].id);
  }
}
```

Update `handleStopActive` to use the service wrapper:

```typescript
import { stopTask } from './services/tauri';

async function handleStopActive() {
  if (!activeSessionId) return;
  try {
    await stopTask(activeSessionId);
  } catch (err) {
    console.error('stop_task failed:', err);
    detachListener(activeSessionId);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, isRunning: false, taskState: 'idle' } : s,
      ),
    );
  }
}
```

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 9: Create `src/hooks/useProjects.ts`

**Files:**
- Create: `src/hooks/useProjects.ts`
- Modify: `src/App.tsx`

**Why:** Project CRUD (`handleAddProject`, `handleRemoveProject`, `resolveTargetProject`) is a clean domain. The only cross-dep is reading `projects` (owned by `useProfile`) and `persistProfile`. This hook wraps those into a unified API.

**Exact code extracted:**
- `function resolveTargetProject(...)` (lines 902–913)
- `async function handleAddProject()` (lines 961–983)
- `function handleRemoveProject(id: string)` (lines 985–994)

- [ ] **Step 1: Create `src/hooks/useProjects.ts`**

```typescript
/**
 * src/hooks/useProjects.ts
 *
 * Project CRUD: add via directory picker, remove, and resolve the target
 * project for a new task based on current view context.
 */
import { chooseDirectory } from '../services/tauri';
import type { Project } from '../data/sample';
import type { View } from '../App';

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export interface UseProjectsReturn {
  resolveTargetProject: (explicitName?: string) => { name: string; path: string };
  handleAddProject: () => Promise<void>;
  handleRemoveProject: (id: string) => void;
}

export function useProjects(
  projects: Project[],
  setProjects: (v: Project[]) => void,
  projectPath: string,
  view: View,
  setView: (v: View) => void,
  persistProfile: (patch: Record<string, unknown>) => Promise<void>,
): UseProjectsReturn {

  function resolveTargetProject(explicitName?: string): { name: string; path: string } {
    if (explicitName) {
      const p = projects.find((p) => p.name === explicitName);
      if (p) return { name: p.name, path: p.path };
    }
    if (view.kind === 'project') {
      const p = projects.find((p) => p.name === view.project);
      if (p) return { name: p.name, path: p.path };
    }
    if (projects.length > 0) return { name: projects[0].name, path: projects[0].path };
    return { name: basename(projectPath), path: projectPath };
  }

  async function handleAddProject() {
    let dir: string | null = null;
    try {
      dir = await chooseDirectory();
    } catch (err) {
      console.error('choose_directory failed:', err);
      return;
    }
    if (!dir) return;

    const existing = projects.find((p) => p.path === dir);
    if (existing) {
      setView({ kind: 'project', project: existing.name });
      return;
    }

    const name = basename(dir);
    const newProject: Project = { id: `p-${Date.now()}`, name, path: dir, count: 0 };
    const next = [...projects, newProject];
    setProjects(next);
    persistProfile({ projects: next });
    setView({ kind: 'project', project: name });
  }

  function handleRemoveProject(id: string) {
    const next = projects.filter((p) => p.id !== id);
    setProjects(next);
    persistProfile({ projects: next });
    const removed = projects.find((p) => p.id === id);
    if (removed && view.kind === 'project' && view.project === removed.name) {
      setView({ kind: 'chat' });
    }
  }

  return { resolveTargetProject, handleAddProject, handleRemoveProject };
}
```

- [ ] **Step 2: Replace project handlers in `App.tsx`**

Remove from `App.tsx`:
- `function resolveTargetProject(...)` (lines 902–913)
- `async function handleAddProject()` (lines 961–983)
- `function handleRemoveProject(id: string)` (lines 985–994)

Add import and hook call in `App()`:

```typescript
import { useProjects } from './hooks/useProjects';

// inside App():
const { resolveTargetProject, handleAddProject, handleRemoveProject } = useProjects(
  projects,
  setProjects,
  projectPath,
  view,
  setView,
  persistProfile,
);
```

- [ ] **Step 3: Verify `tsc --noEmit` and tests pass**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Task 10: Final cleanup — replace remaining inline `invoke()` calls in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Why:** After Tasks 1–9, `App.tsx` still has inline `invoke` calls in `doCommit` (`git_commit`) and `doReject` (`git_discard`). Replace each with the typed service wrappers. After this task, `App.tsx` should have zero direct `invoke()` imports.

> **Note:** Phase 1 Task 9 already removed the `get_current_branch` calls from `handleNewTask` and `handleAutomationRun` — those are not present here.

**Exact replacements:**

In `doCommit`:
```typescript
// Before:
await invoke('git_commit', { worktreePath: currentSession.worktreePath, message });
// After:
await gitCommit(currentSession.worktreePath!, message);
```

In `doReject`:
```typescript
// Before:
await invoke('git_discard', { worktreePath: currentSession.worktreePath });
// After:
await gitDiscard(currentSession.worktreePath!);
```

- [ ] **Step 1: Apply the two replacements in `App.tsx`**

Also remove the `import { invoke } from '@tauri-apps/api/core'` import from line 2 of `App.tsx` — it should no longer be referenced after this task. Replace with:

```typescript
import { loadProfile, gitCommit, gitDiscard, stopTask } from './services/tauri';
```

(Note: `stopTask` is used in `handleStopActive` from Task 8. `loadProfile` is used in the `onComplete` callback. `getCurrentBranch` is no longer needed in `App.tsx` — Phase 1 removed those call sites. `gitCommit` and `gitDiscard` accept `worktreePath` as their first argument — see the updated signatures in `tauri.ts`.)

- [ ] **Step 2: Verify zero `invoke` imports remain in `App.tsx`**

```bash
grep "from '@tauri-apps/api/core'" /Users/sam/workspace/claude-window/src/App.tsx
# Should print nothing
grep "invoke(" /Users/sam/workspace/claude-window/src/App.tsx
# Should print nothing
```

- [ ] **Step 3: Final full verification**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit && npm test -- --run
```

---

### Final state: what App.tsx looks like after all tasks

`App.tsx` shrinks from 1473 lines to approximately 350 lines. It contains:

1. Imports (hooks, services, components, types)
2. `basename`, `tildeify`, `relativeTime`, `deriveHeuristicTitle`, `diffStats` pure helpers
3. `EmptyChatState` component (unchanged — it's a pure render helper)
4. `View` type export (unchanged)
5. `App()` function body:
   - Hook calls (8 total: `useProfile`, `useSessions`, `useAutomations`, `usePermissions`, `useTerminalTabs`, `useAgentEvents`, `useProjects`, `useState` for `showSettings`/`showCommitModal`/`showRejectConfirm`/`view`)
   - `currentSession` and its derived values (unchanged)
   - `handleSubmit` (slimmed — delegates to `startListening`)
   - `handleNewTask` (uses `resolveTargetProject`; `get_current_branch` removed in Phase 1)
   - `handleSessionSelect`, `handleRemoveSession` (uses `detachListener`, `clearTokenBuffer`)
   - `handleStopActive` (uses `stopTask`, `detachListener`)
   - Panel handlers (`openInPanel`, `setPanelActive`, `closePanelTab`, `setPanelCollapsed`)
   - Automation handlers (`handleAutomationCreate`, `handleAutomationUpdate`, `handleAutomationDelete`, `handleAutomationRun`)
   - Commit/reject handlers (`handleCommit`, `doCommit`, `handleReject`, `doReject`)
   - Keyboard shortcut `useEffect` (unchanged)
   - Render JSX (unchanged)

---

### Hook call order in `App()` (dependency order matters)

```typescript
// 1. Profile (no deps)
const { onboardingDone, setOnboardingDone, projectPath, setProjectPath, setApiKey,
        projects, setProjects, terminalCollapsed, setTerminalCollapsed,
        railWidth, setRailWidth, reviewWidth, setReviewWidth,
        railZoom, setRailZoom, convZoom, setConvZoom, reviewZoom, setReviewZoom,
        persistProfile } = useProfile();

// 2. Sessions (depends on onboardingDone)
const { sessions, setSessions, activeSessionId, setActiveSessionId, updateSession } =
  useSessions(onboardingDone);

// 3. Automations (depends on onboardingDone)
const { automations, setAutomations } = useAutomations(onboardingDone);

// 4. Permissions (depends on activeSessionId, setSessions, projectPath)
const { pendingPermissions, addPermission, lowRiskPerms, highRiskPerms,
        handlePermAllow, handlePermDeny, handlePermAlwaysAllow } =
  usePermissions(activeSessionId, setSessions, projectPath);

// 5. Agent events (depends on setSessions, addPermission, updateSession)
const { startListening, detachListener, clearTokenBuffer } =
  useAgentEvents(setSessions, addPermission, updateSession);

// 6. Terminal tabs (depends on sessions, activeSessionId, projectPath, terminalCollapsed)
const { termAddTab, termCycleTab, termCloseActive } = useTerminalTabs(
  sessions, activeSessionId, projectPath, terminalCollapsed, setTerminalCollapsed, updateSession,
);

// 7. Projects (depends on projects, setProjects, projectPath, view, setView, persistProfile)
const { resolveTargetProject, handleAddProject, handleRemoveProject } = useProjects(
  projects, setProjects, projectPath, view, setView, persistProfile,
);

// 8. Local UI state (no deps)
const [showSettings, setShowSettings] = useState(false);
const [showCommitModal, setShowCommitModal] = useState(false);
const [showRejectConfirm, setShowRejectConfirm] = useState(false);
const [view, setView] = useState<View>({ kind: 'chat' });
```

> **Note on hook ordering:** `view` and `setView` are local `useState` — they must be declared before `useProjects` is called. Move `const [view, setView] = useState<View>({ kind: 'chat' })` to before the `useProfile()` call, since React rules require all hooks to be called in a consistent order regardless.

---

### Verification checklist (run after every task)

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test -- --run` exits 0 (Phase 4 tests pass)
- [ ] App loads, shows onboarding on fresh install, shows main shell after profile exists
- [ ] Sessions load from `~/.workbench/sessions.json`, active session is restored
- [ ] Sending a message starts the agent, tokens stream at 60fps
- [ ] Permission modal appears for high-risk tool, banner for low-risk
- [ ] Commit modal commits; reject confirm discards
- [ ] Terminal tabs: ⌘T adds, ⌘W closes, ⌘⇧] cycles
- [ ] Zoom: ⌘+ / ⌘- adjusts hovered panel, ⌘0 resets
- [ ] No `invoke(` raw strings remain in `App.tsx` after Task 10
