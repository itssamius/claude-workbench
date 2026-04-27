import { useState } from 'react';
import { FileCode, X, Check } from 'lucide-react';
import type { DiffFile, DiffLine } from '../data/sample';

/* ── Unified diff parser ── */
function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let beforeLine = 0, afterLine = 0;
  for (const raw of patch.split('\n')) {
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
  return lines;
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
      {/* Before line number */}
      <div
        style={{
          width: 36,
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

      {/* After line number */}
      <div
        style={{
          width: 36,
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

      {/* Glyph */}
      <div
        style={{
          width: 18,
          paddingLeft: 4,
          flexShrink: 0,
          color: isAdd ? 'var(--green)' : isDel ? 'var(--red)' : 'transparent',
          userSelect: 'none',
        }}
      >
        {isAdd ? '+' : isDel ? '−' : ' '}
      </div>

      {/* Code */}
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

/* ── File tab ── */
function FileTab({
  file,
  active,
  onClick,
}: {
  file: DiffFile;
  active: boolean;
  onClick: () => void;
}) {
  const name = file.path;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '7px 12px',
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <FileCode
        size={13}
        style={{ color: 'var(--text-mute)', flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: active ? 'var(--text)' : 'var(--text-dim)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {file.isNew && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--green)',
              letterSpacing: '0.04em',
            }}
          >
            NEW
          </span>
        )}
        {file.additions > 0 && (
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}
          >
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)' }}
          >
            −{file.deletions}
          </span>
        )}
      </div>
    </button>
  );
}

/* ── Review panel ── */
interface Props {
  files: DiffFile[];
  diffLines: DiffLine[];
  diffPatch?: string;
  totalAdditions: number;
  totalDeletions: number;
}

export default function ReviewPanel({ files, diffLines, diffPatch, totalAdditions, totalDeletions }: Props) {
  const displayLines = diffPatch && diffPatch.trim() ? parsePatch(diffPatch) : diffLines;
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div
      style={{
        width: 'var(--review-w)',
        flexShrink: 0,
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: '10px 14px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-mute)',
            marginBottom: 6,
          }}
        >
          Review
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          <span>{files.length} files changed</span>
          <span style={{ color: 'var(--green)' }}>+{totalAdditions}</span>
          <span style={{ color: 'var(--red)' }}>−{totalDeletions}</span>
        </div>
      </div>

      {/* File list */}
      <div style={{ flexShrink: 0 }}>
        {files.map((f, i) => (
          <FileTab
            key={f.path}
            file={f}
            active={i === activeIdx}
            onClick={() => setActiveIdx(i)}
          />
        ))}
      </div>

      {/* Diff viewer */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          background: 'var(--bg-paper)',
        }}
      >
        {displayLines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </div>

      {/* Accept / Reject footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
          background: 'var(--bg-panel)',
        }}
      >
        <button
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
