import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search as SearchIcon, Puzzle, RefreshCw, ExternalLink, Check } from 'lucide-react';
import type { MarketplacePlugin, InstalledPlugin } from '../data/sample';

const ALL_CATEGORY = '__all__';

/* ── Page shell ── */
function PageShell({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg-paper)', borderRight: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h1 style={{
                fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400,
                lineHeight: 1.25, color: 'var(--text)', letterSpacing: '-0.01em', marginBottom: 4,
              }}>{title}</h1>
              {subtitle && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-dim)' }}>
                  {subtitle}
                </div>
              )}
            </div>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PluginsPage() {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [catalog,   setCatalog]   = useState<MarketplacePlugin[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const [showInstalledOnly, setShowInstalledOnly] = useState(false);

  // Per-plugin operation status (keyed by name@marketplace)
  const [busy, setBusy] = useState<Record<string, 'install' | 'uninstall'>>({});
  const [opError, setOpError] = useState<string | null>(null);

  // Load both lists in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      invoke<InstalledPlugin[]>('list_installed_plugins'),
      invoke<MarketplacePlugin[]>('list_marketplace_plugins'),
    ])
      .then(([inst, cat]) => {
        if (cancelled) return;
        setInstalled(inst);
        setCatalog(cat);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  // Index of installed plugins by "name@marketplace" for quick lookup.
  const installedByKey = useMemo(() => {
    const m = new Map<string, InstalledPlugin>();
    for (const p of installed) m.set(`${p.name}@${p.marketplace}`, p);
    return m;
  }, [installed]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of catalog) if (p.category) set.add(p.category);
    return [ALL_CATEGORY, ...Array.from(set).sort()];
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((p) => category === ALL_CATEGORY || p.category === category)
      .filter((p) => !showInstalledOnly || installedByKey.has(`${p.name}@${p.marketplace}`))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Installed first, then alphabetical.
        const ai = installedByKey.has(`${a.name}@${a.marketplace}`) ? 0 : 1;
        const bi = installedByKey.has(`${b.name}@${b.marketplace}`) ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
      });
  }, [catalog, search, category, showInstalledOnly, installedByKey]);

  async function handleInstall(p: MarketplacePlugin) {
    const key = `${p.name}@${p.marketplace}`;
    setBusy((b) => ({ ...b, [key]: 'install' }));
    setOpError(null);
    try {
      await invoke<string>('install_plugin', { name: p.name, marketplace: p.marketplace });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setOpError(`Failed to install ${p.name}: ${String(err)}`);
    } finally {
      setBusy((b) => { const next = { ...b }; delete next[key]; return next; });
    }
  }

  async function handleUninstall(p: MarketplacePlugin) {
    const key = `${p.name}@${p.marketplace}`;
    setBusy((b) => ({ ...b, [key]: 'uninstall' }));
    setOpError(null);
    try {
      await invoke<string>('uninstall_plugin', { name: p.name, marketplace: p.marketplace });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setOpError(`Failed to uninstall ${p.name}: ${String(err)}`);
    } finally {
      setBusy((b) => { const next = { ...b }; delete next[key]; return next; });
    }
  }

  const installedCount = installedByKey.size;
  const subtitle = loading
    ? 'Loading…'
    : `${installedCount} installed · ${catalog.length} available`;

  return (
    <PageShell
      title="Plugins"
      subtitle={subtitle}
      actions={
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          title="Refresh"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 12px',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-dim)', borderRadius: 7, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 12,
          }}
        >
          <RefreshCw size={12} strokeWidth={1.8} />
          Refresh
        </button>
      }
    >
      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}
      {opError && (
        <ErrorBanner message={opError} onDismiss={() => setOpError(null)} />
      )}

      {/* Search + filter row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px',
        background: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 10, marginBottom: 14,
      }}>
        <SearchIcon size={14} style={{ color: 'var(--text-mute)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plugins…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text)',
          }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{
            background: 'var(--bg-paper)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 8px',
            fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-dim)',
            cursor: 'pointer',
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c === ALL_CATEGORY ? 'All categories' : c}</option>
          ))}
        </select>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-dim)',
          cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={showInstalledOnly}
            onChange={(e) => setShowInstalledOnly(e.target.checked)}
          />
          Installed only
        </label>
      </div>

      {/* List */}
      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '32px 20px',
          border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)',
          fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--text-mute)', textAlign: 'center',
        }}>
          {catalog.length === 0
            ? 'No marketplaces found. Run `claude plugin marketplace add <repo>` to add one.'
            : 'No plugins match your filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((p) => {
            const key = `${p.name}@${p.marketplace}`;
            const inst = installedByKey.get(key);
            const busyState = busy[key];
            return (
              <PluginRow
                key={key}
                plugin={p}
                installed={inst}
                busyState={busyState}
                onInstall={() => handleInstall(p)}
                onUninstall={() => handleUninstall(p)}
              />
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

/* ── Row ── */
function PluginRow({
  plugin: p, installed, busyState, onInstall, onUninstall,
}: {
  plugin: MarketplacePlugin;
  installed: InstalledPlugin | undefined;
  busyState: 'install' | 'uninstall' | undefined;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const isInstalled = !!installed;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      padding: '14px 16px',
      background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
    }}>
      <div style={{
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8,
        background: isInstalled ? 'var(--accent-soft)' : 'var(--bg-paper)',
        border: '1px solid var(--border)', flexShrink: 0,
      }}>
        <Puzzle size={14} style={{ color: isInstalled ? 'var(--accent)' : 'var(--text-mute)' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text)', fontWeight: 500,
          }}>
            {p.name}
          </span>
          {installed && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mute)', fontWeight: 400,
            }}>
              v{installed.version}
            </span>
          )}
          {p.category && (
            <span style={{
              padding: '1px 7px',
              fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-mute)', background: 'var(--bg-paper)',
              border: '1px solid var(--border)', borderRadius: 3,
            }}>
              {p.category}
            </span>
          )}
        </div>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--text-dim)',
          lineHeight: 1.5, marginTop: 3,
        }}>
          {p.description}
        </div>
        {(p.author || p.homepage) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mute)',
          }}>
            {p.author && <span>by {p.author}</span>}
            {p.homepage && (
              <a
                href={p.homepage} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  color: 'var(--text-mute)', textDecoration: 'none',
                }}
              >
                homepage <ExternalLink size={10} strokeWidth={1.6} />
              </a>
            )}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0 }}>
        {isInstalled ? (
          <button
            type="button"
            onClick={onUninstall}
            disabled={!!busyState}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
              color: 'var(--text-dim)',
              background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 6,
              cursor: busyState ? 'wait' : 'pointer',
              opacity: busyState ? 0.6 : 1,
            }}
          >
            {busyState === 'uninstall' ? 'Uninstalling…' : (
              <><Check size={12} strokeWidth={2} /> Installed</>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={!!busyState}
            style={{
              padding: '6px 14px',
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
              color: '#fff',
              background: 'var(--accent)',
              border: '1px solid var(--accent)', borderRadius: 6,
              cursor: busyState ? 'wait' : 'pointer',
              opacity: busyState ? 0.6 : 1,
            }}
          >
            {busyState === 'install' ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div style={{
      padding: '40px 20px',
      border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)',
      fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-mute)', textAlign: 'center',
    }}>
      Loading plugin catalog…
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', marginBottom: 14,
      background: 'var(--red-bg)', border: '1px solid var(--red)',
      borderRadius: 8, color: 'var(--red)',
      fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
    }}>
      <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{message}</div>
      <button
        type="button" onClick={onDismiss}
        style={{
          background: 'transparent', border: 'none', color: 'var(--red)',
          cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12,
        }}
      >
        ×
      </button>
    </div>
  );
}
