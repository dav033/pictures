"""Costo estimado, tope duro por corrida y registro de gasto de los embeddings de la biblioteca.

Las cifras salen de ``research-embeddings.md`` (REQ-002): texto $0,20 por millón de tokens y ~$0,00012 por imagen
con ``gemini-embedding-2``. Son estimaciones para frenar antes de gastar, no la factura.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

CARACTERES_POR_TOKEN = 3.5
USD_POR_MILLON_TOKENS_TEXTO = 0.20
USD_POR_IMAGEN = 0.00012


def tokens_estimados(texto: str) -> int:
    return max(1, math.ceil(len(texto) / CARACTERES_POR_TOKEN))


def usd_de_tokens(tokens: int) -> float:
    return tokens * USD_POR_MILLON_TOKENS_TEXTO / 1_000_000


class TopeExcedido(Exception):
    """El gasto estimado pasaría el tope de la corrida."""


@dataclass
class Presupuesto:
    """Tope duro: ``reservar`` antes de cada llamada, ``confirmar`` si salió bien, ``liberar`` si no."""

    tope_usd: float
    gastado_usd: float = 0.0
    reservado_usd: float = 0.0
    agotado: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        if self.tope_usd <= 0:
            raise ValueError("TOPE_USD_DEBE_SER_POSITIVO")

    def reservar(self, usd: float) -> bool:
        if self.gastado_usd + self.reservado_usd + usd > self.tope_usd + 1e-12:
            self.agotado = True
            return False
        self.reservado_usd += usd
        return True

    def confirmar(self, usd: float) -> None:
        self.reservado_usd = max(0.0, self.reservado_usd - usd)
        self.gastado_usd += usd

    def liberar(self, usd: float) -> None:
        self.reservado_usd = max(0.0, self.reservado_usd - usd)


class RegistroGasto:
    """JSONL de gasto (ts, modelo, modalidad, unidades, usd_estimado, run_id) que importará el libro de gasto (REQ-004)."""

    def __init__(self, ruta: Path, run_id: str, modelo: str) -> None:
        self._ruta = ruta
        self._run_id = run_id
        self._modelo = modelo

    def registrar(self, modalidad: str, unidades: int, usd_estimado: float, unidad: str) -> None:
        if unidades <= 0:
            return
        self._ruta.parent.mkdir(parents=True, exist_ok=True)
        linea = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "modelo": self._modelo,
            "modalidad": modalidad,
            "unidades": unidades,
            "unidad": unidad,
            "usd_estimado": round(usd_estimado, 8),
            "run_id": self._run_id,
        }
        with self._ruta.open("a", encoding="utf-8") as archivo:
            archivo.write(json.dumps(linea, ensure_ascii=False) + "\n")
