# Python Deployment Example

## Supported Versions

- Python 3.9, 3.10, 3.11, 3.12

## Local Dependencies

```bash
# Install dependencies locally before deployment
pip install --no-cache-dir -r requirements.txt
```

## Build Commands

Python is interpreted, but local build validation is still required: install dependencies before packaging. Add framework-specific commands only when needed.

For this deploy workflow, prefer installing dependencies into a project-local path in Dockerfile.build (for example `pip install --target /build/python-deps -r requirements.txt`) and copy that path into `/output-mount/`.

### Special Cases

| Framework | Build Command | Notes |
|-----------|---------------|-------|
| Flask | `pip install --no-cache-dir -r requirements.txt` | Installs runtime dependencies; ensure `gunicorn` is in requirements.txt for production |
| Django | `pip install --no-cache-dir -r requirements.txt && python manage.py collectstatic --noinput` | Installs dependencies, then collects static files to `staticfiles/` |
| FastAPI | `pip install --no-cache-dir -r requirements.txt` | Installs runtime dependencies; ensure `uvicorn` is in requirements.txt |

## Output Directory

| Framework | Output Directory | Contents |
|-----------|------------------|----------|
| Flask | `.` (root) + `python-deps/` | Source files + vendored dependencies |
| Django | `.` (root) + `python-deps/` + `staticfiles/` | Source + dependencies + collected static files |
| FastAPI | `.` (root) + `python-deps/` | Source files + vendored dependencies |

## Files to Include

- `*.py` - Python source files
- `requirements.txt` - Dependencies
- `python-deps/` (if used in Dockerfile.build) - Vendored runtime dependencies
- `static/`, `templates/` - Static assets and templates
- `staticfiles/` - Django collected static (if applicable)
- Configuration files (`.env.example`, `config.py`)

## Files to Exclude

- `__pycache__/`
- `*.pyc`, `*.pyo`
- `.venv/`, `venv/`, `env/`
- `.pytest_cache/`
- `tests/`, `test_*.py`
- `.git/`

## Startup Commands

| Framework | Development | Production |
|-----------|-------------|------------|
| Flask | `python app.py` | `gunicorn -w 4 -b 0.0.0.0:9000 app:app` |
| Django | `python manage.py runserver` | `gunicorn -w 4 -b 0.0.0.0:9000 project.wsgi:application` |
| FastAPI | `uvicorn main:app --reload` | `uvicorn main:app --host 0.0.0.0 --port 9000` |

## Common Ports

- Flask: 5000 (dev)
- Django: 8000 (dev)
- FastAPI: 8000 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
# Common Python environment variables
PYTHONUNBUFFERED=1
PYTHONDONTWRITEBYTECODE=1
# REQUIRED: Production port
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` environment variable.

### Minimal code changes:

| Framework | Before | After |
|-----------|--------|-------|
| Flask | `app.run(port=5000)` | `app.run(port=int(os.environ.get('PORT', 5000)))` |
| Django | `runserver 8000` | Use gunicorn: `gunicorn -b 0.0.0.0:$PORT project.wsgi` |
| FastAPI | `uvicorn.run(app, port=8000)` | `uvicorn.run(app, port=int(os.environ.get('PORT', 8000)))` |

## Reliability Notes

1. Do not rely on global site-packages from the build image.
2. Keep Docker base family and package manager consistent (`python:*-slim` + `apt-get`, `python:*-alpine` + `apk`).
3. Prefer pinned Python base tags over floating `latest`.
