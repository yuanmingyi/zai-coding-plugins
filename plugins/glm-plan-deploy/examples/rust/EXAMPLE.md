# Rust Deployment Example

## Supported Versions

- Rust 1.85+ (recommended for modern dependency compatibility)

## Local Dependencies

```bash
# Dependencies are managed by Cargo
cargo fetch
```

## Build Commands

Rust requires compilation to a binary before deployment.

```bash
# Debug build (fast compile, slow runtime)
cargo build

# Release build (slow compile, optimized runtime)
cargo build --release --locked

# Cross-compile for Linux using CC_DEPLOY_BUILD_ARCH
# amd64 (production default)
cargo build --release --target x86_64-unknown-linux-musl

# arm64 (Apple Silicon local testing)
cargo build --release --target aarch64-unknown-linux-musl
```

### Architecture-Specific Builds

| CC_DEPLOY_BUILD_ARCH | Rust Target | When to use |
|----------------------|-------------|-------------|
| `amd64` (default) | `x86_64-unknown-linux-musl` | Production server, Intel/AMD Linux |
| `arm64` | `aarch64-unknown-linux-musl` | Apple Silicon Mac local testing |

### Cross-Compilation Setup

```bash
# Install musl targets for static linking (works on Alpine)
rustup target add x86_64-unknown-linux-musl   # for amd64
rustup target add aarch64-unknown-linux-musl  # for arm64

# On macOS, you may need a cross-compiler or use Docker/cross tool
# Install cross for easier cross-compilation:
cargo install cross

# Build with cross (handles toolchain automatically)
cross build --release --target x86_64-unknown-linux-musl
cross build --release --target aarch64-unknown-linux-musl
```

### Special Cases

| Scenario | Build Command | Notes |
|----------|---------------|-------|
| Standard release | `cargo build --release --locked` | Optimized binary in `target/release/` |
| Cross-compile | `cargo build --release --target x86_64-unknown-linux-musl` | Static binary for Alpine |
| Workspace | `cargo build --release -p <package>` | Build specific package in workspace |
| Minimal binary | Add `[profile.release] lto = true, strip = true` to Cargo.toml | Smaller binary size |

### Cross-Compilation Setup

```bash
# Install musl target for static linking (works on Alpine)
rustup target add x86_64-unknown-linux-musl

# On macOS, install musl cross-compiler
brew install filosottile/musl-cross/musl-cross

# Build static binary
CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=x86_64-linux-musl-gcc \
cargo build --release --target x86_64-unknown-linux-musl
```

## Output Directory

| Build Type | Output Directory | Contents |
|------------|------------------|----------|
| Debug | `target/debug/` | Debug binary |
| Release | `target/release/` | Optimized binary |
| Cross-compile | `target/<target>/release/` | Target-specific binary |

## Files to Include

- Binary executable only (e.g., `target/release/app`)
- `config/` - Configuration files (if external)
- `static/`, `templates/` - Static assets and templates (if serving)

## Files to Exclude

- `src/` - Source files (not needed at runtime)
- `Cargo.toml`, `Cargo.lock` - Build files
- `target/` (except the final binary) - Build artifacts
- `tests/`
- `.git/`

## Startup Commands

```bash
# Direct execution
./app

# With environment variables
PORT=9000 ./app
```

## Common Ports

- Actix-web default: 8080 (dev)
- Axum default: 3000 (dev)
- Rocket default: 8000 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
RUST_LOG=info
# REQUIRED: Production port
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` environment variable.

### Minimal code changes:

| Framework | Before | After |
|-----------|--------|-------|
| Actix-web | `.bind("127.0.0.1:8080")` | `.bind(format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or("8080".into())))` |
| Axum | `.bind("0.0.0.0:3000")` | `.bind(format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or("3000".into())))` |
| Rocket | `port = 8000` in Rocket.toml | `port = 9000` or use `ROCKET_PORT` env var |

## Important Notes

1. **Use musl for Alpine**: Build with `x86_64-unknown-linux-musl` target for Alpine-based containers
2. **Static linking**: Rust binaries are statically linked by default (with musl)
3. **Minimal runtime**: Only the binary is needed - no runtime dependencies
4. **Multi-stage builds**: Use `rust:*` for building, `debian:*-slim` or `alpine` for runtime
5. **Binary size**: Enable LTO and stripping in `Cargo.toml` for smaller binaries
6. **Use lockfile for parity**: Include `Cargo.lock` in deploy context and prefer `cargo build --locked`
7. **Avoid floating toolchains**: Prefer pinned Rust versions over `rust:latest` to reduce remote drift

### Cargo.toml optimization

```toml
[profile.release]
lto = true
strip = true
codegen-units = 1
panic = "abort"
```
