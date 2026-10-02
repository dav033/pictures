"""Tipos y valores de partida de una columna.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columna/tipos.ts``. El criterio se define allá;
aquí solo se replica. Ver ``app/armado_columna.py`` y ``docs/architecture/decisions/0033-motor-de-columna-migrado.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping

# ---------------------------------------------------------------------------
# Tipos y valores de partida (``tipos.ts``)
# ---------------------------------------------------------------------------

TamanoGlobo = int

TAMANOS_GLOBO: tuple[TamanoGlobo, ...] = (5, 9, 12, 18, 24, 36)
INFLADO_PULG: Mapping[TamanoGlobo, float] = {5: 4, 9: 8, 12: 10.5, 18: 14, 24: 20, 36: 30}

PATRON_IDS: tuple[str, ...] = (
    "solido",
    "apilado",
    "espiral",
    "rayas",
    "zigzag",
    "diamante",
    "punteado",
    "ombre",
    "aleatorio",
)

TIPOS_REMATE: tuple[str, ...] = ("ninguno", "globo", "racimo", "estrella", "corazon")

MAX_CAPAS = 60

COLORES_INICIALES: tuple[str, ...] = ("#1d4ed8", "#ffffff")

ModoColumna = Literal["altura", "capas"]


def diametro_m(tamano: TamanoGlobo, inflado: float = 1) -> float:
    """Diámetro (m) al que se infla un tamaño nominal."""
    return INFLADO_PULG[tamano] * inflado * 0.0254


@dataclass
class Columna:
    alto_m: float = 1.6
    globos_capa: float = 4
    abajo: TamanoGlobo = 12
    arriba: TamanoGlobo = 12
    escalonado: bool = True
    base: bool = True
    persona: bool = True


@dataclass
class Globo:
    inflado: float = 1
    tamano: float = 1.14
    compresion: float = 0.8
    variacion_tam: float = 0
    variacion_tono: float = 0.03
    desorden: float = 0
    brillo: float = 0.6
    sombra: float = 0.18
    contorno: float = 1
    profundidad: float = 0.55
    semilla: float = 7


@dataclass
class Remate:
    tipo: str = "globo"
    tamano: TamanoGlobo = 24
    cantidad: float = 5
    foil_m: float = 0.7
    color: str = "#ffffff"


@dataclass
class Real:
    desperdicio: float = 0.08
    precio: float = 0
    cantidad: float = 1


@dataclass
class CapaColumna:
    """Una capa de la columna por capas: el tamaño de sus globos y el color de cada uno."""

    tamano: TamanoGlobo
    colores: list[int]


@dataclass
class Config:
    modo: ModoColumna = "altura"
    capas: list[CapaColumna] = field(default_factory=list)
    patron: str = "espiral"
    columna: Columna = field(default_factory=Columna)
    globo: Globo = field(default_factory=Globo)
    remate: Remate = field(default_factory=Remate)
    real: Real = field(default_factory=Real)
    colores: list[str] = field(default_factory=lambda: list(COLORES_INICIALES))
    opciones: dict[str, dict[str, float]] = field(default_factory=dict)




def _copia(cfg: Config) -> Config:
    return Config(
        modo=cfg.modo,
        capas=[CapaColumna(tamano=k.tamano, colores=list(k.colores)) for k in cfg.capas],
        patron=cfg.patron,
        columna=Columna(**vars(cfg.columna)),
        globo=Globo(**vars(cfg.globo)),
        remate=Remate(**vars(cfg.remate)),
        real=Real(**vars(cfg.real)),
        colores=list(cfg.colores),
        opciones={pid: dict(ops) for pid, ops in cfg.opciones.items()},
    )
