# ---- Build stage ----
FROM rust:1.83-slim AS builder

WORKDIR /build

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./
RUN mkdir src && echo 'pub fn ffmpeg_check() -> Result<String, String> { Ok(String::new()) } pub fn ffmpeg_probe(_: &str) -> Result<(), String> { Ok(()) } pub fn ffmpeg_convert(_: &()) -> Result<String, String> { Ok(String::new()) }' > src/lib.rs && \
    mkdir src/bin && echo 'fn main() {}' > src/bin/web.rs && \
    cargo build --release --features web --bin audio-forge-web 2>/dev/null || true && \
    rm -rf src

# Copy real source
COPY src-tauri/src ./src
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./

RUN cargo build --release --features web --bin audio-forge-web

# ---- Runtime stage ----
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary
COPY --from=builder /build/target/release/audio-forge-web .

# Copy frontend
COPY src/ ./static/

ENV STATIC_DIR=/app/static
ENV PORT=3000

EXPOSE 3000

CMD ["./audio-forge-web"]
