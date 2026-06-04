# Rust Actix Test Project

Minimal Actix-web application for testing deploy-arbitrary agent.

## Local Development

```bash
cargo run
# or for release build
cargo build --release
PORT=9000 ./target/release/rust-actix-test
```

## Cross-Compile for Linux

Requires musl target for static linking (Alpine compatibility):

```bash
# Install musl target
rustup target add x86_64-unknown-linux-musl  # for amd64
rustup target add aarch64-unknown-linux-musl # for arm64

# Build for Linux amd64 (production)
cargo build --release --target x86_64-unknown-linux-musl

# Build for Linux arm64 (Apple Silicon local testing)
cargo build --release --target aarch64-unknown-linux-musl
```

## Expected Deployment Parameters

- **Language/Runtime**: Rust 1.75+
- **Build command**: `cargo build --release --target ${RUST_TARGET}` where:
  - `RUST_TARGET=x86_64-unknown-linux-musl` for amd64
  - `RUST_TARGET=aarch64-unknown-linux-musl` for arm64
- **Build output files**: `target/${RUST_TARGET}/release/rust-actix-test` (single binary)
- **Runtime dependencies**: None (statically linked binary)
- **Startup command**: `./rust-actix-test`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "rust", "framework": "actix-web"}
```

## Notes

- Rust cross-compilation requires the musl target for Alpine-based containers
- On macOS, you may need a cross-compiler toolchain (e.g., `cross` or Docker-based build)
