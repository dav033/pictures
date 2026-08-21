from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="data/processed/sempertex-training-final-database-v001.json")
    parser.add_argument("--output", default="data/staging/sempertex-training-v001-fal.zip")
    args = parser.parse_args()

    database = json.loads(Path(args.database).read_text(encoding="utf-8"))
    records = database["products"]
    if len(records) != 200:
        raise SystemExit(f"Expected 200 records, found {len(records)}")
    if any(record.get("qualityStatus") != "approved" for record in records):
        raise SystemExit("Database contains non-approved records")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    seen_names: set[str] = set()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for record in records:
            image = Path(record["localImage"])
            if not image.is_file():
                raise SystemExit(f"Missing image: {image}")
            if image.name in seen_names:
                raise SystemExit(f"Duplicate archive name: {image.name}")
            seen_names.add(image.name)
            archive.write(image, arcname=image.name)
            archive.writestr(f"{image.stem}.txt", record["caption"].strip() + "\n")

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        images = [name for name in names if Path(name).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        captions = [name for name in names if name.endswith(".txt")]
        if len(images) != 200 or len(captions) != 200:
            raise SystemExit("Archive verification failed")
    print(json.dumps({
        "output": str(output.resolve()),
        "images": len(images),
        "captions": len(captions),
        "bytes": output.stat().st_size,
    }))


if __name__ == "__main__":
    main()
