use axum::{
    extract::Multipart,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use audio_forge::{ffmpeg_check, ffmpeg_convert, ffmpeg_probe, ConvertOptions};

#[derive(Deserialize)]
struct WebConvertOptions {
    format: String,
    sample_rate: Option<u32>,
    channels: Option<u8>,
    bit_depth: Option<u16>,
    bitrate: Option<String>,
    volume: Option<f32>,
    normalize: bool,
    trim_silence: bool,
    fade_in: Option<f32>,
    fade_out: Option<f32>,
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    // Determine static file directory
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../src".to_string());

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/probe", post(probe))
        .route("/api/convert", post(convert))
        .fallback_service(ServeDir::new(&static_dir).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Audio Forge web server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<serde_json::Value> {
    match ffmpeg_check() {
        Ok(version) => Json(serde_json::json!({ "status": "ok", "ffmpeg": version })),
        Err(e) => Json(serde_json::json!({ "status": "error", "error": e })),
    }
}

async fn probe(mut multipart: Multipart) -> impl IntoResponse {
    let tmp_dir = tempfile::tempdir().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create temp dir: {}", e))
    })?;

    let mut file_path: Option<PathBuf> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e))
    })? {
        if field.name() == Some("file") {
            let original_name = field.file_name().unwrap_or("input").to_string();
            let dest = tmp_dir.path().join(&original_name);
            let data = field.bytes().await.map_err(|e| {
                (StatusCode::BAD_REQUEST, format!("Failed to read file: {}", e))
            })?;
            std::fs::write(&dest, &data).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file: {}", e))
            })?;
            file_path = Some(dest);
        }
    }

    let path = file_path.ok_or((StatusCode::BAD_REQUEST, "No file uploaded".to_string()))?;

    match ffmpeg_probe(path.to_str().unwrap_or("")) {
        Ok(info) => Ok(Json(serde_json::to_value(info).unwrap())),
        Err(e) => Err((StatusCode::UNPROCESSABLE_ENTITY, e)),
    }
}

async fn convert(mut multipart: Multipart) -> impl IntoResponse {
    let tmp_dir = tempfile::tempdir().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create temp dir: {}", e))
    })?;

    let mut file_path: Option<PathBuf> = None;
    let mut options_json: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e))
    })? {
        match field.name() {
            Some("file") => {
                let original_name = field.file_name().unwrap_or("input").to_string();
                let dest = tmp_dir.path().join(&original_name);
                let data = field.bytes().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, format!("Failed to read file: {}", e))
                })?;
                std::fs::write(&dest, &data).map_err(|e| {
                    (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file: {}", e))
                })?;
                file_path = Some(dest);
            }
            Some("options") => {
                let text = field.text().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, format!("Failed to read options: {}", e))
                })?;
                options_json = Some(text);
            }
            _ => {}
        }
    }

    let input_path = file_path.ok_or((StatusCode::BAD_REQUEST, "No file uploaded".to_string()))?;
    let opts_str = options_json.ok_or((StatusCode::BAD_REQUEST, "No options provided".to_string()))?;
    let web_opts: WebConvertOptions = serde_json::from_str(&opts_str).map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Invalid options JSON: {}", e))
    })?;

    let ext = match web_opts.format.as_str() {
        "m4a" => "m4a",
        f => f,
    };
    let output_name = format!("converted_{}.{}", uuid::Uuid::new_v4(), ext);
    let output_path = tmp_dir.path().join(&output_name);

    let convert_opts = ConvertOptions {
        input_path: input_path.to_str().unwrap_or("").to_string(),
        output_path: output_path.to_str().unwrap_or("").to_string(),
        format: web_opts.format,
        sample_rate: web_opts.sample_rate,
        channels: web_opts.channels,
        bit_depth: web_opts.bit_depth,
        bitrate: web_opts.bitrate,
        volume: web_opts.volume,
        normalize: web_opts.normalize,
        trim_silence: web_opts.trim_silence,
        fade_in: web_opts.fade_in,
        fade_out: web_opts.fade_out,
    };

    ffmpeg_convert(&convert_opts).map_err(|e| {
        (StatusCode::UNPROCESSABLE_ENTITY, e)
    })?;

    let file_data = std::fs::read(&output_path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read output: {}", e))
    })?;

    let content_type = match ext {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "opus" => "audio/opus",
        _ => "application/octet-stream",
    };

    Ok::<_, (StatusCode, String)>((
        [
            ("content-type", content_type),
            ("content-disposition", &format!("attachment; filename=\"{}\"", output_name)),
        ],
        file_data,
    ))
}
