"""Valida y empaqueta el dataset v005 de 300 imágenes para fal.ai."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "data" / "staging" / "recaption-v005"
IMAGES = DATASET_ROOT / "original"
CAPTIONS = DATASET_ROOT / "nuevo"
OUTPUT_ZIP = ROOT / "data" / "staging" / "sempertex-general-v005-300-fal.zip"
CONFIG = DATASET_ROOT / "entrenamiento.config.json"
MANIFEST = DATASET_ROOT / "empaquetado-300.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
TRIGGER = "eventdecor_style_v2"
FORBIDDEN = re.compile(
    r"\b(?:lighting|lit|glow|soft|warm|bright|ambience|mood|atmosphere|photo|"
    r"photograph|photorealistic|camera|quality|aesthetic|left|right)\b",
    re.IGNORECASE,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    if OUTPUT_ZIP.exists():
        raise SystemExit(f"Ya existe el ZIP de salida: {OUTPUT_ZIP}")

    images = sorted(path for path in IMAGES.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)
    if len(images) != 300:
        raise SystemExit(f"Se esperaban 300 imágenes, encontradas {len(images)}")

    names: set[str] = set()
    for image in images:
        stem = image.stem
        if stem in names:
            raise SystemExit(f"Nombre base duplicado: {stem}")
        names.add(stem)
        caption = CAPTIONS / f"{stem}.txt"
        if not caption.exists():
            raise SystemExit(f"Falta caption para {image.name}")
        text = caption.read_text(encoding="utf-8").strip()
        if not text.startswith(f"{TRIGGER},"):
            raise SystemExit(f"Trigger incorrecto en {caption.name}")
        forbidden = sorted(set(match.group(0).lower() for match in FORBIDDEN.finditer(text)))
        if forbidden:
            raise SystemExit(f"Palabras prohibidas en {caption.name}: {', '.join(forbidden)}")

    OUTPUT_ZIP.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for image in images:
            archive.write(image, image.name)
            archive.write(CAPTIONS / f"{image.stem}.txt", f"{image.stem}.txt")

    with zipfile.ZipFile(OUTPUT_ZIP) as archive:
        members = [Path(name).name for name in archive.namelist()]
        archived_images = [name for name in members if Path(name).suffix.lower() in IMAGE_SUFFIXES]
        archived_captions = [name for name in members if Path(name).suffix.lower() == ".txt"]
        if len(archived_images) != 300 or len(archived_captions) != 300:
            raise SystemExit(f"ZIP inválido: {len(archived_images)} imágenes, {len(archived_captions)} captions")

    config = {
        "dataset": {
            "zip": "data/staging/sempertex-general-v005-300-fal.zip",
            "imagenes": 300,
            "trigger": TRIGGER,
            "origen": "data/staging/recaption-v005/seleccion-300.json",
        },
        "trainer": {
            "endpoint": "https://queue.fal.run/fal-ai/flux-2-trainer",
            "output_lora_format": "fal",
        },
        "corridas": [{"id": "v005-1000", "steps": 1000, "learning_rate": 0.00005}],
        "evaluacion": {
            "escalas_a_probar": [0.8, 1.0],
            "costo_estimado_usd_por_corrida_y_escala": 0.2,
        },
        "criterio_de_aceptacion": {
            "composicion_minima": "5/6 a lora_scale 0,8",
        },
    }
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MANIFEST.write_text(
        json.dumps(
            {
                "version": 1,
                "imagenes": 300,
                "captions": 300,
                "zip": str(OUTPUT_ZIP.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256(OUTPUT_ZIP),
                "config": str(CONFIG.relative_to(ROOT)).replace("\\", "/"),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"zip": str(OUTPUT_ZIP.relative_to(ROOT)), "imagenes": 300, "captions": 300, "config": str(CONFIG.relative_to(ROOT))}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
