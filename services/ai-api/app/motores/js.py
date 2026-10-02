"""Semántica de JavaScript que Python no comparte, y la mezcla de colores.

No tiene gemelo en el motor: es el puente. Están aquí las diferencias que, si no se replican,
desvían el resultado sin que nada falle — el generador pseudoaleatorio de 32 bits, ``Math.round``,
``Math.floor`` con infinito, el resto de una división con negativos, ``toFixed`` y, sobre todo, **cómo escribe
JavaScript un número dentro de un texto**, que es lo que decide si el SVG sale idéntico o no.

Lo usan los tres motores migrados. Vivía dentro de ``app/columna``; se subió aquí al migrar el arco para que
no hubiera dos copias del puente, que es justo el archivo donde una diferencia no se nota hasta que el
resultado ya se desvió.
"""

from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable

# ---------------------------------------------------------------------------
# Semántica de JavaScript
# ---------------------------------------------------------------------------


def _u32(valor: int) -> int:
    """Los 32 bits bajos sin signo, que es lo que hace ``>>> 0``."""
    return valor & 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """``Math.imul``: multiplicación de 32 bits con signo."""
    producto = _u32(_u32(a) * _u32(b))
    return producto - 0x100000000 if producto >= 0x80000000 else producto


def crear_rng(semilla: float) -> Callable[[], float]:
    """``mulberry32``, el mismo generador del motor: misma semilla, mismo dibujo."""
    estado = _u32(int(_piso(semilla)))

    def siguiente() -> float:
        nonlocal estado
        estado = _u32(estado + 0x6D2B79F5)
        t = estado
        t = _u32(_imul(t ^ (t >> 15), t | 1))
        t = _u32(t ^ _u32(t + _u32(_imul(t ^ (t >> 7), t | 61))))
        return _u32(t ^ (t >> 14)) / 4294967296

    return siguiente


def _redondear(valor: float) -> float:
    """``Math.round``: el medio va hacia arriba, no al par."""
    if math.isnan(valor) or math.isinf(valor):
        return valor
    return float(math.floor(valor + 0.5))


def _piso(valor: float) -> float:
    """``Math.floor``, que con infinito devuelve infinito en vez de lanzar."""
    if math.isnan(valor) or math.isinf(valor):
        return valor
    return float(math.floor(valor))


def _techo(valor: float) -> float:
    """``Math.ceil``, que con infinito devuelve infinito en vez de lanzar."""
    if math.isnan(valor) or math.isinf(valor):
        return valor
    return float(math.ceil(valor))


def _minimo(a: float, b: float) -> float:
    """``Math.min`` de dos: con un NaN, NaN (el ``min`` de Python depende del orden)."""
    if math.isnan(a) or math.isnan(b):
        return math.nan
    return a if a < b else b


def _maximo(a: float, b: float) -> float:
    """``Math.max`` de dos, con la misma regla del NaN."""
    if math.isnan(a) or math.isnan(b):
        return math.nan
    return a if a > b else b


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return _minimo(maximo, _maximo(minimo, valor))


def _mod(a: float, n: float) -> float:
    """Módulo siempre positivo, construido con el resto de JavaScript (``fmod``)."""
    return math.fmod(math.fmod(a, n) + n, n)


def _resto(a: float, n: float) -> float:
    """El ``%`` de JavaScript tal cual: toma el signo del dividendo, como ``fmod``."""
    return math.fmod(a, n)


def _arriba(valor: float) -> float:
    """Al múltiplo de 5 cm de arriba."""
    return _techo(valor * 20 - 1e-9) / 20


def _abajo(valor: float) -> float:
    """Al múltiplo de 5 cm de abajo."""
    return _piso(valor * 20 + 1e-9) / 20


def _to_fixed(valor: float, decimales: int) -> str:
    """``toFixed``: redondeo del medio hacia arriba y siempre con todos los decimales."""
    cuantizado = Decimal(valor).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)
    return f"{cuantizado}"


def _coma(valor: float, decimales: int = 2) -> str:
    """``toFixed`` con coma decimal: es lo que leen los avisos."""
    return _to_fixed(valor, decimales).replace(".", ",")


def _es_finito(valor: object) -> bool:
    """``Number.isFinite``: un booleano no es un número y un texto tampoco."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return False
    return math.isfinite(float(valor))


def _numero(valor: float) -> str:
    """Un número escrito como lo escribe JavaScript dentro de un texto.

    Es la pieza con la que el SVG sale idéntico o no sale. Las tres diferencias con ``repr`` de Python:

    - un valor entero va sin decimales (``12``, no ``12.0``) y ``-0`` se escribe ``0``;
    - Python pasa a notación exponencial desde ``1e-5`` y JavaScript aguanta hasta ``1e-7``;
    - el exponente de JavaScript no lleva ceros a la izquierda (``1e-7``, no ``1e-07``).

    Los dígitos salen de ``repr``, que da la representación más corta que vuelve al mismo número, igual que
    JavaScript; lo único que se rehace aquí es dónde va la coma.
    """
    numero = float(valor)
    if math.isnan(numero):
        return "NaN"
    if math.isinf(numero):
        return "Infinity" if numero > 0 else "-Infinity"
    if numero == 0:
        return "0"
    if numero.is_integer() and abs(numero) < 1e21:
        return str(int(numero))

    signo = "-" if numero < 0 else ""
    digitos, exponente = _digitos_y_exponente(abs(numero))
    # `exponente` es la potencia de diez del primer dígito: 1.23e2 → dígitos "123", exponente 2.
    if -7 < exponente < 21:
        if exponente >= 0:
            entero = digitos[: exponente + 1].ljust(exponente + 1, "0")
            resto = digitos[exponente + 1 :]
            return f"{signo}{entero}.{resto}" if resto else f"{signo}{entero}"
        return f"{signo}0.{'0' * (-exponente - 1)}{digitos}"
    mantisa = digitos[0] if len(digitos) == 1 else f"{digitos[0]}.{digitos[1:]}"
    return f"{signo}{mantisa}e{'+' if exponente > 0 else '-'}{abs(exponente)}"


def _digitos_y_exponente(positivo: float) -> tuple[str, int]:
    """Los dígitos significativos de la representación más corta y la potencia de diez del primero."""
    texto = repr(positivo)
    if "e" in texto or "E" in texto:
        mantisa, _, exp = texto.lower().partition("e")
        exponente = int(exp)
    else:
        mantisa = texto
        exponente = 0
    entero, _, decimal = mantisa.partition(".")
    digitos = (entero + decimal).lstrip("0")
    # Cuántos ceros se quitaron por delante: cada uno baja el exponente del primer dígito.
    ceros = len(entero + decimal) - len(digitos)
    exponente += len(entero) - 1 - ceros
    return digitos.rstrip("0") or "0", exponente


# ---------------------------------------------------------------------------
# Color
# ---------------------------------------------------------------------------


def _canal(hexa: str, indice: int) -> int:
    return int(hexa[1 + 2 * indice : 3 + 2 * indice], 16)


def mezclar(a: str, b: str, t: float) -> str:
    """Mezcla dos colores: ``t = 0`` devuelve ``a``, ``t = 1`` devuelve ``b``."""
    peso = _acotar(t, 0, 1)

    def canal(indice: int) -> str:
        crudo = _canal(a, indice) + (_canal(b, indice) - _canal(a, indice)) * peso
        return f"{int(_redondear(crudo)):02x}"

    return f"#{canal(0)}{canal(1)}{canal(2)}"
