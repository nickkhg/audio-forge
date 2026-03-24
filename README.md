# Audio Forge

A desktop and web audio converter built with [Tauri v2](https://v2.tauri.app) and [FFmpeg](https://ffmpeg.org). Drop in any audio file, pick a preset or configure your own settings, and convert.

![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![FFmpeg](https://img.shields.io/badge/FFmpeg-required-orange) ![Docker](https://img.shields.io/badge/Docker-ready-blue)

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

## Desktop app (Tauri)

### Prerequisites

- [Node.js](https://nodejs.org) (v18+)
- [Rust](https://rustup.rs) (stable)
- [FFmpeg](https://ffmpeg.org/download.html) on your system PATH
- Tauri v2 system dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Run

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

The bundled app will be in `src-tauri/target/release/bundle/`.

## Web server (Docker)

The web version runs the same UI in a browser, backed by an axum web server that handles file uploads and FFmpeg conversion server-side.

### Run with Docker

```bash
# Pull from GHCR (after CI pushes)
docker pull ghcr.io/<owner>/audio-forge:main
docker run -p 3000:3000 ghcr.io/<owner>/audio-forge:main

# Or build locally
docker build -t audio-forge .
docker run -p 3000:3000 audio-forge
```

Then open http://localhost:3000.

### Run without Docker

Requires Rust and FFmpeg installed locally.

```bash
cd src-tauri
cargo run --release --features web --bin audio-forge-web
```

The server listens on port 3000 by default. Set the `PORT` env var to change it.

### Environment variables

| Variable     | Default    | Description                     |
|-------------|------------|---------------------------------|
| `PORT`      | `3000`     | HTTP server port                |
| `STATIC_DIR`| `../src`   | Path to frontend static files   |

## CI/CD

The GitHub Action at `.github/workflows/build-and-deploy.yml` automatically:

1. Builds the Docker image on every push to `main` or version tag
2. Pushes to GitHub Container Registry (`ghcr.io`)
3. Tags images with branch name, semver, and commit SHA

Pull requests build the image without pushing (validation only).

## Project structure

```
audio-forge/
├── src/                     # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── main.js              # Auto-detects Tauri vs web mode
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── lib.rs           # Shared FFmpeg logic
│   │   ├── main.rs          # Tauri desktop entry point
│   │   └── web.rs           # Axum web server entry point
│   ├── tauri.conf.json
│   └── Cargo.toml
├── Dockerfile
├── .github/workflows/
│   └── build-and-deploy.yml
└── package.json
```

## License

MIT
