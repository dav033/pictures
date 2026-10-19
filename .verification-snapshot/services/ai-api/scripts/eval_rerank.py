"""Evaluate cross-encoder ordering against the versioned Fase 8.2 fixture."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import TypedDict

import truststore

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

truststore.inject_into_ssl()

from app.reranker import model_score_fn, rerank  # noqa: E402


class Candidate(TypedDict):
    id: str
    text: str


class Case(TypedDict):
    id: str
    query: str
    candidates: list[Candidate]
    ideal_order: list[str]


def reciprocal_rank(order: list[str], ideal_order: list[str]) -> float:
    if not ideal_order:
        return 0.0
    try:
        return 1.0 / (order.index(ideal_order[0]) + 1)
    except ValueError:
        return 0.0


def ndcg_at_k(order: list[str], ideal_order: list[str], k: int) -> float:
    relevance = {
        candidate_id: len(ideal_order) - index for index, candidate_id in enumerate(ideal_order)
    }
    ranked = [relevance.get(candidate_id, 0) for candidate_id in order[:k]]
    ideal = sorted(relevance.values(), reverse=True)[:k]

    def dcg(values: list[int]) -> float:
        return sum(value / math.log2(index + 2) for index, value in enumerate(values))

    ideal_dcg = dcg(ideal)
    return dcg(ranked) / ideal_dcg if ideal_dcg else 0.0


def metrics(orders: list[tuple[list[str], list[str]]]) -> dict[str, float]:
    mrr = sum(reciprocal_rank(order, ideal) for order, ideal in orders) / len(orders)
    ndcg = sum(ndcg_at_k(order, ideal, 3) for order, ideal in orders) / len(orders)
    return {"mrr": round(mrr, 6), "ndcg_at_3": round(ndcg, 6)}


def main() -> int:
    fixture_path = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else ROOT.parents[1] / "eval" / "rag" / "rerank-fixture-v1.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    score_fn = model_score_fn(fixture["model"])
    before: list[tuple[list[str], list[str]]] = []
    after: list[tuple[list[str], list[str]]] = []
    cases: list[dict[str, object]] = []

    for case in fixture["casos"]:
        candidates = [(candidate["id"], candidate["text"]) for candidate in case["candidates"]]
        ideal_order = list(case["ideal_order"])
        baseline_order = [candidate_id for candidate_id, _text in candidates]
        reranked = rerank(case["query"], candidates, score_fn=score_fn)
        model_order = [candidate_id for candidate_id, _score in reranked]
        before.append((baseline_order, ideal_order))
        after.append((model_order, ideal_order))
        cases.append(
            {
                "id": case["id"],
                "before": baseline_order,
                "after": model_order,
                "scores": {candidate_id: score for candidate_id, score in reranked},
            }
        )

    print(
        json.dumps(
            {
                "model": fixture["model"],
                "before": metrics(before),
                "after": metrics(after),
                "cases": cases,
            },
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
