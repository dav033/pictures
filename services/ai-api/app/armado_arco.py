"""Arco de globos: el motor, migrado 1 a 1 desde ``clasificador-decoraciones``.

Un arco es una banda de globos que sigue una línea guía —un semicírculo, un arco alto o una herradura— con
``globos_ancho`` globos a lo ancho y las filas escalonadas, como se arma de verdad. De ahí sale todo: el largo
real de la línea, el grosor de la banda, cuántos globos lleva, de qué color es cada uno, qué se compra y
**cómo se ve**.

**La fuente de verdad de esta lógica es el repo ``clasificador-decoraciones``** (``src/lib/arco/``). Este
módulo es la puerta de su puerto (``app/arco/``), no una segunda versión: cada función de allá tiene su gemela
aquí y ``tests/test_arco.py`` lo comprueba contra los vectores que genera
``scripts/migracion/vectores-arco.ts`` — globo por globo, aviso por aviso y sha del SVG por sha del SVG. Un
cambio de criterio se hace **allá primero**; aquí solo se replica y se vuelven a generar los vectores.

**Aquí sí entra el dibujo**, al revés que en la columna cuando se migró. Lo que el cliente aprueba es la
imagen, y el único que sabe dibujar un arco como el diseñador es el diseñador: si la gráfica se vuelve a
pintar en el cliente, hay dos motores y el que se ve no es el que se cobra. El SVG que sale de aquí es
derivado —no entra en el plan ni en ``plan_hash``—, así que se puede regenerar sin tocar nada aprobado.

El armado llega con **índices de material**, no con tonos: el plan es el dueño de qué color se compra. Para
traducir de vuelta cada globo a su material, el motor se alimenta dos veces: una con colores testigo
(``#000001``, ``#000002``…), que no se repiten aunque dos materiales tengan el mismo tono, y otra con los
colores de verdad, que es la que da el SVG. Las dos pasadas colocan los globos exactamente igual —el color no
mueve geometría ni consume azar distinto—, así que se pueden cruzar posición por posición.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast

from jsonschema import Draft7Validator

from app.arco.limites import ALTO_MAX, ALTO_MIN, ANCHO_MAX, ANCHO_MIN, limites
from app.arco.medidas import calcular_compra, calcular_medidas
from app.arco.motor import LIENZO, generar, svg_documento
from app.arco.patrones import PATRONES, normalizar_config_con_cambios
from app.arco.tipos import MAX_SECUENCIA_ARCO, PATRON_IDS, SECCION_M, TAMANOS_GLOBO, Config
from app.generated_models import contract_schema

VERSION = "armado-arco.v1"

#: Hasta cuántos colores admite un arco. Es el tope de la lista más larga de los patrones (el arcoíris) y el
#: mismo que la columna, para que una propuesta no cambie de tope según la pieza.
MAX_MATERIALES = 8

FORMAS = ("alto", "semi", "herradura")

#: Margen de compra cuando quien llama no dice otro. Es el del diseñador (`REAL_INICIAL`), para que una pieza
#: armada aquí y la misma pieza abierta allá den la misma lista de compra.
DESPERDICIO_POR_DEFECTO = 0.08


class ArmadoInvalido(ValueError):
    """Un armado de arco que no se puede armar o no corresponde a la pieza."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True)
class EstructuraArco:
    """La pieza del plan que lleva el armado, con lo poco que el motor necesita de ella.

    ``materiales`` son los colores de la estructura **en su orden**, ya resueltos a ``#rrggbb``: el catálogo
    lo hace antes y aquí un color es un tono y nada más.
    """

    es_arco: bool
    materiales: Sequence[str]


def _testigos(cuantos: int) -> list[str]:
    """Colores testigo con los que se alimenta el motor: uno por material del armado, en su orden.

    Así el color de un globo se traduce de vuelta a su índice **sin ambigüedad**, aunque dos materiales
    distintos tengan el mismo tono.
    """
    return [f"#{i + 1:06x}" for i in range(cuantos)]


def _entero(valor: object, motivo: str, mensaje: str) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int):
        raise ArmadoInvalido(motivo, mensaje)
    return valor


def _mapa(armado: Mapping[str, object], clave: str) -> Mapping[str, object]:
    valor = armado.get(clave)
    if not isinstance(valor, Mapping):
        raise ArmadoInvalido("forma_invalida", f"Al armado le falta {clave}.")
    return cast(Mapping[str, object], valor)


def _lista(valor: object) -> Sequence[object] | None:
    if isinstance(valor, Sequence) and not isinstance(valor, (str, bytes)):
        return cast(Sequence[object], valor)
    return None


_ESQUEMA_ARMADO: Mapping[str, object] = cast(
    Mapping[str, object],
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"]["armado_arco"],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)


def _validar_forma(armado: Mapping[str, object]) -> None:
    """Comprueba la forma contra el esquema publicado de ``armado-arco.v1``.

    La forma la valida el contrato, no una lista de comprobaciones a mano: el contrato se exporta desde el Zod
    de ``src/lib/plan/armado-arco.ts`` y repetirlo aquí sería un segundo dueño que se desincroniza en silencio.
    Lo que queda en este módulo son las reglas que un esquema no puede expresar —que el patrón elegido tenga
    bastantes colores, que cada índice exista en la pieza—, que son las que sí son suyas.
    """
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido("forma_invalida", f"El armado no tiene la forma de {VERSION}.")


def _indices_de_secuencias(armado: Mapping[str, object], clave: str, cuantos: int) -> None:
    """Las capas y las secciones nombran materiales por índice; comprueba que existan todos."""
    for numero, cruda in enumerate(cast(Sequence[object], armado[clave]), start=1):
        if cruda is None:
            continue
        colores = _lista(cruda)
        if colores is None or not colores:
            raise ArmadoInvalido(f"{clave}_invalidas", f"La {clave[:-1]} {numero} no dice de que color es.")
        if len(colores) > MAX_SECUENCIA_ARCO:
            raise ArmadoInvalido(
                f"{clave}_invalidas",
                f"La {clave[:-1]} {numero} usa mas de {MAX_SECUENCIA_ARCO} colores seguidos.",
            )
        for valor in colores:
            indice = _entero(valor, "material_invalido", f"La {clave[:-1]} {numero} nombra un color raro.")
            if indice < 0 or indice >= cuantos:
                raise ArmadoInvalido(
                    "material_fuera_de_rango",
                    f"La {clave[:-1]} {numero} usa un color que el armado no nombra.",
                )


def validar(estructura: EstructuraArco, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la pieza. Lanza ``ArmadoInvalido`` si no se sostiene."""
    if not estructura.es_arco:
        raise ArmadoInvalido("no_es_arco", "Solo un arco se arma como una banda sobre una linea guia.")
    _validar_forma(armado)
    if not estructura.materiales:
        raise ArmadoInvalido("sin_materiales", "El arco no lleva colores que armar.")
    materiales = cast(Sequence[object], armado["materiales"])
    indices = [_entero(m, "material_invalido", "Un color del armado no es un indice.") for m in materiales]
    if any(i < 0 or i >= len(estructura.materiales) for i in indices):
        raise ArmadoInvalido("material_fuera_de_rango", "El armado nombra un color que el arco no lleva.")
    patron = PATRONES[cast(str, armado["patron"])]
    minimo = patron.lista["min"] if patron.lista else len(patron.colores)
    if len(indices) < minimo:
        raise ArmadoInvalido(
            "pocos_materiales",
            f"El patron «{patron.nombre}» necesita al menos {minimo} colores y el armado trae {len(indices)}.",
        )
    _indices_de_secuencias(armado, "capas", len(indices))
    _indices_de_secuencias(armado, "secciones", len(indices))


def _secuencias(armado: Mapping[str, object], clave: str, colores: Sequence[str]) -> list[object]:
    """Las capas o secciones del armado traducidas a los colores que el motor entiende."""
    salida: list[object] = []
    for cruda in cast(Sequence[object], armado[clave]):
        if cruda is None:
            salida.append(None)
            continue
        indices = cast(Sequence[object], cruda)
        salida.append({"colores": [colores[cast(int, i)] for i in indices]})
    return salida


def _config_desde_armado(armado: Mapping[str, object], colores: Sequence[str]) -> tuple[Config, list[str]]:
    """El diseño del motor a partir del armado, con la lista de colores que se le quiera dar.

    Se llama dos veces: con los testigos, para poder volver de un globo a su material, y con los colores de
    verdad, para el dibujo.
    """
    patron = cast(str, armado["patron"])
    geometria = _mapa(armado, "geometria")
    globo = _mapa(armado, "globo")
    crudo: dict[str, object] = {
        "patron": patron,
        "geometria": dict(geometria),
        "globo": dict(globo),
        "colores": {patron: list(colores)},
        "opciones": {patron: dict(_mapa(armado, "opciones"))},
        "capas": _secuencias(armado, "capas", colores),
        "secciones": _secuencias(armado, "secciones", colores),
    }
    cfg, cambios = normalizar_config_con_cambios(crudo)
    return cfg, list(cambios)


def armado_resuelto(
    estructura: EstructuraArco, armado: Mapping[str, object], desperdicio: float = DESPERDICIO_POR_DEFECTO
) -> dict[str, Any]:
    """El arco resuelto: cada globo colocado, el conteo, la compra, los avisos y el dibujo.

    Los globos salen ordenados de atrás hacia adelante, que es el orden en el que hay que pintarlos. El SVG
    viene del mismo motor que los colocó, así que la gráfica no recalcula nada: la muestra.
    """
    validar(estructura, armado)
    materiales = [
        _entero(m, "material_invalido", "Un color del armado no es un indice.")
        for m in cast(Sequence[object], armado["materiales"])
    ]
    testigos = _testigos(len(materiales))
    reales = [estructura.materiales[i] for i in materiales]

    cfg_testigo, cambios = _config_desde_armado(armado, testigos)
    res = generar(cfg_testigo)
    # El dibujo con los colores de verdad. La geometría es la misma: el color no mueve ningún globo ni cambia
    # cuántas veces se tira el azar, y el saneado trabaja sobre la geometría, no sobre la lista de colores.
    cfg_real, _ = _config_desde_armado(armado, reales)
    dibujo = generar(cfg_real, datos=True)

    de_testigo = {testigo: materiales[i] for i, testigo in enumerate(testigos)}
    medidas = calcular_medidas(res)
    # El desperdicio es política del plan, no del armado: el armado dice cómo se arma la pieza y el plan
    # cuánto de más se compra. Por eso entra por parámetro y no viaja dentro de `armado-arco.v1`.
    compra = calcular_compra(res, desperdicio)

    return {
        "version": VERSION,
        "globos": [
            {
                "x": b.x,
                "y": b.y,
                "rx": b.rx,
                "ry": b.ry,
                "rot": b.rot,
                "material": de_testigo.get(b.base, -1),
                "fila": b.fila,
                "carril": b.carril,
                "seccion": b.banda,
                "prof": b.prof,
            }
            for b in res.globos
        ],
        "filas": res.filas,
        "columnas": res.columnas,
        "secciones": res.secciones,
        "ancho_m": res.anchoM,
        "alto_m": res.altoM,
        "grosor_m": res.grosorM,
        "largo_m": res.largoM,
        "diametro_m": res.diametroM,
        "globos_por_metro": medidas["globosPorMetro"],
        "formula_clasica": medidas["formulaClasica"],
        "conteo": [
            {"material": de_testigo.get(cast(str, e["color"]), -1), "cantidad": e["cantidad"]}
            for e in res.conteo
        ],
        "compra": [
            {
                "material": de_testigo.get(cast(str, linea["color"]), -1),
                "cantidad": linea["cantidad"],
                "comprar": linea["comprar"],
            }
            for linea in cast(Sequence[Mapping[str, object]], compra["lineas"])
        ],
        "total_comprar": compra["total"],
        "avisos": [*cambios, *res.avisos],
        "desperdicio": desperdicio,
        # Derivado: el SVG no entra en el plan ni en `plan_hash`. Se regenera cuando haga falta.
        "grafica": {"lienzo": LIENZO, "svg": dibujo.svg, "documento": svg_documento(dibujo.svg)},
        "config_saneada": cfg_testigo,
    }


def opciones_admitidas() -> dict[str, Any]:
    """Lo que el editor y la IA pueden ofrecer: patrones con sus mandos, formas, tamaños y rangos.

    Sale del motor y no de una lista escrita a mano: si allá se añade un patrón o cambia un rango, aquí se ve
    sin tocar nada. Es la lista de herramientas que la IA puede usar libremente.
    """
    return {
        "formas": list(FORMAS),
        "patrones": [
            {
                "id": pid,
                "nombre": PATRONES[pid].nombre,
                "descripcion": PATRONES[pid].descripcion,
                "roles": PATRONES[pid].roles,
                "lista": PATRONES[pid].lista,
                "min_colores": PATRONES[pid].lista["min"] if PATRONES[pid].lista else len(PATRONES[pid].colores),
                "max_colores": PATRONES[pid].lista["max"] if PATRONES[pid].lista else len(PATRONES[pid].colores),
                "controles": [
                    {
                        "clave": c["clave"],
                        "etiqueta": c["etiqueta"],
                        "min": c["min"],
                        "max": c["max"],
                        "paso": c["paso"],
                        "defecto": c["def_"],
                        **({"interruptor": True} if c.get("interruptor") else {}),
                        **({"seleccion": c["seleccion"]} if c.get("seleccion") else {}),
                        **({"ayuda": c["ayuda"]} if c.get("ayuda") else {}),
                    }
                    for c in PATRONES[pid].controles
                ],
            }
            for pid in PATRON_IDS
        ],
        "tamanos": list(TAMANOS_GLOBO),
        "ancho_m": {"min": ANCHO_MIN, "max": ANCHO_MAX},
        "alto_m": {"min": ALTO_MIN, "max": ALTO_MAX},
        "max_materiales": MAX_MATERIALES,
        "max_secuencia": MAX_SECUENCIA_ARCO,
        "seccion_m": SECCION_M,
    }


def limites_de(armado: Mapping[str, object], estructura: EstructuraArco) -> dict[str, float]:
    """Los rangos que la interfaz puede ofrecer con este armado puesto (el ancho mínimo sube con el globo)."""
    validar(estructura, armado)
    testigos = _testigos(len(cast(Sequence[object], armado["materiales"])))
    return dict(limites(_config_desde_armado(armado, testigos)[0]))
