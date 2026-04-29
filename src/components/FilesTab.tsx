import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, Folder, FileText, Save, X } from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface Props {
  basePath: string;
  onOpenFile?: (path: string) => void;
  /** Increment this to trigger a tree refresh (e.g. after agent done). */
  version?: number;
}

const GIT_STATUS_COLORS: Record<string, string> = {
  M: 'var(--amber)',
  A: 'var(--green)',
  D: 'var(--red)',
  '?': 'var(--text-mute)',
  R: 'var(--accent)',
  C: 'var(--accent)',
};

function gitBadgeStyle(status: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    height: 14,
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    color: GIT_STATUS_COLORS[status] ?? 'var(--text-mute)',
    background: 'transparent',
    flexShrink: 0,
  };
}

function fileIcon(name: string) {
  return <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />;
}

export default function FilesTab({ basePath, onOpenFile, version }: Props) {
  // Tree state: Map from dirPath → entries[]
  const [entries, setEntries] = useState<Map<string, DirEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([basePath]));
  const [gitStatus, setGitStatus] = useState<Map<string, string>>(new Map());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    try {
      const result = await invoke<DirEntry[]>('list_dir', { path });
      setEntries(prev => {
        const next = new Map(prev);
        next.set(path, result);
        return next;
      });
    } catch (e) {
      console.error('list_dir failed:', e);
    }
  }, []);

  const loadGitStatus = useCallback(async () => {
    try {
      const result = await invoke<[string, string][]>('git_status_porcelain', { projectPath: basePath });
      const map = new Map<string, string>();
      for (const [file, status] of result) {
        map.set(file, status[0] ?? '?');
      }
      setGitStatus(map);
    } catch {
      // Not a git repo or git not available — ignore
    }
  }, [basePath]);

  // Initial load
  useEffect(() => {
    loadDir(basePath);
    loadGitStatus();
  }, [basePath, loadDir, loadGitStatus]);

  // Refresh when version changes
  useEffect(() => {
    if (version === undefined || version === 0) return;
    loadDir(basePath);
    loadGitStatus();
    // Also reload currently open file
    if (selectedPath) loadFile(selectedPath);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFile(path: string) {
    setFileContent(null);
    setLoadError(null);
    setEditMode(false);
    setDirty(false);
    try {
      const result = await invoke<{ content: string; binary: boolean }>('read_file', { path, basePath });
      if (result.binary) {
        setLoadError('Binary file — preview unavailable.');
      } else {
        setFileContent(result.content);
        setEditBuffer(result.content);
      }
    } catch (e) {
      setLoadError(String(e));
    }
  }

  function handleFileClick(entry: DirEntry) {
    setSelectedPath(entry.path);
    loadFile(entry.path);
    onOpenFile?.(entry.path);
  }

  function toggleDir(path: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        loadDir(path);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!selectedPath || !dirty) return;
    setSaving(true);
    try {
      await invoke('write_file', { path: selectedPath, content: editBuffer, basePath });
      setFileContent(editBuffer);
      setDirty(false);
      loadGitStatus();
    } catch (e) {
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setEditBuffer(fileContent ?? '');
    setDirty(false);
  }

  function renderTree(dirPath: string, depth: number): React.ReactNode {
    const dirEntries = entries.get(dirPath);
    if (!dirEntries) return null;

    return dirEntries.map(entry => {
      const relPath = entry.path.startsWith(basePath)
        ? entry.path.slice(basePath.length).replace(/^\//, '')
        : entry.path;
      const statusChar = gitStatus.get(relPath);
      const isExpanded = expandedDirs.has(entry.path);
      const isSelected = selectedPath === entry.path;

      if (entry.is_dir) {
        return (
          <div key={entry.path}>
            <div
              onClick={() => toggleDir(entry.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: `3px 8px 3px ${8 + depth * 14}px`,
                cursor: 'pointer',
                background: 'transparent',
                color: 'var(--text-dim)',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                userSelect: 'none',
              }}
            >
              <ChevronRight
                size={11}
                strokeWidth={1.8}
                style={{
                  color: 'var(--text-mute)',
                  flexShrink: 0,
                  transform: isExpanded ? 'rotate(90deg)' : 'none',
                  transition: 'transform 120ms',
                }}
              />
              <Folder size={12} strokeWidth={1.5} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.name}
              </span>
            </div>
            {isExpanded && renderTree(entry.path, depth + 1)}
          </div>
        );
      }

      return (
        <div
          key={entry.path}
          onClick={() => handleFileClick(entry)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: `3px 8px 3px ${24 + depth * 14}px`,
            cursor: 'pointer',
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--text)' : 'var(--text-dim)',
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            userSelect: 'none',
          }}
        >
          {fileIcon(entry.name)}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.name}
          </span>
          {statusChar && (
            <span style={gitBadgeStyle(statusChar)} title={`git: ${statusChar}`}>
              {statusChar}
            </span>
          )}
        </div>
      );
    });
  }

  const fileName = selectedPath ? selectedPath.split('/').pop() ?? selectedPath : null;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: file tree (40%) */}
      <div
        style={{
          width: '40%',
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div style={{ padding: '6px 0' }}>
          {renderTree(basePath, 0)}
        </div>
      </div>

      {/* Right: file viewer / editor (60%) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedPath ? (
          <>
            {/* Header bar */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-panel)',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fileName}
              </span>

              {fileContent !== null && !loadError && (
                <button
                  type="button"
                  onClick={() => {
                    if (editMode && dirty) handleDiscard();
                    setEditMode(e => !e);
                  }}
                  style={{
                    padding: '2px 8px',
                    height: 22,
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: editMode ? 'var(--accent)' : 'var(--text-mute)',
                    background: editMode ? 'var(--accent-soft)' : 'transparent',
                    border: '1px solid',
                    borderColor: editMode ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {editMode ? 'View' : 'Edit'}
                </button>
              )}

              {dirty && (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    title="Save (Cmd+S)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', height: 22,
                      fontFamily: 'var(--font-sans)', fontSize: 11,
                      color: '#fff', background: 'var(--green)',
                      border: '1px solid var(--green)', borderRadius: 4,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    <Save size={10} strokeWidth={2} />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscard}
                    title="Discard changes"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', height: 22,
                      fontFamily: 'var(--font-sans)', fontSize: 11,
                      color: 'var(--text-dim)', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <X size={10} strokeWidth={2} />
                    Discard
                  </button>
                </>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {loadError ? (
                <div style={{
                  padding: '16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: 'var(--red)',
                }}>
                  {loadError}
                </div>
              ) : fileContent === null ? (
                <div style={{
                  padding: '16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: 'var(--text-mute)',
                }}>
                  Loading…
                </div>
              ) : editMode ? (
                <textarea
                  value={editBuffer}
                  onChange={e => { setEditBuffer(e.target.value); setDirty(true); }}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    padding: '12px 16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11.5,
                    lineHeight: 1.55,
                    color: 'var(--text)',
                    background: 'var(--bg-paper)',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              ) : (
                <pre style={{
                  margin: 0,
                  padding: '12px 16px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: 'var(--text)',
                  whiteSpace: 'pre',
                  overflowX: 'auto',
                }}>
                  {fileContent.split('\n').map((line, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12 }}>
                      <span style={{
                        color: 'var(--text-mute)', userSelect: 'none',
                        textAlign: 'right', minWidth: 32, flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span>{line || ' '}</span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-mute)',
          }}>
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
