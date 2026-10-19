"""Cross-encoder reranking for RAG candidates (Fase 8.2 of the Python migration).

Reorders a candidate list PostgreSQL already authorized (see
src/lib/rag/retrieval/search.ts, buscarHibrido). This module never adds or
removes a candidate -- `rerank` always returns a permutation of the input
ids. Model loading is lazy and process-local: importing this module, or
calling `rerank` with a fake `score_fn`, never touches disk or network, so
unrelated tests (and app startup) stay fast and offline.
"""

from __future__ import annotations

import threading
import math
from typing import Callable, Sequence

DEFAULT_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
DEFAULT_MODEL_REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"

ScoreFn = Callable[[Sequence[tuple[str, str]]], Sequence[float]]

_model_lock = threading.Lock()
_model_cache: dict[str, object] = {}


def _load_model(model_name: str) -> object:
    with _model_lock:
        model = _model_cache.get(model_name)
        if model is None:
            # Imported here, not at module scope: sentence-transformers pulls
            # in torch, and constructing CrossEncoder(...) downloads the
            # model weights on first use if they are not already cached.
            from sentence_transformers import CrossEncoder

            model = CrossEncoder(model_name, revision=DEFAULT_MODEL_REVISION)
            _model_cache[model_name] = model
        return model


def model_score_fn(model_name: str = DEFAULT_MODEL_NAME) -> ScoreFn:
    """A ScoreFn backed by the real cross-encoder model (loaded on first call)."""

    def score(pairs: Sequence[tuple[str, str]]) -> Sequence[float]:
        model = _load_model(model_name)
        predicted = model.predict(list(pairs))  # type: ignore[attr-defined]
        return [float(value) for value in predicted]

    return score


def rerank(
    query: str,
    candidates: Sequence[tuple[str, str]],
    *,
    score_fn: ScoreFn,
) -> list[tuple[str, float]]:
    """Reorders `candidates` (id, text) by relevance to `query`.

    Returns (id, score) pairs sorted by descending score. Python's sort is
    stable, so candidates the model scores as ties keep the relative order
    PostgreSQL already gave them.
    """

    if not query.strip():
        raise ValueError("query must not be empty")
    if not candidates:
        return []
    candidate_ids = [candidate_id for candidate_id, _text in candidates]
    if any(not candidate_id.strip() for candidate_id in candidate_ids):
        raise ValueError("candidate ids must not be empty")
    if len(candidate_ids) != len(set(candidate_ids)):
        raise ValueError("candidate ids must be unique")
    if any(not text.strip() for _candidate_id, text in candidates):
        raise ValueError("candidate text must not be empty")
    pairs = [(query, text) for _candidate_id, text in candidates]
    scores = score_fn(pairs)
    if len(scores) != len(candidates):
        raise ValueError("score_fn must return exactly one score per candidate")
    normalized_scores: list[float] = []
    for score in scores:
        try:
            normalized = float(score)
        except (TypeError, ValueError):
            raise ValueError("score_fn must return numeric scores") from None
        if not math.isfinite(normalized):
            raise ValueError("score_fn must return finite scores")
        normalized_scores.append(normalized)
    scored = list(zip(candidates, normalized_scores))
    scored.sort(key=lambda item: item[1], reverse=True)
    return [(candidate_id, score) for (candidate_id, _text), score in scored]
