import { useRef, useState, useEffect } from 'react';
import { SendHorizonal, Paperclip } from 'lucide-react';
import type { Message, PlanItem, ToolCall } from '../data/sample';
import { MESSAGES } from '../data/sample';

/* ── Tool row ── */
function ToolRow({ tc }: { tc: ToolCall }) {
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
      }}
    >
      {/* Verb */}
      <span
        style={{
          minWidth: 38,
          color: 'var(--accent)',
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}
      >
        {tc.tool}
      </span>

      {/* Path */}
      <span style={{ color: 'var(--text)', flexShrink: 0 }}>{tc.path}</span>

      {/* Dotted leader */}
      <span
        style={{
          flex: 1,
          borderBottom: '1px dotted var(--border)',
          marginBottom: 3,
          minWidth: 12,
        }}
      />

      {/* Detail */}
      <span style={{ color: 'var(--text-mute)', flexShrink: 0 }}>{tc.detail}</span>
    </div>
  );
}

/* ── Plan card ── */
function PlanCard({ items, label, intro }: { items: PlanItem[]; label: string; intro: string }) {
  const done = items.filter((i) => i.status === 'done').length;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--bg-paper)',
        marginTop: 8,
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
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent)',
          }}
        />
        <span>
          PLAN · {done} OF {items.length} COMPLETE
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
          width: 20,
          height: 20,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...(isDone
            ? { background: 'var(--green)', border: 'none' }
            : isActive
            ? { background: 'transparent', border: '1.5px solid var(--accent)' }
            : { background: 'transparent', border: '1.5px solid var(--border)' }),
        }}
      >
        {isDone ? (
          <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
            <path d="M1 4l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: isActive ? 'var(--accent)' : 'var(--text-mute)',
              lineHeight: 1,
            }}
          >
            {item.id}
          </span>
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

/* ── Message author row ── */
function AuthorRow({ author, time }: { author: string; time: string }) {
  const isUser = author === 'You';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: isUser ? 'var(--bg-panel)' : 'var(--accent-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-serif)',
          fontSize: 10,
          color: isUser ? 'var(--text-dim)' : 'var(--accent)',
          flexShrink: 0,
        }}
      >
        {author.charAt(0)}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text)',
        }}
      >
        {author}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-mute)',
        }}
      >
        · {time}
      </span>
    </div>
  );
}

/* ── Message renderer ── */
function MessageBlock({ msg }: { msg: Message }) {
  if (msg.role === 'tools' && msg.tools) {
    return (
      <div style={{ margin: '4px 0 12px' }}>
        {msg.tools.map((tc) => (
          <ToolRow key={tc.id} tc={tc} />
        ))}
      </div>
    );
  }

  if (msg.role === 'plan' && msg.planItems) {
    return (
      <div style={{ marginBottom: 14 }}>
        {msg.author && msg.time && <AuthorRow author={msg.author} time={msg.time} />}
        <PlanCard items={msg.planItems} label={msg.planLabel ?? ''} intro={msg.content ?? ''} />
      </div>
    );
  }

  const isUser = msg.role === 'user';

  return (
    <div style={{ marginBottom: isUser ? 12 : 14 }}>
      {msg.author && msg.time && <AuthorRow author={msg.author} time={msg.time} />}
      <p
        style={{
          fontFamily: isUser ? 'var(--font-sans)' : 'var(--font-serif)',
          fontSize: isUser ? 14 : 15,
          lineHeight: isUser ? 1.6 : 1.72,
          color: 'var(--text)',
        }}
      >
        {msg.content}
      </p>
    </div>
  );
}

/* ── Composer ── */
function Composer({ onSubmit, isRunning }: { onSubmit: (prompt: string) => void; isRunning: boolean }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed);
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      style={{
        padding: '8px 0 12px',
      }}
    >
      <div
        style={{
          background: 'var(--bg-paper)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply to Claude…"
          rows={2}
          style={{
            width: '100%',
            padding: '10px 14px 6px',
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
            padding: '6px 12px 10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PillBadge label="claude-sonnet-4-5" />
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-mute)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              <Paperclip size={10} />
              Attach
            </button>
          </div>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={isRunning || !text.trim()}
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--green)',
              border: 'none',
              borderRadius: 7,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              color: '#fff',
              flexShrink: 0,
              opacity: isRunning ? 0.5 : 1,
              animation: isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
            }}
          >
            <SendHorizonal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function PillBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '3px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-dim)',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      {label}
    </span>
  );
}

/* ── Main conversation column ── */
interface Props {
  task: {
    title: string;
    project: string;
    branch: string;
    startedAt: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    toolsUsed: number;
    state: 'working';
  };
  messages: Message[];
  planItems?: PlanItem[];
  onSubmit: (prompt: string) => void;
  isRunning: boolean;
  permissionBanners?: React.ReactNode;
}

export default function Conversation({ task, messages, onSubmit, isRunning, permissionBanners }: Props) {
  // Show live messages if we have any, otherwise fall back to sample data
  const displayMessages = messages.length > 0 ? messages : MESSAGES;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
          {/* Eyebrow */}
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
            Conversation · Started {task.startedAt}
          </div>

          {/* H1 */}
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1.25,
              color: 'var(--text)',
              marginBottom: 10,
              letterSpacing: '-0.01em',
            }}
          >
            {task.title}
          </h1>

          {/* Metadata row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 14,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-dim)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                }}
              />
              {task.filesChanged} files
            </span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>
              <span style={{ color: 'var(--green)' }}>+{task.additions}</span>
              {' '}
              <span style={{ color: 'var(--red)' }}>-{task.deletions}</span>
            </span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span>{task.toolsUsed} tools used</span>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span
              style={{
                padding: '2px 8px',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                borderRadius: 4,
                fontSize: 11,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              {task.state}
            </span>
          </div>

          {/* Message list */}
          <div style={{ paddingBottom: 20 }}>
            {displayMessages.map((msg) => (
              <MessageBlock key={msg.id} msg={msg} />
            ))}
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
        <Composer onSubmit={onSubmit} isRunning={isRunning} />
      </div>
    </div>
  );
}
