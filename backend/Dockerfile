FROM python:3.11-slim

# Install system configurations required for psycopg2 compilation
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Leverage Docker layer caching for requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright headless browser layout streams and native Linux OS dependencies
RUN playwright install chromium
RUN playwright install-deps chromium

# Copy your full codebase (main.py, database.py, engine.py, templates/)
COPY . .

EXPOSE 8000

# Bind dynamically to the port provided by the cloud hosting environment variable
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]