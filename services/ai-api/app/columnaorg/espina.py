"""La línea guía de una columna orgánica: vertical desde el suelo, con inclinación, serpenteo en S y temblor.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columnaorg/espina.ts``.

La punta se puede correr de lado (inclinación), la línea puede serpentear en S y temblar un poco, y el grosor va del
de la base al de la punta con abultamientos suaves. Las ocho fases llegan ya sorteadas, así que la forma de la
línea no depende de ningún otro ajuste. De ellas se usan ``fase[0]`` a ``[6]``.

Dos cosas la separan de la del arco y de la guirnalda y las dos cambian el dibujo:

- **La línea termina medio globo antes del alto pedido** (``H = max(0,3, alto − grosorCima / 2)``): con los globos
  de la punta, la columna mide lo que se pidió.
- ``pie`` devuelve ``min(1, max(0, fr)) · 0,5``: la base es 0 (los globos grandes) y la punta 0,5.
"""

from __future__ import annotations

from typing import Any

from app.motores import mate
from app.motores.js import _maximo, _minimo
from app.organico.espina import N_PUNTOS, Espina, hacer_indice_en, medir, memorizar


def crear_espina_columna(cfg: dict[str, Any], fase: list[float]) -> Espina:
    """Línea guía de una columna, de la base a la punta, y su perfil de grosor."""
    f = cfg["forma"]
    v = cfg["volumen"]
    # La línea guía termina medio globo antes del alto pedido: con los globos de la punta, la columna mide lo que
    # se pidió.
    H = _maximo(0.3, f["altoM"] - v["grosorCimaM"] * 0.5)

    k1 = 2 + fase[0] * 2
    k2 = 4 + fase[1] * 3
    amp = f["ondulacion"] * 0.035 * H
    pts: list[tuple[float, float]] = []
    for i in range(N_PUNTOS + 1):
        t = i / N_PUNTOS
        base = _minimo(1, t * 5)  # la base no se mueve
        x = (
            f["inclinacionM"] * mate.pow(t, 1.6)
            + f["serpenteoM"] * mate.sin(2 * mate.pi * t) * base
            + amp
            * base
            * (
                0.7 * mate.sin(2 * mate.pi * k1 * t + fase[2] * 6.283)
                + 0.3 * mate.sin(2 * mate.pi * k2 * t + fase[3] * 6.283)
            )
        )
        pts.append((x, H * t))

    puntos = medir(pts)
    largo = puntos[-1].s

    irreg = v["irregularidad"]

    def grosor(fr: float) -> float:
        u = _minimo(1, _maximo(0, fr))
        # De la base a la punta: se afina más rápido al principio, como una columna que pasa de «pila» a «tallo».
        base = v["grosorPatasM"] + (v["grosorCimaM"] - v["grosorPatasM"]) * mate.pow(u, 0.85)
        ruido = (
            0.5 * mate.sin(2 * mate.pi * (1.6 * u) + fase[4] * 6.283)
            + 0.3 * mate.sin(2 * mate.pi * (3.1 * u) + fase[5] * 6.283)
            + 0.2 * mate.sin(2 * mate.pi * (5.3 * u) + fase[6] * 6.283)
        )
        return float(_maximo(0.25, base * (1 + irreg * 0.5 * ruido)))

    def pie(fr: float) -> float:
        # Para el reparto de tamaños, «0» es la base (grandes) y «0,5» la punta.
        return float(_minimo(1, _maximo(0, fr)) * 0.5)

    return Espina(
        puntos=puntos,
        largo=largo,
        largoCompleto=largo,
        grosor=memorizar(grosor),
        pie=pie,
        indiceEn=hacer_indice_en(puntos, largo),
        fraCima=0.98,
        simetrica=True,
        yMax=f["altoM"],
    )
