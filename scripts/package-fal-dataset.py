from __future__ import annotations

import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifests" / "dataset-v001.jsonl"
CAPTIONS = ROOT / "data" / "captions" / "dataset-v001.jsonl"
OUTPUT = ROOT / "data" / "staging" / "dataset-decoration-v001-fal.zip"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    records = read_jsonl(MANIFEST)
    captions = {row["id"]: row for row in read_jsonl(CAPTIONS)}
    if not records or len(records) != len(captions):
        raise SystemExit("Manifest/caption count mismatch.")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for record in records:
            if record.get("status") != "approved":
                raise SystemExit(f"Dataset record is not approved: {record['id']}")
            image = ROOT / record["relative_path"]
            caption = captions.get(record["id"])
            if not image.is_file() or not caption:
                raise SystemExit(f"Missing image or caption: {record['id']}")
            archive.write(image, arcname=image.name)
            archive.writestr(f"{image.stem}.txt", caption["caption"] + "\n")
            written += 1
    print(json.dumps({"output": str(OUTPUT), "images": written, "caption_files": written, "bytes": OUTPUT.stat().st_size}))


if __name__ == "__main__":
    main()
