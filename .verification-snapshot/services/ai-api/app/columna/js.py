"""El puente con la semántica de JavaScript, que ahora comparten los tres motores migrados.

Vivía aquí entero. Al migrar el arco pasó a ``app/motores/js.py``: era el mismo puente palabra por palabra y
tener dos copias de este archivo en concreto es la peor duplicación posible, porque una diferencia entre ellas
no rompe nada — solo desvía el resultado. Este módulo se queda como la puerta de la columna para no tocar sus
importaciones ni sus vectores de oro.
"""

from __future__ import annotations

from app.motores.js import (  # noqa: F401
    _abajo,
    _acotar,
    _arriba,
    _canal,
    _coma,
    _es_finito,
    _imul,
    _maximo,
    _minimo,
    _mod,
    _numero,
    _piso,
    _redondear,
    _techo,
    _to_fixed,
    _u32,
    crear_rng,
    mezclar,
)

__all__ = [
    "_abajo",
    "_acotar",
    "_arriba",
    "_canal",
    "_coma",
    "_es_finito",
    "_imul",
    "_maximo",
    "_minimo",
    "_mod",
    "_numero",
    "_piso",
    "_redondear",
    "_techo",
    "_to_fixed",
    "_u32",
    "crear_rng",
    "mezclar",
]
