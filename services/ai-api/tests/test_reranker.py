"""Unit tests for app.reranker. These never load sentence-transformers/torch
-- score_fn is always a fake here, so this suite stays fast and offline."""

import pytest

from app.reranker import rerank


def _fake_score(pairs: list[tuple[str, str]]) -> list[float]:
    # Higher score for a candidate text containing "rosas" -- deterministic
    # and independent of `pairs` order, like a real cross-encoder would be.
    return [1.0 if "rosas" in text else 0.0 for _query, text in pairs]


def test_rerank_orders_by_descending_score() -> None:
    candidates = [
        ("prod-1", "arreglo de girasoles"),
        ("prod-2", "ramo de rosas rojas"),
        ("prod-3", "canasta de frutas"),
    ]
    result = rerank("rosas", candidates, score_fn=_fake_score)
    assert [candidate_id for candidate_id, _score in result] == ["prod-2", "prod-1", "prod-3"]
    assert dict(result) == {"prod-1": 0.0, "prod-2": 1.0, "prod-3": 0.0}


def test_rerank_never_adds_or_removes_a_candidate() -> None:
    candidates = [("a", "uno"), ("b", "dos"), ("c", "tres")]
    result = rerank("query", candidates, score_fn=lambda pairs: [0.0] * len(pairs))
    assert {candidate_id for candidate_id, _score in result} == {"a", "b", "c"}
    assert len(result) == len(candidates)


def test_rerank_is_stable_on_ties() -> None:
    candidates = [("a", "x"), ("b", "x"), ("c", "x")]
    result = rerank("query", candidates, score_fn=lambda pairs: [0.0] * len(pairs))
    assert [candidate_id for candidate_id, _score in result] == ["a", "b", "c"]


def test_rerank_empty_candidates_returns_empty() -> None:
    assert rerank("query", [], score_fn=_fake_score) == []


def test_rerank_rejects_score_fn_with_wrong_length() -> None:
    with pytest.raises(ValueError):
        rerank("query", [("a", "x"), ("b", "y")], score_fn=lambda pairs: [0.0])


def test_rerank_rejects_duplicate_or_empty_ids() -> None:
    with pytest.raises(ValueError, match="unique"):
        rerank("query", [("a", "x"), ("a", "y")], score_fn=lambda pairs: [0.0, 0.0])
    with pytest.raises(ValueError, match="empty"):
        rerank("query", [("", "x")], score_fn=lambda pairs: [0.0])


def test_rerank_rejects_non_finite_scores() -> None:
    with pytest.raises(ValueError, match="finite"):
        rerank("query", [("a", "x")], score_fn=lambda pairs: [float("nan")])
