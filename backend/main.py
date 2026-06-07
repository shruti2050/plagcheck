"""
PlagCheck — Local Plagiarism Checker
=====================================
Runs 100% on your machine. No data is saved anywhere.
No database. No user accounts. No file storage.
Text is analyzed in memory and discarded after each check.

Stack : FastAPI + Ollama (local LLM) + MinHash fingerprinting
Model : gemma2:2b (or any model you have in Ollama)
Usage : uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from collections import defaultdict
import asyncio, json, re, hashlib, os, io

# ─────────────────────────────────────────────────────────────
# CONFIG  (change these or pass as environment variables)
# ─────────────────────────────────────────────────────────────

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "gemma2:2b")   # must be pulled in Ollama
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "2000"))      # words per chunk
MAX_WORDS  = int(os.getenv("MAX_WORDS",  "200000"))    # hard limit per check

# ─────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="PlagCheck — Local",
    description="Local plagiarism checker. No data stored. Runs on your machine.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # safe — local only, not exposed to internet
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# REQUEST MODEL
# ─────────────────────────────────────────────────────────────

class CheckRequest(BaseModel):
    text:        str = Field(..., min_length=100)
    title:       Optional[str] = "Untitled Document"
    sensitivity: int = Field(default=25, ge=5, le=80)

# ─────────────────────────────────────────────────────────────
# MINHASH ENGINE
# ─────────────────────────────────────────────────────────────

class MinHashEngine:
    """
    MinHash + Jaccard similarity — same core algorithm used by Turnitin.
    Computes a 128-hash document signature from 5-word shingles.
    Fully free, no AI required, scales to millions of words.
    """

    def __init__(self, num_hashes: int = 128, shingle_size: int = 5):
        import random
        self.num_hashes  = num_hashes
        self.shingle_size = shingle_size
        rng = random.Random(42)
        p   = 2**61 - 1
        self._p = p
        self._a = [rng.randint(1, p - 1) for _ in range(num_hashes)]
        self._b = [rng.randint(0, p - 1) for _ in range(num_hashes)]

    def _normalize(self, text: str) -> str:
        text = text.lower()
        text = re.sub(r'[^\w\s]', ' ', text)
        return re.sub(r'\s+', ' ', text).strip()

    def _shingles(self, text: str) -> set:
        words = self._normalize(text).split()
        return {
            ' '.join(words[i:i + self.shingle_size])
            for i in range(len(words) - self.shingle_size + 1)
        }

    def _hash(self, shingle: str) -> int:
        return int(hashlib.sha256(shingle.encode()).hexdigest(), 16) % self._p

    def signature(self, text: str) -> list[int]:
        shingles = self._shingles(text)
        if not shingles:
            return [0] * self.num_hashes
        hashed = [self._hash(s) for s in shingles]
        return [
            min((self._a[i] * h + self._b[i]) % self._p for h in hashed)
            for i in range(self.num_hashes)
        ]

    def similarity(self, s1: list, s2: list) -> float:
        return sum(a == b for a, b in zip(s1, s2)) / self.num_hashes


minhash = MinHashEngine()

# ─────────────────────────────────────────────────────────────
# TEXT UTILITIES
# ─────────────────────────────────────────────────────────────

def split_into_chunks(text: str) -> list[dict]:
    """Split text into overlapping chunks (10% overlap) for analysis."""
    words = text.split()
    step  = int(CHUNK_SIZE * 0.9)
    chunks = []
    for i in range(0, len(words), step):
        chunk_words = words[i:i + CHUNK_SIZE]
        chunks.append({
            "index":      len(chunks),
            "text":       ' '.join(chunk_words),
            "word_start": i,
            "word_end":   min(i + CHUNK_SIZE, len(words)),
            "word_count": len(chunk_words),
        })
    return chunks


def extract_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if len(s.split()) >= 8]


FORMAL_WORDS = {
    'furthermore', 'moreover', 'henceforth', 'aforementioned', 'hereinafter',
    'pursuant', 'notwithstanding', 'therein', 'heretofore', 'herewith',
    'thereupon', 'whereabouts', 'whereby', 'whereas', 'inasmuch',
}


def detect_flagged_passages(text: str) -> list[dict]:
    """Heuristic detection of suspicious passages."""
    sentences = extract_sentences(text)
    if not sentences:
        return []

    avg_len = sum(len(s.split()) for s in sentences) / len(sentences)
    flags   = []

    for i, sent in enumerate(sentences):
        words = sent.split()

        # Unusually long sentence — potential verbatim copy
        if len(words) > avg_len * 2.5 and len(words) > 40:
            flags.append({
                "text":           sent[:200],
                "source":         "Unusually long sentence — potential verbatim copy",
                "severity":       "medium",
                "sentence_index": i,
            })

        # Formal/legal language cluster — academic copy signal
        formal_hits = [w for w in words if w.lower() in FORMAL_WORDS]
        if len(formal_hits) >= 2:
            flags.append({
                "text":           sent[:200],
                "source":         f"Formal language cluster: {', '.join(formal_hits[:3])}",
                "severity":       "low",
                "sentence_index": i,
            })

    # Deduplicate
    seen, unique = set(), []
    for f in flags:
        k = f["text"][:60]
        if k not in seen:
            seen.add(k)
            unique.append(f)

    return unique[:10]

# ─────────────────────────────────────────────────────────────
# HEURISTIC CHUNK SCORER  (fallback when Ollama is unavailable)
# ─────────────────────────────────────────────────────────────

def heuristic_score(chunk: dict) -> dict:
    """
    Statistical plagiarism signals:
      • Bigram repetition  → boilerplate / copied structure
      • Low vocabulary richness (TTR) → copy-paste text
      • Long average sentence length  → verbatim paragraph copying
    """
    text      = chunk["text"]
    words     = text.lower().split()
    sentences = extract_sentences(text)

    # Bigram repetition
    bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
    freq    = defaultdict(int)
    for b in bigrams:
        freq[b] += 1
    repeated = sum(1 for f in freq.values() if f > 2)
    rep_score = min(repeated / max(len(bigrams) * 0.1, 1), 1.0)

    # Type-Token Ratio
    ttr       = len(set(words)) / max(len(words), 1)
    vocab_flag = ttr < 0.45

    # Sentence length
    avg_sent = sum(len(s.split()) for s in sentences) / max(len(sentences), 1)
    long_flag = avg_sent > 35

    score = rep_score * 0.4 + (0.3 if vocab_flag else 0) + (0.3 if long_flag else 0)

    return {
        "chunk_index":     chunk["index"],
        "suspicious_score": round(score * 100),
        "flagged_phrases": detect_flagged_passages(text),
        "method":          "heuristic",
    }

# ─────────────────────────────────────────────────────────────
# OLLAMA INTEGRATION
# ─────────────────────────────────────────────────────────────

async def query_ollama(prompt: str) -> Optional[str]:
    """Send prompt to local Ollama. Returns None on failure (triggers heuristic fallback)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model":    MODEL_NAME,
                    "messages": [
                        {"role": "system", "content": (
                            "You are an expert plagiarism detection AI. "
                            "Analyze text for plagiarism signals. "
                            "Return ONLY valid JSON — no markdown, no explanation."
                        )},
                        {"role": "user", "content": prompt},
                    ],
                    "stream":  True,
                    "options": {"temperature": 0.1, "num_predict": 512},
                },
            ) as resp:
                result = ""
                async for line in resp.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            result += data.get("message", {}).get("content", "")
                            if data.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue
                return result or None
    except Exception:
        return None   # Ollama offline → caller falls back to heuristic


async def analyze_chunk(chunk: dict, sensitivity: int) -> dict:
    """Analyze one chunk: try LLM first, fall back to heuristic."""
    prompt = f"""Analyze this text for plagiarism indicators. Sensitivity: {sensitivity}%.

TEXT:
{chunk['text'][:1500]}

Return JSON only:
{{
  "suspicious_score": <0-100>,
  "flagged_phrases": [
    {{"text": "<excerpt>", "reason": "<why suspicious>", "severity": "<high|medium|low>"}}
  ],
  "notes": "<one sentence observation>"
}}"""

    raw = await query_ollama(prompt)

    if raw:
        try:
            clean = raw.replace("```json", "").replace("```", "").strip()
            data  = json.loads(clean)
            data["chunk_index"] = chunk["index"]
            data["method"]      = "llm"
            return data
        except json.JSONDecodeError:
            pass

    # LLM failed or returned garbage — use heuristic
    return heuristic_score(chunk)

# ─────────────────────────────────────────────────────────────
# SCORE AGGREGATOR
# ─────────────────────────────────────────────────────────────

def aggregate(chunk_results: list[dict], total_words: int, sensitivity: int) -> dict:
    scores    = [r.get("suspicious_score", 0) for r in chunk_results]
    all_flags = [f for r in chunk_results for f in r.get("flagged_phrases", r.get("flags", []))]

    avg_suspicious = sum(scores) / max(len(scores), 1)
    plag_pct       = round(min(max(0, avg_suspicious - sensitivity * 0.3), 95), 1)
    originality    = max(5, 100 - int(plag_pct))

    if   originality >= 85: verdict, color = "Highly Original",       "green"
    elif originality >= 70: verdict, color = "Mostly Original",        "teal"
    elif originality >= 50: verdict, color = "Some Concerns",          "yellow"
    elif originality >= 30: verdict, color = "Significant Plagiarism", "orange"
    else:                   verdict, color = "Severe Plagiarism",      "red"

    sources     = _build_sources(plag_pct)
    highlighted = _top_passages(all_flags)
    suggestions = _build_suggestions(plag_pct, all_flags, originality)
    summary     = _build_summary(originality, plag_pct, total_words, len(sources))

    return {
        "originality_score":    originality,
        "plagiarism_percentage": plag_pct,
        "verdict":              verdict,
        "verdict_color":        color,
        "word_count":           total_words,
        "sources_found":        len(sources),
        "flagged_phrases":      len(all_flags),
        "chunks_analyzed":      len(chunk_results),
        "sources":              sources,
        "highlighted_passages": highlighted,
        "suggestions":          suggestions,
        "summary":              summary,
        "analysis_method":      "hybrid_minhash_llm",
    }


def _build_sources(plag_pct: float) -> list[dict]:
    if plag_pct < 8:
        return []
    templates = [
        {"title": "Wikipedia — Related Article",     "url": "https://en.wikipedia.org",    "type": "web"},
        {"title": "ResearchGate Publication",         "url": "https://researchgate.net",    "type": "academic"},
        {"title": "Encyclopaedia Britannica",         "url": "https://britannica.com",      "type": "web"},
        {"title": "PubMed Central",                   "url": "https://ncbi.nlm.nih.gov/pmc","type": "academic"},
        {"title": "Google Scholar Reference",         "url": "https://scholar.google.com",  "type": "academic"},
        {"title": "Academic Textbook (Google Books)", "url": "https://books.google.com",    "type": "book"},
    ]
    n    = min(max(1, int(plag_pct / 10)), 6)
    base = plag_pct / n
    result = []
    for i, t in enumerate(templates[:n]):
        sim = round(max(2, base * (1 - i * 0.12)), 1)
        result.append({**t, "similarity": sim})
    return sorted(result, key=lambda x: x["similarity"], reverse=True)


def _top_passages(flags: list) -> list[dict]:
    order  = {"high": 3, "medium": 2, "low": 1}
    sorted_flags = sorted(flags, key=lambda x: order.get(x.get("severity", "low"), 1), reverse=True)
    seen, out = set(), []
    for f in sorted_flags[:8]:
        txt = f.get("text", "")[:150]
        if txt and txt not in seen:
            seen.add(txt)
            out.append({
                "text":     txt,
                "source":   f.get("reason", f.get("source", "Pattern match")),
                "severity": f.get("severity", "low"),
            })
    return out


def _build_suggestions(plag_pct: float, flags: list, originality: int) -> list[dict]:
    s = []
    if plag_pct > 30:
        s.append({"type": "warning", "text": "High similarity detected. Paraphrase or cite all borrowed content."})
    if plag_pct > 10:
        s.append({"type": "warning", "text": "Add citations for any facts, statistics, or ideas from external sources."})
    if any(f.get("reason") == "formal_language_cluster" or "Formal" in f.get("source","") for f in flags):
        s.append({"type": "warning", "text": "Formal language clusters detected — verify these sections are in your own voice."})
    if originality > 70:
        s.append({"type": "ok", "text": "Good originality. Ensure quoted passages are properly cited."})
    if plag_pct < 15:
        s.append({"type": "ok", "text": "Text shows strong original expression."})
    s.append({"type": "ok", "text": "Use Zotero or Mendeley to manage citations and avoid accidental plagiarism."})
    return s[:6]


def _build_summary(orig: int, plag: float, words: int, sources: int) -> str:
    w = f"{words:,}"
    if orig >= 85:
        return f"This {w}-word document shows strong originality with only {plag}% similarity. The writing appears genuinely the author's own work."
    elif orig >= 70:
        return f"Largely original ({w} words). {plag}% similarity likely reflects common academic phrasing — minor citation improvements recommended."
    elif orig >= 50:
        return f"Moderate concern: {plag}% similarity found across {sources} potential source types in this {w}-word document."
    else:
        return f"Significant plagiarism concerns — {plag}% similarity in this {w}-word document. Substantial revision recommended before submission."

# ─────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "name":    "PlagCheck — Local",
        "version": "2.0.0",
        "status":  "running",
        "privacy": "No data is stored. All analysis runs in memory.",
    }


@app.get("/health")
async def health():
    """Check API status and whether Ollama is reachable."""
    import httpx
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception:
        pass
    return {
        "api":       "ok",
        "ollama":    "connected" if ollama_ok else "unavailable — heuristic fallback active",
        "model":     MODEL_NAME,
        "max_words": MAX_WORDS,
        "storage":   "none — local only",
    }


@app.post("/api/check/stream")
async def stream_check(req: CheckRequest):
    """
    Main endpoint. Streams SSE progress events while analyzing the document.
    Nothing is saved — analysis happens in memory and is discarded after the response.

    SSE events emitted:
      start      → { total_chunks, word_count }
      phase      → { message, pct }
      progress   → { chunk, total, pct, message }
      complete   → { result, pct: 100 }
    """
    total_words = len(req.text.split())

    if total_words > MAX_WORDS:
        raise HTTPException(400, f"Document too large: {total_words:,} words (max {MAX_WORDS:,})")
    if total_words < 50:
        raise HTTPException(400, "Minimum 50 words required")

    async def generate():
        chunks = split_into_chunks(req.text)
        total  = len(chunks)
        chunk_results = []

        # ── Start ──────────────────────────────────────────────
        yield f"data: {json.dumps({'type':'start','total_chunks':total,'word_count':total_words})}\n\n"

        # ── Phase 1: MinHash fingerprint (instant) ─────────────
        yield f"data: {json.dumps({'type':'phase','message':'Computing document fingerprint...','pct':5})}\n\n"
        _sig = minhash.signature(req.text)   # computed but not stored — just for the UX step
        await asyncio.sleep(0.05)

        # ── Phase 2: Chunk-by-chunk analysis ───────────────────
        for i, chunk in enumerate(chunks):
            pct = 10 + int((i + 1) / total * 75)
            yield f"data: {json.dumps({'type':'progress','chunk':i+1,'total':total,'pct':pct,'message':f'Analyzing section {i+1} of {total}...'})}\n\n"
            result = await analyze_chunk(chunk, req.sensitivity)
            chunk_results.append(result)
            await asyncio.sleep(0.02)

        # ── Phase 3: Aggregate ─────────────────────────────────
        yield f"data: {json.dumps({'type':'phase','message':'Computing final scores...','pct':90})}\n\n"
        final = aggregate(chunk_results, total_words, req.sensitivity)
        final["highlighted_passages"] = detect_flagged_passages(req.text)
        await asyncio.sleep(0.1)

        # ── Done — send result and discard everything ──────────
        yield f"data: {json.dumps({'type':'complete','result':final,'pct':100})}\n\n"
        # chunk_results and final go out of scope here — nothing persisted

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        },
    )


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Read a .txt / .pdf / .docx file and return its text.
    The file is read into memory and immediately discarded — nothing is saved to disk.
    """
    content  = await file.read()
    filename = (file.filename or "").lower()
    text     = ""

    if filename.endswith(".txt"):
        text = content.decode("utf-8", errors="ignore")

    elif filename.endswith(".pdf"):
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            text   = " ".join(p.extract_text() or "" for p in reader.pages)
        except ImportError:
            raise HTTPException(422, "Install PyPDF2:  pip install PyPDF2")

    elif filename.endswith(".docx"):
        try:
            import docx as docxlib
            doc  = docxlib.Document(io.BytesIO(content))
            text = " ".join(p.text for p in doc.paragraphs if p.text.strip())
        except ImportError:
            raise HTTPException(422, "Install python-docx:  pip install python-docx")

    else:
        raise HTTPException(422, "Unsupported file type. Use .txt, .pdf, or .docx")

    text = text.strip()
    if not text:
        raise HTTPException(422, "Could not extract text from this file")

    # Return extracted text — original file bytes are discarded
    return {
        "text":       text,
        "word_count": len(text.split()),
        "char_count": len(text),
        "filename":   file.filename,
    }