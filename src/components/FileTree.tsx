import { useState, useEffect } from "react";
import { listDirectory } from "../lib/tauri";
import type { FileEntry } from "../lib/types";

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (path: string, name: string) => void;
}

function FileNode({
  entry,
  onFileSelect,
}: {
  entry: FileEntry;
  onFileSelect: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    if (!entry.isDir) {
      onFileSelect(entry.path, entry.name);
      return;
    }
    if (!expanded) {
      setLoading(true);
      try {
        const entries = await listDirectory(entry.path);
        setChildren(entries);
      } catch (e) {
        console.error("Failed to list directory:", e);
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  }

  const icon = entry.isDir ? (expanded ? "▾" : "▸") : " ";

  return (
    <div>
      <button
        onClick={handleToggle}
        className="w-full text-left px-1 py-0.5 hover:bg-[var(--bg-surface)] rounded text-xs flex items-center gap-1"
      >
        <span className="w-3 text-[var(--text-secondary)] flex-shrink-0">
          {icon}
        </span>
        <span
          className={
            entry.isDir
              ? "text-[var(--accent)]"
              : "text-[var(--text-primary)]"
          }
        >
          {entry.name}
        </span>
      </button>
      {expanded && (
        <div className="ml-3">
          {loading && (
            <span className="text-xs text-[var(--text-secondary)] pl-4">
              Loading...
            </span>
          )}
          {children.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, onFileSelect }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);

  useEffect(() => {
    listDirectory(rootPath).then(setEntries).catch(console.error);
  }, [rootPath]);

  return (
    <div className="p-2 overflow-y-auto h-full text-sm">
      {entries.map((entry) => (
        <FileNode key={entry.path} entry={entry} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
}
