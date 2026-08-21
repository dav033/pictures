from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "processed" / "sempertex-training-final-database-v001.json"
OUTPUT_DIR = ROOT / "data" / "staging" / "sempertex-pilot-v001"
OUTPUT_ZIP = ROOT / "data" / "staging" / "sempertex-pilot-v001-fal.zip"
MANIFEST = ROOT / "data" / "processed" / "sempertex-pilot-v001.json"
TARGET = 50


def select_diverse(records: list[dict], target: int) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        groups[str(record["productId"])].append(record)
    for values in groups.values():
        values.sort(key=lambda item: (item.get("imageIndex", 0), item["selectionId"]))

    selected: list[dict] = []
    round_index = 0
    product_ids = sorted(groups)
    while len(selected) < target:
        added = 0
        for product_id in product_ids:
            values = groups[product_id]
            if round_index < len(values):
                selected.append(values[round_index])
                added += 1
                if len(selected) >= target:
                    break
        if added == 0:
            break
        round_index += 1
    if len(selected) != target:
        raise SystemExit(f"Could only select {len(selected)}/{target} diverse records")
    return selected


def normalize_image(source_path: Path, output_path: Path) -> tuple[int, int, str]:
    with Image.open(source_path) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
        background = Image.new("RGBA", image.size, "white")
        background.alpha_composite(image)
        rgb = background.convert("RGB")
        if max(rgb.size) > 1536:
            scale = 1536 / max(rgb.size)
            rgb = rgb.resize((round(rgb.width * scale), round(rgb.height * scale)), Image.Resampling.LANCZOS)
        rgb.save(output_path, "JPEG", quality=93, optimize=True, progressive=True)
    payload = output_path.read_bytes()
    return rgb.width, rgb.height, hashlib.sha256(payload).hexdigest()


def main() -> None:
    database = json.loads(DATABASE.read_text(encoding="utf-8"))
    venues = [record for record in database["products"] if record["imageRole"] == "venue_scene"]
    assemblies = [
        record
        for record in database["products"]
        if record["imageRole"] == "assembled_decoration"
        and record["qualityStatus"] == "approved"
        and min(record["width"], record["height"]) >= 1024
    ]
    if len(venues) != 15:
        raise SystemExit(f"Expected 15 venue scenes, found {len(venues)}")
    selected = venues + select_diverse(assemblies, TARGET - len(venues))

    resolved_output = OUTPUT_DIR.resolve()
    if not resolved_output.is_relative_to(ROOT.resolve()) or resolved_output.name != "sempertex-pilot-v001":
        raise SystemExit(f"Unsafe output directory: {resolved_output}")
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)
    records: list[dict] = []
    for index, record in enumerate(selected, start=1):
        stem = f"sempertex-pilot-{index:03d}"
        image_name = f"{stem}.jpg"
        image_path = OUTPUT_DIR / image_name
        width, height, sha256 = normalize_image(ROOT / record["localImage"], image_path)
        if min(width, height) < 1024:
            raise SystemExit(f"Normalized image below 1024px: {image_name} ({width}x{height})")
        caption_path = OUTPUT_DIR / f"{stem}.txt"
        caption_path.write_text(record["caption"].strip() + "\n", encoding="utf-8")
        records.append({
            "id": stem,
            "sourceSelectionId": record["selectionId"],
            "sourceProductId": record["productId"],
            "role": record["imageRole"],
            "theme": record["theme"],
            "image": str(image_path.relative_to(ROOT)).replace("\\", "/"),
            "caption": str(caption_path.relative_to(ROOT)).replace("\\", "/"),
            "width": width,
            "height": height,
            "sha256": sha256,
            "triggerToken": "eventdecor_style_v1",
            "license": record["license"],
        })

    MANIFEST.write_text(json.dumps({
        "schemaVersion": 1,
        "datasetVersion": "sempertex-pilot-v001",
        "generatedAt": database["generatedAt"],
        "objective": "First FLUX.2 LoRA run focused on finished Sempertex decorations under a USD 2 budget.",
        "counts": {
            "total": len(records),
            "venueScenes": sum(record["role"] == "venue_scene" for record in records),
            "assembledDecorations": sum(record["role"] == "assembled_decoration" for record in records),
        },
        "normalization": {
            "format": "JPEG",
            "maximumLongSide": 1536,
            "minimumSourceShortSide": 1024,
            "metadataRemoved": True,
        },
        "training": {
            "endpoint": "fal-ai/flux-2-trainer-v2",
            "steps": 300,
            "estimatedCostUsd": 1.92,
            "triggerToken": "eventdecor_style_v1",
        },
        "records": records,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    with zipfile.ZipFile(OUTPUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file_path in sorted(OUTPUT_DIR.iterdir()):
            archive.write(file_path, arcname=file_path.name)
    with zipfile.ZipFile(OUTPUT_ZIP) as archive:
        names = archive.namelist()
        if len([name for name in names if name.endswith(".jpg")]) != TARGET or len([name for name in names if name.endswith(".txt")]) != TARGET:
            raise SystemExit("Pilot archive verification failed")
    print(json.dumps({
        "manifest": str(MANIFEST),
        "zip": str(OUTPUT_ZIP),
        "images": len(records),
        "captions": len(records),
        "bytes": OUTPUT_ZIP.stat().st_size,
    }))


if __name__ == "__main__":
    main()
