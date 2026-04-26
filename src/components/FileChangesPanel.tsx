import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getChangedFiles,
  getFileSnapshot,
  removeChangedFile,
  writeFile,
  readFile,
} from "../lib/tauri";
import type { FileChangeEvent } from "../lib/types";

interface FileChangesPanelProps {
  sessionId: string;
  onSelectFile: (path: string, original: string, modified: string) => void;
}

export function FileChangesPanel({
  sessionId,
  onSelectFile,
}: FileChangesPanelProps) {
  const [files, setFiles] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const changed = await getChangedFiles(sessionId);
      setFiles(changed);
    } catch (e) {
      console.error("Failed to get changed files:", e);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen<FileChangeEvent>("file-changed", (event) => {
      if (event.payload.sessionId === sessionId) {
        refresh();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId, refresh]);

  const handleAccept = async (path: string) => {
    try {
      await removeChangedFile(sessionId, path);
      setFiles((prev) => prev.filter((f) => f !== path));
    } catch (e) {
      console.error("Failed to accept file:", e);
    }
  };

  const handleReject = async (path: string) => {
    try {
      const snapshotContent = await getFileSnapshot(sessionId, path);
      if (snapshotContent === null) return;
      await readFile(path);
      await writeFile(path, snapshotContent);
      await removeChangedFile(sessionId, path);
      setFiles((prev) => prev.filter((f) => f !== path));
    } catch (e) {
      console.error("Failed to reject file:", e);
    }
  };

  const handleSelect = async (path: string) => {
    try {
      const snapshot = await getFileSnapshot(sessionId, path);
      const current = await readFile(path);
      onSelectFile(path, snapshot ?? current, current);
    } catch (e) {
      console.error("Failed to select file:", e);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          Changes
        </span>
        {files.length > 0 && (
          <span className="text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 bg-[var(--accent)] text-[var(--bg-primary)]">
            {files.length}
          </span>
        )}
      </div>
      <div className="overflow-y-auto">
        {files.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">
            No file changes detected
          </p>
        ) : (
          files.map((path) => {
            const parts = path.split("/");
            const fileName = parts.pop() || path;
            const dirPath = parts.join("/");
            return (
              <div
                key={path}
                className="px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--bg-surface)]/50 transition-colors"
              >
                <button
                  onClick={() => handleSelect(path)}
                  className="w-full text-left"
                >
                  <span className="text-xs font-bold text-[var(--text-primary)] truncate block">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="text-[10px] text-[var(--text-secondary)] truncate block">
                      {dirPath}
                    </span>
                  )}
                </button>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleAccept(path)}
                    className="text-xs text-[var(--success)] hover:underline"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleReject(path)}
                    className="text-xs text-[var(--error)] hover:underline"
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
