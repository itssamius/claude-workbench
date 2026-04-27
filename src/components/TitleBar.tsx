import { GitBranch, ExternalLink, Check } from 'lucide-react';

interface Props {
  project: string;
  branch: string;
  taskTitle: string;
}

export default function TitleBar({ project, branch, taskTitle }: Props) {
  return (
    <div
      data-tauri-drag-region
      style={{
        height: 'var(--titlebar-h)',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 20,
        paddingRight: 16,
        flexShrink: 0,
        userSelect: 'none',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* macOS traffic lights */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 16, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840' }} />
      </div>

      {/* Breadcrumb */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-mute)',
          overflow: 'hidden',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>{project}</span>
        <span style={{ color: 'var(--border)' }}>›</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <GitBranch size={11} style={{ color: 'var(--text-mute)' }} />
          {branch}
        </span>
        <span style={{ color: 'var(--border)' }}>›</span>
        <span
          style={{
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {taskTitle}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 28,
            padding: '0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-dim)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <ExternalLink size={12} />
          Open PR
        </button>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 28,
            padding: '0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--green)',
            border: '1px solid var(--green)',
            borderRadius: 6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Check size={12} />
          Commit &amp; continue
        </button>
      </div>
    </div>
  );
}
