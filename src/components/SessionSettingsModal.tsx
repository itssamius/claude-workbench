import { useState, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function SessionSettingsModal({ sessionId, onClose }: Props) {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const setEnvVars = useSessionStore((s) => s.setEnvVars);

  const [vars, setVars] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    if (session?.envVars) {
      setVars(
        Object.entries(session.envVars).map(([key, value]) => ({ key, value })),
      );
    }
  }, [session?.envVars]);

  function addRow() {
    setVars([...vars, { key: "", value: "" }]);
  }

  function removeRow(index: number) {
    setVars(vars.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: "key" | "value", val: string) {
    setVars(vars.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  }

  function handleSave() {
    const envVars: Record<string, string> = {};
    for (const row of vars) {
      if (row.key.trim()) {
        envVars[row.key.trim()] = row.value;
      }
    }
    setEnvVars(sessionId, envVars);
    onClose();
  }

  if (!session) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl w-[500px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Session Settings: {session.name}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Environment Variables
              </h3>
              <button
                onClick={addRow}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                + Add Variable
              </button>
            </div>

            {vars.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] py-2">
                No environment variables configured.
              </p>
            )}

            <div className="space-y-2">
              {vars.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateRow(i, "key", e.target.value)}
                    placeholder="KEY"
                    className="flex-1 text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] font-mono"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => updateRow(i, "value", e.target.value)}
                    placeholder="value"
                    className="flex-1 text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] font-mono"
                  />
                  <button
                    onClick={() => removeRow(i)}
                    className="text-[var(--text-secondary)] hover:text-[var(--error)] text-sm px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {session.status === "running" && vars.length > 0 && (
              <p className="text-xs text-[var(--text-secondary)] mt-2 italic">
                Changes take effect on session restart.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
