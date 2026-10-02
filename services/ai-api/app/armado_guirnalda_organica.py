"""Guirnalda orgánica: el motor, migrado 1 a 1 desde ``clasificador-decoraciones``.

Una guirnalda orgánica es una tira larga de globos de varios tamaños que corre en horizontal con una
ondulación suave, con racimos que se solapan, globos que se salen de la banda, follaje y flores. No es una
rejilla: el motor coloca cada globo con una relajación que los separa hasta que dejan de pisarse, y de ahí
salen el conteo, la compra y el dibujo.

**La fuente de verdad es el repo ``clasificador-decoraciones``** (``src/lib/guirnalda/`` y
``src/lib/organico/``), migrado a ``app/guirnalda/`` y ``app/organico/`` y probado contra 199 vectores de oro
—25 694 globos y el sha256 de cada SVG— en ``tests/test_guirnalda.py``. Este módulo es su puerta: traduce
entre el vocabulario del plan (índices de material) y el del motor (una paleta de colores con su acabado).

**Convive con ``armado-guirnalda.v1``, no lo reemplaza.** Aquel describe una guirnalda por racimos, relleno y
remates (ADR-0032) y está vivo, con su editor y sus fixtures. Este describe la del motor del diseñador
(ADR-0034). Cuando una pieza trae los dos, manda el del motor: es el que coloca los globos de verdad.

A diferencia del arco, **aquí no hacen falta colores testigo**: el motor orgánico ya guarda en cada globo el
índice de su color dentro de la paleta (``GloboOrg.indice``), así que dos materiales del mismo tono no se
confunden sin tener que engañar al motor.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast

from jsonschema import Draft7Validator

from app.guirnalda.limites import (
    ALTURA_TOPE,
    GROSOR_MIN,
    GROSOR_TOPE,
    LARGO_MAX,
    LARGO_MIN,
    limites,
    normalizar_config_con_cambios,
)
from app.guirnalda.motor import LIENZO_GUIR, disposicion_guir, pintar_guir
from app.guirnalda.tipos import ConfigGuir, config_inicial
from app.organico.dibujo import svg_documento
from app.organico.medidas import calcular_compra, calcular_medidas
from app.generated_models import contract_schema
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO

VERSION = "armado-guirnalda-organica.v1"

#: Hasta cuántos colores admite una guirnalda. Es el tope de la paleta del motor.
MAX_MATERIALES = 8

#: Margen de compra cuando quien llama no dice otro, el mismo que el diseñador.
DESPERDICIO_POR_DEFECTO = 0.12

#: Los papeles que puede tener un color: uno normal, o un acento repartido suelto entre los demás.
ROLES = ("normal", "acento")


class ArmadoInvalido(ValueError):
    """Un armado de guirnalda que no se puede armar o no corresponde a la pieza."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True)
class EstructuraGuirnalda:
    """La pieza del plan que lleva el armado, con lo poco que el motor necesita de ella."""

    es_guirnalda: bool
    #: Los colores de la estructura **en su orden**, ya resueltos a ``#rrggbb``.
    materiales: Sequence[str]


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
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_guirnalda_organica"
    ],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)


def _validar_forma(armado: Mapping[str, object]) -> None:
    """Comprueba la forma contra el esquema publicado de ``armado-guirnalda-organica.v1``.

    La forma la valida el contrato, no una lista de comprobaciones a mano: se exporta desde el Zod de
    ``src/lib/plan/armado-guirnalda-organica.ts`` y repetirlo aquí sería un segundo dueño que se desincroniza
    en silencio. Lo que queda en este módulo son las reglas que un esquema no puede expresar —que cada índice
    de material exista en la pieza—, que son las que sí son suyas.
    """
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido("forma_invalida", f"El armado no tiene la forma de {VERSION}.")


def validar(estructura: EstructuraGuirnalda, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la pieza. Lanza ``ArmadoInvalido`` si no se sostiene."""
    if not estructura.es_guirnalda:
        raise ArmadoInvalido("no_es_guirnalda", "Solo una guirnalda se arma como una tira ondulada.")
    _validar_forma(armado)
    # Lo que el esquema no puede decir: «al menos un tamaño». Todas las claves de la mezcla son opcionales
    # —una guirnalda nombra los tamaños que usa y no más—, así que un `{}` pasa la forma y no es una mezcla.
    mezcla = _mapa(armado, "tamanos").get("mezcla")
    if not isinstance(mezcla, Mapping) or not any(float(cast(float, v)) > 0 for v in mezcla.values()):
        raise ArmadoInvalido("sin_mezcla", "El armado no dice de que tamanos son los globos.")
    if not estructura.materiales:
        raise ArmadoInvalido("sin_materiales", "La guirnalda no lleva colores que armar.")
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    for numero, color in enumerate(paleta, start=1):
        indice = _entero(color.get("material"), "material_invalido", f"El color {numero} no es un indice.")
        if indice < 0 or indice >= len(estructura.materiales):
            raise ArmadoInvalido(
                "material_fuera_de_rango", "El armado nombra un color que la guirnalda no lleva."
            )


def _config_desde_armado(
    armado: Mapping[str, object],
    colores: Sequence[str],
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> tuple[ConfigGuir, list[str]]:
    """El diseño del motor a partir del armado, con los tonos que se le quiera dar a la paleta.

    El desperdicio entra aquí porque ``calcular_compra`` lo lee de ``cfg.real``: es el único sitio donde el
    motor lo mira, y dejarlo en el valor inicial hacía que el parámetro de ``armado_resuelto`` no hiciera nada.
    """
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    inicial = config_inicial()
    crudo: dict[str, object] = {
        "forma": {**inicial["forma"], **dict(_mapa(armado, "forma"))},
        "volumen": dict(_mapa(armado, "volumen")),
        "tamanos": dict(_mapa(armado, "tamanos")),
        "colores": {
            "lista": [
                {
                    "hex": colores[i] if i < len(colores) else "#9ca3af",
                    "peso": color.get("peso", 20),
                    "acabado": color.get("acabado", "mate"),
                    "rol": color.get("rol", "normal"),
                }
                for i, color in enumerate(paleta)
            ],
            "reparto": _mapa(armado, "colores").get("reparto", "azar"),
            "mezcla": _mapa(armado, "colores").get("mezcla", 0.5),
        },
        "adornos": dict(_mapa(armado, "adornos")),
        "aspecto": dict(_mapa(armado, "aspecto")),
        "real": {**inicial["real"], "desperdicio": desperdicio},
    }
    cfg, cambios = normalizar_config_con_cambios(crudo)
    return cfg, list(cambios)


def armado_resuelto(
    estructura: EstructuraGuirnalda,
    armado: Mapping[str, object],
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> dict[str, Any]:
    """La guirnalda resuelta: cada globo colocado, el conteo, la compra, los avisos y el dibujo.

    Los globos salen en el orden en el que hay que pintarlos. El SVG viene del mismo motor que los colocó, así
    que la gráfica no recalcula nada: la muestra.
    """
    validar(estructura, armado)
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    materiales = [
        _entero(color.get("material"), "material_invalido", "Un color del armado no es un indice.")
        for color in paleta
    ]
    tonos = [estructura.materiales[i] for i in materiales]

    cfg, cambios = _config_desde_armado(armado, tonos, desperdicio)
    disposicion = disposicion_guir(cfg)
    res = pintar_guir(cfg, disposicion)
    medidas = calcular_medidas(res, cfg)
    compra = calcular_compra(res, cfg)

    def material_de(indice: int) -> int:
        """Del lugar en la paleta del motor al material de la estructura."""
        return materiales[indice] if 0 <= indice < len(materiales) else -1

    return {
        "version": VERSION,
        "globos": [
            {
                "x": b.x,
                "y": b.y,
                "r": b.r,
                "capa": int(b.capa),
                "tamano": int(b.nominal),
                "material": material_de(b.indice),
                "acabado": b.acabado,
            }
            for b in res.globos
        ],
        "capas": int(res.capas),
        "ancho_m": res.anchoM,
        "alto_m": res.altoM,
        "largo_m": res.largoM,
        "grosor_extremos_m": res.grosorPatasM,
        "grosor_centro_m": res.grosorCimaM,
        "globos_por_metro": medidas["globosPorMetro"],
        "globos_por_pie": medidas["globosPorPie"],
        # Globos que quedaron sin tocar a ningún otro: con el motor bien puesto es 0, y si no lo es, se ve.
        "sueltos": int(res.sueltos),
        "conteo": [
            {
                "material": material_de(int(cast(int, e["indice"]))),
                "tamano": int(cast(int, e["nominal"])),
                "acabado": e["acabado"],
                "cantidad": int(cast(int, e["cantidad"])),
            }
            for e in res.conteo
        ],
        "compra": [
            {
                "material": material_de(int(cast(int, fila["indice"]))),
                # `Math.ceil` devuelve un número en JavaScript y aquí un `float`; el contrato pide enteros,
                # y un 47.0 en el JSON lo rechazaría por no ser entero.
                # La clave es la pulgada **en texto**, como la publica `armados_guirnalda_organica[]` (y como
                # la escribe `tamanos.mezcla` del armado): un entero pasa el `json.dumps` sin ruido pero
                # rompe la validación del contrato contra el diccionario, que es donde se comprueba.
                "por_tamano": {str(int(t)): int(c) for t, c in cast(Mapping[Any, Any], fila["porTamano"]).items()},
                "cantidad": int(cast(int, fila["cantidad"])),
                "comprar": int(cast(float, fila["comprar"])),
            }
            for fila in cast(Sequence[Mapping[str, object]], compra["filas"])
        ],
        "total_comprar": int(cast(float, compra["total"])),
        # El follaje y las flores no se cotizan en el catálogo de globos: se listan para que nadie los olvide.
        "adornos": {"ramas": len(res.ramas), "flores": len(res.flores)},
        "avisos": cambios,
        # Derivado: el SVG no entra en el plan ni en `plan_hash`. Se regenera cuando haga falta.
        "grafica": {
            "ancho": LIENZO_GUIR["w"],
            "alto": LIENZO_GUIR["h"],
            "svg": res.svg,
            "documento": svg_documento(res.svg, "Guirnalda de globos", LIENZO_GUIR["w"], LIENZO_GUIR["h"]),
        },
    }


def opciones_admitidas() -> dict[str, Any]:
    """Lo que el editor y la IA pueden ofrecer, sacado del motor y no de una lista escrita a mano."""
    return {
        "acabados": [dict(a) for a in ACABADOS],
        "repartos": [dict(r) for r in REPARTOS],
        "roles": list(ROLES),
        "tamanos": list(TAMANOS_GLOBO),
        "largo_m": {"min": LARGO_MIN, "max": LARGO_MAX},
        "grosor_m": {"min": GROSOR_MIN, "max": GROSOR_TOPE},
        "altura_m": {"min": 0.0, "max": ALTURA_TOPE},
        "max_materiales": MAX_MATERIALES,
    }


def limites_de(armado: Mapping[str, object], estructura: EstructuraGuirnalda) -> dict[str, float]:
    """Los rangos que la interfaz puede ofrecer con este armado puesto."""
    validar(estructura, armado)
    tonos = list(estructura.materiales)
    return dict(limites(_config_desde_armado(armado, tonos)[0]))
