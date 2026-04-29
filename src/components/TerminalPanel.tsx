import { useEffect } from 'react';
import { Terminal as TerminalIcon, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import Terminal from './Terminal';

export interface TerminalTab {
  id?: string;
  localKey: string;
  cwd: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

interface Props {
  cwd: string;
  tabs: TerminalTab[];
  activeKey: string | null;
  collapsed: boolean;
  onTabsChange: (tabs: TerminalTab[]) => void;
  onActiveKeyChange: (key: string | null) => void;
  onCollapsedChange: (c: boolean) => void;
  model?: string;
  tokenUsage?: TokenUsage;
}

const TERM_BG = '#1d1a14';

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus'))   return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku'))  return 'Haiku';
  return model;
}

export default function TerminalPanel({
  cwd,
  tabs,
  activeKey,
  collapsed,
  onTabsChange,
  onActiveKeyChange,
  onCollapsedChange,
  model,
  tokenUsage,
}: Props) {
  useEffect(() => {
    if (collapsed) return;
    if (tabs.length === 0) {
      const t: TerminalTab = { localKey: `t-${Date.now()}`, cwd };
      onTabsChange([t]);
      onActiveKeyChange(t.localKey);
    } else if (activeKey == null || !tabs.some(t => t.localKey === activeKey)) {
      onActiveKeyChange(tabs[0].localKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, collapsed]);

  function addTab() {
    const t: TerminalTab = { localKey: `t-${Date.now()}`, cwd };
    onTabsChange([...tabs, t]);
    onActiveKeyChange(t.localKey);
  }

  function closeTab(localKey: string) {
    const tab = tabs.find(t => t.localKey === localKey);
    if (tab?.id) {
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('term_close', { id: tab.id }).catch(() => {})
      );
    }
    const next = tabs.filter(t => t.localKey !== localKey);
    onTabsChange(next);
    if (activeKey === localKey) {
      onActiveKeyChange(next[0]?.localKey ?? null);
    }
  }

  function attachId(localKey: string, id: string) {
    onTabsChange(tabs.map(t => t.localKey === localKey ? { ...t, id } : t));
  }

  const hasUsage = (tokenUsage?.input ?? 0) > 0 || (tokenUsage?.output ?? 0) > 0;

  return (
    <div
      style={{
        flexShrink: 0,
        height: collapsed ? 30 : 240,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border)',
        background: TERM_BG,
      }}
    >
      {!collapsed && (
        <div
          style={{
            height: 4,
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ width: 28, height: 2, background: 'var(--border)', borderRadius: 2 }} />
        </div>
      )}

      {/* Tab strip / collapsed header */}
      <div
        style={{
          height: 30,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          background: 'var(--bg-panel)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          gap: 4,
          overflowX: 'auto',
        }}
      >
        <button
          type="button"
          title={collapsed ? 'Show terminal (⌘J)' : 'Hide terminal (⌘J)'}
          onClick={() => onCollapsedChange(!collapsed)}
          style={{
            width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: 'var(--text-mute)', cursor: 'pointer', borderRadius: 4, padding: 0,
            flexShrink: 0,
          }}
        >
          {collapsed
            ? <ChevronUp size={13} strokeWidth={1.8} />
            : <ChevronDown size={13} strokeWidth={1.8} />}
        </button>

        {!collapsed && tabs.map((t) => {
          const isActive = t.localKey === activeKey;
          return (
            <div
              key={t.localKey}
              onClick={() => onActiveKeyChange(t.localKey)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 22,
                padding: '0 8px 0 10px',
                background: isActive ? 'var(--bg-paper)' : 'transparent',
                border: '1px solid',
                borderColor: isActive ? 'var(--border)' : 'transparent',
                borderRadius: 5,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: isActive ? 'var(--text)' : 'var(--text-dim)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <TerminalIcon size={11} strokeWidth={1.6} style={{ color: 'var(--text-mute)' }} />
              <span>zsh</span>
              <button
                type="button"
                title="Close"
                onClick={(e) => { e.stopPropagation(); closeTab(t.localKey); }}
                style={{
                  width: 14, height: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-mute)', cursor: 'pointer', padding: 0, marginLeft: 2,
                }}
              >
                <X size={10} strokeWidth={1.8} />
              </button>
            </div>
          );
        })}

        {!collapsed && (
          <button
            type="button"
            title="New terminal (⌘T)"
            onClick={addTab}
            style={{
              width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: 'var(--text-mute)', cursor: 'pointer', borderRadius: 4, padding: 0,
              flexShrink: 0,
            }}
          >
            <Plus size={12} strokeWidth={1.8} />
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Right-side info: model + usage + terminal count */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-mute)',
            paddingRight: 6,
            flexShrink: 0,
          }}
        >
          {model && (
            <span style={{ color: 'var(--text-dim)' }}>{modelLabel(model)}</span>
          )}

          {hasUsage && tokenUsage && (
            <>
              <span style={{ color: 'var(--border)' }}>·</span>
              <span
                title={[
                  `input: ${fmtK(tokenUsage.input)}`,
                  tokenUsage.cacheRead     > 0 ? `cache read: ${fmtK(tokenUsage.cacheRead)}`     : null,
                  tokenUsage.cacheCreation > 0 ? `cache write: ${fmtK(tokenUsage.cacheCreation)}` : null,
                  `output: ${fmtK(tokenUsage.output)}`,
                ].filter(Boolean).join(' · ')}
                style={{ cursor: 'default' }}
              >
                {fmtK(tokenUsage.input + tokenUsage.cacheRead + tokenUsage.cacheCreation)} ctx
              </span>
              <span style={{ color: 'var(--border)' }}>·</span>
              <span>{fmtK(tokenUsage.output)} out</span>
            </>
          )}

          {(model || hasUsage) && (
            <span style={{ color: 'var(--border)' }}>·</span>
          )}

          <span>
            {collapsed
              ? `Terminal · ${tabs.length} hidden`
              : `${tabs.length} session${tabs.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, position: 'relative', background: TERM_BG, minHeight: 0 }}>
          {tabs.map((t) => (
            <div
              key={t.localKey}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: t.localKey === activeKey ? 'visible' : 'hidden',
              }}
            >
              <Terminal
                cwd={t.cwd}
                terminalId={t.id}
                onReady={(id) => { if (!t.id) attachId(t.localKey, id); }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
