import { useState } from 'react';
import { Sparkles, Plus, Play, Pencil, Trash2, X } from 'lucide-react';
import type { Automation, Project } from '../data/sample';

interface Props {
  automations: Automation[];
  projects: Project[];
  onCreate: (a: Omit<Automation, 'id' | 'createdAt'>) => void;
  onUpdate: (id: string, patch: Partial<Automation>) => void;
  onDelete: (id: string) => void;
  onRun: (a: Automation) => void;
}

/* ── Page shell (kept local so this file is self-contained) ── */
function PageShell({
  title, subtitle, actions, children,
}: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg-paper)', borderRight: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
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

export function AutomationsPage({ automations, projects, onCreate, onUpdate, onDelete, onRun }: Props) {
  const [editing, setEditing] = useState<Automation | null>(null);
  const [creating, setCreating] = useState(false);

  const onCount = automations.filter((a) => a.enabled).length;

  return (
    <PageShell
      title="Automations"
      subtitle={`${onCount} of ${automations.length} active`}
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 32, padding: '0 12px',
            background: 'var(--accent-soft)', border: '1px solid transparent',
            borderRadius: 7, cursor: 'pointer', color: 'var(--accent)',
            fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
          }}
        >
          <Plus size={14} strokeWidth={2} />
          New automation
        </button>
      }
    >
      {automations.length === 0 ? (
        <div style={{
          padding: '40px 20px',
          border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)',
          fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--text-mute)', textAlign: 'center',
        }}>
          No automations yet. Create one to run a saved prompt with a single click.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              onToggle={() => onUpdate(a.id, { enabled: !a.enabled })}
              onRun={() => onRun(a)}
              onEdit={() => setEditing(a)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      )}

      {creating && (
        <AutomationEditor
          projects={projects}
          onSave={(draft) => {
            onCreate(draft);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {editing && (
        <AutomationEditor
          projects={projects}
          existing={editing}
          onSave={(draft) => {
            onUpdate(editing.id, draft);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </PageShell>
  );
}

/* ── Row ── */
function AutomationRow({
  automation: a,
  onToggle, onRun, onEdit, onDelete,
}: {
  automation: Automation;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px',
        background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
      }}
    >
      <Sparkles size={14} style={{ color: a.enabled ? 'var(--accent)' : 'var(--text-mute)', flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: 14,
          color: 'var(--text)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {a.name}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-mute)',
          marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {a.project ? `${a.project} · ` : 'any project · '}
          {a.trigger}
          {a.lastRun ? ` · last run ${a.lastRun}` : ''}
        </div>
      </div>

      {/* Action cluster — visible on hover; toggle is always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {hovered && (
          <>
            <IconBtn title="Run now" onClick={onRun}>
              <Play size={13} strokeWidth={1.8} />
            </IconBtn>
            <IconBtn title="Edit" onClick={onEdit}>
              <Pencil size={13} strokeWidth={1.8} />
            </IconBtn>
            <IconBtn title="Delete" onClick={onDelete}>
              <Trash2 size={13} strokeWidth={1.8} />
            </IconBtn>
          </>
        )}

        <button
          type="button"
          onClick={onToggle}
          title={a.enabled ? 'Disable' : 'Enable'}
          style={{
            marginLeft: 6,
            padding: '3px 8px',
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            color: a.enabled ? 'var(--green)' : 'var(--text-mute)',
            background: a.enabled ? 'var(--green-bg)' : 'transparent',
            border: a.enabled ? '1px solid transparent' : '1px solid var(--border)',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          {a.enabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 26, height: 26,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hover ? 'var(--bg-paper)' : 'transparent',
        border: '1px solid', borderColor: hover ? 'var(--border)' : 'transparent',
        color: 'var(--text-dim)', borderRadius: 5, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/* ── Editor modal ── */
function AutomationEditor({
  existing, projects, onSave, onCancel,
}: {
  existing?: Automation;
  projects: Project[];
  onSave: (draft: Omit<Automation, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [name,    setName]    = useState(existing?.name ?? '');
  const [prompt,  setPrompt]  = useState(existing?.prompt ?? '');
  const [project, setProject] = useState(existing?.project ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const canSave = name.trim().length > 0 && prompt.trim().length > 0;

  function handleSave() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      prompt: prompt.trim(),
      project,
      trigger: 'manual',
      enabled,
      lastRun: existing?.lastRun,
    });
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(28, 24, 18, 0.45)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540, maxWidth: '90vw', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-paper)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 16px 48px rgba(28, 24, 18, 0.25)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--text)' }}>
            {existing ? 'Edit automation' : 'New automation'}
          </div>
          <button
            type="button" onClick={onCancel}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', color: 'var(--text-mute)',
              cursor: 'pointer', borderRadius: 5,
            }}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Run linter and fix issues"
              style={inputStyle}
              autoFocus
            />
          </Field>

          <Field label="Prompt" hint="What should Claude do when this automation runs?">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task in natural language…"
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55 }}
            />
          </Field>

          <Field label="Project" hint="Where should this run?">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              style={inputStyle}
            >
              <option value="">Active project (whichever is selected)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </Field>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-dim)',
            cursor: 'pointer', userSelect: 'none',
          }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}>
          <button
            type="button" onClick={onCancel}
            style={{
              height: 32, padding: '0 14px',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-dim)', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={handleSave} disabled={!canSave}
            style={{
              height: 32, padding: '0 16px',
              background: canSave ? 'var(--accent)' : 'var(--text-mute)',
              border: 'none', color: '#fff', borderRadius: 6,
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
              opacity: canSave ? 1 : 0.6,
            }}
          >
            {existing ? 'Save changes' : 'Create automation'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-mute)',
      }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-mute)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  outline: 'none',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13.5,
};
