import { GitBranch, PanelRight, ChevronDown } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface Props {
  project: string;
  branch: string;
  additions: number;
  deletions: number;
  onCommit: () => void;
  panelCollapsed?: boolean;
  onTogglePanel?: () => void;
}

const noDrag: React.CSSProperties = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

export default function TitleBar({ project, branch, additions, deletions, onCommit, panelCollapsed, onTogglePanel }: Props) {
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
        paddingRight: 14,
        flexShrink: 0,
        userSelect: 'none',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* macOS traffic lights */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 14, ...noDrag }}>
        <button
          onClick={() => getCurrentWindow().close()}
          style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', border: 'none', padding: 0, cursor: 'pointer' }}
        />
        <button
          onClick={() => getCurrentWindow().minimize()}
          style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E', border: 'none', padding: 0, cursor: 'pointer' }}
        />
        <button
          onClick={() => getCurrentWindow().toggleMaximize()}
          style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', border: 'none', padding: 0, cursor: 'pointer' }}
        />
      </div>

      {/* Left flex spacer (drag region) */}
      <div style={{ flex: 1 }} />

      {/* Centered breadcrumb pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 28,
          padding: '0 12px',
          background: 'var(--bg-paper)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-dim)',
        }}
      >
        <GitBranch size={11} style={{ color: 'var(--text-mute)' }} />
        <span style={{ color: 'var(--text-dim)' }}>{project}</span>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ color: 'var(--text-dim)' }}>{branch}</span>
        <span style={{ marginLeft: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--green)' }}>+{additions}</span>
          <span style={{ color: 'var(--red)' }}>−{deletions}</span>
        </span>
      </div>

      {/* Right flex spacer (drag region) */}
      <div style={{ flex: 1 }} />

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...noDrag }}>
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelCollapsed ? 'Show side panel' : 'Hide side panel'}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: panelCollapsed ? 'transparent' : 'var(--bg-panel)',
            border: '1px solid',
            borderColor: panelCollapsed ? 'transparent' : 'var(--border)',
            color: panelCollapsed ? 'var(--text-mute)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderRadius: 6,
            marginRight: 4,
          }}
        >
          <PanelRight size={14} strokeWidth={1.6} />
        </button>
        <button
          onClick={onCommit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            padding: '0 10px 0 12px',
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
          Commit
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
