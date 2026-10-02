"""Las funciones matemáticas de JavaScript, no las de la libm del sistema.

**V8 no usa la libm del sistema para la trigonometría.** Lleva su propio puerto de fdlibm para ``sin``,
``cos``, ``atan``, ``atan2`` y ``exp``, y escribe ``hypot`` en JavaScript con suma de Kahan. CPython usa la
libm de la plataforma. Medido sobre 4000 valores al azar, difieren en el último bit: ``cos`` 96 veces,
``sin`` 85, ``atan2`` 698 e ``hypot`` 1434; ``exp``, 297 veces sobre el rango que pide el motor orgánico.
``sqrt`` no difiere nunca, porque IEEE-754 lo fija.

Un bit no se ve en el dibujo, pero sí se ve en el **orden**: los motores ordenan los globos por su profundidad
(``z``), y dos globos simétricos de la misma fila tienen una ``z`` que en teoría es idéntica y en coma
flotante no lo es. Con la libm del sistema, 12 de los 259 casos del arco intercambiaban dos globos. Por eso
aquí no se usa ``math``: se usa el puerto de ``ieee754.py``, que da el mismo bit que Node.

**``pow`` es la excepción, y conviene saber por qué.** V8 tiene dos implementaciones y elige con
``--use-std-math-pow``, **activada por defecto**: la de por defecto pone los casos especiales de JavaScript y
delega en el ``std::pow`` del CRT con el que se compiló Node; el puerto de fdlibm solo entra con
``--no-use-std-math-pow``. Las dos difieren entre sí en 331 de 4000 casos. Medido en este equipo, el ``**`` de
CPython coincide con el ``pow`` del sistema en los 4000, y Node se desvía de él en 11 (enlaza el CRT
estáticamente y se lleva el suyo).

O sea: **el ``Math.pow`` de Node no es reproducible desde Python, y tampoco es igual en Windows que en Linux**.
De las dos opciones imperfectas, ``pow`` de aquí usa el camino del sistema con la semántica de JavaScript
encima, que es el que falla 11 veces de 4000 en vez de 331. Los 259 vectores de oro del arco —que ejercitan
``Math.pow`` en la compensación de la curva de cada globo— pasan con él. La implementación de fdlibm queda
disponible como ``pow_fdlibm`` para quien necesite comparar.

Este módulo es la puerta: todos los motores importan de aquí, nunca de ``math`` ni de ``ieee754``
directamente. ``sqrt``, ``floor``, ``fabs``, ``pi`` y demás sí salen de ``math``, porque son exactos.
"""

from __future__ import annotations

import math
from math import ceil, copysign, e, fabs, floor, fmod, inf, isinf, isnan, nan, pi, sqrt, tau  # noqa: F401

from app.motores.ieee754 import atan, atan2, cos, exp, hypot, sin
from app.motores.ieee754 import pow as pow_fdlibm


def pow(base: float, exponente: float) -> float:  # noqa: A001
    """``Math.pow`` tal como lo evalúa Node con sus opciones por defecto.

    Los casos especiales son los de JavaScript, que no son los de C: ``Math.pow(x, 0)`` es ``1`` incluso con
    ``x`` igual a ``NaN``, y ``Math.pow(±1, ±Infinity)`` es ``NaN`` mientras que ``math.pow`` devuelve ``1``.
    El resto se delega en la potencia de la plataforma, que es lo que hace V8 cuando ``--use-std-math-pow``
    está activada, es decir, siempre salvo que se le diga lo contrario.
    """
    if exponente == 0:
        return 1.0
    if math.isnan(base) or math.isnan(exponente):
        return math.nan
    if abs(base) == 1 and math.isinf(exponente):
        return math.nan
    return float(base**exponente)


__all__ = [
    "atan",
    "atan2",
    "ceil",
    "copysign",
    "cos",
    "e",
    "exp",
    "fabs",
    "floor",
    "fmod",
    "hypot",
    "inf",
    "isinf",
    "isnan",
    "nan",
    "pi",
    "pow",
    "pow_fdlibm",
    "sin",
    "sqrt",
    "tau",
]
