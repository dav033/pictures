"""La tabla de colores canónicos viaja con ``app/`` y el servicio importa fuera del repositorio.

La imagen de producción solo lleva ``services/ai-api``: ``contracts/`` no existe ahí. ``app/motores/canonico.py``
subía cuatro directorios hasta la raíz del repo y el contenedor no arrancaba (``IndexError`` al importar
``app.main``, 2026-10-02) sin que ningún test lo viera, porque todos corren con el repo entero al lado.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from app.motores import canonico

AI_API = Path(__file__).resolve().parents[1]
CONTRATO = AI_API.parents[1] / "contracts" / "domain" / "v1" / "sempertex" / "tabla-color.json"


def test_la_tabla_esta_dentro_de_app() -> None:
    assert canonico.TABLA.is_file()
    assert AI_API / "app" in canonico.TABLA.parents, (
        "la tabla debe viajar dentro de app/ para llegar a la imagen"
    )


def test_la_copia_es_identica_al_contrato() -> None:
    # En el repo completo la tabla del contrato es la dueña; la copia de app/ nunca puede quedarse atrás.
    if not CONTRATO.is_file():
        return
    assert json.loads(canonico.TABLA.read_text(encoding="utf-8")) == json.loads(
        CONTRATO.read_text(encoding="utf-8")
    )


def test_el_servicio_importa_sin_el_resto_del_repositorio(tmp_path: Path) -> None:
    """Lo mismo que hace el ``Dockerfile`` (``RUN APP_ENV=build ... import app.main``), pero en CI."""
    destino = tmp_path / "imagen" / "app"
    shutil.copytree(
        AI_API / "app",
        destino,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    entorno = {
        **os.environ,
        "APP_ENV": "build",
        "PYTHONPATH": str(destino.parent),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    # Importar no basta: la ruta vieja solo reventaba al importar si la imagen era poco profunda (``parents[4]``) y,
    # en cualquier otro sitio, al LEER la tabla. Se carga de verdad para que falle con cualquier profundidad.
    programa = (
        "import app.main; from app.motores import canonico; assert len(canonico._catalogo()) > 0"
    )
    resultado = subprocess.run(
        [sys.executable, "-c", programa],
        cwd=destino.parent,
        env=entorno,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert resultado.returncode == 0, resultado.stderr[-1500:]
