"""Lo que ningún esquema JSON comprueba y todas las puertas de los motores exigen igual.

``NaN`` e infinito llegan por JSON (Python los acepta al leer el cuerpo) y pasan el esquema: ``jsonschema`` compara
``NaN < mínimo`` y ``NaN > máximo`` y ambas dan falso, así que un ``altoM`` en ``NaN`` parecía dentro de rango. El
motor lo digería sin error y devolvía una columna que no corresponde a ningún alto. Cada puerta lo rechaza con su
propio ``ArmadoInvalido`` y su frase, para que el cliente reciba un 422 estable y no un dibujo inventado.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

#: La frase y el motivo estables que publican todas las puertas.
MOTIVO_NO_FINITO = "numero_no_finito"
MENSAJE_NO_FINITO = "El armado trae un número que no es válido (no es finito): revisa los valores."


def hay_numero_no_finito(valor: object) -> bool:
    """Si el armado trae, en cualquier nivel, un número que no es finito (``NaN`` o infinito)."""
    if isinstance(valor, float):
        return not math.isfinite(valor)
    if isinstance(valor, Mapping):
        return any(hay_numero_no_finito(hijo) for hijo in valor.values())
    if isinstance(valor, Sequence) and not isinstance(valor, (str, bytes)):
        return any(hay_numero_no_finito(hijo) for hijo in valor)
    return False


__all__ = ["MENSAJE_NO_FINITO", "MOTIVO_NO_FINITO", "hay_numero_no_finito"]
