import { useState, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, X, Check, Layers, Quote, PanelRightClose, FileText, Code2, FolderOpen } from 'lucide-react';
import type { DiffFile, DiffLine } from '../data/sample';
import Resizer from './Resizer';
import FilesTab from './FilesTab';

/* ── Per-file patch parser ── */
interface ParsedFile {
  path: string;
  isNew: boolean;
  lines: DiffLine[];
}

function parsePatchByFile(patch: string): ParsedFile[] {
  const result: ParsedFile[] = [];
  const sections = patch.split(/(?=^diff --git )/m);
  for (const section of sections) {
    if (!section.trim()) continue;
    const headerMatch = section.match(/^diff --git a\/\S+ b\/(\S+)/m);
    if (!headerMatch) continue;
    const filePath = headerMatch[1];
    const isNew = /^new file mode/m.test(section) || /^--- \/dev\/null/m.test(section);
    const lines: DiffLine[] = [];
    let beforeLine = 0, afterLine = 0;
    for (const raw of section.split('\n')) {
      if (raw.startsWith('@@')) {
        const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) { beforeLine = parseInt(m[1]); afterLine = parseInt(m[2]); }
        lines.push({ type: 'hunk', content: raw });
      } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
        lines.push({ type: 'add', after: afterLine++, content: raw.slice(1) });
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        lines.push({ type: 'del', before: beforeLine++, content: raw.slice(1) });
      } else if (raw.startsWith(' ')) {
        lines.push({ type: 'context', before: beforeLine++, after: afterLine++, content: raw.slice(1) });
      }
    }
    if (lines.length > 0) {
      result.push({ path: filePath, isNew, lines });
    }
  }
  return result;
}

/* ── Diff line ── */
function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return (
      <div
        style={{
          display: 'flex',
          padding: '3px 12px',
          background: 'var(--bg)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-mute)',
          lineHeight: 1.7,
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {line.content}
      </div>
    );
  }

  const isAdd = line.type === 'add';
  const isDel = line.type === 'del';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: isAdd ? 'var(--green-bg)' : isDel ? 'var(--red-bg)' : 'transparent',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          width: 32,
          padding: '0 6px',
          textAlign: 'right',
          color: isAdd ? 'transparent' : isDel ? 'var(--red)' : 'var(--text-mute)',
          flexShrink: 0,
          userSelect: 'none',
          borderRight: '1px solid var(--border)',
        }}
      >
        {line.before ?? ''}
      </div>
      <div
        style={{
          width: 32,
          padding: '0 6px',
          textAlign: 'right',
          color: isDel ? 'transparent' : isAdd ? 'var(--green)' : 'var(--text-mute)',
          flexShrink: 0,
          userSelect: 'none',
          borderRight: '1px solid var(--border)',
        }}
      >
        {line.after ?? ''}
      </div>
      <div
        style={{
          width: 16,
          paddingLeft: 4,
          flexShrink: 0,
          color: isAdd ? 'var(--green)' : isDel ? 'var(--red)' : 'transparent',
          userSelect: 'none',
        }}
      >
        {isAdd ? '+' : isDel ? '−' : ' '}
      </div>
      <div
        style={{
          flex: 1,
          paddingRight: 12,
          color: isAdd ? 'var(--text)' : isDel ? 'var(--text)' : 'var(--text-dim)',
          overflow: 'hidden',
          whiteSpace: 'pre',
        }}
      >
        {line.content}
      </div>
    </div>
  );
}

/* ── File extension → small badge ── */
function FileTypeBadge({ path }: { path: string }) {
  const dot = path.lastIndexOf('.');
  const ext = (dot >= 0 ? path.slice(dot + 1) : '').slice(0, 3).toUpperCase() || '··';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 14,
        padding: '0 3px',
        background: 'var(--accent)',
        color: '#fff',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 3,
        flexShrink: 0,
      }}
    >
      {ext}
    </span>
  );
}

/* ── Top tab strip ── */
type TabId = 'summary' | 'review' | 'files';

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        height: 28,
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border)' : 'transparent',
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 500,
        color: active ? 'var(--text)' : 'var(--text-mute)',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label}
    </button>
  );
}

function FileTabButton({
  path,
  active,
  onClick,
  onClose,
}: {
  path: string;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const name = path.split('/').pop() ?? path;
  return (
    <div
      onClick={onClick}
      title={path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px 0 8px',
        height: 28,
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border)' : 'transparent',
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        color: active ? 'var(--text)' : 'var(--text-mute)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <FileTypeBadge path={path} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close tab"
        style={{
          width: 18, height: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none',
          color: 'var(--text-mute)', cursor: 'pointer', borderRadius: 3, padding: 0,
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

/* ── File accordion ── */
function FileAccordion({
  file,
  expanded,
  onToggle,
  diffLines,
}: {
  file: DiffFile;
  expanded: boolean;
  onToggle: () => void;
  diffLines: DiffLine[];
}) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: expanded ? 'var(--bg-paper)' : 'var(--bg-panel)',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <ChevronRight
          size={12}
          style={{
            color: 'var(--text-mute)',
            flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        />
        <span
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.path}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {file.additions > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)' }}>
              −{file.deletions}
            </span>
          )}
          {file.isNew && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.05em',
                color: 'var(--green)',
                background: 'var(--green-bg)',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              NEW
            </span>
          )}
          {file.testStatus === 'pass' && (
            <span
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.1,
                fontFamily: 'var(--font-mono)',
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '0.06em',
                color: 'var(--green)',
                background: 'var(--green-bg)',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              <span>TESTS</span>
              <span>PASS</span>
            </span>
          )}
          {file.testStatus === 'fail' && (
            <span
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.1,
                fontFamily: 'var(--font-mono)',
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '0.06em',
                color: 'var(--red)',
                background: 'var(--red-bg)',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              <span>TESTS</span>
              <span>FAIL</span>
            </span>
          )}
        </span>
      </button>

      {/* Diff body */}
      {expanded && diffLines.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {diffLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── File viewer (renders an open file tab's contents) ── */
interface FilePreview {
  path: string;
  content: string;
  language: string;
  size_bytes: number;
  truncated: boolean;
  binary: boolean;
}

function FileViewer({
  path, basePath, onOpenFile,
}: {
  path: string;
  basePath?: string;
  onOpenFile?: (p: string) => void;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    invoke<FilePreview>('read_file', { path, basePath })
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [path, basePath]);

  const isMarkdown = path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown');
  const [renderMode, setRenderMode] = useState<'rich' | 'source'>(isMarkdown ? 'rich' : 'source');
  useEffect(() => { setRenderMode(isMarkdown ? 'rich' : 'source'); }, [path, isMarkdown]);

  if (error) {
    return (
      <div style={{
        padding: '20px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
        color: 'var(--red)', whiteSpace: 'pre-wrap',
      }}>
        Failed to read file:{'\n'}{error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div style={{
        padding: '20px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
        color: 'var(--text-mute)',
      }}>
        Loading…
      </div>
    );
  }
  if (preview.binary) {
    return (
      <div style={{
        padding: '20px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
        color: 'var(--text-mute)',
      }}>
        Binary file ({(preview.size_bytes / 1024).toFixed(1)} KB) — preview unavailable.
      </div>
    );
  }

  const lines = preview.content.split('\n');
  return (
    <div style={{ padding: '12px 0' }}>
      {preview.truncated && (
        <div style={{
          padding: '6px 16px', marginBottom: 8,
          background: 'var(--amber-bg)', color: 'var(--amber)',
          fontFamily: 'var(--font-mono)', fontSize: 11,
        }}>
          File is {(preview.size_bytes / 1024 / 1024).toFixed(2)} MB — preview truncated to first 2 MB.
        </div>
      )}
      {isMarkdown && (
        <div style={{ display: 'flex', gap: 4, padding: '0 12px 8px' }}>
          <button type="button" onClick={() => setRenderMode('rich')}   style={fileViewerToggleStyle(renderMode === 'rich')}>
            <FileText size={11} strokeWidth={1.6} /> Rendered
          </button>
          <button type="button" onClick={() => setRenderMode('source')} style={fileViewerToggleStyle(renderMode === 'source')}>
            <Code2 size={11} strokeWidth={1.6} /> Source
          </button>
        </div>
      )}
      {isMarkdown && renderMode === 'rich' ? (
        <div className="md-prose" style={{ padding: '4px 16px 16px' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...props }) => {
                if (href && onOpenFile && !/^[a-z][a-z0-9+\-.]*:\/\//i.test(href) && !href.startsWith('#')) {
                  return (
                    <a href={href} onClick={(e) => { e.preventDefault(); onOpenFile(href); }} style={{ cursor: 'pointer' }}>
                      {children}
                    </a>
                  );
                }
                return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
              },
            }}
          >
            {preview.content}
          </ReactMarkdown>
        </div>
      ) : null}
      <pre style={{
        margin: 0, padding: '0 16px',
        fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55,
        color: 'var(--text)', whiteSpace: 'pre',
        overflowX: 'auto',
        display: isMarkdown && renderMode === 'rich' ? 'none' : 'block',
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <span style={{
              color: 'var(--text-mute)',
              userSelect: 'none', textAlign: 'right',
              minWidth: 32, flexShrink: 0,
            }}>
              {i + 1}
            </span>
            <span>{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function fileViewerToggleStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 8px', height: 22,
    fontFamily: 'var(--font-sans)', fontSize: 11,
    color: active ? 'var(--text)' : 'var(--text-mute)',
    background: active ? 'var(--bg-paper)' : 'transparent',
    border: '1px solid', borderColor: active ? 'var(--border)' : 'transparent',
    borderRadius: 5, cursor: 'pointer',
  };
}

/* ── Review panel ── */
interface Props {
  files?: DiffFile[];
  diffLines?: DiffLine[];
  diffPatch?: string;
  onReject: () => void;
  onAcceptAll: () => void;
  testStatusByPath?: Record<string, 'pass' | 'fail'>;
  /** Open file-viewer tabs for the active session. */
  panelTabs: string[];
  /** Currently focused tab — "review" / "summary" or one of `panelTabs`. */
  panelActive: string;
  onPanelActive: (active: string) => void;
  onPanelClose: () => void;
  onCloseTab: (path: string) => void;
  basePath?: string;
  width: number;
  onWidthChange: (w: number) => void;
  /** Open another file in the panel — used by clickable paths inside an
   *  already-open file (e.g. links inside a markdown preview). */
  onOpenFile?: (path: string) => void;
  zoom?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function ReviewPanel({
  files, diffPatch, onReject, onAcceptAll, testStatusByPath,
  panelTabs, panelActive, onPanelActive, onPanelClose, onCloseTab, basePath,
  width, onWidthChange, onOpenFile, zoom, onMouseEnter, onMouseLeave,
}: Props) {

  const parsedFiles = useMemo<ParsedFile[]>(() => {
    if (diffPatch && diffPatch.trim()) return parsePatchByFile(diffPatch);
    return [];
  }, [diffPatch]);

  const linesByPath = useMemo(() => {
    const map = new Map<string, DiffLine[]>();
    for (const pf of parsedFiles) map.set(pf.path, pf.lines);
    return map;
  }, [parsedFiles]);

  const derivedFiles: DiffFile[] = useMemo(() => {
    // Explicit `files` prop takes priority for metadata (counts, NEW, testStatus)
    if (files && files.length > 0) {
      return files.map(f => ({
        ...f,
        testStatus: testStatusByPath?.[f.path] ?? f.testStatus,
      }));
    }
    return parsedFiles.map(pf => {
      const adds = pf.lines.filter(l => l.type === 'add').length;
      const dels = pf.lines.filter(l => l.type === 'del').length;
      return {
        path: pf.path,
        additions: adds,
        deletions: dels,
        isNew: pf.isNew,
        testStatus: testStatusByPath?.[pf.path],
      };
    });
  }, [parsedFiles, files, testStatusByPath]);

  // Built-in tabs are only meaningful when there's a diff to look at.
  const hasDiff = derivedFiles.length > 0;
  const isBuiltinActive = panelActive === 'review' || panelActive === 'summary';
  const fileActive = !isBuiltinActive ? panelActive : null;

  // Inside the Review tab, expand whichever file the user clicked last.
  const [expandedPath, setExpandedPath] = useState<string | null>(
    derivedFiles[0]?.path ?? null,
  );
  useMemo(() => {
    if (expandedPath && !derivedFiles.find(f => f.path === expandedPath)) {
      setExpandedPath(derivedFiles[0]?.path ?? null);
    }
  }, [derivedFiles, expandedPath]);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width,
        flexShrink: 0,
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft: '1px solid var(--border)',
        position: 'relative',
        zoom,
      }}
    >
      <Resizer side="left" width={width} min={280} max={900} onChange={onWidthChange} />
      {/* Top tab strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        <TabButton
          active={panelActive === 'files'}
          icon={<FolderOpen size={12} strokeWidth={1.6} />}
          label="Files"
          onClick={() => onPanelActive('files')}
        />
        {hasDiff && (
          <>
            <TabButton
              active={panelActive === 'summary'}
              icon={<Layers size={12} strokeWidth={1.6} />}
              label="Summary"
              onClick={() => onPanelActive('summary')}
            />
            <TabButton
              active={panelActive === 'review'}
              icon={<Quote size={12} strokeWidth={1.6} />}
              label="Review"
              onClick={() => onPanelActive('review')}
            />
          </>
        )}
        {panelTabs.map((p) => (
          <FileTabButton
            key={p}
            path={p}
            active={panelActive === p}
            onClick={() => onPanelActive(p)}
            onClose={() => onCloseTab(p)}
          />
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onPanelClose}
          title="Hide side panel"
          style={{
            width: 26, height: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: 'var(--text-mute)', cursor: 'pointer', borderRadius: 5,
            flexShrink: 0,
          }}
        >
          <PanelRightClose size={14} strokeWidth={1.6} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
        }}
      >
        {panelActive === 'files' ? (
          <FilesTab basePath={basePath ?? ''} onOpenFile={onOpenFile} />
        ) : fileActive ? (
          <FileViewer path={fileActive} basePath={basePath} onOpenFile={onOpenFile} />
        ) : panelActive === 'summary' ? (
          <div style={{ padding: '20px 16px' }}>
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: 14,
              color: 'var(--text-dim)', lineHeight: 1.6,
            }}>
              {derivedFiles.length} file{derivedFiles.length === 1 ? '' : 's'} changed.
              Switch to Review to inspect each one.
            </div>
          </div>
        ) : (
          // panelActive === 'review' (or fallback)
          derivedFiles.length === 0 ? (
            <div style={{
              padding: '24px 16px',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--text-mute)', textAlign: 'center',
            }}>
              No changes yet
            </div>
          ) : (
            derivedFiles.map((f) => (
              <FileAccordion
                key={f.path}
                file={f}
                expanded={expandedPath === f.path}
                onToggle={() =>
                  setExpandedPath(expandedPath === f.path ? null : f.path)
                }
                diffLines={linesByPath.get(f.path) ?? []}
              />
            ))
          )
        )}
      </div>

      {/* Accept / Reject footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          borderTop: '1px solid var(--border)',
          display: hasDiff ? 'flex' : 'none',
          gap: 8,
          background: 'var(--bg-panel)',
        }}
      >
        <button
          onClick={onReject}
          style={{
            flex: 1,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-dim)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          <X size={13} />
          Reject
        </button>
        <button
          onClick={onAcceptAll}
          style={{
            flex: 1,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--green)',
            border: '1px solid var(--green)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          <Check size={13} />
          Accept all
        </button>
      </div>
    </div>
  );
}
