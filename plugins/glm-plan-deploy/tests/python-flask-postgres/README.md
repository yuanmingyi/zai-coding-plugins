# Python Flask PostgreSQL Test Project

Flask application that uses SQLAlchemy with PostgreSQL. This fixture verifies that the deploy-arbitrary analyzer detects a real Python database project and marks PostgreSQL as an external database scenario.

## Local Development

```bash
pip install -r requirements.txt
psql "$DATABASE_URL" -f migrations/001_init.sql
PORT=9000 python app.py
```

## Expected Deployment Parameters

- **Language/Runtime**: Python 3.11
- **Build command**: `pip install --no-cache-dir -r requirements.txt`
- **Build output files**: Source files
- **Startup command**: `python app.py`
- **Database**: PostgreSQL via `DATABASE_URL`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status":"ok","language":"python","framework":"flask","database":"postgresql"}

curl http://localhost:9000/notes
# Requires DATABASE_URL and a reachable migrated PostgreSQL database.
```
