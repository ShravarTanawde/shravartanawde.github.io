"""
embed.py: turn each paper into a vector, so papers about the same idea sit close
together even when they use different words.

    python -m pipeline.embed                       every harvested paper, default model
    python -m pipeline.embed --model specter2      the comparison model

Rules:

  * Text is title + ". " + abstract, whitespace collapsed. LaTeX stays in; the
    models were trained on text that has it.
  * Every vector is L2-normalised, so a dot product is the cosine similarity
    and every later step can use one or the other interchangeably.
  * The model revision is pinned by commit hash, resolved once and written to
    .local/embeddings/<model>/meta.json. A vector is only comparable with
    vectors from the same weights, and "latest" moves.
  * Cached by arXiv id. A refit embeds only papers it has not seen.
  * Uses an NVIDIA GPU when there is one (the laptop) and the CPU otherwise
    (the weekly Action). Always float32: on the laptop's GTX 1650 half
    precision ran three times slower (19 against 59 papers/s), and it would
    make laptop and Action vectors differ by more than rounding.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from . import config, store
from .arxiv import log

MODELS = {
    "bge": {"name": "BAAI/bge-small-en-v1.5", "dim": 384, "pooling": "sentence-transformers"},
    "specter2": {"name": "allenai/specter2_base", "dim": 768, "pooling": "cls"},
}
DEFAULT_MODEL = "bge"
MAX_TOKENS = 512


def paper_text(title: str, abstract: str) -> str:
    return " ".join(f"{title}. {abstract}".split())


def cache_dir(model_key: str) -> Path:
    return config.LOCAL / "embeddings" / model_key


def _resolve_revision(model_key: str) -> str:
    meta_path = cache_dir(model_key) / "meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())["revision"]
    from huggingface_hub import model_info

    spec = MODELS[model_key]
    revision = model_info(spec["name"]).sha
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({"model": spec["name"], "revision": revision, "dim": spec["dim"]}, indent=1))
    return revision


def pin_revision(model_key: str, revision: str) -> None:
    """Make the embedder use exactly `revision` (from model.json). The weekly
    Action starts with no cache, and without this it would resolve the
    newest revision on the Hub, which could quietly move every paper."""
    meta_path = cache_dir(model_key) / "meta.json"
    if meta_path.exists():
        have = json.loads(meta_path.read_text())["revision"]
        if have != revision:
            raise SystemExit(f"Embedding cache is for {model_key}@{have[:10]}, the model needs @{revision[:10]}")
        return
    spec = MODELS[model_key]
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({"model": spec["name"], "revision": revision, "dim": spec["dim"]}, indent=1))


class Embedder:
    def __init__(self, model_key: str = DEFAULT_MODEL, device: str | None = None):
        import torch

        self.key = model_key
        self.spec = MODELS[model_key]
        self.revision = _resolve_revision(model_key)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.torch = torch
        if self.spec["pooling"] == "sentence-transformers":
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(self.spec["name"], revision=self.revision, device=self.device)
            self.model.max_seq_length = MAX_TOKENS
        else:
            from transformers import AutoModel, AutoTokenizer

            self.tok = AutoTokenizer.from_pretrained(self.spec["name"], revision=self.revision)
            self.model = AutoModel.from_pretrained(self.spec["name"], revision=self.revision).to(self.device).eval()

    def encode(self, titles, abstracts, batch_size: int = 64) -> np.ndarray:
        if self.spec["pooling"] == "sentence-transformers":
            texts = [paper_text(t, a) for t, a in zip(titles, abstracts)]
            vecs = self.model.encode(texts, batch_size=batch_size, normalize_embeddings=True,
                                     convert_to_numpy=True, show_progress_bar=False)
            return vecs.astype(np.float32)
        # SPECTER2's own input format: title [SEP] abstract, first-token pooling.
        texts = [" ".join(t.split()) + self.tok.sep_token + " ".join(a.split()) for t, a in zip(titles, abstracts)]
        out = []
        with self.torch.no_grad():
            for i in range(0, len(texts), batch_size):
                enc = self.tok(texts[i:i + batch_size], padding=True, truncation=True,
                               max_length=MAX_TOKENS, return_tensors="pt").to(self.device)
                cls = self.model(**enc).last_hidden_state[:, 0, :].float()
                out.append(self.torch.nn.functional.normalize(cls, dim=1).cpu().numpy())
        return np.concatenate(out).astype(np.float32) if out else np.zeros((0, self.spec["dim"]), np.float32)


def load_cache(model_key: str):
    d = cache_dir(model_key)
    ids_path, vec_path = d / "ids.json", d / "vectors.npy"
    if not ids_path.exists():
        return [], np.zeros((0, MODELS[model_key]["dim"]), np.float32)
    return json.loads(ids_path.read_text()), np.load(vec_path)


def save_cache(model_key: str, ids, vecs) -> None:
    d = cache_dir(model_key)
    d.mkdir(parents=True, exist_ok=True)
    np.save(d / "vectors.tmp.npy", vecs)
    (d / "ids.tmp.json").write_text(json.dumps(ids))
    (d / "vectors.tmp.npy").replace(d / "vectors.npy")
    (d / "ids.tmp.json").replace(d / "ids.json")


def embed_papers(papers, model_key: str = DEFAULT_MODEL, chunk: int = 4096):
    """Embeds whichever of `papers` are not cached yet. Returns (ids, vectors)
    for exactly `papers`, in their order."""
    ids, vecs = load_cache(model_key)
    have = set(ids)
    todo = [p for p in papers if p["id"] not in have]
    if todo:
        emb = Embedder(model_key)
        log(f"Embedding {len(todo)} papers with {emb.spec['name']}@{emb.revision[:10]} on {emb.device}")
        # Similar lengths per batch means less padding, which is most of the cost.
        todo.sort(key=lambda p: len(p["abstract"]))
        t0 = time.monotonic()
        for i in range(0, len(todo), chunk):
            part = todo[i:i + chunk]
            new = emb.encode([p["title"] for p in part], [p["abstract"] for p in part])
            ids = ids + [p["id"] for p in part]
            vecs = np.concatenate([vecs, new])
            save_cache(model_key, ids, vecs)
            done = i + len(part)
            rate = done / (time.monotonic() - t0)
            log(f"  {done}/{len(todo)}  ({rate:.0f} papers/s)")
    index = {pid: k for k, pid in enumerate(ids)}
    rows = [index[p["id"]] for p in papers]
    return [p["id"] for p in papers], vecs[rows]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.embed")
    ap.add_argument("--model", choices=sorted(MODELS), default=DEFAULT_MODEL)
    args = ap.parse_args(argv)
    papers = store.read_papers(config.PAPERS)
    ids, vecs = embed_papers(papers, args.model)
    log(f"{len(ids)} papers, vectors {vecs.shape}, cached in {cache_dir(args.model).relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
