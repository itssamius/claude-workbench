import { useState, useEffect } from "react";
import { useTemplateStore } from "../stores/templateStore";
import { open } from "@tauri-apps/plugin-dialog";
import type { SessionTemplate } from "../lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  template?: SessionTemplate;
}

export function TemplateModal({ isOpen, onClose, template }: Props) {
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);

  const [name, setName] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [flagsText, setFlagsText] = useState("");
  const [vars, setVars] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setWorkingDir(template.workingDir);
      setFlagsText(template.flags.join(", "));
      setVars(
        Object.entries(template.envVars).map(([key, value]) => ({ key, value })),
      );
    } else {
      setName("");
      setWorkingDir("");
      setFlagsText("");
      setVars([]);
    }
  }, [template, isOpen]);

  function addRow() {
    setVars([...vars, { key: "", value: "" }]);
  }

  function removeRow(index: number) {
    setVars(vars.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: "key" | "value", val: string) {
    setVars(vars.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  }

  async function handlePickDir() {
    const dir = await open({ directory: true, multiple: false });
    if (dir) setWorkingDir(dir as string);
  }

  async function handleSave() {
    if (!name.trim() || !workingDir.trim()) return;
    const flags = flagsText
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const envVars: Record<string, string> = {};
    for (const row of vars) {
      if (row.key.trim()) {
        envVars[row.key.trim()] = row.value;
      }
    }
    if (template) {
      await updateTemplate(template.id, { name: name.trim(), workingDir: workingDir.trim(), flags, envVars });
    } else {
      await createTemplate(name.trim(), workingDir.trim(), flags, envVars);
    }
    onClose();
  }

  async function handleDelete() {
    if (!template) return;
    if (!confirm("Delete this template?")) return;
    await deleteTemplate(template.id);
    onClose();
  }

  if (!isOpen) return null;

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
            {template ? "Edit Template" : "New Template"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
              className="w-full text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">
              Working Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] font-mono"
              />
              <button
                onClick={handlePickDir}
                className="px-2 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-1">
              Flags
            </label>
            <input
              type="text"
              value={flagsText}
              onChange={(e) => setFlagsText(e.target.value)}
              placeholder="--flag1, --flag2"
              className="w-full text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] font-mono"
            />
          </div>

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
          </div>
        </div>

        <div className="flex justify-between px-4 py-3 border-t border-[var(--border)]">
          <div>
            {template && (
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs rounded border border-[var(--error)] text-[var(--error)] hover:opacity-90 transition-opacity"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
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
    </div>
  );
}
