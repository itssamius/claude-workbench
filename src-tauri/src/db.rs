use tauri_plugin_sql::{Migration, MigrationKind};

pub fn init_db() -> tauri_plugin_sql::Builder {
    tauri_plugin_sql::Builder::default()
        .add_migrations(
            "sqlite:claude-window.db",
            vec![
                Migration {
                    version: 1,
                    description: "create sessions and output tables",
                    sql: "PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    working_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'stopped',
    error TEXT,
    env_vars TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    chunk_data TEXT NOT NULL,
    sequence_num INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_output_session_seq ON output_chunks(session_id, sequence_num);",
                    kind: MigrationKind::Up,
                },
                Migration {
                    version: 2,
                    description: "add workspaces and settings tables",
                    sql: "CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_dir TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);",
                    kind: MigrationKind::Up,
                },
            ],
        )
}
