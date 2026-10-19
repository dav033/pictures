"""Unir las líneas de conteo y de compra de un motor orgánico por material de la pieza.

El motor orgánico cuenta por **posición en su paleta**, y dos posiciones pueden ser el mismo material de la pieza: el
globo grande de la punta de una columna (índice ``−1``) y un color de la paleta, o dos entradas de la paleta de una
guirnalda con el mismo material y distinto acabado. Sin unirlas, el mismo material salía en dos filas de compra y
la pantalla, que supone una fila por material, repetía su clave. Compartido por las puertas de la columna y de la
guirnalda orgánicas. Las cantidades se suman y el total no cambia.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def unir_conteo(lineas: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """El conteo con una sola línea por material, tamaño y acabado.

    El motor cuenta por **posición en su paleta**, y el globo grande de la punta (índice ``−1``) y un color de la
    paleta pueden ser el mismo material de la pieza: sin unirlos, el mismo material, tamaño y acabado salía en dos
    líneas. Las cantidades se suman; el total no cambia.
    """
    unidas: dict[tuple[int, int, str], dict[str, Any]] = {}
    for linea in lineas:
        clave = (linea["material"], linea["tamano"], linea["acabado"])
        if clave in unidas:
            unidas[clave]["cantidad"] += linea["cantidad"]
        else:
            unidas[clave] = dict(linea)
    return list(unidas.values())


def unir_compra(filas: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """La compra con una sola fila por material, que es lo que el contrato y la pantalla suponen.

    Pasa lo mismo que en el conteo: el globo grande de la punta y un color de la paleta pueden ser el mismo material y
    el motor los lista aparte. Se suman la cantidad, lo que hay que comprar y lo que lleva de cada tamaño; como el total
    del motor es la suma de lo que hay que comprar de cada fila, ``total_comprar`` no se mueve.
    """
    unidas: dict[int, dict[str, Any]] = {}
    for fila in filas:
        previa = unidas.get(fila["material"])
        if previa is None:
            unidas[fila["material"]] = {**fila, "por_tamano": dict(fila["por_tamano"])}
            continue
        previa["cantidad"] += fila["cantidad"]
        previa["comprar"] += fila["comprar"]
        for tamano, cantidad in fila["por_tamano"].items():
            previa["por_tamano"][tamano] = previa["por_tamano"].get(tamano, 0) + cantidad
    return list(unidas.values())


__all__ = ["unir_compra", "unir_conteo"]
