export const AVATAR_COLORS = ['#c4bfb5', '#b8b0a4', '#bdb6ae', '#c8c2b8', '#b4aca3', '#ccc6bc'];

export interface RestoredTerminal {
  localKey: string;
  cwd: string;
}

export interface RestoredSession {
  id: string;
  initials: string;
  avatarBg: string;
  taskState: 'idle';
  title: string;
  project: string;
  createdAt: number;
  lastActivityAt: number;
  model: string;
  panelTabs: string[];
  panelActive: string;
  panelCollapsed: boolean;
  messages: unknown[];
  planItems: unknown[];
  toolCalls: unknown[];
  diffPatch: string;
  isRunning: false;
  worktreePath: string | undefined;
  worktreeBranch: string | undefined;
  claudeSessionId: string | undefined;
  terminals: RestoredTerminal[];
  activeTerminalKey: string | null;
  tokenUsage: { input: number; output: number; cacheRead: number; cacheCreation: number };
  titleLocked: boolean;
  summarizedAtTurn: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function restoreSession(s: any, index: number): RestoredSession {
  const terminals: RestoredTerminal[] = Array.isArray(s.terminals)
    ? s.terminals.map((t: any, j: number) => ({
        localKey: `t-${s.id}-${j}-restored`,
        cwd: t.cwd,
      }))
    : [];

  return {
    id: s.id ?? `s-${Date.now()}-${index}`,
    initials: s.initials ?? 'NW',
    avatarBg: s.avatarBg ?? AVATAR_COLORS[index % AVATAR_COLORS.length],
    taskState: 'idle',
    title: s.title ?? 'New task',
    project: s.project ?? '',
    createdAt: s.createdAt ?? Date.now(),
    lastActivityAt: s.lastActivityAt ?? s.createdAt ?? Date.now(),
    model: typeof s.model === 'string' && s.model ? s.model : 'sonnet',
    panelTabs: Array.isArray(s.panelTabs)
      ? s.panelTabs.filter((t: any) => typeof t === 'string')
      : [],
    panelActive: typeof s.panelActive === 'string' ? s.panelActive : 'review',
    panelCollapsed: typeof s.panelCollapsed === 'boolean' ? s.panelCollapsed : false,
    messages: Array.isArray(s.messages) ? s.messages : [],
    planItems: Array.isArray(s.planItems) ? s.planItems : [],
    toolCalls: Array.isArray(s.toolCalls) ? s.toolCalls : [],
    diffPatch: s.diffPatch ?? '',
    isRunning: false,
    worktreePath: s.worktreePath,
    worktreeBranch: s.worktreeBranch,
    claudeSessionId: typeof s.claudeSessionId === 'string' ? s.claudeSessionId : undefined,
    terminals,
    activeTerminalKey: terminals[0]?.localKey ?? null,
    tokenUsage: s.tokenUsage ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    titleLocked: s.titleLocked ?? false,
    summarizedAtTurn: s.summarizedAtTurn ?? 0,
  };
}
