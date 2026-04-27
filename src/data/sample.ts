/* ── Sample data derived from acceptance/step-1-static-main-window.png ── */

export interface Session {
  id: string;
  initials: string;
  avatarBg: string;
  state: 'working' | 'review' | 'awaiting' | 'idle';
  active?: boolean;
}

export interface PlanItem {
  id: number;
  status: 'done' | 'active' | 'pending';
  text: string;
}

export interface ToolCall {
  id: string;
  tool: 'READ' | 'GREP' | 'EDIT' | 'SHELL' | 'WRITE';
  path: string;
  detail: string;
}

export type MessageRole = 'user' | 'assistant' | 'tools' | 'plan';

export interface Message {
  id: string;
  role: MessageRole;
  author?: string;
  time?: string;
  content?: string;
  tools?: ToolCall[];
  planItems?: PlanItem[];
  planLabel?: string;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  isNew?: boolean;
}

export interface DiffLine {
  type: 'hunk' | 'context' | 'add' | 'del';
  before?: number;
  after?: number;
  content: string;
}

/* ── Session rail ── */
export const SESSIONS: Session[] = [
  { id: 's1', initials: 'RA', avatarBg: '#c4bfb5', state: 'working', active: true },
  { id: 's2', initials: 'AD', avatarBg: '#b8b0a4', state: 'working' },
  { id: 's3', initials: 'CI', avatarBg: '#bdb6ae', state: 'awaiting' },
  { id: 's4', initials: 'AP', avatarBg: '#c8c2b8', state: 'awaiting' },
  { id: 's5', initials: 'IF', avatarBg: '#b4aca3', state: 'idle' },
  { id: 's6', initials: 'GO', avatarBg: '#ccc6bc', state: 'idle' },
];

/* ── Task ── */
export const TASK = {
  title: 'Refactor auth middleware for token rotation',
  project: 'api-gateway',
  branch: 'feat/token-rotation',
  startedAt: '9:14 AM TODAY',
  filesChanged: 3,
  additions: 69,
  deletions: 27,
  toolsUsed: 4,
  state: 'working' as const,
};

/* ── Plan items ── */
const PLAN_ITEMS: PlanItem[] = [
  { id: 1, status: 'done',    text: 'Add `tokenVersion` column to sessions table + migration' },
  { id: 2, status: 'done',    text: 'Issue rotated access tokens with 15-min TTL in refresh' },
  { id: 3, status: 'done',    text: 'Invalidate previous refresh token on use (sliding window)' },
  { id: 4, status: 'active',  text: 'Compatibility: accept old-format tokens until 2026-05-01' },
  { id: 5, status: 'pending', text: 'Update tests + add rotation race-condition test' },
  { id: 6, status: 'pending', text: 'Update SDK docs' },
];

/* ── Messages ── */
export const MESSAGES: Message[] = [
  {
    id: 'm1',
    role: 'user',
    author: 'You',
    time: '9:14 AM',
    content:
      'Refactor the auth middleware so access tokens rotate every 15 minutes. Refresh tokens should stay 30 days but rotate on every use. Don\'t break existing sessions.',
  },
  {
    id: 'm2',
    role: 'assistant',
    author: 'Claude',
    time: '9:14 AM',
    content:
      'Going to read through the current auth flow first, then plan the rotation. I\'ll keep a compatibility shim so live sessions don\'t get logged out.',
  },
  {
    id: 'm3',
    role: 'tools',
    tools: [
      { id: 't1', tool: 'READ',  path: 'src/middleware/auth.ts',  detail: '104 lines' },
      { id: 't2', tool: 'READ',  path: 'src/auth/token.ts',       detail: '92 lines' },
      { id: 't3', tool: 'GREP',  path: '"verifyAccessToken"',      detail: '6 matches across 4 files' },
      { id: 't4', tool: 'READ',  path: 'src/auth/session.ts',     detail: '210 lines' },
    ],
  },
  {
    id: 'm4',
    role: 'plan',
    author: 'Claude',
    time: '9:15 AM',
    planLabel: '3 OF 6 COMPLETE',
    content: "Here's the plan. I'll mark each step done as I go.",
    planItems: PLAN_ITEMS,
  },
  {
    id: 'm5',
    role: 'assistant',
    author: 'Claude',
    time: '9:16 AM',
    content:
      "I've completed the compatibility shim — old tokens with the legacy format will continue to work until 2026-05-01, then hard-expire. The `acceptLegacy` flag in `verifyAccessToken` handles the version branch. Moving to the test suite next.",
  },
];

/* ── Diff ── */
export const DIFF_FILES: DiffFile[] = [
  { path: 'src/middleware/auth.ts', additions: 42, deletions: 18 },
  { path: 'src/auth/token.ts',      additions: 27, deletions: 9 },
  { path: 'migrations/0042_token_version.sql', additions: 14, deletions: 0, isNew: true },
];

export const DIFF_LINES: DiffLine[] = [
  { type: 'hunk',    content: '@@ -22,9 +22,14 @@ export async function authMiddleware(req, res, next) {' },
  { type: 'context', before: 22, after: 22, content: '  const header = req.headers.authorization;' },
  { type: 'context', before: 23, after: 23, content: '  if (!header) return next();' },
  { type: 'context', before: 24, after: 24, content: '' },
  { type: 'del',     before: 25,            content: "  const token = header.replace(/^Bearer\\s+/i, '');", },
  { type: 'del',     before: 26,            content: '  const claims = await verifyAccessToken(token);' },
  { type: 'add',     after: 25,             content: "  const raw = header.replace(/^Bearer\\s+/i, '');" },
  { type: 'add',     after: 26,             content: "  const { claims, version } = await verifyAccessToken(raw, {" },
  { type: 'add',     after: 27,             content: '    acceptLegacy: true,' },
  { type: 'add',     after: 28,             content: '  });' },
  { type: 'context', before: 27, after: 29, content: '' },
  { type: 'add',     after: 30,             content: "  if (version === 'legacy') {" },
  { type: 'add',     after: 31,             content: "    metrics.increment('auth.legacy_token_used', {" },
  { type: 'add',     after: 32,             content: "      ua: req.headers['user-agent'] ?? 'unknown'," },
  { type: 'add',     after: 33,             content: '    });' },
  { type: 'add',     after: 34,             content: '  }' },
  { type: 'add',     after: 35,             content: '' },
  { type: 'context', before: 28, after: 36, content: '  req.user = claims;' },
  { type: 'context', before: 29, after: 37, content: '  return next();' },
  { type: 'context', before: 30, after: 38, content: '}' },
];
