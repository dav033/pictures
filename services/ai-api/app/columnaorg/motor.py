"""Fachada del motor de columna orgánica: delega todo en el motor orgánico compartido.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columnaorg/motor.ts``.

Lo único propio es el encuadre: un lienzo **vertical** de 600 × 720 con la regla a la izquierda y, si se pide, la
persona de 1,70 m, y el globo grande de la punta. La separación entre ``disposicion_col`` (dónde va cada globo) y
``pintar_col`` (de qué color y cómo se ve) es la que hace que cambiar un color repinte sin volver a acomodar nada.
"""

from __future__ import annotations

from typing import Any, cast

from app.columnaorg.espina import crear_espina_columna
from app.columnaorg.tipos import ConfigCol
from app.motores.canonico import resolver_colores
from app.organico.motor import (
    Disposicion,
    OpcionesPintado,
    ResultadoOrg,
    crear_disposicion_en,
    pintar,
)

#: Lienzo vertical en el que se dibuja la columna.
LIENZO_COL = {"w": 600, "h": 720}


def disposicion_col(cfg: ConfigCol) -> Disposicion:
    """Dónde queda cada globo de la columna (no depende de los colores)."""
    return crear_disposicion_en(
        cast(dict[str, Any], cfg),
        lambda fase: crear_espina_columna(cast(dict[str, Any], cfg), fase),
    )


def pintar_col(cfg: ConfigCol, disp: Disposicion) -> ResultadoOrg:
    """Colores, adornos, globo grande de la punta, persona y regla sobre una disposición."""
    corona = cfg["corona"]
    return pintar(
        cast(dict[str, Any], cfg),
        disp,
        OpcionesPintado(
            lienzo=cast(dict[str, float], LIENZO_COL),
            referencia={"persona": cfg["forma"]["persona"]},
            # Diferencia deliberada con el original: `pintar` solo resuelve `cfg.colores`, así que una referencia del
            # catálogo (`sx:041`) como color del globo de la punta se dibujaba `#NaNNaNNaN`. Aquí se resuelve a `#rrggbb`.
            corona={
                "tamano": corona["tamano"],
                "color": cast(str, resolver_colores(corona["color"])),
            }
            if corona["activa"]
            else None,
        ),
    )


def pintar_miniatura(cfg: ConfigCol, disp: Disposicion) -> ResultadoOrg:
    """Miniatura: solo la columna, centrada, sin persona ni regla ni adornos."""
    sin_adornos = {**cfg, "adornos": {"follaje": 0, "flores": 0}}
    return pintar(
        cast(dict[str, Any], sin_adornos),
        disp,
        OpcionesPintado(lienzo=cast(dict[str, float], LIENZO_COL)),
    )


def generar_col(cfg: ConfigCol) -> ResultadoOrg:
    """Acomoda y pinta una columna de una sola vez."""
    return pintar_col(cfg, disposicion_col(cfg))
