use std::collections::HashMap;
use std::fs;
use tauri::Manager;

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
}

/// Generic authenticated HTTP request executed from the Rust process.
///
/// Routing requests through here (instead of the webview `fetch`) lets us:
/// - set the `Referer` header, which browsers forbid but ArcGIS Online
///   requires for referer-bound tokens;
/// - avoid CORS entirely;
/// - keep raw credentials out of the webview network stack.
#[tauri::command]
async fn http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("Terrex/0.1")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|e| format!("Invalid HTTP method: {}", e))?;

    let mut req = client.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Request to '{}' failed: {}", url, e))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpResponse { status, body })
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read binary file '{}': {}", path, e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("Failed to create parent directories: {}", e));
        }
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
fn load_connections(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("connections.json");
    if !path.exists() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read connections file: {}", e))
}

#[tauri::command]
fn save_connections(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("connections.json");
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("Failed to create parent directories: {}", e));
        }
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write connections file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_binary,
            write_file,
            http_request,
            load_connections,
            save_connections
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
