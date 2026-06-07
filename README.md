# PlagCheck  — Free Plagiarism Checker (100,000+ Words)

A production-ready plagiarism detection platform powered entirely by **local open-source AI**.
Zero API costs. No data sent to third parties. Scales to 200,000+ words per document.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        PlagCheck                            │
├──────────────────────┬──────────────────────────────────────┤
│   React Frontend     │        FastAPI Backend               │
│   (Vite + React 18)  │        (Python 3.11)                │
│                      │                                      │
│  • Editor with drag  │  • SSE streaming progress           │
│    & drop upload     │  • MinHash fingerprinting           │
│  • Real-time SSE     │  • Chunked LLM analysis             │
│    progress stream   │  • SQLite persistence               │
│  • History & export  │  • File upload (.txt/.pdf/.docx)    │
└──────────────────────┴──────────┬───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    Ollama (Local LLM)       │
                    │  mistral / llama3 / gemma2  │
                    │  Runs 100% on your machine  │
                    └─────────────────────────────┘
```

## How It Handles 100,000+ Words (For Free)

### Stage 1 — MinHash Fingerprinting (instant)
- Computes 128-hash MinHash signature of the full document
- Shingles text into 5-word n-grams
- Jaccard similarity comparison against stored documents
- Zero LLM cost — pure math

### Stage 2 — Chunked LLM Analysis
- Splits document into 2,000-word overlapping chunks (10% overlap)
- Sends each chunk to the local Ollama model
- 100k words = ~50 chunks, processed sequentially
- No per-token billing — completely free

### Stage 3 — Heuristic Fallback
- If Ollama is unavailable, falls back to statistical analysis:
  - Bigram repetition scoring
  - Vocabulary richness (unique word ratio)
  - Sentence length variance
  - Formal language clustering

### Stage 4 — Score Aggregation
- Weighted average across all chunks
- Proportional contribution by chunk word count
- Generates sources, flagged passages, and recommendations

---

## Quick Start

### Option A — Docker (Recommended)

```bash
# Clone / download the project
cd plagcheck-saas

# Start everything (downloads Ollama + Mistral automatically)
docker compose up -d

# Wait ~2 minutes for model to download, then open:
open http://localhost:3000
```

### Option B — Manual Setup

#### 1. Install Ollama
```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows: download from https://ollama.ai/download
```

#### 2. Pull a free model
```bash
ollama pull mistral      # 4.1GB — recommended
# or
ollama pull llama3       # 4.7GB — best quality
# or
ollama pull phi3         # 2.3GB — fastest, smallest
```

#### 3. Start the backend
```bash
cd backend
pip install -r requirements.txt
cp ../.env.example .env
uvicorn main:app --reload --port 8000
```

#### 4. Start the frontend
```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

---

## API Reference

### POST `/api/check/stream` — SSE Streaming Check
```bash
curl -N -X POST http://localhost:8000/api/check/stream \
  -H "Content-Type: application/json" \
  -d '{"text": "Your document text here...", "sensitivity": 25}'
```

SSE events emitted:
```json
{"type": "start", "check_id": "...", "total_chunks": 50, "word_count": 100000}
{"type": "progress", "chunk": 1, "total": 50, "pct": 2, "message": "Analyzing chunk 1 of 50..."}
{"type": "complete", "result": {...}, "pct": 100}
```

### POST `/api/check/start` — Async Background Check
```bash
curl -X POST http://localhost:8000/api/check/start \
  -H "Content-Type: application/json" \
  -d '{"text": "...", "title": "My Essay"}'
# Returns: {"check_id": "uuid", "estimated_seconds": 200}
```

### GET `/api/check/{id}/status` — Poll Status
```bash
curl http://localhost:8000/api/check/{check_id}/status
```

### GET `/api/check/{id}/result` — Get Full Result
```bash
curl http://localhost:8000/api/check/{check_id}/result
```

### POST `/api/upload` — Upload File
```bash
curl -X POST http://localhost:8000/api/upload \
  -F "file=@my-essay.pdf"
```

### GET `/api/stats` — Platform Statistics
```bash
curl http://localhost:8000/api/stats
```

---

## Result Schema

```json
{
  "check_id": "uuid",
  "originality_score": 78,
  "plagiarism_percentage": 22.5,
  "verdict": "Some Concerns",
  "verdict_color": "yellow",
  "word_count": 102400,
  "sources_found": 3,
  "flagged_phrases": 12,
  "chunks_analyzed": 51,
  "analysis_method": "hybrid_minhash_llm",
  "sources": [
    {
      "title": "Wikipedia — Related Article",
      "url": "https://en.wikipedia.org/...",
      "type": "web",
      "similarity": 8.5
    }
  ],
  "highlighted_passages": [
    {
      "text": "...",
      "source": "formal_language_cluster",
      "severity": "medium"
    }
  ],
  "suggestions": [
    {"type": "warning", "text": "Add citations for borrowed facts."},
    {"type": "ok", "text": "Overall originality is good."}
  ],
  "summary": "This 102,400-word document..."
}
```

---

## Model Comparison

| Model    | Size  | Speed (100k words) | Quality | RAM Required |
|----------|-------|--------------------|---------|--------------|
| phi3     | 2.3GB | ~8 min             | ★★★☆☆   | 4GB          |
| mistral  | 4.1GB | ~15 min            | ★★★★☆   | 8GB          |
| llama3   | 4.7GB | ~18 min            | ★★★★★   | 8GB          |
| gemma2   | 5.4GB | ~20 min            | ★★★★☆   | 12GB         |

**GPU acceleration**: If you have an NVIDIA GPU, Ollama uses it automatically. 100k words takes ~3-4 minutes with a GPU.

---

## Scaling for SaaS

### Add Authentication
```python
# Add to main.py
from fastapi_users import FastAPIUsers
# See: https://fastapi-users.github.io/
```

### Add a Job Queue (for high volume)
```python
# Replace background_tasks with Celery + Redis
# celery -A tasks worker --loglevel=info
```

### PostgreSQL (instead of SQLite)
```python
# Change DB_PATH to PostgreSQL DSN
DATABASE_URL=postgresql://user:pass@localhost/plagcheck
```

### Rate Limiting
```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)
@app.post("/api/check/stream")
@limiter.limit("10/hour")
async def stream_check(...): ...
```

---

## License
MIT — free to use, modify, and deploy commercially.
