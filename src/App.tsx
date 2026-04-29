import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import TitleBar from './components/TitleBar';
import SessionRail from './components/SessionRail';
import Conversation from './components/Conversation';
import ReviewPanel from './components/ReviewPanel';
import TerminalPanel from './components/TerminalPanel';
import DebugMenu from './components/DebugMenu';
import Onboarding from './components/Onboarding';
import SettingsOverlay from './components/Settings';
import PermissionBanner from './components/PermissionBanner';
import PermissionModal from './components/PermissionModal';
import CommitModal from './components/CommitModal';
import ConfirmModal from './components/ConfirmModal';
import { AUTOMATIONS } from './data/sample';
import { AllChatsPage, SearchPage, ProjectPage } from './components/Pages';
import { AutomationsPage } from './components/AutomationsPage';
import { PluginsPage } from './components/PluginsPage';
import type { Automation, Message, PlanItem, Project, ToolCall } from './data/sample';
import type { AgentEvent } from './types/agent-events';
import type { PermissionRequest } from './types/permissions';
import { basename, tildeify, relativeTime, diffStats, deriveHeuristicTitle } from './lib/utils';
import { AVATAR_COLORS, restoreSession } from './lib/session';
import { loadAppearance, applyAppearanceToDom } from './lib/appearance';

interface TerminalTabState {
  localKey: string;
  cwd: string;
  id?: string;
}

interface SessionState {
  id: string;
  initials: string;
  avatarBg: string;
  taskState: 'working' | 'review' | 'awaiting' | 'idle' | 'stopped';
  title: string;
  project: string;
  createdAt: number;
  /** Last time anything happened on this session (user msg, assistant msg,
   *  tool call, diff, done). Drives the 24h Active/Recent split. */
  lastActivityAt: number;
  /** Model alias (or full id) — passed to claude via --model. */
  model: string;
  /** Files the user has opened in the right-side panel for this session.
   *  Persisted so closing/reopening the session restores the same tabs. */
  panelTabs: string[];
  /** Currently-focused panel tab.
   *  - "review" / "summary" → built-in tabs (only meaningful when there's a diff)
   *  - any other string     → an absolute file path from `panelTabs` */
  panelActive: string;
  /** User-collapsed the side panel? Independent of having tabs/diff. */
  panelCollapsed: boolean;
  messages: Message[];
  planItems: PlanItem[];
  toolCalls: ToolCall[];
  diffPatch: string;
  isRunning: boolean;
  // Worktree (optional — initial sessions run on the project itself)
  worktreePath?: string;
  worktreeBranch?: string;
  // Claude Code session id — captured from the first stream-json event of a
  // turn. Subsequent turns pass this back to `start_task` via `--resume` so
  // we keep the same conversation context instead of starting fresh.
  claudeSessionId?: string;
  // Terminal tabs scoped to this session
  terminals: TerminalTabState[];
  activeTerminalKey: string | null;
  // Current tool being executed (displayed in rail status subtext)
  currentTool?: { name: string; path: string } | null;
  // Whether the session is actively streaming tokens (drives rail animation)
  streamingText?: boolean;
  // Title management
  titleLocked?: boolean;
  summarizedAtTurn?: number;
  // Accumulated token usage for the usage footer
  tokenUsage?: { input: number; output: number; cacheRead: number; cacheCreation: number };
}


function EmptyChatState({
  hasProjects,
  onNewChat,
  onAddProject,
}: {
  hasProjects: boolean;
  onNewChat: () => void;
  onAddProject: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-paper)',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ maxWidth: 380, textAlign: 'center', padding: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 24,
            fontWeight: 400,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            marginBottom: 10,
          }}
        >
          {hasProjects ? 'No active chats' : 'Add a project to start'}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13.5,
            color: 'var(--text-dim)',
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          {hasProjects
            ? 'Start a new chat to point Claude at one of your projects.'
            : 'Open a directory to use as your first project — Claude will run on its current branch.'}
        </div>
        <button
          type="button"
          onClick={hasProjects ? onNewChat : onAddProject}
          style={{
            height: 34,
            padding: '0 18px',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          {hasProjects ? 'New chat' : 'Add project'}
        </button>
      </div>
    </div>
  );
}


export type View =
  | { kind: 'chat' }
  | { kind: 'search' }
  | { kind: 'all-chats' }
  | { kind: 'automations' }
  | { kind: 'plugins' }
  | { kind: 'project'; project: string };

export default function App() {
  // Onboarding gate: null = loading, false = needs onboarding, true = done
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  function showError(message: string) {
    setToast(message);
    if (toastTimerRef.current != null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  }

  // Apply stored appearance to DOM before first paint
  useEffect(() => {
    applyAppearanceToDom(loadAppearance());
  }, []);

  // Per-session listener unsubscribe functions. Keyed by session id so
  // concurrent sessions each manage their own listener independently.
  const unlistensBySessionRef = useRef<Map<string, () => void>>(new Map());
  // Token coalescing: buffer incoming token chunks and flush via RAF
  const pendingTokensRef = useRef<Map<string, string>>(new Map());
  const rafScheduledRef = useRef(false);
  // Last-token timestamp per session — drives the streamingText status tick
  const lastTokenAtRef = useRef<Map<string, number>>(new Map());
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [view, setView] = useState<View>({ kind: 'chat' });

  // Profile data (loaded from ~/.workbench/profile.json)
  const [projectPath, setProjectPath] = useState('/tmp');
  const [apiKey, setApiKey] = useState('');
  const [yoloMode, setYoloMode] = useState(false);

  // Project list — persisted in profile.json under `projects`
  const [projects, setProjects] = useState<Project[]>([]);

  // Automations — persisted in ~/.workbench/automations.json
  const [automations, setAutomations] = useState<Automation[]>(AUTOMATIONS);
  const automationsLoadedRef = useRef(false);

  const DEFAULT_MODEL = 'sonnet';

  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  // Terminal panel collapsed state (persisted)
  const [terminalCollapsed, setTerminalCollapsed] = useState<boolean>(false);

  // Resizable column widths (persisted in profile.json under `layout`).
  const [railWidth,   setRailWidth]   = useState<number>(240);
  const [reviewWidth, setReviewWidth] = useState<number>(420);

  // Per-panel zoom — Cmd+/- adjusts whichever panel the mouse is hovering.
  // 1.0 = default, range [0.7, 1.5]. Persisted alongside widths.
  const [railZoom,   setRailZoom]   = useState<number>(1);
  const [convZoom,   setConvZoom]   = useState<number>(1);
  const [reviewZoom, setReviewZoom] = useState<number>(1);
  const hoveredPanelRef = useRef<'rail' | 'conv' | 'review' | null>(null);

  // Permission state
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);

  // Derive current session state (may be undefined if there are no sessions yet)
  const currentSession: SessionState | undefined =
    sessions.find(s => s.id === activeSessionId) ?? sessions[0];
  const messages = currentSession?.messages ?? [];
  const planItems = currentSession?.planItems ?? [];
  const diffPatch = currentSession?.diffPatch ?? '';
  const isRunning = currentSession?.isRunning ?? false;
  const taskTitle = currentSession?.title ?? 'New task';

  function updateSession(id: string, updates: Partial<SessionState>) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  // ── Load profile on startup ────────────────────────────────────────────────
  useEffect(() => {
    invoke<string | null>('load_profile')
      .then((raw) => {
        if (raw) {
          try {
            const profile = JSON.parse(raw);
            if (profile.projectPath) setProjectPath(profile.projectPath);
            if (profile.apiKey) setApiKey(profile.apiKey);
            if (typeof profile.yoloMode === 'boolean') setYoloMode(profile.yoloMode);
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
            if (typeof profile.railWidth === 'number') {
              setRailWidth(profile.railWidth);
            }
            if (typeof profile.reviewWidth === 'number') {
              setReviewWidth(profile.reviewWidth);
            }
            if (typeof profile.railZoom   === 'number') setRailZoom(profile.railZoom);
            if (typeof profile.convZoom   === 'number') setConvZoom(profile.convZoom);
            if (typeof profile.reviewZoom === 'number') setReviewZoom(profile.reviewZoom);
            // Mark onboarding done if we have a project path
            setOnboardingDone(!!profile.projectPath);
            return;
          } catch {}
        }
        // Fall back to localStorage gate check
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      })
      .catch(() => {
        setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
      });
  }, []);

  // ── Persist profile (merge-patch) ──────────────────────────────────────────
  async function persistProfile(patch: Record<string, unknown>) {
    try {
      const raw = await invoke<string | null>('load_profile');
      const existing = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
      const next = { ...existing, ...patch };
      await invoke('save_profile', { data: JSON.stringify(next) });
    } catch (err) {
      console.error('persistProfile failed:', err);
    }
  }

  // Persist terminalCollapsed UI preference to profile (separate from sessions).
  useEffect(() => {
    if (onboardingDone !== true) return;
    persistProfile({ terminalCollapsed });
  }, [terminalCollapsed, onboardingDone]);

  // Persist resizable widths + per-panel zoom (debounced — both fire many updates).
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
  }, [railWidth, reviewWidth, railZoom, convZoom, reviewZoom, onboardingDone]);

  // ── Automations: load on first ready, save on change ──────────────────────
  useEffect(() => {
    if (onboardingDone !== true || automationsLoadedRef.current) return;
    automationsLoadedRef.current = true;
    invoke<string | null>('load_automations').then((raw) => {
      if (!raw) return; // keep seed defaults
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.automations)) {
          setAutomations(parsed.automations);
        }
      } catch (err) {
        console.error('load_automations parse failed:', err);
      }
    }).catch((err) => {
      console.error('load_automations failed:', err);
    });
  }, [onboardingDone]);

  const automationsSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (onboardingDone !== true || !automationsLoadedRef.current) return;
    if (automationsSaveTimerRef.current != null) {
      window.clearTimeout(automationsSaveTimerRef.current);
    }
    automationsSaveTimerRef.current = window.setTimeout(() => {
      const payload = JSON.stringify({ version: 1, automations });
      invoke('save_automations', { data: payload }).catch((err) => {
        console.error('save_automations failed:', err);
      });
    }, 300);
    return () => {
      if (automationsSaveTimerRef.current != null) {
        window.clearTimeout(automationsSaveTimerRef.current);
      }
    };
  }, [automations, onboardingDone]);

  // ── streamingText status tick ─────────────────────────────────────────────
  // Runs a 500ms interval while any session is running and flips streamingText
  // based on whether a token arrived within the last 600ms.
  useEffect(() => {
    if (!sessions.some(s => s.isRunning)) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setSessions(prev => {
        let changed = false;
        const next = prev.map(s => {
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
  }, [sessions.some(s => s.isRunning)]);

  // ── Session persistence ────────────────────────────────────────────────────
  // Schema lives in ~/.workbench/sessions.json:
  //   { version: 1, activeSessionId, sessions: SerializedSession[] }
  // Ephemeral fields (isRunning, PTY ids) are stripped on save and reset on load.
  const sessionsLoadedRef = useRef(false);

  useEffect(() => {
    if (onboardingDone !== true || sessionsLoadedRef.current) return;
    sessionsLoadedRef.current = true;
    invoke<string | null>('load_sessions').then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return;
        const restored = parsed.sessions.map(restoreSession) as SessionState[];
        setSessions(restored);
        if (parsed.activeSessionId && restored.some(s => s.id === parsed.activeSessionId)) {
          setActiveSessionId(parsed.activeSessionId);
        } else {
          setActiveSessionId(restored[0].id);
        }
      } catch (err) {
        console.error('load_sessions parse failed:', err);
      }
    }).catch((err) => {
      console.error('load_sessions failed:', err);
    });
  }, [onboardingDone]);

  // Debounced save whenever sessions or active id changes.
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (onboardingDone !== true || !sessionsLoadedRef.current) return;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const payload = {
        version: 1,
        activeSessionId,
        sessions: sessions.map(s => ({
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
          terminals: s.terminals.map(t => ({ cwd: t.cwd })),
          tokenUsage: s.tokenUsage,
          titleLocked: s.titleLocked,
          summarizedAtTurn: s.summarizedAtTurn,
        })),
      };
      invoke('save_sessions', { data: JSON.stringify(payload) }).catch((err) => {
        console.error('save_sessions failed:', err);
      });
    }, 400);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, onboardingDone]);

  // ── Terminal helpers (also reused by keyboard shortcuts) ─────────────────
  function termAddTab() {
    const sess = sessions.find(s => s.id === activeSessionId);
    if (!sess) return;
    const cwd = sess.worktreePath ?? projectPath;
    const t: TerminalTabState = { localKey: `t-${Date.now()}`, cwd };
    updateSession(activeSessionId, {
      terminals: [...sess.terminals, t],
      activeTerminalKey: t.localKey,
    });
    if (terminalCollapsed) setTerminalCollapsed(false);
  }

  function termCycleTab(dir: 1 | -1) {
    const sess = sessions.find(s => s.id === activeSessionId);
    if (!sess || sess.terminals.length === 0) return;
    const idx = sess.terminals.findIndex(t => t.localKey === sess.activeTerminalKey);
    const nextIdx = ((idx === -1 ? 0 : idx) + dir + sess.terminals.length) % sess.terminals.length;
    updateSession(activeSessionId, { activeTerminalKey: sess.terminals[nextIdx].localKey });
    if (terminalCollapsed) setTerminalCollapsed(false);
  }

  function termCloseActive() {
    const sess = sessions.find(s => s.id === activeSessionId);
    if (!sess || !sess.activeTerminalKey) return;
    const tab = sess.terminals.find(t => t.localKey === sess.activeTerminalKey);
    if (tab?.id) invoke('term_close', { id: tab.id }).catch(() => {});
    const next = sess.terminals.filter(t => t.localKey !== sess.activeTerminalKey);
    updateSession(activeSessionId, {
      terminals: next,
      activeTerminalKey: next[0]?.localKey ?? null,
    });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      // xterm renders into a div with class "xterm" — when its textarea has focus
      // we still want to intercept ⌘-keys (the shell doesn't see them anyway).
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return !t.closest('.xterm');
      }
      return t.isContentEditable;
    }

    function bumpZoom(target: 'rail' | 'conv' | 'review' | null, delta: number) {
      const clamp = (v: number) => Math.round(Math.max(0.7, Math.min(1.5, v)) * 100) / 100;
      if (target === 'rail')   setRailZoom(z   => clamp(z + delta));
      if (target === 'conv')   setConvZoom(z   => clamp(z + delta));
      if (target === 'review') setReviewZoom(z => clamp(z + delta));
    }
    function resetZoom(target: 'rail' | 'conv' | 'review' | null) {
      if (target === 'rail')   setRailZoom(1);
      if (target === 'conv')   setConvZoom(1);
      if (target === 'review') setReviewZoom(1);
    }

    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // ⌘+ / ⌘= : grow font of the panel under the cursor
      if ((e.key === '=' || e.key === '+') && !e.altKey) {
        e.preventDefault();
        bumpZoom(hoveredPanelRef.current, 0.1);
        return;
      }
      // ⌘-  shrink font
      if (e.key === '-' && !e.altKey) {
        e.preventDefault();
        bumpZoom(hoveredPanelRef.current, -0.1);
        return;
      }
      // ⌘0  reset to 1.0
      if (e.key === '0' && !e.altKey) {
        e.preventDefault();
        resetZoom(hoveredPanelRef.current);
        return;
      }
      // ⌘N  new chat
      if (e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        handleNewTask();
        return;
      }
      // ⌘T  new terminal
      if (e.key.toLowerCase() === 't' && !e.shiftKey && !e.altKey) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        termAddTab();
        return;
      }
      // ⌘J  toggle hide/show terminal panel
      if (e.key.toLowerCase() === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setTerminalCollapsed(c => !c);
        return;
      }
      // ⌘W  close current terminal tab (only when terminal is focused)
      if (e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey) {
        const inTerm = (e.target as HTMLElement | null)?.closest?.('.xterm');
        if (!inTerm) return;
        e.preventDefault();
        termCloseActive();
        return;
      }
      // ⌘⇧]  next, ⌘⇧[  previous
      if (e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        termCycleTab(1);
        return;
      }
      if (e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        termCycleTab(-1);
        return;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, activeSessionId, projectPath, terminalCollapsed]);

  // ── Token flush via requestAnimationFrame ────────────────────────────────
  function flushTokens() {
    rafScheduledRef.current = false;
    if (pendingTokensRef.current.size === 0) return;
    const pending = new Map(pendingTokensRef.current);
    pendingTokensRef.current.clear();
    setSessions(prev => prev.map(s => {
      const chunk = pending.get(s.id);
      if (!chunk) return s;
      const last = s.messages[s.messages.length - 1];
      if (last?.role === 'assistant') {
        return { ...s, messages: [...s.messages.slice(0, -1), { ...last, content: (last.content ?? '') + chunk }] };
      }
      return { ...s, messages: [...s.messages, {
        id: `msg-${Date.now()}-a`,
        role: 'assistant' as const,
        author: 'Claude',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: chunk,
      }] };
    }));
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  // `override` lets a caller (e.g. an automation run) target a session that
  // was just created and may not yet be reflected in `currentSession`.
  async function handleSubmit(
    prompt: string,
    override?: { sessionId: string; workDir: string },
  ) {
    if (!prompt.trim()) return;
    if (!override && (isRunning || !currentSession)) return;

    const sessionId = override?.sessionId ?? activeSessionId;

    // Look up session (may not be flushed to React state yet for automation-spawned sessions)
    const sess = sessions.find(s => s.id === sessionId);
    const projPath = sess?.project
      ? (projects.find(p => p.name === sess.project)?.path ?? projectPath)
      : (override?.workDir ?? projectPath);

    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        isRunning: true,
        taskState: 'working',
        title: s.messages.length === 0 ? deriveHeuristicTitle(prompt) : s.title,
        lastActivityAt: Date.now(),
        messages: [...s.messages, {
          id: `msg-${Date.now()}`,
          role: 'user' as const,
          author: 'You',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: prompt,
        }],
      };
    }));

    // Ensure a dedicated worktree exists for this session before Claude starts
    let workDir: string | undefined = sess?.worktreePath;
    if (!workDir) {
      try {
        const wt = await invoke<{ path: string; branch: string }>('create_worktree', { projectPath: projPath });
        workDir = wt.path;
        setSessions(prev => prev.map(s => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            worktreePath: wt.path,
            worktreeBranch: wt.branch,
            terminals: s.terminals.length > 0
              ? [{ ...s.terminals[0], cwd: wt.path }, ...s.terminals.slice(1)]
              : s.terminals,
          };
        }));
      } catch (err) {
        setSessions(prev => prev.map(s => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            isRunning: false,
            taskState: 'idle',
            messages: [...s.messages, {
              id: `msg-err-${Date.now()}`,
              role: 'assistant' as const,
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: `Could not create isolated worktree: ${String(err)}`,
            }],
          };
        }));
        return;
      }
    }

    const unlisten = await listen<AgentEvent>('agent-event', (event) => {
      const ev = event.payload;
      // `app.emit` is a global broadcast — every listener receives every
      // emit. Drop events that belong to a different concurrent session so
      // two sessions running at the same time don't share output.
      if (ev.task_id !== sessionId) return;
      switch (ev.type) {
        case 'token': {
          lastTokenAtRef.current.set(sessionId, Date.now());
          pendingTokensRef.current.set(sessionId, (pendingTokensRef.current.get(sessionId) ?? '') + ev.content);
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
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            if (s.messages.some(m => m.role === 'plan')) return { ...s, planItems: mapped };
            return {
              ...s,
              planItems: mapped,
              messages: [...s.messages, {
                id: `msg-plan-${Date.now()}`,
                role: 'plan' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: "Here's my plan. I'll mark each step done as I go.",
                planItems: mapped,
                planLabel: `0 OF ${mapped.length} COMPLETE`,
              }],
            };
          }));
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
            setSessions(prev => prev.map(s => {
              if (s.id !== sessionId) return s;
              const alreadyHas = s.toolCalls.some(t => t.id === ev.id);
              const newToolCalls = alreadyHas ? s.toolCalls : [...s.toolCalls, tc];
              const last = s.messages[s.messages.length - 1];
              const newMessages = last?.role === 'tools'
                ? [...s.messages.slice(0, -1), { ...last, tools: [...(last.tools ?? []), tc] }]
                : [...s.messages, { id: `msg-tools-${Date.now()}`, role: 'tools' as const, tools: [tc] }];
              return { ...s, toolCalls: newToolCalls, messages: newMessages, currentTool: { name: ev.tool, path: ev.path } };
            }));
          }
          break;
        }
        case 'diff': {
          updateSession(sessionId, { diffPatch: ev.patch, taskState: 'review' });
          break;
        }
        case 'session': {
          // Claude Code session id — store it so the next turn resumes the
          // same conversation. Only set if not already present (the id can be
          // re-emitted on resume but should remain stable).
          setSessions(prev => prev.map(s =>
            s.id === sessionId && !s.claudeSessionId ? { ...s, claudeSessionId: ev.id } : s,
          ));
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
          setPendingPermissions(prev => [...prev, req]);
          updateSession(sessionId, { taskState: 'awaiting' });
          break;
        }
        case 'thinking': {
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            const last = s.messages[s.messages.length - 1];
            // Only accumulate into an existing assistant message if it has no
            // text content yet — otherwise this is a new turn's thinking block
            // and we must not prepend it above a completed message's prose.
            const appendToLast = last?.role === 'assistant' && !(last.content ?? '').trim();
            const newThinking = {
              content: (appendToLast ? (last.thinking?.content ?? '') : '') + ev.content,
              finishedAt: ev.done ? Date.now() : undefined,
            };
            if (appendToLast) {
              return { ...s, messages: [...s.messages.slice(0, -1), { ...last, thinking: newThinking }] };
            }
            return { ...s, messages: [...s.messages, {
              id: `msg-${Date.now()}-a`,
              role: 'assistant' as const,
              author: 'Claude',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              content: '',
              thinking: newThinking,
            }] };
          }));
          break;
        }
        case 'usage': {
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return { ...s, tokenUsage: {
              input:         (s.tokenUsage?.input         ?? 0) + ev.input,
              output:        (s.tokenUsage?.output        ?? 0) + ev.output,
              cacheRead:     (s.tokenUsage?.cacheRead     ?? 0) + ev.cache_read,
              cacheCreation: (s.tokenUsage?.cacheCreation ?? 0) + ev.cache_creation,
            }};
          }));
          break;
        }
        case 'done': {
          flushTokens();
          setSessions(prev => {
            const sess = prev.find(s => s.id === sessionId);
            if (sess && !sess.titleLocked && !sess.summarizedAtTurn && sess.messages.length >= 2) {
              const firstUser = sess.messages.find(m => m.role === 'user')?.content ?? '';
              const lastAssistant = [...sess.messages].reverse().find(m => m.role === 'assistant')?.content ?? '';
              if (firstUser && lastAssistant) {
                const turnCount = sess.messages.length;
                invoke<string>('summarize_session', { firstUser, lastAssistant })
                  .then(title => {
                    setSessions(prev2 => prev2.map(s2 =>
                      s2.id !== sessionId || s2.titleLocked ? s2 : { ...s2, title, summarizedAtTurn: turnCount }
                    ));
                  })
                  .catch(() => {});
              }
            }
            return prev.map(s =>
              s.id !== sessionId ? s : { ...s, isRunning: false, taskState: 'idle', lastActivityAt: Date.now(), currentTool: null, streamingText: false }
            );
          });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
        case 'stopped': {
          flushTokens();
          updateSession(sessionId, { isRunning: false, taskState: 'idle', lastActivityAt: Date.now(), currentTool: null, streamingText: false });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
        case 'error': {
          flushTokens();
          // If Claude couldn't find the session to resume (stale claudeSessionId),
          // clear it so the next attempt starts a fresh session instead of failing again.
          const sessionLost = ev.message.includes('No conversation found') ||
            ev.message.includes('session') && ev.message.includes('not found');
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              isRunning: false,
              taskState: 'idle',
              currentTool: null,
              streamingText: false,
              claudeSessionId: sessionLost ? undefined : s.claudeSessionId,
              messages: [...s.messages, {
                id: `msg-err-${Date.now()}`,
                role: 'assistant' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: `Error: ${ev.message}`,
              }],
            };
          }));
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
      }
    });

    unlistensBySessionRef.current.set(sessionId, unlisten);

    try {
      // Look up the (possibly just-set) Claude Code session id for this
      // session and pass it as `--resume` so the conversation continues.
      // First turn: undefined → fresh session, id captured from output.
      const liveSession = sessions.find(s => s.id === sessionId);
      const resumeId = liveSession?.claudeSessionId;
      const model    = liveSession?.model ?? DEFAULT_MODEL;
      await invoke('start_task', {
        taskId: sessionId,
        projectPath: workDir!,
        prompt,
        resumeSession: resumeId ?? null,
        model,
        yoloMode,
      });
    } catch (err) {
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          isRunning: false,
          messages: [...s.messages, {
            id: `msg-err-${Date.now()}`,
            role: 'assistant' as const,
            author: 'Claude',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: `Failed to start task: ${String(err)}`,
          }],
        };
      }));
      unlisten();
      unlistensBySessionRef.current.delete(sessionId);
    }
  }

  // ── New task / session handlers ────────────────────────────────────────────
  // Resolve which project the new chat should be created against.
  // Priority: explicit arg → currently-viewed project → first project → fallback projectPath.
  function resolveTargetProject(explicitName?: string): { name: string; path: string } {
    if (explicitName) {
      const p = projects.find(p => p.name === explicitName);
      if (p) return { name: p.name, path: p.path };
    }
    if (view.kind === 'project') {
      const p = projects.find(p => p.name === view.project);
      if (p) return { name: p.name, path: p.path };
    }
    if (projects.length > 0) return { name: projects[0].name, path: projects[0].path };
    return { name: basename(projectPath), path: projectPath };
  }

  async function handleNewTask(projectName?: string) {
    // Nothing to clean up here — the active session's listener stays alive
    // if it's still running. Each session manages its own listener.

    const target = resolveTargetProject(projectName);

    // Run on the project's current branch (default branch / whatever it's on).
    // No worktree is created up-front — that can happen later when a task starts editing.
    let branch: string | undefined;
    try {
      branch = await invoke<string>('get_current_branch', { projectPath: target.path });
    } catch (err) {
      console.error('get_current_branch failed:', err);
    }

    const newId = `s-${Date.now()}`;
    const newSession: SessionState = {
      id: newId,
      initials: 'NW',
      avatarBg: AVATAR_COLORS[sessions.length % AVATAR_COLORS.length],
      taskState: 'idle',
      title: 'New task',
      project: target.name,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      model: DEFAULT_MODEL,
      panelTabs: [],
      panelActive: 'review',
      panelCollapsed: false,
      messages: [],
      planItems: [],
      toolCalls: [],
      diffPatch: '',
      isRunning: false,
      worktreePath: undefined,
      worktreeBranch: undefined,
      terminals: [{ localKey: `t-${Date.now()}`, cwd: target.path }],
      activeTerminalKey: null,  // panel will set on first render
    };
    newSession.activeTerminalKey = newSession.terminals[0].localKey;
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
    setView({ kind: 'chat' });
  }

  // ── Project add / remove ──────────────────────────────────────────────────
  async function handleAddProject() {
    let dir: string | null = null;
    try {
      dir = await invoke<string | null>('choose_directory');
    } catch (err) {
      console.error('choose_directory failed:', err);
      showError('Could not open the directory picker. Please try again.');
      return;
    }
    if (!dir) return;

    const existing = projects.find(p => p.path === dir);
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
    const next = projects.filter(p => p.id !== id);
    setProjects(next);
    persistProfile({ projects: next });
    // If we were viewing this project, return to chat view
    const removed = projects.find(p => p.id === id);
    if (removed && view.kind === 'project' && view.project === removed.name) {
      setView({ kind: 'chat' });
    }
  }

  // ── Chat remove ───────────────────────────────────────────────────────────
  function handleRemoveSession(id: string) {
    // Detach any running listener for this session before removing
    unlistensBySessionRef.current.get(id)?.();
    unlistensBySessionRef.current.delete(id);
    pendingTokensRef.current.delete(id);
    lastTokenAtRef.current.delete(id);
    const removingActive = id === activeSessionId;
    setSessions(prev => prev.filter(s => s.id !== id));
    if (removingActive) {
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
      }
    }
  }

  function handleSessionSelect(id: string) {
    setActiveSessionId(id);
    setView({ kind: 'chat' });
  }

  // ── Side panel handlers ───────────────────────────────────────────────────
  // Open a file in the active session's right-side panel. Adds a tab if it
  // wasn't already open, focuses it, and un-collapses the panel.
  function openInPanel(path: string) {
    if (!path || !activeSessionId) return;
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const tabs = s.panelTabs.includes(path) ? s.panelTabs : [...s.panelTabs, path];
      return { ...s, panelTabs: tabs, panelActive: path, panelCollapsed: false };
    }));
  }

  function setPanelActive(active: string) {
    if (!activeSessionId) return;
    updateSession(activeSessionId, { panelActive: active, panelCollapsed: false });
  }

  function closePanelTab(path: string) {
    if (!activeSessionId) return;
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const tabs = s.panelTabs.filter(t => t !== path);
      // If we closed the active tab, fall back to "review" (or "summary" if no diff).
      const nextActive = s.panelActive === path
        ? (s.diffPatch ? 'review' : (tabs[tabs.length - 1] ?? 'review'))
        : s.panelActive;
      return { ...s, panelTabs: tabs, panelActive: nextActive };
    }));
  }

  function setPanelCollapsed(collapsed: boolean) {
    if (!activeSessionId) return;
    updateSession(activeSessionId, { panelCollapsed: collapsed });
  }

  // ── Stop / cancel current task ────────────────────────────────────────────
  // Sends SIGKILL to the running claude process via stop_task. The Rust side
  // emits AgentEvent::Stopped which the listener handles to clean up state.
  // Falls back to local cleanup after 1s in case the event never arrives.
  async function handleStopActive() {
    if (!activeSessionId) return;
    try {
      await invoke('stop_task', { taskId: activeSessionId });
    } catch (err) {
      console.error('stop_task failed:', err);
      // Fallback: detach listener and clear state locally
      unlistensBySessionRef.current.get(activeSessionId)?.();
      unlistensBySessionRef.current.delete(activeSessionId);
      setSessions(prev => prev.map(s =>
        s.id === activeSessionId ? { ...s, isRunning: false, taskState: 'idle' } : s,
      ));
    }
  }

  // ── Automations handlers ──────────────────────────────────────────────────
  function handleAutomationCreate(draft: Omit<Automation, 'id' | 'createdAt'>) {
    const next: Automation = {
      ...draft,
      id: `a-${Date.now()}`,
      createdAt: Date.now(),
    };
    setAutomations((prev) => [next, ...prev]);
  }

  function handleAutomationUpdate(id: string, patch: Partial<Automation>) {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function handleAutomationDelete(id: string) {
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  }

  // Run an automation: figure out the project, spin up a new session there,
  // then submit the prompt as if the user had typed it.
  async function handleAutomationRun(a: Automation) {

    const target = resolveTargetProject(a.project || undefined);

    let branch: string | undefined;
    try {
      branch = await invoke<string>('get_current_branch', { projectPath: target.path });
    } catch (err) {
      console.error('get_current_branch failed:', err);
    }

    const newId = `s-${Date.now()}`;
    const newSession: SessionState = {
      id: newId,
      initials: 'AU',
      avatarBg: AVATAR_COLORS[sessions.length % AVATAR_COLORS.length],
      taskState: 'working',
      title: a.name,
      project: target.name,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      model: DEFAULT_MODEL,
      panelTabs: [],
      panelActive: 'review',
      panelCollapsed: false,
      messages: [],
      planItems: [],
      toolCalls: [],
      diffPatch: '',
      isRunning: false,
      worktreePath: undefined,
      worktreeBranch: undefined,
      terminals: [{ localKey: `t-${Date.now()}`, cwd: target.path }],
      activeTerminalKey: null,
    };
    newSession.activeTerminalKey = newSession.terminals[0].localKey;
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
    setView({ kind: 'chat' });

    // Bump lastRun stamp
    handleAutomationUpdate(a.id, {
      lastRun: new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
    });

    // Submit directly against the new session id — handleSubmit's override
    // path uses `setSessions(prev => …)` so it doesn't matter that the session
    // hasn't been flushed to React state yet.
    handleSubmit(a.prompt, { sessionId: newId, workDir: target.path });
  }

  // ── Commit / reject handlers ───────────────────────────────────────────────
  function handleCommit() {
    setShowCommitModal(true);
  }

  async function doCommit(message: string) {
    const worktreePath = currentSession?.worktreePath;
    if (!worktreePath) {
      setShowCommitModal(false);
      return;
    }
    try {
      await invoke('git_commit', { projectPath: worktreePath, message });
    } catch (err) {
      console.error('git commit failed:', err);
      showError('Commit failed. Check the terminal for details.');
      setShowCommitModal(false);
      return;
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowCommitModal(false);
  }

  function handleReject() {
    setShowRejectConfirm(true);
  }

  async function doReject() {
    const worktreePath = currentSession?.worktreePath;
    if (worktreePath) {
      const proj = currentSession?.project
        ? (projects.find(p => p.name === currentSession.project)?.path ?? projectPath)
        : projectPath;
      try {
        await invoke('remove_worktree', { projectPath: proj, worktreePath });
      } catch (err) {
        console.error('remove_worktree failed:', err);
        showError('Could not remove the worktree. You may need to clean it up manually.');
      }
      updateSession(activeSessionId, { diffPatch: '', worktreePath: undefined, worktreeBranch: undefined });
    } else {
      updateSession(activeSessionId, { diffPatch: '' });
    }
    setShowRejectConfirm(false);
  }

  // ── Permission handlers ────────────────────────────────────────────────────
  function dismissPermission(id: string) {
    setPendingPermissions((prev) => {
      const next = prev.filter((p) => p.id !== id);
      // If no more pending perms and the active session is still running,
      // it's back to "working" (instead of stuck on "awaiting").
      if (next.length === 0) {
        setSessions(prevS => prevS.map(s =>
          s.id === activeSessionId && s.isRunning ? { ...s, taskState: 'working' } : s,
        ));
      }
      return next;
    });
  }

  async function handlePermAllow(id: string) {
    await invoke('resolve_permission', { id, allow: true, always: false });
    dismissPermission(id);
  }

  async function handlePermDeny(id: string) {
    await invoke('resolve_permission', { id, allow: false, always: false });
    dismissPermission(id);
  }

  async function handlePermAlwaysAllow(id: string, tool: string, pattern: string) {
    await invoke('save_policy', { projectPath, tool, pattern });
    await invoke('resolve_permission', { id, allow: true, always: true });
    dismissPermission(id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (onboardingDone === null) {
    return (
      <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-mute)' }}>Loading…</span>
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <Onboarding
        onComplete={() => {
          // Re-load profile after onboarding saves it
          invoke<string | null>('load_profile').then((raw) => {
            if (raw) {
              try {
                const p = JSON.parse(raw);
                if (p.projectPath) setProjectPath(p.projectPath);
                if (p.apiKey) setApiKey(p.apiKey);
              } catch {}
            }
          });
          setOnboardingDone(true);
        }}
      />
    );
  }

  // Resolve real project/branch/path for the active session
  const activeProject = currentSession ? projects.find(p => p.name === currentSession.project) : undefined;
  const activeProjectName = currentSession?.project || activeProject?.name || '—';
  const activeBranch = currentSession?.worktreeBranch ?? '—';
  const activeCwd = tildeify(currentSession?.worktreePath ?? activeProject?.path ?? projectPath);
  const displayTask = {
    title: taskTitle,
    project: activeProjectName,
    branch: activeBranch,
    state: (currentSession?.taskState === 'stopped' ? 'idle' : currentSession?.taskState ?? 'idle'),
  };

  // Separate low-risk banners from high-risk modals
  const lowRiskPerms  = pendingPermissions.filter((p) => p.risk === 'low');
  const highRiskPerms = pendingPermissions.filter((p) => p.risk === 'high');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      <TitleBar
        project={activeProjectName}
        branch={activeBranch}
        additions={diffPatch ? diffStats(diffPatch).additions : 0}
        deletions={diffPatch ? diffStats(diffPatch).deletions : 0}
        onCommit={handleCommit}
        panelCollapsed={currentSession?.panelCollapsed ?? true}
        onTogglePanel={() => setPanelCollapsed(!(currentSession?.panelCollapsed ?? true))}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {(() => {
          // Active = currently running. Recent = idle, last activity within 24h.
          // Older sessions stay accessible via the "All chats" page.
          const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
          const now = Date.now();
          const activeRail = sessions
            .filter(s => s.isRunning)
            .map(s => ({
              id: s.id,
              title: s.title,
              project: s.project,
              state: s.taskState,
              relativeTime: relativeTime(s.lastActivityAt),
              currentTool: s.currentTool ?? null,
              streamingText: s.streamingText ?? false,
            }));
          const recentRail = sessions
            .filter(s => !s.isRunning && (now - s.lastActivityAt) < RECENT_WINDOW_MS)
            .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
            .map(s => ({
              id: s.id,
              title: s.title,
              project: s.project,
              state: s.taskState,
              relativeTime: relativeTime(s.lastActivityAt),
              currentTool: s.currentTool ?? null,
              streamingText: s.streamingText ?? false,
            }));
          return (
            <SessionRail
              activeSessions={activeRail}
              recentSessions={recentRail}
              projects={projects}
              view={view}
              activeSessionId={activeSessionId}
              onSettingsOpen={() => setShowSettings(true)}
              onNewTask={() => handleNewTask()}
              onSessionSelect={handleSessionSelect}
              onNavigate={setView}
              onAddProject={handleAddProject}
              onRemoveProject={handleRemoveProject}
              onRemoveSession={handleRemoveSession}
              width={railWidth}
              onWidthChange={setRailWidth}
              zoom={railZoom}
              onMouseEnter={() => { hoveredPanelRef.current = 'rail'; }}
              onMouseLeave={() => { if (hoveredPanelRef.current === 'rail') hoveredPanelRef.current = null; }}
            />
          );
        })()}

        {view.kind === 'chat' && currentSession && (
          <>
            <Conversation
              task={displayTask}
              messages={messages}
              planItems={planItems}
              onSubmit={handleSubmit}
              onStop={handleStopActive}
              isRunning={isRunning}
              cwd={currentSession?.worktreePath ?? activeProject?.path ?? projectPath}
              sessionId={activeSessionId}
              model={currentSession?.model ?? DEFAULT_MODEL}
              onModelChange={(m) => updateSession(activeSessionId, { model: m })}
              onOpenFile={openInPanel}
              zoom={convZoom}
              onMouseEnter={() => { hoveredPanelRef.current = 'conv'; }}
              onMouseLeave={() => { if (hoveredPanelRef.current === 'conv') hoveredPanelRef.current = null; }}
              permissionBanners={lowRiskPerms.map((req) => (
                <PermissionBanner
                  key={req.id}
                  request={req}
                  onAllow={handlePermAllow}
                  onDeny={handlePermDeny}
                />
              ))}
            />
            {/* Show panel whenever not explicitly collapsed */}
            {!currentSession.panelCollapsed && (
              <ReviewPanel
                diffPatch={diffPatch}
                testStatusByPath={{}}
                onReject={handleReject}
                onAcceptAll={handleCommit}
                panelTabs={currentSession.panelTabs}
                panelActive={currentSession.panelActive}
                onPanelActive={setPanelActive}
                onPanelClose={() => setPanelCollapsed(true)}
                onCloseTab={closePanelTab}
                basePath={currentSession.worktreePath ?? activeProject?.path ?? projectPath}
                width={reviewWidth}
                onWidthChange={setReviewWidth}
                onOpenFile={openInPanel}
                zoom={reviewZoom}
                onMouseEnter={() => { hoveredPanelRef.current = 'review'; }}
                onMouseLeave={() => { if (hoveredPanelRef.current === 'review') hoveredPanelRef.current = null; }}
              />
            )}
          </>
        )}

        {view.kind === 'chat' && !currentSession && (
          <EmptyChatState
            hasProjects={projects.length > 0}
            onNewChat={() => handleNewTask()}
            onAddProject={handleAddProject}
          />
        )}

        {view.kind === 'search' && <SearchPage />}

        {view.kind === 'all-chats' && (
          <AllChatsPage
            chats={sessions
              .slice()
              .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
              .map(s => ({
                id: s.id,
                title: s.title,
                project: s.project,
                state: s.taskState === 'stopped' ? 'idle' : s.taskState,
                relativeTime: relativeTime(s.lastActivityAt),
              }))}
            onSelectActive={handleSessionSelect}
            onRemoveChat={handleRemoveSession}
          />
        )}

        {view.kind === 'automations' && (
          <AutomationsPage
            automations={automations}
            projects={projects}
            onCreate={handleAutomationCreate}
            onUpdate={handleAutomationUpdate}
            onDelete={handleAutomationDelete}
            onRun={handleAutomationRun}
          />
        )}

        {view.kind === 'plugins' && <PluginsPage />}

        {view.kind === 'project' && (
          <ProjectPage
            project={view.project}
            chats={sessions
              .filter(s => s.project === view.project)
              .slice()
              .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
              .map(s => ({
                id: s.id,
                title: s.title,
                project: s.project,
                state: s.taskState === 'stopped' ? 'idle' : s.taskState,
                relativeTime: relativeTime(s.lastActivityAt),
              }))}
            onSelectActive={handleSessionSelect}
            onNewChat={() => handleNewTask(view.project)}
            onRemoveChat={handleRemoveSession}
          />
        )}
      </div>

      {currentSession && (
      <TerminalPanel
        cwd={currentSession.worktreePath ?? projectPath}
        tabs={currentSession.terminals}
        activeKey={currentSession.activeTerminalKey}
        collapsed={terminalCollapsed}
        onTabsChange={(tabs) => updateSession(activeSessionId, { terminals: tabs })}
        onActiveKeyChange={(k) => updateSession(activeSessionId, { activeTerminalKey: k })}
        onCollapsedChange={setTerminalCollapsed}
        model={currentSession.model}
        tokenUsage={currentSession.tokenUsage}
      />
      )}

      <DebugMenu />

      {/* High-risk permission modals — show the first one */}
      {highRiskPerms[0] && (
        <PermissionModal
          request={highRiskPerms[0]}
          onDeny={handlePermDeny}
          onAllow={handlePermAllow}
          onAlwaysAllow={handlePermAlwaysAllow}
        />
      )}

      {showSettings && (
        <SettingsOverlay
          onClose={() => setShowSettings(false)}
          yoloMode={yoloMode}
          onYoloModeChange={(v: boolean) => {
            setYoloMode(v);
            persistProfile({ yoloMode: v });
          }}
        />
      )}

      {showCommitModal && (
        <CommitModal
          defaultMessage={taskTitle}
          onCommit={doCommit}
          onCancel={() => setShowCommitModal(false)}
        />
      )}
      {showRejectConfirm && (
        <ConfirmModal
          title="Discard changes"
          body="This will discard all of Claude's changes. Are you sure?"
          confirmLabel="Discard"
          confirmStyle="red"
          onConfirm={doReject}
          onCancel={() => setShowRejectConfirm(false)}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'var(--red)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 8,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
            maxWidth: 440,
            textAlign: 'center',
            cursor: 'pointer',
          }}
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
