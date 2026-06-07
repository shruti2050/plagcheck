# PlagCheck 🔍

> Free, local plagiarism checker for students — no signup, no limits, no data stored.

![Python](https://img.shields.io/badge/Python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-black)


---

## Why I built this

Turnitin charges per check. Grammarly is paywalled. Every free tool caps at 1,000 words.

My final year project was 12,000 words. I just needed to know if my work was original.

So I built PlagCheck — a plagiarism checker that runs entirely on your machine, costs nothing, and supports up to **200,000 words**.

---

## What it does

- ✅ Checks up to **200,000 words** — full dissertations, theses, research papers
- ✅ **No signup. No credit card. No word limit.**
- ✅ Real-time analysis with live progress updates
- ✅ Source detection, flagged passages, and actionable recommendations
- ✅ Upload `.txt`, `.pdf`, or `.docx` directly
- ✅ Powered by a **local LLM (Ollama + Gemma2)** — your text never leaves your machine
- ✅ Falls back to heuristic analysis if Ollama is unavailable

---

## Privacy

```
Your text → analyzed in memory → result returned → everything discarded
```

Nothing is saved. No database. No file storage. No user accounts.  
Pull the repo, run it locally, use it — your data stays yours.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      PlagCheck                        │
├─────────────────────┬────────────────────────────────┤
│   React Frontend    │       FastAPI Backend           │
│   (Vite + React 18) │       (Python 3.11)            │
│                     │                                 │
│  • Paste or upload  │  • SSE streaming progress      │
│    text/file        │  • MinHash fingerprinting      │
│  • Live progress    │  • Chunked LLM analysis        │
│    stream           │  • Heuristic fallback          │
│  • Originality      │  • File reading                │
│    report           │    (.txt / .pdf / .docx)       │
└─────────────────────┴──────────┬───────────────────--┘
                                 │
                   ┌─────────────▼──────────────┐
                   │     Ollama (Local LLM)      │
                   │  gemma2:2b — runs on YOUR   │
                   │  machine, zero API cost     │
                   └────────────────────────────-┘
```

---

## How it handles 200,000 words for free

### Stage 1 — MinHash Fingerprinting (instant)
- Computes a 128-hash MinHash signature of the full document
- Shingles text into 5-word n-grams
- Jaccard similarity for fast pattern matching
- Zero LLM cost — pure math

### Stage 2 — Chunked LLM Analysis
- Splits document into 2,000-word overlapping chunks (10% overlap)
- Sends each chunk to your local Ollama model
- 100k words ≈ 50 chunks, processed sequentially
- No per-token billing — completely free

### Stage 3 — Heuristic Fallback
If Ollama is unavailable, automatically falls back to:
- Bigram repetition scoring
- Vocabulary richness (Type-Token Ratio)
- Sentence length variance
- Formal language clustering

### Stage 4 — Score Aggregation
- Weighted average across all chunks
- Generates sources, flagged passages, and recommendations

---

## Quick Start

### Prerequisites
- [Ollama](https://ollama.ai/download) installed and running
- `gemma2:2b` model pulled (or any model you prefer)
- Python 3.11+
- Node.js 18+

### Step 1 — Pull a model (one time only)
```bash
ollama pull gemma2:2b
```

### Step 2 — Start Ollama
```bash
ollama serve
```

### Step 3 — Start the backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Step 4 — Start the frontend
```bash
cd frontend
npm install
npm run dev
```

### Step 5 — Open in browser
```
http://localhost:3000
```

---

## Docker (optional)

If you have Docker installed, one command starts everything:

```bash
docker compose up --build
```

> Make sure Ollama is already running on your machine before using Docker.  
> The compose file uses `host.docker.internal` to connect to your local Ollama.

---

## Model options

| Model      | Size   | Speed (100k words) | Quality | RAM Needed |
|------------|--------|--------------------|---------|------------|
| phi3       | 2.3 GB | ~8 min             | ★★★☆☆  | 4 GB       |
| gemma2:2b  | 1.6 GB | ~6 min             | ★★★☆☆  | 4 GB       |
| mistral    | 4.1 GB | ~15 min            | ★★★★☆  | 8 GB       |
| llama3     | 4.7 GB | ~18 min            | ★★★★★  | 8 GB       |

To switch models, change this line in `backend/main.py`:
```python
MODEL_NAME = os.getenv("OLLAMA_MODEL", "gemma2:2b")
```

**GPU**: If you have an NVIDIA GPU, Ollama uses it automatically — 100k words drops to ~3 min.

---

## API

### `POST /api/check/stream` — Analyze text (SSE streaming)
```bash
curl -N -X POST http://localhost:8000/api/check/stream \
  -H "Content-Type: application/json" \
  -d '{"text": "Your document here...", "sensitivity": 25}'
```

SSE events:
```json
{"type": "start",    "total_chunks": 50, "word_count": 100000}
{"type": "progress", "chunk": 1, "total": 50, "pct": 2, "message": "Analyzing section 1 of 50..."}
{"type": "complete", "result": {...}, "pct": 100}
```

### `POST /api/upload` — Upload a file
```bash
curl -X POST http://localhost:8000/api/upload \
  -F "file=@my-essay.pdf"
```

### `GET /health` — Check status
```bash
curl http://localhost:8000/health
```

---

## Result schema

```json
{
  "originality_score":     87,
  "plagiarism_percentage": 13.0,
  "verdict":               "Mostly Original",
  "verdict_color":         "teal",
  "word_count":            12400,
  "sources_found":         2,
  "flagged_phrases":       4,
  "chunks_analyzed":       7,
  "analysis_method":       "hybrid_minhash_llm",
  "sources": [
    {
      "title":      "Wikipedia — Related Article",
      "url":        "https://en.wikipedia.org",
      "type":       "web",
      "similarity": 8.5
    }
  ],
  "highlighted_passages": [
    {
      "text":     "...",
      "source":   "Formal language cluster detected",
      "severity": "medium"
    }
  ],
  "suggestions": [
    {"type": "warning", "text": "Add citations for borrowed facts."},
    {"type": "ok",      "text": "Overall originality is good."}
  ],
  "summary": "This 12,400-word document shows strong originality..."
}
```

---

## Tech stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | React 18, Vite, SSE streaming       |
| Backend   | Python 3.11, FastAPI                |
| AI Engine | Ollama (local), gemma2:2b           |
| Algorithm | MinHash fingerprinting, Jaccard similarity |
| Fallback  | Bigram repetition, TTR, heuristics  |
| Files     | PyPDF2 (.pdf), python-docx (.docx)  |

---

## Project structure

```
plagcheck/
├── backend/
│   ├── main.py              # FastAPI app — all analysis logic
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Full React UI
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## Contributing

Pull requests are welcome. If you're a student who found this useful, a ⭐ on the repo goes a long way.
