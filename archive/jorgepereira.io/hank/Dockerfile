FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy identities.json into the data volume on startup if not already present.
# This lets you bake the config into the image and have it auto-seed.
CMD ["sh", "-c", "mkdir -p data && [ -f data/identities.json ] || cp identities.json data/identities.json 2>/dev/null; exec python -m app.main"]
