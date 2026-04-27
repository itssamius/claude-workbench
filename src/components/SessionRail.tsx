import { Plus, Settings } from 'lucide-react';
import type { Session } from '../data/sample';

interface Props {
  sessions: Session[];
}

const STATE_DOT: Record<Session['state'], string> = {
  working:  'var(--accent)',
  review:   'var(--green)',
  awaiting: 'var(--amber)',
  idle:     'var(--text-mute)',
};

export default function SessionRail({ sessions }: Props) {
  return (
    <div
      style={{
        width: 'var(--rail-w)',
        flexShrink: 0,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 8,
      }}
    >
      {/* Add session */}
      <button
        style={{
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
          marginBottom: 4,
        }}
      >
        <Plus size={16} strokeWidth={2} />
      </button>

      {/* Session dots */}
      {sessions.map((session) => (
        <div
          key={session.id}
          style={{
            position: 'relative',
            width: 40,
            height: 40,
          }}
        >
          {/* Active left bar */}
          {session.active && (
            <div
              style={{
                position: 'absolute',
                left: -16,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 4,
                height: 28,
                background: 'var(--text)',
                borderRadius: '0 3px 3px 0',
              }}
            />
          )}

          {/* Avatar */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: session.active
                ? 'var(--bg-paper)'
                : session.avatarBg,
              border: session.active
                ? '1px solid var(--border)'
                : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-serif)',
              fontSize: 13,
              fontWeight: 400,
              color: session.active ? 'var(--text)' : 'var(--text-dim)',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {session.initials}

            {/* State dot */}
            {session.state !== 'idle' && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: STATE_DOT[session.state],
                  border: '2px solid var(--bg-panel)',
                }}
              />
            )}
          </div>
        </div>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button
        style={{
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: 'var(--text-mute)',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        <Settings size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
