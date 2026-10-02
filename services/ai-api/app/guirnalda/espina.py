"""La línea guía de una guirnalda: horizontal, con pendiente, ondulación y festones colgados.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/guirnalda/espina.ts``.

Dos cosas la separan de la del arco y las dos cambian el dibujo:

- ``grosor`` toma la fracción del largo **directamente** (el arco la pasa por ``pie``), con el perfil
  ``sen(π·u)^0,8`` y el ruido escalado por el largo: una guirnalda de 6 m ondula el doble de veces que una de 3 m.
- ``pie`` devuelve ``min(u, 1−u)``, **sin dividir por el largo**. Así ``baseza`` del motor vale 1 en los
  extremos y 0 en el centro, y con «grandes abajo» los globos grandes van a los EXTREMOS, no al suelo.

Las ocho fases llegan ya sorteadas, así que la forma de la línea no depende de ningún otro ajuste. De ellas se
usan ``fase[0]``, ``[1]``, ``[2]``, ``[4]``, ``[5]`` y ``[6]``: la ``[3]`` y la ``[7]`` son del arco y aquí se
consumen del generador igual, para no mover el resto de las tiradas.
"""

from __future__ import annotations

from typing import Any

from app.motores import mate
from app.motores.js import _maximo, _minimo, _resto
from app.organico.espina import N_PUNTOS, Espina, hacer_indice_en, medir, memorizar


def altura_guirnalda(f: dict[str, Any], t: float, fase: float = 0) -> float:
    """Altura de la línea guía (m) en la fracción ``t`` del largo, sin el temblor.

    El colgado es una parábola invertida **por festón**: 0 en los extremos de cada tramo y ``colgadoM`` en su
    mitad. Con un solo festón se usa ``t`` directamente, que solo cambia algo en ``t = 1``.
    """
    feston_u = _resto(t * f["festones"], 1) if f["festones"] > 1 else t
    colgado = f["colgadoM"] * 4 * feston_u * (1 - feston_u)
    # El 6,283 es el 2π aproximado que trae el original: cambiarlo por `tau` mueve la onda.
    onda = f["ondaM"] * mate.sin(2 * mate.pi * f["ondas"] * t + fase * 6.283)
    return float(f["alturaM"] + f["pendienteM"] * t + onda - colgado)


def crear_espina_guirnalda(cfg: dict[str, Any], fase: list[float]) -> Espina:
    """Línea guía de una guirnalda, de izquierda a derecha, y su perfil de grosor."""
    f = cfg["forma"]
    v = cfg["volumen"]
    L = f["largoM"]

    pts: list[tuple[float, float]] = []
    k2 = 3 + fase[1] * 2
    for i in range(N_PUNTOS + 1):
        t = i / N_PUNTOS
        # Un temblor muy suave que rompe la regularidad de la onda; el `sen(π t)` lo anula en los extremos.
        temblor = (
            0.012
            * _minimo(L, 6)
            * mate.sin(2 * mate.pi * k2 * t + fase[2] * 6.283)
            * mate.sin(mate.pi * t)
        )
        pts.append((L * t, _maximo(0.05, altura_guirnalda(f, t, fase[0]) + temblor)))

    puntos = medir(pts)
    largo = puntos[-1].s

    irreg = v["irregularidad"]
    escala_ruido = _maximo(1, L / 3)

    def grosor(fr: float) -> float:
        u = _minimo(1, _maximo(0, fr))
        h = mate.pow(mate.sin(mate.pi * u), 0.8)
        base = v["grosorPatasM"] + (v["grosorCimaM"] - v["grosorPatasM"]) * h
        # El lado cargado es más grueso: en u = 0 el factor es 1 − 0,28·carga y en u = 1, 1 + 0,28·carga.
        carga = 1 - 0.28 * f["carga"] * (1 - 2 * u)
        ruido = (
            0.5 * mate.sin(2 * mate.pi * (1.3 * u * escala_ruido) + fase[4] * 6.283)
            + 0.3 * mate.sin(2 * mate.pi * (2.9 * u * escala_ruido) + fase[5] * 6.283)
            + 0.2 * mate.sin(2 * mate.pi * (5.1 * u * escala_ruido) + fase[6] * 6.283)
        )
        # Suelo duro de 25 cm: por debajo no cabe ni un R9 y la banda deja de leerse.
        return float(_maximo(0.25, base * carga * (1 + irreg * 0.5 * ruido)))

    def pie(fr: float) -> float:
        u = _minimo(1, _maximo(0, fr))
        return float(_minimo(u, 1 - u))

    return Espina(
        puntos=puntos,
        largo=largo,
        # Una guirnalda no se corta ni se voltea: el largo armado es el completo.
        largoCompleto=largo,
        grosor=memorizar(grosor),
        pie=pie,
        indiceEn=hacer_indice_en(puntos, largo),
        fraCima=0.5,
        simetrica=True,
        xMin=0,
        xMax=L,
    )
