"""Los globos de las piezas que no tienen motor ni dibujo esquemático, para la guía de escena.

Cada módulo de este paquete expone ``globos_de(estructura, colores[, contexto])`` y devuelve los globos de su
tipo de pieza como tuplas ``(x_m, y_m, r_m, hex)`` en metros, con ``y`` hacia arriba y el origen donde convenga
(la guía los recentra), en orden de pintura; o ``None`` si la estructura no es de su tipo o no tiene con qué
dibujarse. ``colores`` es el hex del globo inflado de cada material, en el orden de ``materiales_de(estructura)``.

**El contexto** (``ContextoPieza``) es lo que la resolución ya sabe de la pieza y el plan no dice: la
``mezcla_real`` (los tamaños que se compran), qué globo es cada material (``MaterialGuia``: látex, foil,
burbuja o número, de cuántas pulgadas y con qué silueta, de la leyenda del armado o de las líneas del catálogo)
y la proporción de la caja de la foto donde va la pieza. Es opcional y su tercer parámetro también: un módulo
de dos parámetros sigue funcionando igual, sin contexto.

**Cómo se sostiene.** Un módulo que además lo sabe expone ``pieza_de(estructura, colores, contexto)``, que
devuelve una ``PiezaDePlugin``: los mismos globos más el ``anclaje`` y, si flota, a qué altura del piso queda su
globo más bajo (``elevacion_m``); sus globos van con ``y`` medida **desde el piso**, como los da el diseñador
del clasificador. Si existe, el gancho la prefiere a ``globos_de``, que sigue devolviendo la lista.

Los módulos se descubren solos (``pkgutil``), en orden alfabético, y gana el primero que responde: así cada
pieza nueva es un archivo y nadie edita un registro compartido.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from types import ModuleType
from typing import Literal, cast

Globo = tuple[float, float, float, str]
TipoGlobo = Literal["latex", "metalizado", "burbuja", "numero"]
Anclaje = Literal["piso", "techo", "flotante", "pared"]
Silueta = Literal["corazon", "estrella"]

#: Los tipos de globo que son foil: planos, del tamaño que dice su etiqueta (sin la cuenta de inflado del látex).
TIPOS_FOIL: frozenset[str] = frozenset({"metalizado", "numero"})


@dataclass(frozen=True, slots=True)
class MaterialGuia:
    """Qué globo es un material, según lo que la resolución ya sabe de él."""

    tipo: TipoGlobo
    #: Tamaño de su etiqueta en pulgadas (``None`` si el catálogo no lo dice).
    tamano_pulg: float | None
    #: Silueta de un foil o un látex con forma (``None``: redondo o desconocida).
    silueta: Silueta | None = None
    #: El dígito de un número foil.
    digito: str | None = None

    @property
    def es_foil(self) -> bool:
        return self.tipo in TIPOS_FOIL


@dataclass(frozen=True, slots=True)
class ContextoPieza:
    """Lo que la resolución ya sabe de una pieza y el plan no dice. Vacío, todo es como antes."""

    #: ``plan_resuelto.estructuras[].mezcla_real``: tamaño, forma, unidades y porcentaje de lo que se compra.
    mezcla_real: tuple[Mapping[str, object], ...] = ()
    #: Uno por material de ``materiales_de(estructura)``; ``None`` donde no se sabe.
    materiales: tuple[MaterialGuia | None, ...] = ()
    #: Alto sobre ancho de la caja de la foto donde va la pieza, en píxeles de la guía.
    aspecto_caja: float | None = None

    def material(self, indice: int) -> MaterialGuia | None:
        return self.materiales[indice] if 0 <= indice < len(self.materiales) else None

    def tamanos_latex(self, redondos: Sequence[int]) -> tuple[tuple[int, float], ...]:
        """El látex redondo de la ``mezcla_real`` como ``(pulgadas, unidades)``; vacío si no se sabe.

        Una línea cuenta si su forma es ``redondo``, o si no la dice y ningún foil de la pieza tiene ese tamaño
        (un foil sin forma en el catálogo no es látex). El tamaño se toma del redondo estándar más cercano
        (``redondos``) si está a menos de una pulgada; si no, la línea no es un redondo de la mezcla.
        """
        tamanos_foil = {
            m.tamano_pulg for m in self.materiales if m is not None and m.es_foil and m.tamano_pulg
        }
        pesos: dict[int, float] = {}
        for linea in self.mezcla_real:
            diametro = linea.get("diam_pulg")
            unidades = linea.get("unidades")
            forma = linea.get("forma")
            if (
                isinstance(diametro, bool)
                or not isinstance(diametro, (int, float))
                or isinstance(unidades, bool)
                or not isinstance(unidades, (int, float))
                or unidades <= 0
            ):
                continue
            if forma not in ("redondo", None) or (forma is None and diametro in tamanos_foil):
                continue
            cercano = min(redondos, key=lambda t: (abs(t - diametro), t))
            if abs(cercano - diametro) < 1:
                pesos[cercano] = pesos.get(cercano, 0.0) + float(unidades)
        return tuple(sorted(pesos.items()))


@dataclass(frozen=True, slots=True)
class PiezaDePlugin:
    """Los globos de una pieza y, si el módulo lo sabe, cómo se sostiene."""

    globos: list[Globo]
    anclaje: Anclaje | None = None
    #: Solo con ``anclaje == "flotante"``: altura (m) del globo más bajo sobre el piso.
    elevacion_m: float | None = None


Constructor = Callable[..., "list[Globo] | PiezaDePlugin | None"]


def _modulos() -> list[ModuleType]:
    nombres = sorted(m.name for m in pkgutil.iter_modules(__path__) if not m.name.startswith("_"))
    return [importlib.import_module(f"{__name__}.{nombre}") for nombre in nombres]


@cache
def _acepta_contexto(constructor: Constructor) -> bool:
    """Si el ``globos_de`` del módulo acepta el tercer parámetro (los de antes solo toman dos)."""
    parametros = list(inspect.signature(constructor).parameters.values())
    if any(p.kind is inspect.Parameter.VAR_POSITIONAL for p in parametros):
        return True
    posicionales = [
        p
        for p in parametros
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    return len(posicionales) >= 3


def pieza_de_plugin(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> PiezaDePlugin | None:
    """La pieza del primer módulo que reconoce la estructura, o ``None``."""
    for modulo in _modulos():
        constructor = cast(
            Constructor | None,
            getattr(modulo, "pieza_de", None) or getattr(modulo, "globos_de", None),
        )
        if constructor is None:
            continue
        if contexto is not None and _acepta_contexto(constructor):
            crudo = constructor(estructura, colores, contexto)
        else:
            crudo = constructor(estructura, colores)
        pieza = crudo if isinstance(crudo, PiezaDePlugin) else PiezaDePlugin(list(crudo or []))
        if pieza.globos:
            return pieza
    return None


def globos_de_pieza(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> list[Globo] | None:
    """Los globos del primer módulo que reconoce la estructura, o ``None`` (sin anclaje ni elevación)."""
    pieza = pieza_de_plugin(estructura, colores, contexto)
    return pieza.globos if pieza is not None else None


__all__ = [
    "TIPOS_FOIL",
    "Anclaje",
    "ContextoPieza",
    "Globo",
    "MaterialGuia",
    "PiezaDePlugin",
    "Silueta",
    "TipoGlobo",
    "globos_de_pieza",
    "pieza_de_plugin",
]
