interface Props {
  branch: string;
  tokens: number;
  cost: string;
  version: string;
  testsTotal: number;
  testsPassed: number;
  migrationsPending: number;
}

export default function StatusBar({
  branch,
  tokens,
  cost,
  version,
  testsTotal,
  testsPassed,
  migrationsPending,
}: Props) {
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div
      style={{
        height: 'var(--statusbar-h)',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-mute)',
        userSelect: 'none',
      }}
    >
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <Dot />
        <StatusItem label="connected" />
        <Dot />
        <StatusItem
          label={`tests passed · ${testsPassed}/${testsTotal}`}
        />
        <Dot />
        <StatusItem
          label={`migrations: ${migrationsPending} pending`}
          highlight={migrationsPending > 0}
        />
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <StatusItem label={`${fmt(tokens)} tokens`} />
        <Dot />
        <StatusItem label={`$${cost}`} />
        <Dot />
        <StatusItem label={`v${version}`} />
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span
      style={{
        margin: '0 6px',
        color: 'var(--border)',
        userSelect: 'none',
      }}
    >
      ·
    </span>
  );
}

function StatusItem({ label, highlight }: { label: string; highlight?: boolean }) {
  return (
    <span style={{ color: highlight ? 'var(--amber)' : 'var(--text-mute)' }}>{label}</span>
  );
}
