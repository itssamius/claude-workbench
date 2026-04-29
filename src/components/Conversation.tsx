import { useRef, useState, useEffect, createContext, useContext } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SendHorizonal, Paperclip, GitBranch, Sparkles, ChevronDown, MoreHorizontal, Square } from 'lucide-react';
import type { Message, PlanItem, ToolCall } from '../data/sample';

// Active session's working directory — used by ToolRow to resolve relative
// paths when the user clicks one. Lives in context so we don't have to thread
// the prop through every message renderer.
const SessionCwdContext = createContext<string | undefined>(undefined);
// Click handler for in-app file opens (renders the file in the right-side
// panel). Cmd/Ctrl-click bypasses this and opens in the OS default editor.
const OpenInPanelContext = createContext<((path: string) => void) | undefined>(undefined);

/* Heuristic — does this string look like a file path Claude would mention?
 * - No whitespace, not a URL, not absurdly long
 * - Either contains a slash, or ends in a `.ext` (avoiding `.gitignore`-like
 *   leading-dot dotfiles, which we still allow if they include a slash)
 * - Avoids matches that are purely punctuation or numbers */
function looksLikePath(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length === 0 || t.length > 500) return false;
  if (/\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(t)) return false;  // url scheme
  if (t.includes('/')) return true;
  // Standalone filename: must end in `.ext` (1–8 char alnum suffix)
  if (/^[A-Za-z0-9_\-.]+\.[A-Za-z0-9]{1,8}$/.test(t) && !/^\.[A-Za-z]/.test(t)) return true;
  return false;
}

/* ── Markdown renderer (Atelier-styled) ── */
function Markdown({ source }: { source: string }) {
  return (
    <div className="md-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, href, children, ...props }) => {
            // Markdown links to local paths → open in side panel.
            if (href && looksLikePath(href)) {
              return <PathLink path={href}>{children}</PathLink>;
            }
            return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          code: ({ node: _n, className, children, ...props }) => {
            const inline = !/language-/.test(className ?? '');
            // Wrap inline code that looks like a path so the user can click
            // to open it in the side panel.
            if (inline) {
              const text = Array.isArray(children)
                ? children.filter((c): c is string => typeof c === 'string').join('')
                : (typeof children === 'string' ? children : '');
              if (looksLikePath(text)) {
                return (
                  <PathLink path={text}>
                    <code className="md-inline-code" {...props}>{children}</code>
                  </PathLink>
                );
              }
              return <code className="md-inline-code" {...props}>{children}</code>;
            }
            return <code className={className} {...props}>{children}</code>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/* ── Thinking indicator (shown while waiting for first token) ── */
function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      <AssistantDot />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--text-mute)',
          paddingTop: 1,
        }}
      >
        <span>Thinking</span>
        <span className="thinking-dot" style={{ animationDelay: '0ms'   }}>·</span>
        <span className="thinking-dot" style={{ animationDelay: '180ms' }}>·</span>
        <span className="thinking-dot" style={{ animationDelay: '360ms' }}>·</span>
      </div>
    </div>
  );
}

/* ── ThinkingCard (collapsible extended thinking block) ── */
function ThinkingCard({ thinking }: { thinking: { content: string; finishedAt?: number } }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = thinking.finishedAt !== undefined;
  const label = isDone ? 'Thought' : 'Thinking…';

  return (
    <div
      style={{
        marginBottom: 10,
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-panel)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-mute)',
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.7 }}>{expanded ? '▼' : '▶'}</span>
        <span>{label}</span>
        {!isDone && (
          <>
            <span className="thinking-dot" style={{ animationDelay: '0ms' }}>·</span>
            <span className="thinking-dot" style={{ animationDelay: '180ms' }}>·</span>
            <span className="thinking-dot" style={{ animationDelay: '360ms' }}>·</span>
          </>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: '8px 12px 10px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 13,
            color: 'var(--text-mute)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {thinking.content}
        </div>
      )}
    </div>
  );
}

/* ── ToolGroupCard (collapsible group of consecutive tool calls) ── */
function ToolGroupCard({ tools, time }: { tools: ToolCall[]; time?: string }) {
  const [expanded, setExpanded] = useState(tools.length === 1);

  // Derive summary: "Read 2 files · Edited 1 file"
  const counts: Record<string, number> = {};
  for (const tc of tools) {
    const key = tc.tool;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const summary = Object.entries(counts)
    .map(([tool, n]) => {
      const verb =
        tool === 'READ'  ? 'Read'    :
        tool === 'WRITE' ? 'Wrote'   :
        tool === 'EDIT'  ? 'Edited'  :
        tool === 'SHELL' ? 'Ran'     :
        tool === 'GREP'  ? 'Searched':
        tool === 'GLOB'  ? 'Globbed' :
        tool === 'LIST'  ? 'Listed'  :
        tool === 'FETCH' ? 'Fetched' :
        tool.charAt(0) + tool.slice(1).toLowerCase();
      const noun = n === 1
        ? (tool === 'SHELL' ? 'command' : 'file')
        : (tool === 'SHELL' ? 'commands' : 'files');
      return `${verb} ${n} ${noun}`;
    })
    .join(' · ');

  if (tools.length === 1) {
    // Single tool — always expanded, no card chrome
    return (
      <div style={{ paddingLeft: DOT_COLUMN_WIDTH, margin: '0 0 12px' }}>
        <ToolRow tc={tools[0]} />
        {time && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 8 }}>
            {time}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: DOT_COLUMN_WIDTH, margin: '0 0 12px' }}>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--bg-panel)',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: '100%',
            padding: '6px 10px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-mute)',
          }}
        >
          <span style={{ fontSize: 9, opacity: 0.7 }}>{expanded ? '▼' : '▶'}</span>
          <span>{summary}</span>
        </button>
        {expanded && (
          <div style={{ padding: '4px 10px 8px', borderTop: '1px solid var(--border)' }}>
            {tools.map(tc => <ToolRow key={tc.id} tc={tc} />)}
          </div>
        )}
      </div>
      {time && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 8 }}>
          {time}
        </div>
      )}
    </div>
  );
}

/* ── Tool row ── */
function PathLink({ path, children }: { path: string; children: React.ReactNode }) {
  const cwd = useContext(SessionCwdContext);
  const openInPanel = useContext(OpenInPanelContext);
  const [hover, setHover] = useState(false);
  if (!path) return <>{children}</>;
  return (
    <span
      title={`Open ${path}  (⌘-click to open externally)`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
          // Open in the OS default editor.
          invoke('open_path', { path, basePath: cwd }).catch((err) => {
            console.error('open_path failed:', err);
          });
        } else if (openInPanel) {
          openInPanel(path);
        } else {
          // Fallback: no panel handler in context — open externally.
          invoke('open_path', { path, basePath: cwd }).catch((err) => {
            console.error('open_path failed:', err);
          });
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        textDecoration: hover ? 'underline' : 'none',
        textDecorationColor: 'var(--accent)',
        textUnderlineOffset: 2,
      }}
    >
      {children}
    </span>
  );
}

function ToolRow({ tc }: { tc: ToolCall }) {
  // Verb chip — shared by both layouts
  const chip = (
    <span
      style={{
        padding: '1px 7px',
        fontSize: 10.5,
        fontWeight: 500,
        color: 'var(--accent)',
        background: 'var(--accent-soft)',
        borderRadius: 4,
        flexShrink: 0,
        textTransform: 'capitalize',
        letterSpacing: '0.01em',
      }}
    >
      {tc.tool.toLowerCase()}
    </span>
  );

  // SHELL: chip on top, full command wrapped on a second line.
  if (tc.tool === 'SHELL') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '4px 0 6px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          lineHeight: 1.6,
        }}
      >
        <div>{chip}</div>
        <div
          style={{
            color: 'var(--text)',
            paddingLeft: 2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
          }}
        >
          {tc.detail || tc.path}
        </div>
      </div>
    );
  }

  // Default: chip + path · dotted leader · detail, wrapped on overflow.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '3px 0',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        lineHeight: 1.6,
        flexWrap: 'wrap',
      }}
    >
      {chip}
      <span
        style={{
          color: 'var(--text)',
          minWidth: 0,
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
        }}
      >
        <PathLink path={tc.path}>{tc.path}</PathLink>
      </span>
      {tc.detail && (
        <>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted var(--border)',
              marginBottom: 3,
              minWidth: 12,
            }}
          />
          <span style={{ color: 'var(--text-mute)', flexShrink: 0 }}>{tc.detail}</span>
        </>
      )}
    </div>
  );
}

/* ── Plan card ── */
function PlanCard({ items, intro }: { items: PlanItem[]; intro: string }) {
  const done = items.filter((i) => i.status === 'done').length;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--bg-paper)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
        <span>
          PLAN · {done}/{items.length} STEPS DONE
        </span>
      </div>

      {/* Intro */}
      <p
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 13.5,
          color: 'var(--text-dim)',
          marginBottom: 10,
          lineHeight: 1.55,
        }}
      >
        {intro}
      </p>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((item) => (
          <PlanItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function PlanItemRow({ item }: { item: PlanItem }) {
  const isDone = item.status === 'done';
  const isActive = item.status === 'active';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {/* Circle / check */}
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...(isDone
            ? { background: 'var(--green)', border: 'none' }
            : isActive
            ? { background: 'transparent', border: '1.5px solid var(--text-dim)' }
            : { background: 'transparent', border: '1.5px solid var(--border)' }),
        }}
      >
        {isDone && (
          <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
            <path d="M1 4l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Text */}
      <span
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 14,
          lineHeight: 1.55,
          color: isDone ? 'var(--text-mute)' : 'var(--text)',
          textDecoration: isDone ? 'line-through' : 'none',
          textDecorationColor: 'var(--text-mute)',
        }}
      >
        {item.text}
      </span>
    </div>
  );
}

/* ── Left-margin assistant dot column ── */
const DOT_COLUMN_WIDTH = 18;

function AssistantDot() {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--accent)',
        marginTop: 8,
        flexShrink: 0,
      }}
    />
  );
}

/* ── Message renderer ── */
function MessageBlock({ msg }: { msg: Message }) {
  // User → right-aligned cream bubble + timestamp
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div
            style={{
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '10px 14px',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--text)',
            }}
          >
            {msg.content}
          </div>
          {msg.time && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>
              {msg.time}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Tools → collapsible group card
  if (msg.role === 'tools' && msg.tools) {
    return <ToolGroupCard tools={msg.tools} time={msg.time} />;
  }

  // Plan → dot + plan card
  if (msg.role === 'plan' && msg.planItems) {
    return (
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <AssistantDot />
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlanCard items={msg.planItems} intro={msg.content ?? ''} />
          {msg.time && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 8 }}>
              {msg.time}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant → dot + optional thinking card + serif prose with markdown
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      <AssistantDot />
      <div style={{ flex: 1, minWidth: 0 }}>
        {msg.thinking && <ThinkingCard thinking={msg.thinking} />}
        <Markdown source={msg.content ?? ''} />
        {msg.time && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-mute)', marginTop: 6 }}>
            {msg.time}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Model picker ── */
function ModelPicker({ model, onChange }: { model: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opt = modelOption(model);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Change model"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: 24, padding: '0 8px',
          fontFamily: 'var(--font-sans)', fontSize: 12,
          color: 'var(--text-dim)',
          background: open ? 'var(--bg-panel)' : 'transparent',
          border: '1px solid', borderColor: open ? 'var(--border)' : 'transparent',
          borderRadius: 5, cursor: 'pointer',
        }}
      >
        <Sparkles size={12} style={{ color: 'var(--text-mute)' }} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
          <span style={{ fontSize: 12 }}>{opt.label}</span>
          <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>{opt.sub}</span>
        </span>
        <ChevronDown size={11} style={{ color: 'var(--text-mute)' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, bottom: 'calc(100% + 6px)',
            zIndex: 30, minWidth: 180,
            background: 'var(--bg-paper)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(28, 24, 18, 0.15)',
            overflow: 'hidden',
          }}
        >
          {MODEL_OPTIONS.map((m, i) => {
            const selected = m.value === model;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => { onChange(m.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '9px 12px',
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  border: 'none',
                  borderBottom: i === MODEL_OPTIONS.length - 1 ? 'none' : '1px solid var(--border)',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'var(--font-sans)', fontSize: 13,
                  color: 'var(--text)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span>{m.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mute)' }}>
                    {m.sub}
                  </span>
                </span>
                {selected && (
                  <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Attachment ── */
interface Attachment {
  path: string;     // absolute path on disk
  name: string;     // displayed in the chip
  kind: 'image' | 'file';
}

/* Models exposed in the composer picker. `value` is what gets sent to the
 * Claude CLI as `--model`. */
const MODEL_OPTIONS: Array<{ value: string; label: string; sub: string }> = [
  { value: 'opus',                   label: 'Opus',   sub: '4.7'  },
  { value: 'sonnet',                 label: 'Sonnet', sub: '4.6'  },
  { value: 'claude-haiku-4-5',       label: 'Haiku',  sub: '4.5'  },
];

function modelOption(value: string) {
  return MODEL_OPTIONS.find(m => m.value === value) ?? MODEL_OPTIONS[1];
}

/* ── Composer ── */
function Composer({
  onSubmit,
  onStop,
  isRunning,
  branch,
  cwd,
  sessionId,
  model,
  onModelChange,
}: {
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  isRunning: boolean;
  branch: string;
  cwd?: string;
  sessionId?: string;
  model: string;
  onModelChange: (model: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Autocomplete state. `mention` describes the active "@…" trigger:
  //   start:   index in `text` of the "@"
  //   query:   substring between "@" and the caret
  //   results: file paths fetched from list_project_files
  //   active:  highlighted index in results
  const [mention, setMention] = useState<{
    start: number;
    query: string;
    results: string[];
    active: number;
  } | null>(null);
  const mentionReqIdRef = useRef(0);

  // ── Mention detection ───────────────────────────────────────────────────
  // Run on every text or caret change. Looks back from the caret to find an
  // active "@<query>" trigger (no whitespace, current word, preceded by ws or
  // start-of-string). When matched, kicks off a debounced query.
  function detectMention(value: string, caret: number) {
    if (!cwd) { setMention(null); return; }
    let i = caret - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === '@') {
        const before = i === 0 ? '' : value[i - 1];
        if (before === '' || /\s/.test(before)) {
          const query = value.slice(i + 1, caret);
          if (!/\s/.test(query)) {
            setMention(prev => ({
              start: i,
              query,
              results: prev?.start === i ? prev.results : [],
              active: 0,
            }));
            queryFiles(query);
            return;
          }
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
    }
    setMention(null);
  }

  async function queryFiles(query: string) {
    if (!cwd) return;
    const reqId = ++mentionReqIdRef.current;
    try {
      const results = await invoke<string[]>('list_project_files', {
        projectPath: cwd, query, limit: 12,
      });
      // Only apply if this is still the latest request
      if (reqId !== mentionReqIdRef.current) return;
      setMention(prev => prev ? { ...prev, results, active: 0 } : prev);
    } catch (err) {
      console.error('list_project_files failed:', err);
    }
  }

  function applyMentionResult(idx: number) {
    if (!mention || !mention.results[idx]) return;
    const path = mention.results[idx];
    const before = text.slice(0, mention.start);
    const after  = text.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${path}`;
    const next = `${before}${inserted}${after.startsWith(' ') ? '' : ' '}${after}`;
    setText(next);
    setMention(null);
    // Re-focus and place caret right after the inserted path + space
    queueMicrotask(() => {
      const t = textRef.current;
      if (!t) return;
      const caret = before.length + inserted.length + 1;
      t.focus();
      t.setSelectionRange(caret, caret);
    });
  }

  // ── Attachments ─────────────────────────────────────────────────────────
  async function attachImageBlob(blob: Blob, fallbackName: string) {
    if (!sessionId) return;
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const dataB64 = btoa(binary);
    const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    try {
      const path = await invoke<string>('save_attachment', {
        sessionId, extension: ext, dataB64,
      });
      const name = path.split('/').pop() || fallbackName;
      setAttachments(prev => [...prev, { path, name, kind: 'image' }]);
    } catch (err) {
      console.error('save_attachment failed:', err);
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!sessionId) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items.filter(it => it.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    for (const it of images) {
      const blob = it.getAsFile();
      if (blob) await attachImageBlob(blob, 'pasted.png');
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!sessionId) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        await attachImageBlob(f, f.name);
      } else {
        // For non-image files dropped in: best-effort, treat as a path mention.
        // Browser DataTransfer doesn't expose a real OS path for security, so
        // we save the file's contents as an attachment under .workbench too.
        await attachImageBlob(f, f.name);
      }
    }
  }

  function removeAttachment(path: string) {
    setAttachments(prev => prev.filter(a => a.path !== path));
  }

  // ── Send ────────────────────────────────────────────────────────────────
  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isRunning) return;

    let payload = trimmed;
    if (attachments.length > 0) {
      const list = attachments.map(a => `- ${a.path}`).join('\n');
      payload = `Attached files:\n${list}\n\n${trimmed}`.trim();
    }
    onSubmit(payload);
    setText('');
    setAttachments([]);
    setMention(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Autocomplete keyboard handling — only when mention dropdown is open
    if (mention && mention.results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention(m => m ? { ...m, active: (m.active + 1) % m.results.length } : m);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention(m => m ? { ...m, active: (m.active - 1 + m.results.length) % m.results.length } : m);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMentionResult(mention.active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    detectMention(v, e.target.selectionStart ?? v.length);
  }
  function handleSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const t = e.currentTarget;
    detectMention(t.value, t.selectionStart);
  }

  return (
    <div style={{ padding: '8px 0 12px', position: 'relative' }}>
      {/* @file autocomplete dropdown — anchored above the composer */}
      {mention && mention.results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0, right: 0,
            bottom: 'calc(100% - 4px)',
            zIndex: 30,
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(28, 24, 18, 0.12)',
            overflow: 'hidden',
            maxHeight: 240,
            overflowY: 'auto',
          }}
          onMouseDown={(e) => e.preventDefault() /* keep textarea focused */}
        >
          {mention.results.map((p, i) => (
            <div
              key={p}
              onClick={() => applyMentionResult(i)}
              onMouseEnter={() => setMention(m => m ? { ...m, active: i } : m)}
              style={{
                padding: '7px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text)',
                cursor: 'pointer',
                background: i === mention.active ? 'var(--accent-soft)' : 'transparent',
                borderBottom: i === mention.results.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              {p}
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={handleDrop}
        style={{
          background: 'var(--bg-paper)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            padding: '10px 12px 0',
          }}>
            {attachments.map((a) => (
              <span
                key={a.path}
                title={a.path}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 4px 3px 8px',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid transparent', borderRadius: 5,
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  maxWidth: 240,
                }}
              >
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.kind === 'image' ? '🖼' : '📎'} {a.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.path)}
                  style={{
                    width: 16, height: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none', color: 'var(--accent)',
                    cursor: 'pointer', borderRadius: 3, fontSize: 12, lineHeight: 1,
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textRef}
          value={text}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask for a follow-up change… (paste/drop images, type @ to mention a file)"
          rows={2}
          style={{
            width: '100%',
            padding: '12px 14px 6px',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            lineHeight: 1.6,
          }}
        />

        {/* Composer footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px 10px',
            gap: 8,
          }}
        >
          {/* Left cluster: attach + branch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                padding: '0 8px',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-mute)',
                background: 'transparent',
                border: 'none',
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              <Paperclip size={12} />
              Attach
            </button>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                padding: '0 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-dim)',
                border: '1px solid var(--border)',
                borderRadius: 5,
              }}
            >
              <GitBranch size={11} />
              {branch}
            </span>
          </div>

          {/* Right cluster: model picker + send */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ModelPicker model={model} onChange={onModelChange} />

            <button
              onClick={isRunning ? onStop : handleSend}
              title={isRunning ? 'Stop running task' : 'Send'}
              disabled={!isRunning && !text.trim()}
              style={{
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isRunning ? 'var(--red)' : 'var(--green)',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                color: '#fff',
                flexShrink: 0,
                opacity: !isRunning && !text.trim() ? 0.5 : 1,
                animation: isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }}
            >
              {isRunning ? <Square size={12} fill="#fff" /> : <SendHorizonal size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main conversation column ── */
interface Props {
  task: {
    title: string;
    project: string;
    branch: string;
    startedAt?: string;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
    toolsUsed?: number;
    state: 'working' | 'review' | 'awaiting' | 'idle';
  };
  messages: Message[];
  planItems?: PlanItem[];
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  isRunning: boolean;
  permissionBanners?: React.ReactNode;
  /** Active session's working directory — used to resolve relative tool paths
   *  when the user clicks one to open it. */
  cwd?: string;
  /** Active session id — used by the composer for attachment + autocomplete
   *  Rust calls. */
  sessionId?: string;
  /** Selected model alias for the active session (e.g. "sonnet", "opus"). */
  model: string;
  onModelChange: (model: string) => void;
  /** Click handler for file paths in this view — opens the file in the
   *  right-side panel. Optional: if absent, paths fall back to OS-open. */
  onOpenFile?: (path: string) => void;
  zoom?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function Conversation({
  task, messages, onSubmit, onStop, isRunning, permissionBanners, cwd, sessionId,
  model, onModelChange, onOpenFile, zoom, onMouseEnter, onMouseLeave,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <SessionCwdContext.Provider value={cwd}>
    <OpenInPanelContext.Provider value={onOpenFile}>
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-paper)',
        borderRight: '1px solid var(--border)',
        zoom,
      }}
    >
      {/* Scrollable area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '24px 40px 0',
          }}
        >
          {/* Title row: H1 + ... menu */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 4,
            }}
          >
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1.3,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
                flex: 1,
              }}
            >
              {task.title}
            </h1>
            <button
              type="button"
              title="Task menu"
              style={{
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-mute)',
                cursor: 'pointer',
                borderRadius: 5,
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <MoreHorizontal size={15} />
            </button>
          </div>

          {/* Subtitle: project · branch · ● state */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              color: 'var(--text-dim)',
              marginBottom: 24,
            }}
          >
            <span>{task.project}</span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>{task.branch}</span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background:
                    task.state === 'working'  ? 'var(--accent)' :
                    task.state === 'review'   ? 'var(--green)'  :
                    task.state === 'awaiting' ? 'var(--amber)'  :
                                                'var(--text-mute)',
                  display: 'inline-block',
                }}
              />
              {task.state}
            </span>
          </div>

          {/* Message list */}
          <div style={{ paddingBottom: 20 }}>
            {messages.map((msg) => (
              <MessageBlock key={msg.id} msg={msg} />
            ))}
            {isRunning && (() => {
              // Show "Thinking…" until the assistant has streamed any prose.
              // We hide it once an assistant or plan message has actual content.
              const last = messages[messages.length - 1];
              const assistantHasContent =
                (last?.role === 'assistant' && (last.content ?? '').length > 0) ||
                (last?.role === 'plan' && (last.planItems?.length ?? 0) > 0);
              return assistantHasContent ? null : <ThinkingIndicator />;
            })()}
          </div>
        </div>
      </div>

      {/* Sticky bottom area */}
      <div
        style={{
          flexShrink: 0,
          padding: '0 40px',
          paddingBottom: 16,
          maxWidth: 720,
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {permissionBanners && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {permissionBanners}
          </div>
        )}
        <Composer
          onSubmit={onSubmit}
          onStop={onStop}
          isRunning={isRunning}
          branch={task.branch}
          cwd={cwd}
          sessionId={sessionId}
          model={model}
          onModelChange={onModelChange}
        />
      </div>
    </div>
    </OpenInPanelContext.Provider>
    </SessionCwdContext.Provider>
  );
}
