"""Colores canónicos de Sempertex dentro de un diseño: ``sx:041`` en vez de ``#001489``.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/colores/canonico.ts``. Un ``#001489`` es un color de
pantalla: no se puede pedir ni cotizar, y si algún día se corrige la conversión de PMS a sRGB los diseños
guardados se quedan apuntando al tono viejo. ``sx:041`` es la referencia del fabricante, que es lo que de
verdad quiso decir quien diseñó.

Los motores dibujan con hexadecimales y no saben nada de esto: cada ``generar`` llama a ``resolver_colores``
en su primera línea y de ahí para abajo todo es ``#rrggbb``.

**El hexadecimal con el que se dibuja es el de la tinta** (``hexTinta``, la conversión del PMS), no el del
globo inflado. Es lo que hace el motor original y por eso se copia tal cual: el color del globo medido
(``hexGlobo``) sirve para reconocer un color en una foto, no para dibujar el diseño.

La tabla la genera el repo dueño (``scripts/migracion/tabla-color-sempertex.ts``) y llega a
``contracts/domain/v1/sempertex/tabla-color.json``: aquí no se escribe ningún color a mano.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

#: El prefijo que marca una referencia del catálogo.
PREFIJO = "sx:"

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

#: La copia de la tabla que viaja DENTRO de ``app/``: la imagen de producción solo lleva ``services/ai-api``, así
#: que desde ahí no existe ``contracts/``. Antes la ruta subía cuatro directorios hasta la raíz del repo y la
#: imagen no arrancaba (``IndexError`` al importar, 2026-10-02). ``tests/test_canonico_tabla.py`` exige que sea
#: idéntica a la del contrato, así que no se puede quedar atrás sin que CI lo diga.
TABLA = Path(__file__).resolve().with_name("tabla-color.json")


@lru_cache(maxsize=1)
def _catalogo() -> dict[str, dict[str, Any]]:
    crudo = json.loads(TABLA.read_text(encoding="utf-8"))
    return {str(r["codigo"]): r for r in crudo["referencias"]}


def es_canonico(valor: object) -> bool:
    """Si el valor es una referencia del catálogo (no comprueba que el código exista)."""
    return isinstance(valor, str) and valor.startswith(PREFIJO)


def es_hex(valor: object) -> bool:
    return isinstance(valor, str) and bool(_HEX.match(valor))


def canonico(codigo: str) -> str:
    """La referencia canónica de un código: ``041`` → ``sx:041``."""
    return f"{PREFIJO}{codigo}"


def codigo_de(valor: object) -> str | None:
    """El código de una referencia canónica, o ``None`` si es un hexadecimal libre o el código no existe."""
    if not es_canonico(valor):
        return None
    codigo = str(valor)[len(PREFIJO) :]
    return codigo if codigo in _catalogo() else None


def color_de(valor: object) -> dict[str, Any] | None:
    """La referencia del catálogo a la que apunta el valor, o ``None`` si es un hexadecimal libre."""
    codigo = codigo_de(valor)
    return None if codigo is None else _catalogo()[codigo]


def hex_de(valor: object, respaldo: str = "#9ca3af") -> str:
    """El hexadecimal con el que se dibuja un valor de color, sea del tipo que sea."""
    if not isinstance(valor, str):
        return respaldo
    if _HEX.match(valor):
        return valor.lower()
    color = color_de(valor)
    return str(color["hexTinta"]) if color else respaldo


def resolver_colores(valor: Any) -> Any:
    """La misma estructura con toda referencia ``sx:`` cambiada por su hexadecimal.

    Recorre el objeto entero en vez de conocer los campos de cada config a propósito: los motores guardan los
    colores en sitios distintos (``colores.espiral[]``, ``secciones[].colores[]``, ``colores.lista[].hex``…) y
    una función por motor serían varios sitios donde se puede olvidar uno. El prefijo ``sx:`` no aparece en
    ningún otro campo, así que recorrer todo es seguro.
    """
    if isinstance(valor, str):
        return hex_de(valor) if es_canonico(valor) else valor
    if isinstance(valor, list):
        return [resolver_colores(v) for v in valor]
    if isinstance(valor, tuple):
        return tuple(resolver_colores(v) for v in valor)
    if isinstance(valor, dict):
        return {k: resolver_colores(v) for k, v in valor.items()}
    return valor


def es_translucido(valor: object) -> bool:
    """Si el valor es un globo de la familia Cristal, que deja ver lo que tiene detrás."""
    color = color_de(valor)
    return bool(color and color.get("familia") == "cristal")


def hexes_translucidos(valor: Any, salida: set[str] | None = None) -> set[str]:
    """Los hexadecimales de una config que vienen de una referencia translúcida.

    Se calcula **antes** de resolver: después solo quedan hexadecimales y se pierde de qué familia venía cada
    color, que es justo lo que el dibujo necesita saber para pintar un cristal como cristal.
    """
    acumulado: set[str] = set() if salida is None else salida
    if isinstance(valor, str):
        if es_translucido(valor):
            acumulado.add(hex_de(valor))
        return acumulado
    if isinstance(valor, (list, tuple)):
        for v in valor:
            hexes_translucidos(v, acumulado)
        return acumulado
    if isinstance(valor, dict):
        for v in valor.values():
            hexes_translucidos(v, acumulado)
    return acumulado


def etiqueta_valor(valor: object) -> str:
    """Cómo se escribe un valor de color para leerlo: ``SX 041`` o el hexadecimal en mayúsculas."""
    codigo = codigo_de(valor)
    return f"SX {codigo}" if codigo else str(valor or "").upper()


def valores_catalogo() -> list[str]:
    """Todos los valores canónicos del catálogo, para las pruebas y para los selectores."""
    return [canonico(c) for c in _catalogo()]
