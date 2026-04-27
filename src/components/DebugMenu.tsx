import { useState } from 'react';
import { Settings } from 'lucide-react';

type Theme = 'light' | 'dark';
type Density = 'comfortable' | 'compact';

export default function DebugMenu() {
  const isDebug = new URLSearchParams(window.location.search).has('debug');
  if (!isDebug) return null;

  return <DebugMenuInner />;
}

function DebugMenuInner() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [density, setDensity] = useState<Density>('comfortable');

  function applyTheme(value: Theme) {
    setTheme(value);
    if (value === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function applyDensity(value: Density) {
    setDensity(value);
    if (value === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  }

  return (
    <>
      {/* Gear icon trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Debug menu"
        style={{
          position: 'fixed',
          top: 54,
          right: 10,
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--text-mute)',
          zIndex: 9999,
        }}
      >
        <Settings size={14} strokeWidth={1.5} />
      </button>

      {/* Floating panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            top: 88,
            right: 10,
            width: 220,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 14px',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Panel header */}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-mute)',
              paddingBottom: 8,
              borderBottom: '1px solid var(--border)',
            }}
          >
            Debug · Theme &amp; Density
          </div>

          {/* Theme row */}
          <ToggleRow label="Theme">
            <ToggleButton
              active={theme === 'light'}
              onClick={() => applyTheme('light')}
            >
              Light
            </ToggleButton>
            <ToggleButton
              active={theme === 'dark'}
              onClick={() => applyTheme('dark')}
            >
              Dark
            </ToggleButton>
          </ToggleRow>

          {/* Density row */}
          <ToggleRow label="Density">
            <ToggleButton
              active={density === 'comfortable'}
              onClick={() => applyDensity('comfortable')}
            >
              Comfortable
            </ToggleButton>
            <ToggleButton
              active={density === 'compact'}
              onClick={() => applyDensity('compact')}
            >
              Compact
            </ToggleButton>
          </ToggleRow>
        </div>
      )}
    </>
  );
}

function ToggleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 28,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: active ? 500 : 400,
        color: active ? 'var(--accent)' : 'var(--text-mute)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.1s ease',
      }}
    >
      {children}
    </button>
  );
}
