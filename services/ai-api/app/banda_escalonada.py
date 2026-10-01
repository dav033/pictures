"""El empaquetado escalonado de una banda de globos: carriles y columnas.

Las filas de un arco clásico van **escalonadas**: las pares llevan ``n`` globos
y las impares ``n − 1``, corridas medio paso, que es lo que las hace encajar.
De ahí salen dos cosas que hay que mirar desde dos sitios distintos:

* la **columna** de un globo, que es fraccionaria (``carril + 0,5`` en las filas
  pares), y es con la que el motor de referencia decide el color
  (``clasificador-decoraciones/src/lib/arco/patrones.ts``);
* el **carril**, que es entera, y es con la que se indexa la rejilla del patrón.

Vive aparte de ``app.arco_clasico`` por una razón mecánica y una de fondo. La
mecánica: ``arco_clasico`` importa ``app.silueta``, que acaba importando
``app.patron_color``, así que el patrón no puede importar al motor sin cerrar un
ciclo. La de fondo: esto es geometría pura del empaquetado, no tiene
dependencias, y teniéndolo en un solo sitio la rejilla del patrón y el dibujo no
pueden separarse —que es exactamente lo que pasó cuando el patrón se escribió su
propio reparto.

``app.arco_clasico`` lo reexporta, así que quien ya lo importaba de allí sigue
igual.
"""

from __future__ import annotations

import math

__all__ = ["carril_de", "carril_sin_globo", "columna_de"]


def carril_de(columna: float, globos_ancho: int) -> int:
    """Carril de un globo según su columna, portado tal cual de ``carrilDe``.

    Un globo justo en el borde entre dos carriles (en las filas desfasadas) va
    al más externo en la mitad de fuera y al más interno en la mitad de dentro:
    bordes estables, sin motas sueltas.
    """
    borde = round(columna)
    if abs(columna - borde) < 1e-6 and 1 <= borde <= globos_ancho - 1:
        return borde - 1 if borde <= globos_ancho / 2 else borde
    return min(globos_ancho - 1, max(0, math.floor(columna)))


def columna_de(
    fila: int, carril: int, globos_ancho: int, escalonado: bool = True
) -> float | None:
    """La columna REAL del globo que está en esa fila y ese carril.

    Es la inversa de ``carril_de``, y existe porque el carril es un entero y la
    columna no: las filas pares van en ``carril + 0,5`` y las impares en
    enteros, y ese medio paso es justo lo que hace que una espiral se trence.
    El patrón del original se evalúa con esta columna, no con el carril;
    redondearla antes de pintar partía la diagonal.

    Devuelve ``None`` en la celda que una fila impar deja vacía: ahí no hay
    globo que pintar. Se deriva de ``carril_de`` en vez de escribir el reparto
    otra vez.

    Sin ``escalonado`` no hay medio paso ni celdas vacías: todas las filas son
    anillos iguales y cada carril tiene su globo en ``carril + 0,5``.
    """
    if not escalonado or fila % 2 == 0:
        return carril + 0.5 if 0 <= carril < globos_ancho else None
    for puesto in range(globos_ancho - 1):
        columna = puesto + 1.0
        if carril_de(columna, globos_ancho) == carril:
            return columna
    return None


def carril_sin_globo(globos_ancho: int, escalonado: bool = True) -> int | None:
    """El carril que se queda vacío en una fila impar, o ``None`` si ninguno.

    Las filas impares llevan un globo menos y van corridas, así que uno de los
    carriles no recibe globo en esas filas. Cuál es sale de ``carril_de``, que
    es quien reparte: no se escribe a mano en ninguna otra parte, porque
    entonces la rejilla del patrón y el dibujo podrían dejar de coincidir.
    """
    if not escalonado:
        # Anillos iguales: todas las filas van llenas, no sobra ninguna celda.
        return None
    ocupados = {carril_de(puesto + 1.0, globos_ancho) for puesto in range(globos_ancho - 1)}
    vacios = sorted(set(range(globos_ancho)) - ocupados)
    return vacios[0] if len(vacios) == 1 else None
