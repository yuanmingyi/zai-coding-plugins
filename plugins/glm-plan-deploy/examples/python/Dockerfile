# Python Runtime Dockerfile
# Suitable for Flask, Django, FastAPI applications

FROM python:3.11-slim

# Prevent Python from writing bytecode and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app/

# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000
EXPOSE 9000

# Start the application (Flask with gunicorn example)
# The application MUST read port from PORT environment variable
# Adjust the command based on your framework:
# - Flask: gunicorn -w 4 -b 0.0.0.0:$PORT app:app
# - Django: gunicorn -w 4 -b 0.0.0.0:$PORT project.wsgi:application
# - FastAPI: uvicorn main:app --host 0.0.0.0 --port $PORT
CMD ["sh", "-c", "gunicorn -w 4 -b 0.0.0.0:$PORT app:app"]
