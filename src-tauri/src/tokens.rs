use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageEntry {
    pub session_file: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_cost: f64,
}

fn calculate_cost(model: &str, input: u64, output: u64, cache_create: u64, cache_read: u64) -> f64 {
    let (input_price, output_price) = match model {
        m if m.contains("opus") => (15.0, 75.0),
        m if m.contains("haiku") => (0.80, 4.0),
        _ => (3.0, 15.0),
    };
    let cache_create_price = input_price * 1.25;
    let cache_read_price = input_price * 0.1;

    (input as f64 * input_price
        + output as f64 * output_price
        + cache_create as f64 * cache_create_price
        + cache_read as f64 * cache_read_price)
        / 1_000_000.0
}

fn encode_path(path: &str) -> String {
    path.replace('/', "-")
}

fn find_sessions_dir(home: &str, encoded_path: &str) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(format!("{}/.claude/projects/{}/sessions", home, encoded_path)),
        PathBuf::from(format!(
            "{}/.config/claude/projects/{}/sessions",
            home, encoded_path
        )),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

#[tauri::command]
pub fn parse_session_usage(working_dir: String) -> Result<Vec<SessionUsageEntry>, String> {
    let home = std::env::var("HOME").map_err(|e| format!("Failed to get HOME: {}", e))?;
    let encoded_path = encode_path(&working_dir);

    let sessions_dir = match find_sessions_dir(&home, &encoded_path) {
        Some(dir) => dir,
        None => return Ok(Vec::new()),
    };

    let entries =
        fs::read_dir(&sessions_dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    let mut results = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;
        let mut cache_creation_tokens: u64 = 0;
        let mut cache_read_tokens: u64 = 0;
        let mut model = String::new();

        for line in content.lines() {
            let value: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if value["type"] != "assistant" {
                continue;
            }
            if value["message"]["stop_reason"] != "end_turn" {
                continue;
            }

            if model.is_empty() {
                if let Some(m) = value["message"]["model"].as_str() {
                    model = m.to_string();
                }
            }

            let usage = &value["message"]["usage"];
            input_tokens += usage["input_tokens"].as_u64().unwrap_or(0);
            output_tokens += usage["output_tokens"].as_u64().unwrap_or(0);
            cache_creation_tokens += usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            cache_read_tokens += usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
        }

        if input_tokens > 0 || output_tokens > 0 {
            let total_cost = calculate_cost(
                &model,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
            );

            results.push(SessionUsageEntry {
                session_file: file_name,
                model,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
                total_cost,
            });
        }
    }

    Ok(results)
}
