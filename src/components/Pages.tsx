import { useState } from 'react';
import { Search as SearchIcon, Plus, X } from 'lucide-react';

interface ChatRowItem {
  id: string;
  title: string;
  project: string;
  state?: 'working' | 'review' | 'awaiting' | 'idle';
  relativeTime: string;
}

const STATE_DOT_COLOR: Record<NonNullable<ChatRowItem['state']>, string> = {
  working:  'var(--accent)',
  review:   'var(--green)',
  awaiting: 'var(--amber)',
  idle:     'var(--text-mute)',
};

/* ── Shared shell ── */
function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-paper)',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 40px' }}>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 26,
              fontWeight: 400,
              lineHeight: 1.25,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              marginBottom: 4,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--text-dim)',
                marginBottom: 28,
              }}
            >
              {subtitle}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Chat list row ── */
function ChatListItem({
  chat,
  onClick,
  isLast,
  onRemove,
}: {
  chat: ChatRowItem;
  onClick?: () => void;
  isLast?: boolean;
  onRemove?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '12px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: chat.state ? STATE_DOT_COLOR[chat.state] : 'var(--text-mute)',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13.5,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {chat.title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-mute)',
            marginTop: 2,
          }}
        >
          {chat.project} · {chat.relativeTime}
        </div>
      </div>
      {hovered && onRemove && (
        <button
          type="button"
          title="Remove chat"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-mute)',
            cursor: 'pointer',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

/* ── All chats page ── */
export function AllChatsPage({
  chats,
  onSelectActive,
  onRemoveChat,
}: {
  chats: ChatRowItem[];
  onSelectActive?: (id: string) => void;
  onRemoveChat?: (id: string) => void;
}) {
  return (
    <PageShell title="All chats" subtitle={`${chats.length} conversations`}>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--bg-panel)',
        }}
      >
        {chats.map((c, i) => (
          <ChatListItem
            key={c.id}
            chat={c}
            isLast={i === chats.length - 1}
            onClick={() => onSelectActive?.(c.id)}
            onRemove={onRemoveChat ? () => onRemoveChat(c.id) : undefined}
          />
        ))}
      </div>
    </PageShell>
  );
}

/* ── Project page ── */
export function ProjectPage({
  project,
  chats,
  onSelectActive,
  onNewChat,
  onRemoveChat,
}: {
  project: string;
  chats: ChatRowItem[];
  onSelectActive?: (id: string) => void;
  onNewChat?: () => void;
  onRemoveChat?: (id: string) => void;
}) {
  return (
    <PageShell title={project} subtitle={`${chats.length} conversations in this project`}>
      {onNewChat && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={onNewChat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 34,
              padding: '0 14px',
              background: 'var(--accent-soft)',
              border: '1px solid transparent',
              borderRadius: 7,
              cursor: 'pointer',
              color: 'var(--accent)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Plus size={14} strokeWidth={2} />
            New chat in {project}
          </button>
        </div>
      )}

      {chats.length === 0 ? (
        <div
          style={{
            padding: '32px 20px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--bg-panel)',
            fontFamily: 'var(--font-serif)',
            fontSize: 14,
            color: 'var(--text-mute)',
            textAlign: 'center',
          }}
        >
          No conversations in this project yet.
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--bg-panel)',
          }}
        >
          {chats.map((c, i) => (
            <ChatListItem
              key={c.id}
              chat={c}
              isLast={i === chats.length - 1}
              onClick={() => onSelectActive?.(c.id)}
              onRemove={onRemoveChat ? () => onRemoveChat(c.id) : undefined}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

/* ── Search page ── */
export function SearchPage() {
  return (
    <PageShell title="Search" subtitle="Find any conversation, file, or tool call">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 14px',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        <SearchIcon size={14} style={{ color: 'var(--text-mute)' }} />
        <input
          type="text"
          disabled
          placeholder="Search coming soon…"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: 'var(--text)',
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mute)' }}>
          ⌘K
        </span>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 14,
          color: 'var(--text-mute)',
          lineHeight: 1.6,
        }}
      >
        Search is not yet available.
      </div>
    </PageShell>
  );
}

/* AutomationsPage and PluginsPage now live in their own files
 * (./AutomationsPage.tsx and ./PluginsPage.tsx). */
