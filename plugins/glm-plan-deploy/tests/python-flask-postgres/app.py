import os

from flask import Flask, jsonify
from sqlalchemy import create_engine, text

app = Flask(__name__)


def get_engine():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return None
    return create_engine(database_url, pool_pre_ping=True)


@app.route("/")
def index():
    return jsonify(
        {
            "status": "ok",
            "language": "python",
            "framework": "flask",
            "database": "postgresql",
        }
    )


@app.route("/notes")
def notes():
    engine = get_engine()
    if engine is None:
        return jsonify({"error": "DATABASE_URL is not configured"}), 503

    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("select id, body, created_at from notes order by id limit 20")
            ).mappings()
            return jsonify({"notes": [dict(row) for row in rows]})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 503


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
