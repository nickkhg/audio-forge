use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioInfo {
    pub filename: String,
    pub format: String,
    pub duration: String,
    pub sample_rate: String,
    pub channels: String,
    pub bit_depth: String,
    pub codec: String,
    pub bitrate: String,
    pub file_size: String,
}

#[derive(Debug, Deserialize)]
pub struct ConvertOptions {
    pub input_path: String,
    pub output_path: String,
    pub format: String,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub bit_depth: Option<u16>,
    pub bitrate: Option<String>,
    pub volume: Option<f32>,
    pub normalize: bool,
    pub trim_silence: bool,
    pub fade_in: Option<f32>,
    pub fade_out: Option<f32>,
}

#[tauri::command]
fn check_ffmpeg() -> Result<String, String> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map_err(|e| format!("FFmpeg not found: {}. Please install FFmpeg.", e))?;

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to read ffmpeg output: {}", e))
        .map(|s| s.lines().next().unwrap_or("FFmpeg installed").to_string())
}

#[tauri::command]
fn probe_audio(path: String) -> Result<AudioInfo, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe error: {}", stderr));
    }

    let json_str = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid output: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    let stream = json["streams"]
        .as_array()
        .and_then(|s| s.iter().find(|s| s["codec_type"] == "audio"))
        .ok_or("No audio stream found")?;

    let format = &json["format"];

    let filename = format["filename"]
        .as_str()
        .unwrap_or("")
        .split(['/', '\\'])
        .last()
        .unwrap_or("Unknown")
        .to_string();

    let file_size_bytes: u64 = format["size"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let file_size = if file_size_bytes > 1_048_576 {
        format!("{:.1} MB", file_size_bytes as f64 / 1_048_576.0)
    } else if file_size_bytes > 1024 {
        format!("{:.1} KB", file_size_bytes as f64 / 1024.0)
    } else {
        format!("{} B", file_size_bytes)
    };

    let duration_secs: f64 = format["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let mins = (duration_secs / 60.0).floor() as u32;
    let secs = (duration_secs % 60.0).floor() as u32;
    let duration = format!("{}:{:02}", mins, secs);

    let sample_rate = stream["sample_rate"]
        .as_str()
        .unwrap_or("Unknown")
        .to_string();

    let channels_num = stream["channels"].as_u64().unwrap_or(0);
    let channels = match channels_num {
        1 => "Mono".to_string(),
        2 => "Stereo".to_string(),
        n => format!("{} channels", n),
    };

    let bit_depth = stream["bits_per_raw_sample"]
        .as_str()
        .or_else(|| stream["bits_per_sample"].as_str())
        .map(|s| format!("{}-bit", s))
        .unwrap_or_else(|| "N/A".to_string());

    let codec = stream["codec_long_name"]
        .as_str()
        .or_else(|| stream["codec_name"].as_str())
        .unwrap_or("Unknown")
        .to_string();

    let bitrate = format["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .map(|b| format!("{} kbps", b / 1000))
        .unwrap_or_else(|| "N/A".to_string());

    Ok(AudioInfo {
        filename,
        format: format["format_long_name"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
        duration,
        sample_rate,
        channels,
        bit_depth,
        codec,
        bitrate,
        file_size,
    })
}

#[tauri::command]
fn convert_audio(options: ConvertOptions) -> Result<String, String> {
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-i".to_string(),
        options.input_path.clone(),
    ];

    // Audio filters
    let mut filters: Vec<String> = Vec::new();

    if let Some(vol) = options.volume {
        if (vol - 1.0).abs() > 0.01 {
            filters.push(format!("volume={:.2}", vol));
        }
    }

    if options.normalize {
        filters.push("loudnorm=I=-16:TP=-1.5:LRA=11".to_string());
    }

    if options.trim_silence {
        filters.push("silenceremove=start_periods=1:start_silence=0.1:start_threshold=-50dB:detection=peak,aformat=dblp,areverse,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-50dB:detection=peak,aformat=dblp,areverse".to_string());
    }

    if let Some(fade_in) = options.fade_in {
        if fade_in > 0.0 {
            filters.push(format!("afade=t=in:st=0:d={:.1}", fade_in));
        }
    }

    if let Some(fade_out) = options.fade_out {
        if fade_out > 0.0 {
            filters.push(format!("afade=t=out:st=0:d={:.1}", fade_out));
        }
    }

    if !filters.is_empty() {
        args.push("-af".to_string());
        args.push(filters.join(","));
    }

    // Sample rate
    if let Some(sr) = options.sample_rate {
        args.push("-ar".to_string());
        args.push(sr.to_string());
    }

    // Channels
    if let Some(ch) = options.channels {
        args.push("-ac".to_string());
        args.push(ch.to_string());
    }

    // Format-specific options
    match options.format.as_str() {
        "wav" => {
            if let Some(bd) = options.bit_depth {
                let codec = match bd {
                    16 => "pcm_s16le",
                    24 => "pcm_s24le",
                    32 => "pcm_s32le",
                    _ => "pcm_s16le",
                };
                args.push("-acodec".to_string());
                args.push(codec.to_string());
            }
        }
        "mp3" => {
            args.push("-acodec".to_string());
            args.push("libmp3lame".to_string());
            if let Some(ref br) = options.bitrate {
                args.push("-b:a".to_string());
                args.push(br.clone());
            }
        }
        "flac" => {
            args.push("-acodec".to_string());
            args.push("flac".to_string());
            if let Some(bd) = options.bit_depth {
                args.push("-sample_fmt".to_string());
                let fmt = match bd {
                    16 => "s16",
                    24 => "s24",
                    32 => "s32",
                    _ => "s16",
                };
                args.push(fmt.to_string());
            }
        }
        "ogg" => {
            args.push("-acodec".to_string());
            args.push("libvorbis".to_string());
            if let Some(ref br) = options.bitrate {
                args.push("-b:a".to_string());
                args.push(br.clone());
            }
        }
        "aac" | "m4a" => {
            args.push("-acodec".to_string());
            args.push("aac".to_string());
            if let Some(ref br) = options.bitrate {
                args.push("-b:a".to_string());
                args.push(br.clone());
            }
        }
        "opus" => {
            args.push("-acodec".to_string());
            args.push("libopus".to_string());
            if let Some(ref br) = options.bitrate {
                args.push("-b:a".to_string());
                args.push(br.clone());
            }
        }
        _ => {}
    }

    args.push(options.output_path.clone());

    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    if output.status.success() {
        Ok(options.output_path)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Conversion failed: {}", stderr))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_ffmpeg,
            probe_audio,
            convert_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
