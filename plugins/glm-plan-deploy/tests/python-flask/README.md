# Python Flask Test Project

Minimal Flask application for testing deploy-arbitrary agent.

## Local Development

```bash
pip install -r requirements.txt
PORT=9000 python app.py
```

## Expected Deployment Parameters

- **Language/Runtime**: Python 3.11
- **Build command**: None (interpreted language)
- **Build output files**: None (source files used directly)
- **Runtime dependencies**: `pip install --no-cache-dir -r requirements.txt`
- **Startup command**: `python app.py`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "python", "framework": "flask"}
```
