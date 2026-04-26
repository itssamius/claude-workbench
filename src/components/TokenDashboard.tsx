import { useEffect } from "react";
import { useTokenStore } from "../stores/tokenStore";

const fmt = new Intl.NumberFormat();

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

interface TokenDashboardProps {
  workingDir: string;
}

export function TokenDashboard({ workingDir }: TokenDashboardProps) {
  const entries = useTokenStore((s) => s.usage[workingDir] ?? []);
  const loading = useTokenStore((s) => s.loading);
  const loadUsage = useTokenStore((s) => s.loadUsage);

  useEffect(() => {
    loadUsage(workingDir);
  }, [workingDir, loadUsage]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">Loading usage data...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">No usage data found</p>
      </div>
    );
  }

  const totals = entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.cacheCreationTokens,
      totalCost: acc.totalCost + e.totalCost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCost: 0 },
  );

  return (
    <div className="h-full flex flex-col bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-primary)]">Token Usage</span>
        <button
          onClick={() => loadUsage(workingDir)}
          className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] rounded"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)]">Session</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)]">Model</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">Input</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">Output</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">Cache Read</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">Cache Write</th>
              <th className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[140px] truncate">{entry.sessionFile}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{entry.model}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] text-right">{fmt.format(entry.inputTokens)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] text-right">{fmt.format(entry.outputTokens)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] text-right">{fmt.format(entry.cacheReadTokens)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] text-right">{fmt.format(entry.cacheCreationTokens)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-primary)] text-right">{formatCost(entry.totalCost)}</td>
              </tr>
            ))}
            <tr className="bg-[var(--bg-secondary)]">
              <td className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)]">Total</td>
              <td className="px-3 py-2 text-xs text-[var(--text-secondary)]" />
              <td className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">{fmt.format(totals.inputTokens)}</td>
              <td className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">{fmt.format(totals.outputTokens)}</td>
              <td className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">{fmt.format(totals.cacheReadTokens)}</td>
              <td className="px-3 py-2 text-xs font-semibold text-[var(--text-primary)] text-right">{fmt.format(totals.cacheCreationTokens)}</td>
              <td className="px-3 py-2 text-xs font-semibold text-[var(--accent)] text-right">{formatCost(totals.totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
