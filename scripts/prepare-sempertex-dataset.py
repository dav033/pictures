from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "sempertex-v01"
SANITIZED = ROOT / "data" / "sanitized" / "sempertex-v01"
LICENSE_NAME = "sempertex-owned-public-ai-training"
APPROVAL = "explicit internal approval confirmed by user on 2026-08-13"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    without_marks = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", without_marks.lower()).strip("-")
    return slug or "image"


def license_record(source_name: str, original_hash: str | None = None) -> dict[str, object]:
    record: dict[str, object] = {
        "source": "sempertex-public-catalog",
        "license": LICENSE_NAME,
        "owner": "Sempertex",
        "approval": APPROVAL,
        "approved_uses": ["lora_training", "model_evaluation", "image_inference"],
        "original_file": source_name,
    }
    if original_hash:
        record["original_sha256"] = original_hash
    return record


def main() -> int:
    if not RAW.exists():
        print(f"No existe carpeta de entrada: {RAW}", file=sys.stderr)
        return 1

    SANITIZED.mkdir(parents=True, exist_ok=True)
    images = sorted(path for path in RAW.rglob("*") if path.is_file() and path.suffix.lower() in EXTENSIONS)
    used_names: set[str] = set()
    converted = 0
    licenses_created = 0
    skipped = 0
    errors: list[dict[str, str]] = []

    for source in images:
        source_hash = sha256(source)
        raw_license = source.with_name(f"{source.name}.license.json")
        if not raw_license.exists():
            raw_license.write_text(json.dumps(license_record(source.name), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            licenses_created += 1

        base_name = slugify(source.stem)
        output_name = base_name
        suffix = 2
        while output_name in used_names:
            output_name = f"{base_name}-{suffix}"
            suffix += 1
        used_names.add(output_name)
        destination = SANITIZED / f"{output_name}.png"
        destination_license = SANITIZED / f"{output_name}.png.license.json"

        if destination.exists() and destination_license.exists():
            skipped += 1
            continue

        try:
            with Image.open(source) as opened:
                opened.load()
                image = ImageOps.exif_transpose(opened)
                has_alpha = "A" in image.getbands() or (image.mode == "P" and "transparency" in image.info)
                normalized = image.convert("RGBA" if has_alpha else "RGB")
                normalized.save(destination, format="PNG", optimize=True, compress_level=6)
                output_hash = sha256(destination)
                destination_license.write_text(
                    json.dumps(
                        {
                            **license_record(source.name, source_hash),
                            "sanitized_file": destination.name,
                            "sanitized_sha256": output_hash,
                            "format": "PNG",
                            "metadata_removed": True,
                            "width": normalized.width,
                            "height": normalized.height,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                converted += 1
        except (UnidentifiedImageError, OSError, ValueError) as error:
            errors.append({"file": source.name, "error": str(error)[:240]})

    print(json.dumps({
        "input": str(RAW),
        "output": str(SANITIZED),
        "found": len(images),
        "converted": converted,
        "licenses_created": licenses_created,
        "skipped_existing": skipped,
        "errors": errors,
        "originals_changed": False,
        "output_format": "PNG",
    }, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
