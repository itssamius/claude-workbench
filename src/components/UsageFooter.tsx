interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

interface Props {
  model: string;
  tokenUsage?: TokenUsage;
}

const CONTEXT_LIMIT = 200_000;

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

export default function UsageFooter({ model, tokenUsage }: Props) {
  const input         = tokenUsage?.input         ?? 0;
  const output        = tokenUsage?.output        ?? 0;
  const cacheRead     = tokenUsage?.cacheRead     ?? 0;
  const cacheCreation = tokenUsage?.cacheCreation ?? 0;

  const hasUsage = input > 0 || output > 0;

  const contextUsed = input + cacheRead + cacheCreation;
  const pct = Math.min(100, Math.round((contextUsed / CONTEXT_LIMIT) * 100));

  const barColor =
    pct >= 90 ? 'var(--red)' :
    pct >= 75 ? 'var(--amber)' :
    'var(--text-mute)';

  const textColor =
    pct >= 90 ? 'var(--red)' :
    pct >= 75 ? 'var(--amber)' :
    'var(--text-mute)';

  return (
    <div
      style={{
        flexShrink: 0,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 40px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-paper)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        color: 'var(--text-mute)',
        overflow: 'hidden',
      }}
    >
      {/* Model name — always visible */}
      <span style={{ color: 'var(--text-dim)' }}>{modelLabel(model)}</span>

      {hasUsage && (
        <>
          <span style={{ color: 'var(--border)' }}>·</span>

          {/* Context bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: textColor }}>
            <span>ctx</span>
            <div
              style={{
                width: 48,
                height: 3,
                background: 'var(--border)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: barColor,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span>{fmtK(contextUsed)}/{fmtK(CONTEXT_LIMIT)} ({pct}%)</span>
          </div>

          <span style={{ color: 'var(--border)' }}>·</span>

          {/* Token counts */}
          <span>
            {fmtK(input)}↓ {fmtK(output)}↑
            {cacheRead > 0 && (
              <span style={{ opacity: 0.7 }}>
                {' '}· {fmtK(cacheRead)} cached
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}
