"""Columna de globos: el motor, migrado 1 a 1 desde ``clasificador-decoraciones``.

Una columna es una pila de capas. En cada capa, ``globos_capa`` globos (4 = el
cuarteto clásico) forman un anillo, y cada capa se gira medio paso respecto a
la de abajo para que los globos se acomoden en los huecos de la capa anterior.
De ahí sale todo: la altura real, el diámetro, cuántos globos lleva, de qué
color es cada uno y qué se compra.

**La fuente de verdad de esta lógica es el repo ``clasificador-decoraciones``**
(``src/lib/columna/``: ``tipos.ts``, ``patrones.ts``, ``motor.ts``,
``limites.ts``, ``medidas.ts``). Este módulo es su puerto, no una segunda
versión: cada función de aquí tiene su gemela allá y ``tests/test_armado_columna.py``
lo comprueba contra los vectores que genera
``clasificador-decoraciones/scripts/migracion/vectores-columna.ts`` — globo por
globo, color por color, aviso por aviso. Un cambio de criterio se hace **allá
primero**; aquí solo se replica y se vuelven a generar los vectores.

Lo que NO entra, a propósito:

- **El dibujo.** El SVG, la escala, el lienzo, la persona de 1,70 m y la regla
  son pantalla, y en ``pictures`` los pinta su propio componente. Aquí está
  dónde va cada globo (x, y, z en metros, radio y profundidad), que es lo que
  el dibujo necesita y lo único que se puede verificar sin mirar píxeles.
- **Resolver un color del catálogo.** Un ``sx:041`` lo resuelve la tabla de
  Sempertex antes de llegar aquí (en un plan, los colores son índices de
  ``materiales``). Este módulo solo ve ``#rrggbb``.

Las trampas de paridad que hubo que replicar a mano, porque Python y
JavaScript no coinciden:

- El generador pseudoaleatorio (``mulberry32``) es aritmética de 32 bits sin
  signo con ``Math.imul``; en Python hay que enmascarar a mano.
- ``Math.round`` redondea el medio hacia arriba (``-0,5 → 0``); el ``round``
  de Python redondea al par.
- ``Math.floor`` y ``Math.ceil`` admiten infinito; los de Python lanzan.
- El resto de una división con negativos: JavaScript conserva el signo del
  dividendo (``-1 % 4 == -1``), Python el del divisor (``-1 % 4 == 3``). Por
  eso el módulo va con ``math.fmod``.
- ``toFixed`` redondea el medio alejándose del cero sobre el valor exacto del
  doble; el formato de Python redondea al par. Los avisos llevan números, así
  que la diferencia se vería en el texto.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence, cast

from app.columna.js import crear_rng, mezclar
from app.columna.limites import (
    ALTO_MAX,
    ALTO_MIN,
    GLOBOS_CAPA_MAX,
    GLOBOS_CAPA_MIN,
    MAX_GLOBOS,
    Limites,
    config_inicial,
    diametro_de_columna,
    es_hex,
    limites,
    normalizar_color,
    normalizar_config,
    normalizar_config_con_cambios,
    sanear,
)
from app.columna.medidas import Compra, FilaCompra, Medidas, calcular_compra, calcular_medidas
from app.columna.motor import (
    BASE_ALTO_M,
    Capa,
    GloboCol,
    RemateResumen,
    Resultado,
    capas_de,
    capas_desde_altura,
    crear_capas,
    crear_capas_manuales,
    diametro_columna,
    es_por_capas,
    generar,
    radio_anillo,
    tamanos_entre,
)
from app.columna.patrones import PATRONES, Control, Ctx, Patron, opciones_iniciales
from app.columna.tipos import (
    COLORES_INICIALES,
    INFLADO_PULG,
    MAX_CAPAS,
    PATRON_IDS,
    TAMANOS_GLOBO,
    TIPOS_REMATE,
    CapaColumna,
    Columna,
    Config,
    Globo,
    ModoColumna,
    Real,
    Remate,
    TamanoGlobo,
    diametro_m,
)

__all__ = [
    # La puerta de este repo
    "ArmadoInvalido",
    "EstructuraColumna",
    "armado_resuelto",
    "opciones_admitidas",
    "validar",
    # El motor (puerto 1 a 1; su dueño es `clasificador-decoraciones`)
    "ALTO_MAX",
    "ALTO_MIN",
    "BASE_ALTO_M",
    "COLORES_INICIALES",
    "Capa",
    "CapaColumna",
    "Columna",
    "Compra",
    "Config",
    "Control",
    "Ctx",
    "Ctx",
    "FilaCompra",
    "GLOBOS_CAPA_MAX",
    "GLOBOS_CAPA_MIN",
    "GloboCol",
    "Globo",
    "INFLADO_PULG",
    "Limites",
    "MAX_CAPAS",
    "MAX_GLOBOS",
    "Medidas",
    "ModoColumna",
    "PATRONES",
    "PATRON_IDS",
    "Patron",
    "Real",
    "Remate",
    "RemateResumen",
    "Resultado",
    "TAMANOS_GLOBO",
    "TIPOS_REMATE",
    "TamanoGlobo",
    "calcular_compra",
    "calcular_medidas",
    "capas_de",
    "capas_desde_altura",
    "config_inicial",
    "crear_capas",
    "crear_capas_manuales",
    "crear_rng",
    "diametro_columna",
    "diametro_de_columna",
    "diametro_m",
    "es_hex",
    "es_por_capas",
    "generar",
    "limites",
    "mezclar",
    "normalizar_color",
    "normalizar_config",
    "normalizar_config_con_cambios",
    "opciones_iniciales",
    "radio_anillo",
    "sanear",
    "tamanos_entre",
]

# ---------------------------------------------------------------------------
# La puerta: validar un `armado-columna.v1` y resolverlo
# ---------------------------------------------------------------------------


class ArmadoInvalido(ValueError):
    """Un armado de columna que no se puede armar o no corresponde a la pieza."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True)
class EstructuraColumna:
    """La pieza del plan que lleva el armado, con lo poco que el motor necesita de ella.

    ``materiales`` son los colores de la estructura **en su orden**, ya resueltos a ``#rrggbb``
    (el catálogo lo hace antes; aquí un color es un tono y nada más).
    """

    es_columna: bool
    materiales: Sequence[str]


def _testigos(cuantos: int) -> list[str]:
    """Colores testigo con los que se alimenta el motor: uno por material del armado, en su orden.

    Así el color de un globo se traduce de vuelta a su índice **sin ambigüedad**, aunque dos
    materiales distintos tengan el mismo tono. El tono de verdad lo pinta la gráfica.
    """
    return [f"#{i + 1:06x}" for i in range(cuantos)]


def _entero(valor: object, motivo: str, mensaje: str) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int):
        raise ArmadoInvalido(motivo, mensaje)
    return valor


def _validar_forma(armado: Mapping[str, object]) -> None:
    """Comprueba la forma de ``armado-columna.v1``.

    Temporal y con fecha de caducidad: cuando el contrato se publique
    (``npm run contracts:export:domain`` y ``scripts/generate_models.py``), esto se reemplaza por
    ``Draft7Validator(contract_schema("armado-columna.v1"))``, como en ``armado_guirnalda``, y
    estas comprobaciones a mano se borran. Mientras el esquema no esté publicado no se puede
    validar desde el esquema, y dejar la forma sin validar sería peor.
    """
    if armado.get("version") != "armado-columna.v1":
        raise ArmadoInvalido("version_desconocida", "El armado no es un armado-columna.v1.")
    if armado.get("modo") not in ("altura", "capas"):
        raise ArmadoInvalido("modo_invalido", "Una columna se arma por altura o por capas.")
    if armado.get("patron") not in PATRON_IDS:
        raise ArmadoInvalido("patron_invalido", "Ese patron de color no existe en una columna.")
    for clave in ("cuerpo", "inflado", "remate", "opciones"):
        if not isinstance(armado.get(clave), Mapping):
            raise ArmadoInvalido("forma_invalida", f"Al armado le falta {clave}.")
    capas = armado.get("capas")
    if not isinstance(capas, Sequence) or isinstance(capas, str):
        raise ArmadoInvalido("forma_invalida", "Al armado le falta la lista de capas.")
    materiales = armado.get("materiales")
    if not isinstance(materiales, Sequence) or isinstance(materiales, str) or not materiales:
        raise ArmadoInvalido("sin_materiales", "El armado no nombra ningun color.")
    if len(materiales) > 8:
        raise ArmadoInvalido("demasiados_materiales", "Una columna usa hasta 8 colores.")
    remate = cast(Mapping[str, object], armado["remate"])
    if remate.get("tipo") not in TIPOS_REMATE:
        raise ArmadoInvalido("remate_invalido", "Ese remate no existe en una columna.")


def _indices(armado: Mapping[str, object]) -> list[int]:
    """Todos los indices de material que nombra el armado."""
    usados = [
        _entero(i, "material_invalido", "Un color del armado no es un indice.")
        for i in cast(Sequence[object], armado["materiales"])
    ]
    remate = cast(Mapping[str, object], armado["remate"])
    usados.append(
        _entero(remate.get("material"), "material_invalido", "El color del remate no es un indice.")
    )
    return usados


def validar(estructura: EstructuraColumna, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la pieza. Lanza ``ArmadoInvalido`` si no se sostiene."""
    if not estructura.es_columna:
        raise ArmadoInvalido("no_es_columna", "Solo una columna se arma por capas y anillos.")
    _validar_forma(armado)
    if not estructura.materiales:
        raise ArmadoInvalido("sin_materiales", "La columna no lleva colores que armar.")
    if any(i < 0 or i >= len(estructura.materiales) for i in _indices(armado)):
        raise ArmadoInvalido(
            "material_fuera_de_rango", "El armado nombra un color que la columna no lleva."
        )
    capas = cast(Sequence[object], armado["capas"])
    if armado["modo"] == "capas" and not capas:
        raise ArmadoInvalido("capas_faltantes", "Por capas, la columna necesita al menos una capa.")
    cuantos = len(cast(Sequence[object], armado["materiales"]))
    for numero, capa in enumerate(capas, start=1):
        if not isinstance(capa, Mapping):
            raise ArmadoInvalido("capa_invalida", f"La capa {numero} no tiene forma de capa.")
        colores = capa.get("materiales")
        if not isinstance(colores, Sequence) or isinstance(colores, str) or not colores:
            raise ArmadoInvalido("capa_sin_colores", f"La capa {numero} no dice de que color es.")
        for valor in colores:
            indice = _entero(valor, "material_invalido", f"La capa {numero} nombra un color raro.")
            if indice < 0 or indice >= cuantos:
                raise ArmadoInvalido(
                    "material_fuera_de_rango",
                    f"La capa {numero} usa un color que el armado no nombra.",
                )


def _config_desde_armado(armado: Mapping[str, object]) -> tuple[Config, list[str]]:
    """El diseno del motor a partir del armado, con los colores testigo de cada material."""
    cuerpo = cast(Mapping[str, object], armado["cuerpo"])
    inflado = cast(Mapping[str, object], armado["inflado"])
    remate = cast(Mapping[str, object], armado["remate"])
    materiales = cast(Sequence[object], armado["materiales"])
    testigos = _testigos(len(materiales))
    indice_remate = _entero(remate.get("material"), "material_invalido", "Remate sin color.")
    # El remate apunta a un material de la estructura; para el motor es su testigo cuando el
    # armado lo nombra y, si no, el primero: el motor solo necesita un color con el que dibujarlo.
    posicion_remate = next((i for i, m in enumerate(materiales) if m == indice_remate), 0)
    crudo = {
        "modo": armado["modo"],
        "patron": armado["patron"],
        "opciones": {armado["patron"]: dict(cast(Mapping[str, object], armado["opciones"]))},
        "capas": [
            {
                "tamano": cast(Mapping[str, object], capa)["tamano"],
                "colores": list(
                    cast(Sequence[object], cast(Mapping[str, object], capa)["materiales"])
                ),
            }
            for capa in cast(Sequence[object], armado["capas"])
        ],
        "columna": {
            "altoM": cuerpo.get("alto_m"),
            "globosCapa": cuerpo.get("globos_capa"),
            "abajo": cuerpo.get("abajo"),
            "arriba": cuerpo.get("arriba"),
            "escalonado": cuerpo.get("escalonado"),
            "base": cuerpo.get("base"),
            # La persona de 1,70 m de referencia es pantalla y no viaja en el contrato.
            "persona": False,
        },
        "globo": {
            "inflado": inflado.get("inflado"),
            "tamano": inflado.get("tamano"),
            "compresion": inflado.get("compresion"),
            "variacionTam": inflado.get("variacion_tam"),
            "variacionTono": inflado.get("variacion_tono"),
            "desorden": inflado.get("desorden"),
            "semilla": inflado.get("semilla"),
        },
        "remate": {
            "tipo": remate.get("tipo"),
            "tamano": remate.get("tamano"),
            "cantidad": remate.get("cantidad"),
            "foilM": remate.get("foil_m"),
            "color": testigos[posicion_remate] if testigos else "#000001",
        },
        "colores": testigos,
    }
    cfg, avisos = normalizar_config_con_cambios(crudo)
    return cast(Config, cfg), cast("list[str]", avisos)


def _remate_resuelto(res: Resultado, de_testigo: Mapping[str, int]) -> dict[str, object]:
    resumen: dict[str, object] = {
        "descripcion": res.remate.descripcion,
        "globos": [
            {
                "material": de_testigo[cast(str, g["color"])],
                "tamano": g["nominal"],
                "cantidad": g["cantidad"],
            }
            for g in res.remate.globos
        ],
    }
    if res.remate.foil is not None:
        resumen["foil"] = res.remate.foil
    return resumen


def armado_resuelto(
    estructura: EstructuraColumna, armado: Mapping[str, object]
) -> dict[str, object]:
    """La columna resuelta: cada globo colocado, el conteo, el remate y los avisos.

    Es lo que dibuja la grafica sin recalcular nada (``ColumnaResueltaSchema`` en
    ``src/lib/plan/armado-columna.ts``). Los globos salen ordenados de atras hacia adelante, que
    es el orden en el que hay que pintarlos.
    """
    validar(estructura, armado)
    materiales = [
        _entero(m, "material_invalido", "Un color del armado no es un indice.")
        for m in cast(Sequence[object], armado["materiales"])
    ]
    cfg, avisos = _config_desde_armado(armado)
    res = generar(cfg)
    # Del color testigo de vuelta al material de la estructura.
    de_testigo = {testigo: materiales[i] for i, testigo in enumerate(_testigos(len(materiales)))}

    return {
        "version": "armado-columna.v1",
        "globos": [
            {
                "x": b.x,
                "y": b.y,
                "z": b.z,
                "r": b.r,
                "material": de_testigo[b.base],
                "tamano": b.nominal,
                "capa": b.capa,
                "puesto": b.k,
                "prof": b.prof,
            }
            for b in res.globos
        ],
        "capas": res.capas,
        "alto_cuerpo_m": res.alto_cuerpo_m,
        "alto_total_m": res.alto_total_m,
        "diametro_m": res.diametro_m,
        "remate_alto_m": res.remate_alto_m,
        "conteo": [
            {
                "material": de_testigo[cast(str, e["color"])],
                "tamano": e["nominal"],
                "cantidad": e["cantidad"],
            }
            for e in res.conteo
        ],
        "remate": _remate_resuelto(res, de_testigo),
        "avisos": avisos,
    }


def opciones_admitidas() -> dict[str, object]:
    """Lo que el editor puede ofrecer: patrones con sus mandos, remates y tamanos.

    Sale del motor y no de una lista escrita en la interfaz: si alla se anade un patron o cambia
    un rango, aqui se ve sin tocar nada.
    """
    return {
        "modos": ["altura", "capas"],
        "patrones": [
            {
                "id": pid,
                "nombre": PATRONES[pid].nombre,
                "min_colores": PATRONES[pid].min_colores,
                "controles": [
                    {"clave": c.clave, "min": c.minimo, "max": c.maximo, "defecto": c.defecto}
                    for c in PATRONES[pid].controles
                ],
            }
            for pid in PATRON_IDS
        ],
        "remates": list(TIPOS_REMATE),
        "tamanos": list(TAMANOS_GLOBO),
        "globos_capa": {"min": GLOBOS_CAPA_MIN, "max": GLOBOS_CAPA_MAX},
        "alto_m": {"min": ALTO_MIN, "max": ALTO_MAX},
        "max_capas": MAX_CAPAS,
    }
