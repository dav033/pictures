from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifests" / "dataset-v001.jsonl"
CAPTIONS = ROOT / "data" / "captions" / "dataset-v001.jsonl"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    records = read_jsonl(MANIFEST)
    captions = read_jsonl(CAPTIONS)
    by_id = {caption["id"]: caption for caption in captions}
    if len(by_id) != len(captions):
        raise SystemExit("Duplicate caption ids.")
    if {record["id"] for record in records} != set(by_id):
        raise SystemExit("Caption ids and manifest ids do not match.")
    groups: defaultdict[str, set[str]] = defaultdict(set)
    for caption in captions:
        if caption.get("split") not in {"train", "validation", "test"}:
            raise SystemExit(f"Invalid split for {caption['id']}.")
        groups[caption["scene_group"]].add(caption["split"])
    leaking_groups = {group: sorted(splits) for group, splits in groups.items() if len(splits) > 1}
    if leaking_groups:
        raise SystemExit(f"Scene group crosses splits: {leaking_groups}")
    for record in records:
        record["split"] = by_id[record["id"]]["split"]
    MANIFEST.write_text("\n".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) for record in records) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "splits": Counter(record["split"] for record in records), "scene_groups": len(groups), "leakage": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
