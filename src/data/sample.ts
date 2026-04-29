/* ── Sample data derived from acceptance/step-1-static-main-window.png ── */

export interface Session {
  id: string;
  initials: string;
  avatarBg: string;
  state: 'working' | 'review' | 'awaiting' | 'idle';
  title: string;
  project: string;
  relativeTime: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  count: number;
}

export interface RecentChat {
  id: string;
  title: string;
  project: string;
  relativeTime: string;
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
  thinking?: { content: string; finishedAt?: number };
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  isNew?: boolean;
  testStatus?: 'pass' | 'fail';
}

export interface DiffLine {
  type: 'hunk' | 'context' | 'add' | 'del';
  before?: number;
  after?: number;
  content: string;
}

/* ── Session rail ── */
export const SESSIONS: Session[] = [
  { id: 's1', initials: 'RA', avatarBg: '#c4bfb5', state: 'working',  title: 'Refactor auth middleware for token rotation', project: 'api-gateway', relativeTime: 'now' },
  { id: 's2', initials: 'AD', avatarBg: '#b8b0a4', state: 'working',  title: 'Add dark mode toggle to settings panel',      project: 'web-app',     relativeTime: '4m'  },
  { id: 's3', initials: 'CI', avatarBg: '#bdb6ae', state: 'awaiting', title: 'CSV importer — handle quoted fields',        project: 'web-app',     relativeTime: '12m' },
];

/* ── Sidebar projects (counts are total chats per project) ── */
export const PROJECTS: Project[] = [
  { id: 'p1', name: 'api-gateway',     path: '/tmp/api-gateway',     count: 12 },
  { id: 'p2', name: 'web-app',         path: '/tmp/web-app',         count: 23 },
  { id: 'p3', name: 'mobile',          path: '/tmp/mobile',          count: 4  },
  { id: 'p4', name: 'infra-terraform', path: '/tmp/infra-terraform', count: 7  },
];

/* ── Sidebar recent chats ──
 * Real recent history isn't tracked yet — leave empty so the sidebar reflects
 * only sessions the user has actually started. */
export const RECENT_CHATS: RecentChat[] = [];

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
  { id: 2, status: 'done',    text: 'Issue rotated access tokens with 15-min TTL in /refresh' },
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
    content:
      'Going to read through the current auth flow first, then plan the rotation. I\'ll keep a compatibility shim so live sessions don\'t get logged out.',
  },
  {
    id: 'm3',
    role: 'tools',
    time: '9:14 AM',
    tools: [
      { id: 't1', tool: 'READ',  path: 'src/middleware/auth.ts',  detail: '184 lines' },
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
  { path: 'src/middleware/auth.ts', additions: 42, deletions: 18, testStatus: 'pass' },
  { path: 'src/auth/token.ts',      additions: 27, deletions: 9 },
  { path: 'migrations/0042_token_version.sql', additions: 14, deletions: 0, isNew: true },
];

/* ── Multi-file unified diff (used to seed the demo Review panel)
 *  Hand-counted so per-file totals match advertised stats:
 *    src/middleware/auth.ts             +42 -18
 *    src/auth/token.ts                  +27 -9
 *    migrations/0042_token_version.sql  +14  0  (NEW)
 *  Sum: +69 -27 (matches TASK.additions / TASK.deletions)
 */
export const SAMPLE_DIFF_PATCH = `diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts
@@ -1,5 +1,8 @@
-import { Request, Response } from 'express';
-import { verifyAccessToken } from '../auth/token';
+import type { Request, Response, NextFunction } from 'express';
+import { verifyAccessToken, type TokenClaims } from '../auth/token';
+import { metrics } from '../telemetry';
+import { logger } from '../logger';
+
+const LEGACY_DEADLINE = new Date('2026-05-01');

 export async function authMiddleware(req, res, next) {
   const header = req.headers.authorization;
@@ -22,19 +25,40 @@ export async function authMiddleware(req, res, next) {
   const header = req.headers.authorization;
   if (!header) return next();

-  const token = header.replace(/^Bearer\\s+/i, '');
-  const claims = await verifyAccessToken(token);
-  if (!claims) {
-    metrics.increment('auth.invalid_token');
-    return res.status(401).json({ error: 'invalid_token' });
-  }
-  if (claims.exp && claims.exp * 1000 < Date.now()) {
-    metrics.increment('auth.expired_token');
-    return res.status(401).json({ error: 'expired_token' });
-  }
-  req.user = claims;
-  req.tenant = claims.tenantId;
-  metrics.increment('auth.token_validated', { tenant: claims.tenantId });
-  logger.debug({ sub: claims.sub }, 'auth ok');
-  return next();
-}
+  const raw = header.replace(/^Bearer\\s+/i, '');
+  const { claims, version } = await verifyAccessToken(raw, {
+    acceptLegacy: Date.now() < LEGACY_DEADLINE.getTime(),
+  });
+
+  if (!claims) {
+    metrics.increment('auth.invalid_token', {
+      ua: req.headers['user-agent'] ?? 'unknown',
+    });
+    return res.status(401).json({ error: 'invalid_token' });
+  }
+
+  if (version === 'legacy') {
+    metrics.increment('auth.legacy_token_used', {
+      ua: req.headers['user-agent'] ?? 'unknown',
+      tenant: claims.tenantId ?? 'unknown',
+    });
+    res.setHeader('X-Token-Migration', 'rotate-by-2026-05-01');
+  } else {
+    metrics.increment('auth.current_token_used', {
+      tenant: claims.tenantId ?? 'unknown',
+    });
+  }
+
+  if (claims.exp && claims.exp * 1000 < Date.now()) {
+    metrics.increment('auth.expired_token');
+    logger.warn({ sub: claims.sub }, 'expired token rejected');
+    return res.status(401).json({ error: 'expired_token' });
+  }
+
+  req.user = claims;
+  req.tokenVersion = version;
+  req.tenant = claims.tenantId;
+  logger.debug({ sub: claims.sub, version }, 'auth ok');
+  return next();
+}
diff --git a/src/auth/token.ts b/src/auth/token.ts
@@ -45,7 +45,17 @@ export async function verifyAccessToken(token, opts = {}) {
   const claims = await jwt.verify(token, secret);
-  if (!claims) throw new InvalidToken();
-  if (claims.exp && claims.exp * 1000 < Date.now()) {
-    throw new TokenExpired();
-  }
-  return claims;
+  if (!claims) throw new InvalidToken('invalid signature');
+  if (claims.tokenVersion === undefined) {
+    if (opts.acceptLegacy) {
+      metrics.increment('token.verify.legacy', { sub: claims.sub });
+      return { claims, version: 'legacy' as const };
+    }
+    throw new InvalidToken('legacy token rejected');
+  }
+  if (claims.exp && claims.exp * 1000 < Date.now()) {
+    metrics.increment('token.verify.expired', { sub: claims.sub });
+    throw new TokenExpired();
+  }
+  metrics.increment('token.verify.current', { sub: claims.sub });
+  return { claims, version: 'current' as const };
 }
@@ -85,8 +95,13 @@ export async function rotateRefresh(token) {
   const next = await jwt.sign({
     sub: claims.sub,
     sid: claims.sid,
-    tokenVersion: claims.tokenVersion + 1,
-  }, secret);
+    tokenVersion: (claims.tokenVersion ?? 0) + 1,
+    tenantId: claims.tenantId,
+    iat: Math.floor(Date.now() / 1000),
+    exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS,
+  }, secret);
+  metrics.increment('token.refresh.rotated');
+  await sessionStore.bumpVersion(claims.sid);
   return next;
 }
@@ -120,3 +135,9 @@ export async function issueTokens(userId, tenantId) {
   const sid = randomUUID();
-  const access = await jwt.sign({ sub: userId, sid, tenantId, tokenVersion: 1 }, secret);
-  const refresh = await jwt.sign({ sub: userId, sid, tenantId, tokenVersion: 1, type: 'refresh' }, secret);
+  const now = Math.floor(Date.now() / 1000);
+  const access = await jwt.sign({ sub: userId, sid, tenantId, tokenVersion: 1, iat: now, exp: now + ACCESS_TTL_SECONDS }, secret);
+  const refresh = await jwt.sign({ sub: userId, sid, tenantId, tokenVersion: 1, type: 'refresh', iat: now, exp: now + REFRESH_TTL_SECONDS }, secret);
+  metrics.increment('token.issued', { tenant: tenantId });
+  await sessionStore.create({ sid, sub: userId, tenantId });
+  logger.info({ sub: userId, sid }, 'tokens issued');
   return { access, refresh };
 }
diff --git a/migrations/0042_token_version.sql b/migrations/0042_token_version.sql
new file mode 100644
--- /dev/null
+++ b/migrations/0042_token_version.sql
@@ -0,0 +1,14 @@
+-- 0042: token rotation support
+ALTER TABLE sessions
+  ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
+ALTER TABLE sessions
+  ADD COLUMN last_rotated_at TIMESTAMPTZ;
+CREATE INDEX idx_sessions_token_version
+  ON sessions(token_version);
+CREATE INDEX idx_sessions_last_rotated_at
+  ON sessions(last_rotated_at)
+  WHERE last_rotated_at IS NOT NULL;
+UPDATE sessions
+  SET token_version = 1,
+      last_rotated_at = NOW()
+  WHERE token_version = 0;
`;

export const SAMPLE_TEST_STATUS: Record<string, 'pass' | 'fail'> = {
  'src/middleware/auth.ts': 'pass',
};

/* ── Sidebar pages ── */
export type AutomationTrigger = 'manual';

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  /** Project name (matches `Project.name`); empty string = ask at run-time. */
  project: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  lastRun?: string;
  createdAt: number;
}

/** Seed used only when no automations file exists yet — first-run starter set. */
export const AUTOMATIONS: Automation[] = [
  {
    id: 'a-seed-1',
    name: 'Tidy up imports',
    prompt: 'Run through the project and reorganize imports: external first, then internal, then relative. Sort alphabetically within each group. Don\'t change any logic.',
    project: '',
    trigger: 'manual',
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'a-seed-2',
    name: 'Write tests for last commit',
    prompt: 'Look at the most recent commit on the current branch. Add unit tests for any new logic introduced, using whatever testing framework is already configured.',
    project: '',
    trigger: 'manual',
    enabled: true,
    createdAt: 0,
  },
];

/** Live marketplace plugin (returned by `list_marketplace_plugins`). */
export interface MarketplacePlugin {
  name: string;
  marketplace: string;
  description: string;
  category: string;
  author: string;
  homepage: string;
}

/** Currently-installed plugin (returned by `list_installed_plugins`). */
export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  install_path: string;
}

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
