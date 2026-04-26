import { useState, useEffect, useCallback } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { FileTree } from "./FileTree";
import { FileChangesPanel } from "./FileChangesPanel";
import { readFile, watchDirectory, unwatchDirectory } from "../lib/tauri";
import type { OpenFile, FileChangeEvent } from "../lib/types";

interface CodeViewerProps {
  sessionId: string;
  workingDir: string;
}

function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    go: "go",
    rb: "ruby",
    java: "java",
    cpp: "cpp",
    c: "c",
    h: "c",
    swift: "swift",
    kt: "kotlin",
  };
  return map[ext] || "plaintext";
}

export function CodeViewer({ sessionId, workingDir }: CodeViewerProps) {
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const activeFile = tabs.find((t) => t.path === activeTab);

  const openFile = useCallback(
    async (path: string, name: string) => {
      // Check if already open
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActiveTab(path);
        return;
      }

      try {
        const content = await readFile(path);
        const newFile: OpenFile = { path, name, content };

        setTabs((prev) => {
          // Cap at 10 tabs — close LRU
          const next = [...prev, newFile];
          if (next.length > 10) next.shift();
          return next;
        });
        setActiveTab(path);
      } catch (e) {
        console.error("Failed to open file:", e);
      }
    },
    [tabs],
  );

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => prev.filter((t) => t.path !== path));
    setActiveTab((current) => {
      if (current === path) return null;
      return current;
    });
  }, []);

  const handleChangeSelect = useCallback(
    (path: string, original: string, modified: string) => {
      const name = path.split("/").pop() || path;
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === path
              ? { ...t, content: modified, originalContent: original }
              : t,
          ),
        );
      } else {
        const newFile: OpenFile = {
          path,
          name,
          content: modified,
          originalContent: original,
        };
        setTabs((prev) => {
          const next = [...prev, newFile];
          if (next.length > 10) next.shift();
          return next;
        });
      }
      setActiveTab(path);
      setShowDiff(true);
    },
    [tabs],
  );

  // Watch directory for file changes
  useEffect(() => {
    watchDirectory(sessionId, workingDir).catch(console.error);
    return () => {
      unwatchDirectory(sessionId).catch(console.error);
    };
  }, [sessionId, workingDir]);

  // Listen for file change events and refresh open files
  useEffect(() => {
    const unlisten = listen<FileChangeEvent>("file-changed", async (event) => {
      if (event.payload.sessionId !== sessionId) return;
      const changedPath = event.payload.path;

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.path === changedPath) {
            // Store old content for diff, read new content
            readFile(changedPath)
              .then((newContent) => {
                setTabs((current) =>
                  current.map((t) =>
                    t.path === changedPath
                      ? {
                          ...t,
                          originalContent: t.content,
                          content: newContent,
                        }
                      : t,
                  ),
                );
              })
              .catch(console.error);
          }
          return tab;
        }),
      );

      // Auto-open changed file if not already open
      const isOpen = tabs.some((t) => t.path === changedPath);
      if (!isOpen) {
        const name = changedPath.split("/").pop() || changedPath;
        openFile(changedPath, name).catch(console.error);
      } else {
        setActiveTab(changedPath);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId, tabs, openFile]);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <span className="text-xs text-[var(--text-secondary)]">Files</span>
        {activeFile?.originalContent && (
          <button
            onClick={() => setShowDiff(!showDiff)}
            className={`text-xs px-2 py-0.5 rounded ${showDiff ? "bg-[var(--accent)] text-[var(--bg-primary)]" : "text-[var(--accent)] hover:bg-[var(--bg-surface)]"}`}
          >
            {showDiff ? "Code" : "Diff"}
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* File Tree + Changes */}
        <div className="w-48 flex-shrink-0 border-r border-[var(--border)] overflow-y-auto">
          <FileChangesPanel
            sessionId={sessionId}
            onSelectFile={handleChangeSelect}
          />
          <div className="border-t border-[var(--border)]">
            <FileTree rootPath={workingDir} onFileSelect={openFile} />
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          {tabs.length > 0 && (
            <div className="flex border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--border)] flex-shrink-0 ${
                    tab.path === activeTab
                      ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                  }`}
                  onClick={() => setActiveTab(tab.path)}
                >
                  <span>{tab.name}</span>
                  {tab.originalContent && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.path);
                    }}
                    className="ml-1 hover:text-[var(--error)]"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Monaco Editor */}
          <div className="flex-1">
            {activeFile ? (
              showDiff && activeFile.originalContent ? (
                <DiffEditor
                  original={activeFile.originalContent}
                  modified={activeFile.content}
                  language={getLanguage(activeFile.name)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'Menlo', 'Monaco', monospace",
                    scrollBeyondLastLine: false,
                  }}
                />
              ) : (
                <Editor
                  value={activeFile.content}
                  language={getLanguage(activeFile.name)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: true },
                    fontSize: 13,
                    fontFamily: "'Menlo', 'Monaco', monospace",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[var(--text-secondary)]">
                Select a file to view
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
