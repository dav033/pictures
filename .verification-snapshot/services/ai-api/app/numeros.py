"""Lectura tolerante de números del plan y del catálogo: un valor que no es un número finito es ``None``."""

from __future__ import annotations

from decimal import Decimal
from math import isfinite


def numero(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if isfinite(number) else None


def entero(value: object) -> int | None:
    number = numero(value)
    return int(number) if number is not None and number.is_integer() else None


__all__ = ["entero", "numero"]
