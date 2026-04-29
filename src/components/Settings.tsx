import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  onClose: () => void;
}

type NavItem =
  | 'Account'
  | 'Models & defaults'
  | 'Permissions'
  | 'Editor integrations'
  | 'Keyboard'
  | 'Appearance'
  | 'MCP & plugins'
  | 'Notifications';

const NAV_ITEMS: NavItem[] = [
  'Account',
  'Appearance',
];

const ACCENT_COLORS = [
  { value: '#2d6b5d', label: 'Teal' },
  { value: '#4a7c59', label: 'Sage' },
  { value: '#3d5a6e', label: 'Blue-gray' },
  { value: '#6b4c35', label: 'Warm brown' },
  { value: '#4a5568', label: 'Slate' },
];

type Theme = 'light' | 'dark' | 'system';
type Density = 'compact' | 'comfortable' | 'spacious';

interface AppearanceState {
  theme: Theme;
  density: Density;
  accent: string;
}

function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem('workbench-appearance');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { theme: 'light', density: 'comfortable', accent: '#2d6b5d' };
}

async function saveAppearance(state: AppearanceState) {
  try {
    await invoke('save_appearance', { data: JSON.stringify(state) });
  } catch {
    // Fallback: if Tauri command fails, ignore silently
  }
  localStorage.setItem('workbench-appearance', JSON.stringify(state));
}

// ─── Sub-panes ─────────────────────────────────────────────────────────────

function AccountPane() {
  const [apiKey, setApiKey] = useState('sk-ant-••••••••••••••••••••');

  async function handleSave() {
    try {
      const existing = await invoke<string>('load_profile').catch(() => '{}');
      const profile = JSON.parse(existing || '{}');
      profile.apiKey = apiKey;
      await invoke('save_profile', { data: JSON.stringify(profile) });
    } catch {
      // ignore
    }
  }

  async function handleSignOut() {
    try {
      await invoke('save_profile', { data: JSON.stringify({}) });
    } catch {
      // ignore
    }
    window.location.reload();
  }

  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        Account
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-dim)',
          marginBottom: 32,
        }}
      >
        Your Anthropic identity, billing, and team membership.
      </p>

      {/* Plan */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          Plan
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              background: 'var(--accent)',
              borderRadius: 6,
              padding: '6px 10px',
            }}
          >
            Pro
          </span>
          <a
            href="https://claude.ai"
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            claude.ai
          </a>
        </div>
      </section>

      {/* Usage */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          Usage this month
        </div>
        <div
          style={{
            background: 'var(--bg-panel)',
            borderRadius: 4,
            height: 8,
            width: '100%',
            maxWidth: 480,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: '45%',
              height: '100%',
              background: 'var(--accent)',
              borderRadius: 4,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          15,420 / 34,000 tokens
        </span>
      </section>

      {/* API Key */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          API Key
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 480 }}>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--text)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSave}
            style={{
              flexShrink: 0,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              background: 'var(--green)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--text-mute)',
            marginTop: 6,
          }}
        >
          Stored in OS keychain
        </p>
      </section>

      {/* Danger zone */}
      <section>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--red)',
            marginBottom: 10,
          }}
        >
          Danger zone
        </div>
        <button
          onClick={handleSignOut}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--red)',
            background: 'transparent',
            border: '1px solid var(--red)',
            borderRadius: 8,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-bg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

function AppearancePane() {
  const [state, setState] = useState<AppearanceState>(loadAppearance);

  function update(patch: Partial<AppearanceState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    await saveAppearance(state);
  }

  const THEME_CARDS: { value: Theme; label: string; swatch: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      swatch: (
        <div
          style={{
            width: '100%',
            height: 40,
            background: 'var(--bg-paper)',
            borderRadius: '6px 6px 0 0',
          }}
        />
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      swatch: (
        <div
          style={{
            width: '100%',
            height: 40,
            background: '#1d1a14',
            borderRadius: '6px 6px 0 0',
          }}
        />
      ),
    },
    {
      value: 'system',
      label: 'System',
      swatch: (
        <div
          style={{
            width: '100%',
            height: 40,
            borderRadius: '6px 6px 0 0',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, var(--bg-paper) 50%, #1d1a14 50%)',
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        Appearance
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-dim)',
          marginBottom: 32,
        }}
      >
        Theme, density, and typography. Changes apply instantly.
      </p>

      {/* Theme */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 12,
          }}
        >
          Theme
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {THEME_CARDS.map(({ value, label, swatch }) => {
            const active = state.theme === value;
            return (
              <button
                key={value}
                onClick={() => update({ theme: value })}
                style={{
                  width: 80,
                  height: 64,
                  borderRadius: 8,
                  border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: 'var(--bg-paper)',
                  cursor: 'pointer',
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                }}
              >
                {swatch}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: active ? 'var(--accent)' : 'var(--text-dim)',
                    fontWeight: active ? 500 : 400,
                    gap: 4,
                  }}
                >
                  {active && <Check size={10} strokeWidth={2.5} />}
                  {label}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Density */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 12,
          }}
        >
          Density
        </div>
        <div
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {(['compact', 'comfortable', 'spacious'] as Density[]).map((d) => {
            const active = state.density === d;
            return (
              <button
                key={d}
                onClick={() => update({ density: d })}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  color: active ? '#fff' : 'var(--text-dim)',
                  background: active ? 'var(--accent)' : 'var(--bg-paper)',
                  border: 'none',
                  padding: '6px 16px',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            );
          })}
        </div>
      </section>

      {/* Accent color */}
      <section style={{ marginBottom: 48 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 12,
          }}
        >
          Accent color
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ACCENT_COLORS.map(({ value, label }) => {
            const active = state.accent === value;
            return (
              <button
                key={value}
                title={label}
                onClick={() => update({ accent: value })}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: value,
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  outline: active ? `2px solid ${value}` : 'none',
                  outlineOffset: active ? 2 : 0,
                  boxShadow: active ? `inset 0 0 0 2px #fff` : 'none',
                }}
              >
                {active && (
                  <Check size={12} strokeWidth={2.5} style={{ color: '#fff' }} />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--green)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 20px',
            cursor: 'pointer',
          }}
        >
          Save preferences
        </button>
      </div>
    </div>
  );
}

function ComingSoonPane({ title }: { title: string }) {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        {title}
      </h1>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-mute)',
        }}
      >
        Coming soon
      </div>
    </div>
  );
}

// ─── Main Settings overlay ─────────────────────────────────────────────────

export default function Settings({ onClose }: Props) {
  const [active, setActive] = useState<NavItem>('Account');
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function renderPane() {
    switch (active) {
      case 'Account':
        return <AccountPane />;
      case 'Appearance':
        return <AppearancePane />;
      default:
        return <ComingSoonPane title={active} />;
    }
  }

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Titlebar row */}
      <div
        data-tauri-drag-region
        style={{
          height: 'var(--titlebar-h)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 16,
          borderBottom: '1px solid var(--border)',
          userSelect: 'none',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* Traffic lights */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {/* Red — close */}
          <button
            onClick={onClose}
            title="Close settings"
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#FF5F57',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          />
          <div
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E' }}
          />
          <div
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840' }}
          />
        </div>

        {/* Breadcrumb — centered */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-mute)',
            gap: 6,
            WebkitAppRegion: 'drag',
          } as React.CSSProperties}
        >
          <span>Claude Workbench</span>
          <span style={{ color: 'var(--border)' }}>›</span>
          <span>Settings</span>
          <span style={{ color: 'var(--border)' }}>›</span>
          <span>{active}</span>
        </div>

        {/* Right spacer to visually balance traffic lights */}
        <div style={{ width: 52 }} />
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left nav */}
        <nav
          style={{
            width: 220,
            flexShrink: 0,
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border)',
            padding: '16px 0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-mute)',
              padding: '0 16px',
              marginBottom: 8,
            }}
          >
            Settings
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = item === active;
            return (
              <button
                key={item}
                onClick={() => setActive(item)}
                style={{
                  height: 32,
                  padding: '0 16px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? 'var(--accent)' : 'var(--text-dim)',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {item}
              </button>
            );
          })}
        </nav>

        {/* Right content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '40px 48px',
          }}
        >
          {renderPane()}
        </div>
      </div>
    </div>
  );
}
