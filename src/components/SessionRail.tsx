import { useState } from 'react';
import { Plus, Search, MessageSquare, Sparkles, Puzzle, Folder, Settings, X } from 'lucide-react';
import type { Project } from '../data/sample';
import type { View } from '../App';
import Resizer from './Resizer';

interface ActiveSession {
  id: string;
  title: string;
  project: string;
  state: 'working' | 'review' | 'awaiting' | 'idle' | 'error' | 'stopped';
  relativeTime: string;
  currentTool?: { name: string; path: string } | null;
  streamingText?: boolean;
}

interface Props {
  activeSessions: ActiveSession[];
  recentSessions: ActiveSession[];
  projects: Project[];
  view: View;
  activeSessionId?: string;
  onSettingsOpen: () => void;
  onNewTask: () => void;
  onSessionSelect: (id: string) => void;
  onNavigate: (v: View) => void;
  onAddProject?: () => void;
  onRemoveProject?: (id: string) => void;
  onRemoveSession?: (id: string) => void;
  width: number;
  onWidthChange: (w: number) => void;
  zoom?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const STATE_DOT: Record<ActiveSession['state'], string> = {
  working:  'var(--accent)',
  review:   'var(--green)',
  awaiting: 'var(--amber)',
  idle:     'var(--text-mute)',
  error:    'var(--red)',
  stopped:  'var(--text-mute)',
};

/** Return the color for the status dot based on state + currentTool. */
function dotColor(state: ActiveSession['state'], currentTool?: { name: string; path: string } | null): string {
  if (state === 'working' && currentTool) {
    const tool = currentTool.name.toUpperCase();
    if (['READ', 'LIST', 'GLOB', 'GREP'].includes(tool)) return 'var(--text-dim)';
    if (['WRITE', 'EDIT'].includes(tool)) return '#d97706';
    if (tool === 'SHELL') return '#dc2626';
    if (['FETCH', 'SEARCH'].includes(tool)) return 'var(--accent)';
    return 'var(--text-mute)';
  }
  return STATE_DOT[state] ?? 'var(--text-mute)';
}

/** Return a short status subtext for the chat row. */
function statusSubtext(
  state: ActiveSession['state'],
  currentTool?: { name: string; path: string } | null,
  streamingText?: boolean,
): string | null {
  if (state === 'working') {
    if (currentTool?.name) {
      const tool = currentTool.name.toUpperCase();
      const label =
        ['READ', 'LIST'].includes(tool) ? 'Reading' :
        tool === 'GLOB' ? 'Globbing' :
        tool === 'GREP' ? 'Searching' :
        tool === 'WRITE' ? 'Writing' :
        tool === 'EDIT' ? 'Editing' :
        tool === 'SHELL' ? 'Running' :
        tool === 'FETCH' ? 'Fetching' :
        tool === 'SEARCH' ? 'Searching' :
        'Using tool';
      const display = currentTool.path
        ? `${label} ${currentTool.path.split('/').pop() ?? currentTool.path}`
        : label;
      return display;
    }
    if (streamingText) return 'Writing…';
    return 'Thinking…';
  }
  if (state === 'awaiting') return 'Awaiting permission';
  if (state === 'review') return 'Review ready';
  if (state === 'error') return 'Error';
  if (state === 'stopped') return 'Stopped';
  return null;
}

/* ── Section header ── */
function SectionHeader({
  label,
  count,
  onAdd,
  addTitle,
}: {
  label: string;
  count: number;
  onAdd?: () => void;
  addTitle?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 14px 6px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-mute)',
      }}
    >
      <span>
        {label} <span style={{ marginLeft: 4 }}>{count}</span>
      </span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          title={addTitle}
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-mute)',
            cursor: 'pointer',
            padding: 0,
            borderRadius: 3,
          }}
        >
          <Plus size={12} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

/* ── Hover X button (used on chat / project rows) ── */
function RowDeleteButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        width: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-mute)',
        cursor: 'pointer',
        padding: 0,
        borderRadius: 3,
        flexShrink: 0,
      }}
    >
      <X size={12} strokeWidth={1.8} />
    </button>
  );
}

/* ── Plain nav row (Search, All chats, Automations, Plugins) ── */
function NavRow({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        height: 30,
        padding: '0 12px',
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        color: active ? 'var(--text)' : 'var(--text-dim)',
        borderRadius: 6,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          color: active ? 'var(--text)' : 'var(--text-mute)',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: active ? 'var(--text)' : 'var(--text-dim)',
        }}
      >
        {label}
      </span>
      {hint && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-mute)',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/* ── Project row ── */
function ProjectRow({
  project,
  active,
  onClick,
  onRemove,
}: {
  project: Project;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
        height: 28,
        padding: '0 8px 0 12px',
        background: active ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: 6,
      }}
      onClick={onClick}
    >
      <Folder
        size={13}
        strokeWidth={1.6}
        style={{ color: active ? 'var(--accent)' : 'var(--text-mute)', flexShrink: 0 }}
      />
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: active ? 'var(--text)' : 'var(--text-dim)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginLeft: 6,
        }}
      >
        {project.name}
      </span>
      {hovered && onRemove ? (
        <RowDeleteButton onClick={onRemove} title="Remove project" />
      ) : (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-mute)',
            paddingRight: 4,
          }}
        >
          {project.count}
        </span>
      )}
    </div>
  );
}

/* ── Chat row (active + recent) ── */
function ChatRow({
  title,
  project,
  relativeTime,
  state,
  currentTool,
  streamingText,
  isActive,
  onClick,
  onRemove,
}: {
  title: string;
  project: string;
  relativeTime: string;
  state?: ActiveSession['state'];
  currentTool?: { name: string; path: string } | null;
  streamingText?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const resolvedDotColor = state ? dotColor(state, currentTool) : 'var(--text-mute)';
  const showDot = state && state !== 'idle';
  const subtext = state ? statusSubtext(state, currentTool, streamingText) : null;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        padding: '7px 8px 8px 12px',
        background: isActive ? 'var(--bg-paper)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: 6,
      }}
    >
      {/* Active left bar */}
      {isActive && (
        <span
          style={{
            position: 'absolute',
            left: 2,
            top: 8,
            bottom: 8,
            width: 2,
            background: 'var(--accent)',
            borderRadius: 2,
          }}
        />
      )}

      {/* Status dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: showDot ? resolvedDotColor : 'transparent',
          border: showDot ? 'none' : '1px solid var(--border)',
          flexShrink: 0,
          marginTop: 6,
        }}
      />

      {/* Text stack */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            lineHeight: 1.35,
            color: isActive ? 'var(--text)' : 'var(--text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          }}
        >
          {title}
        </span>
        {/* Status subtext (working/awaiting/review/error/stopped) */}
        {subtext ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: resolvedDotColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            }}
          >
            {subtext}
          </span>
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--text-mute)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            }}
          >
            {project} · {relativeTime}
          </span>
        )}
      </div>

      {hovered && onRemove && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
          <RowDeleteButton onClick={onRemove} title="Remove chat" />
        </div>
      )}
    </div>
  );
}

/* ── Sidebar ── */
export default function SessionRail({
  activeSessions,
  recentSessions,
  projects,
  view,
  activeSessionId,
  onSettingsOpen,
  onNewTask,
  onSessionSelect,
  onNavigate,
  onAddProject,
  onRemoveProject,
  onRemoveSession,
  width,
  onWidthChange,
  zoom,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const isChatView = view.kind === 'chat';
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width,
        flexShrink: 0,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        position: 'relative',
        display: 'flex',
        zoom,
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top nav block */}
      <div style={{ padding: '12px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* New chat */}
        <button
          type="button"
          onClick={onNewTask}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            height: 32,
            padding: '0 12px',
            background: 'var(--accent-soft)',
            border: '1px solid transparent',
            borderRadius: 7,
            cursor: 'pointer',
            color: 'var(--accent)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            textAlign: 'left',
          }}
        >
          <Plus size={14} strokeWidth={2} />
          <span style={{ flex: 1 }}>New chat</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--accent)',
              opacity: 0.7,
            }}
          >
            ⌘N
          </span>
        </button>

        <NavRow
          icon={<Search size={14} strokeWidth={1.6} />}
          label="Search"
          hint="⌘K"
          active={view.kind === 'search'}
          onClick={() => onNavigate({ kind: 'search' })}
        />
        <NavRow
          icon={<MessageSquare size={14} strokeWidth={1.6} />}
          label="All chats"
          active={view.kind === 'all-chats'}
          onClick={() => onNavigate({ kind: 'all-chats' })}
        />
        <NavRow
          icon={<Sparkles size={14} strokeWidth={1.6} />}
          label="Automations"
          active={view.kind === 'automations'}
          onClick={() => onNavigate({ kind: 'automations' })}
        />
        <NavRow
          icon={<Puzzle size={14} strokeWidth={1.6} />}
          label="Plugins"
          active={view.kind === 'plugins'}
          onClick={() => onNavigate({ kind: 'plugins' })}
        />
      </div>

      {/* Scrollable groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 4px 8px' }}>
        {/* Projects */}
        <SectionHeader
          label="Projects"
          count={projects.length}
          onAdd={onAddProject}
          addTitle="Add project"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              active={view.kind === 'project' && view.project === p.name}
              onClick={() => onNavigate({ kind: 'project', project: p.name })}
              onRemove={onRemoveProject ? () => onRemoveProject(p.id) : undefined}
            />
          ))}
        </div>

        {/* Active */}
        <SectionHeader label="Active" count={activeSessions.length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {activeSessions.map((s) => (
            <ChatRow
              key={s.id}
              title={s.title}
              project={s.project}
              relativeTime={s.relativeTime}
              state={s.state}
              currentTool={s.currentTool}
              streamingText={s.streamingText}
              isActive={isChatView && s.id === activeSessionId}
              onClick={() => onSessionSelect(s.id)}
              onRemove={onRemoveSession ? () => onRemoveSession(s.id) : undefined}
            />
          ))}
        </div>

        {/* Recent */}
        <SectionHeader label="Recent" count={recentSessions.length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {recentSessions.map((s) => (
            <ChatRow
              key={s.id}
              title={s.title}
              project={s.project}
              relativeTime={s.relativeTime}
              state={s.state}
              currentTool={s.currentTool}
              streamingText={s.streamingText}
              isActive={isChatView && s.id === activeSessionId}
              onClick={() => onSessionSelect(s.id)}
              onRemove={onRemoveSession ? () => onRemoveSession(s.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Footer settings */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={onSettingsOpen}
          title="Settings"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: 'var(--text-mute)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          <Settings size={14} strokeWidth={1.5} />
        </button>
      </div>

      <Resizer side="right" width={width} min={180} max={420} onChange={onWidthChange} />
    </div>
  );
}
