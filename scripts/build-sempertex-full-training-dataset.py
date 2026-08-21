from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "processed" / "sempertex-training-final-database-v001.json"
OUTPUT_DIR = ROOT / "data" / "staging" / "sempertex-full-v001"
OUTPUT_ZIP = ROOT / "data" / "staging" / "sempertex-full-v001-fal.zip"
MANIFEST = ROOT / "data" / "processed" / "sempertex-full-v001.json"
TARGET = 200


def normalize_image(source_path: Path, output_path: Path) -> tuple[int, int, str]:
    with Image.open(source_path) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
        background = Image.new("RGBA", image.size, "white")
        background.alpha_composite(image)
        rgb = background.convert("RGB")
        if min(rgb.size) < 1024:
            scale = 1024 / min(rgb.size)
            rgb = rgb.resize((round(rgb.width * scale), round(rgb.height * scale)), Image.Resampling.LANCZOS)
        if max(rgb.size) > 1536 and min(rgb.size) * (1536 / max(rgb.size)) >= 1024:
            scale = 1536 / max(rgb.size)
            rgb = rgb.resize((round(rgb.width * scale), round(rgb.height * scale)), Image.Resampling.LANCZOS)
        if min(rgb.size) < 1024:
            raise SystemExit(f"Cannot normalize to 1024px without violating aspect ratio: {source_path}")
        rgb.save(output_path, "JPEG", quality=93, optimize=True, progressive=True)
    payload = output_path.read_bytes()
    return rgb.width, rgb.height, hashlib.sha256(payload).hexdigest()


def main() -> None:
    database = json.loads(DATABASE.read_text(encoding="utf-8"))
    records = database["products"]
    if len(records) != TARGET:
        raise SystemExit(f"Expected {TARGET} records, found {len(records)}")

    resolved_output = OUTPUT_DIR.resolve()
    if not resolved_output.is_relative_to(ROOT.resolve()) or resolved_output.name != "sempertex-full-v001":
        raise SystemExit(f"Unsafe output directory: {resolved_output}")
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    manifest_records: list[dict] = []
    for index, record in enumerate(records, start=1):
        stem = f"sempertex-full-{index:03d}"
        image_name = f"{stem}.jpg"
        image_path = OUTPUT_DIR / image_name
        width, height, sha256 = normalize_image(ROOT / record["localImage"], image_path)
        caption_path = OUTPUT_DIR / f"{stem}.txt"
        caption_path.write_text(record["caption"].strip() + "\n", encoding="utf-8")
        manifest_records.append({
            "id": stem,
            "sourceSelectionId": record["selectionId"],
            "role": record["imageRole"],
            "theme": record["theme"],
            "image": str(image_path.relative_to(ROOT)).replace("\\", "/"),
            "caption": str(caption_path.relative_to(ROOT)).replace("\\", "/"),
            "width": width,
            "height": height,
            "sha256": sha256,
            "triggerToken": record["triggerToken"],
            "license": record["license"],
        })

    with zipfile.ZipFile(OUTPUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file_path in sorted(OUTPUT_DIR.iterdir()):
            archive.write(file_path, arcname=file_path.name)
    with zipfile.ZipFile(OUTPUT_ZIP) as archive:
        names = archive.namelist()
        if len([name for name in names if name.endswith(".jpg")]) != TARGET or len([name for name in names if name.endswith(".txt")]) != TARGET:
            raise SystemExit("Full archive verification failed")

    MANIFEST.write_text(json.dumps({
        "schemaVersion": 1,
        "datasetVersion": "sempertex-full-v001",
        "generatedAt": database["generatedAt"],
        "objective": "Full 200-image Sempertex training run with scenes, assembled decorations and individual products.",
        "counts": database["counts"],
        "normalization": {
            "format": "JPEG",
            "minimumShortSide": 1024,
            "maximumLongSide": 1536,
            "metadataRemoved": True,
            "transparentBackgroundsFlattenedToWhite": True,
        },
        "training": {
            "endpoint": "fal-ai/flux-2-trainer-v2",
            "steps": 1000,
            "estimatedCostUsd": 6.40,
            "budgetCeilingUsd": 7.00,
            "triggerTokens": ["eventdecor_style_v1", "sempertex_product_v1"],
        },
        "records": manifest_records,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(MANIFEST),
        "zip": str(OUTPUT_ZIP),
        "images": TARGET,
        "captions": TARGET,
        "bytes": OUTPUT_ZIP.stat().st_size,
        "estimatedCostUsd": 6.40,
    }))


if __name__ == "__main__":
    main()
