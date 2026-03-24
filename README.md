# Audio Forge

A desktop audio converter built with [Tauri v2](https://v2.tauri.app) and [FFmpeg](https://ffmpeg.org). Drop in any audio file, pick a preset or configure your own settings, and convert.

![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![FFmpeg](https://img.shields.io/badge/FFmpeg-required-orange)

## Features

- **Drag-and-drop** or click to browse for audio files
- **Audio probing** — displays duration, sample rate, channels, bit depth, bitrate, and file size
- **Quick presets** — WAV Mono, WAV Stereo, MP3 HQ (320 kbps), FLAC, or Custom
- **6 output formats** — WAV, MP3, FLAC, OGG Vorbis, M4A (AAC), Opus
- **Conversion options:**
  - Sample rate (8 kHz – 96 kHz)
  - Channels (mono / stereo / keep original)
  - Bit depth (16 / 24 / 32-bit for lossless formats)
  - Bitrate (64 – 320 kbps for lossy formats)
  - Volume adjustment
  - Loudness normalization (EBU R128)
  - Silence trimming
  - Fade in / fade out

## Prerequisites

- [Node.js](https://nodejs.org) (v18+)
- [Rust](https://rustup.rs) (stable)
- [FFmpeg](https://ffmpeg.org/download.html) on your system PATH
- Tauri v2 system dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Getting started

```bash
git clone <repo-url> && cd audio-forge
npm install
npm run dev
```

## Building for production

```bash
npm run build
```

The bundled app will be in `src-tauri/target/release/bundle/`.

## Project structure

```
audio-forge/
├── src/                  # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── main.js
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── main.rs       # Entry point
│   │   └── lib.rs        # FFmpeg commands (probe, convert)
│   ├── tauri.conf.json
│   └── Cargo.toml
└── package.json
```

## License

MIT
