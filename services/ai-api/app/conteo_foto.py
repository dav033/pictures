"""El conteo de globos de la foto al confirmar un plan (ADR-0031, entrega E2).

Amaterasu cuenta los globos de cada pieza de la foto (``conteo-referencia.v1``)
y aquí se decide qué hace el plan con esa cuenta. Es regla comercial:
cuántos globos se compran. Por eso vive en Python, junto a ``plan.py``, que la
invoca con ``_aplicar_conteos`` antes de completar los armados.

- **Kits** (``tipo: kit``: bouquet, figura, racimo). El conteo da la CANTIDAD y la
  lectura del armado del bouquet da la DISTRIBUCIÓN (``SEGUIMIENTO-bouquets.md``
  §14: la lectura del armado subcuenta porque lee una unidad por nivel). Con
  lectura del armado, dentro de la tolerancia se queda el armado; si no, el
  total es la cuenta si es exacta, o el mayor de los dos si es un estimado (un
  estimado puede subir la cifra, nunca bajarla por debajo de lo que el armado
  identificó). Los niveles leídos se reescalan a ese total
  (``reescalar_lectura_armado``). Sin lectura del armado: la cuenta exacta
  manda; un estimado solo sube lo declarado.
- **Geométricas**. Primero la mezcla, si el reparto por tamaño de la foto la
  contradice claramente; luego la densidad con las medidas fijas; solo si no
  alcanza, las medidas dentro de ±35 % (del plan, o de la escala que la foto
  trae respecto de una persona, una puerta o una mesa), dichas como "largo
  equivalente", nunca como medidas tomadas. Si ni así alcanza y la pieza tiene
  un solo eje libre (guirnalda: largo; columna: alto), la cantidad de la foto
  decide ese eje (enmienda del 2026-09-28: unas medidas físicas que no se fijaron
  pueden dejar la pieza en una fracción de la foto). Con ``espacio.fuente:
  cliente``, ``medidas_del_cliente`` o una caja geométrica que de verdad ancló la
  escala de su foto las medidas no se tocan (una caja cortada o sin escala no fija
  nada). Nunca fuera de la puerta física. Una pieza que ya trae su armado del motor
  no se ajusta: el armado fija la cantidad, como el de un bouquet.

Lo que este módulo necesita del plan (contar globos, la puerta física, la
cobertura de una mezcla, el contexto de un bouquet) llega en ``PuertoPlan``: así
no depende de ``plan.py`` (que lo importa) y las reglas se prueban solas.

Supuestos a validar con el negocio (ADR-0031): la tolerancia de ±15 % (mínimo 2
globos), la ventana de ±35 % del eje (que un solo eje libre supera sin medidas
del cliente), las alturas de referencia de una persona,
una puerta y una mesa, y el umbral de "contradice claramente" de la mezcla.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from jsonschema import Draft7Validator

from app.armado_bouquet import (
    CLASES_TAMANO_NIVEL,
    CONFIANZA_MINIMA_LECTURA,
    MAX_CANTIDAD_NIVEL,
    CompraLeida,
    EstructuraBouquet,
    clase_de_tamano,
    compra_desde_lectura,
    total_leido,
)
from app.amaterasu.conteo_referencia import MAX_GLOBOS
from app.generated_models import contract_schema
from app.supuestos import agregar_supuesto, nombre_corto
from app.supuestos import supuesto as acotar_supuesto

#: La misma barra que las otras lecturas de la foto (patrón, armado).
CONFIANZA_MINIMA = 0.5
#: Tolerancia de la cuenta aproximada (``SEGUIMIENTO-guirnaldas.md`` §4).
TOLERANCIA_RELATIVA = 0.15
TOLERANCIA_MINIMA = 2
#: Cuánto puede moverse el eje de una pieza geométrica respecto del plan o de la escala de la foto.
VENTANA_EJE = 0.35
PASO_VENTANA = 0.01
#: Resolución del eje libre cuando lo decide la cantidad de la foto (un centímetro).
PASO_EJE_M = 0.01
DENSIDADES = ("sencilla", "media", "lujosa")
#: Altura típica de cada referencia de escala, en metros (supuesto, ADR-0031).
ALTURA_REFERENCIA_M: Mapping[str, float] = {"persona": 1.7, "puerta": 2.0, "mesa": 0.75}
#: Distancia de variación total a partir de la cual el reparto de la foto contradice la mezcla.
CONTRADICCION_MEZCLA = 0.3
#: Cuánto más cerca tiene que quedar la mezcla de la foto para cambiarla.
MEJORA_MINIMA_MEZCLA = 0.15
#: Topes del contrato ``plan-decoracion.v1``.
MAX_UNIDADES_DECLARADAS = 999
MAX_MEDIDA_M = 100.0
TIPOS_GEOMETRICOS = frozenset({"arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"})
#: Un centro de mesa cuya foto cuenta EXACTAMENTE esto o menos se compra por globos contados (UI-6).
MAX_GLOBOS_CENTRO_CONTADO = 3


def es_centro_contado(estructura: Mapping[str, object]) -> bool:
    """Un centro de mesa de pocos globos contados: ``unidades_declaradas`` en vez de banda × eje.

    La fórmula de banda (``plan._total_globos``) no baja de unos 3 globos, así que un único globo
    burbuja leído en la foto («1, exacto») salía como 3 a 22 (CASE-006 de images-judge). Lo declara
    ``_centro_contado``; el plan lo compra como un kit (unidades y ``variant_id`` por material).
    Misma regla en TypeScript: ``esCuentaGeometrica`` (``src/lib/plan/tipos.ts``).
    """
    unidades = estructura.get("unidades_declaradas")
    return (
        estructura.get("tipo") == "centro_mesa"
        and isinstance(unidades, int)
        and not isinstance(unidades, bool)
        and unidades > 0
    )


def es_geometrica(estructura: Mapping[str, object]) -> bool:
    """¿Cuenta sus globos la geometría? Todas las de ``TIPOS_GEOMETRICOS`` salvo el centro contado."""
    return estructura.get("tipo") in TIPOS_GEOMETRICOS and not es_centro_contado(estructura)


_NOMBRE_MEZCLA = {
    "clasica": "clásica",
    "organica_fina": "orgánica fina",
    "organica_gruesa": "orgánica gruesa",
    "solo_grandes": "solo globos grandes",
}
_NOMBRE_MEDIDA = {"ancho_m": "ancho", "alto_m": "alto", "largo_m": "largo"}

_PISTA = Draft7Validator(
    cast(
        Mapping[str, object],
        cast(
            Mapping[str, object],
            contract_schema("PlanResolutionRequest")["properties"]["pistas_conteo"],
        )["items"],
    )
)


def validar_pistas(valores: Sequence[object]) -> list[dict[str, object]]:
    """``pistas_conteo`` contra el esquema exportado (dueño Zod: ``conteo-referencia.ts``).

    El contrato expresa la forma; lo que no expresa (reparto por tamaño con cada
    clase una vez y suma 1, que ``conteo_referencia.py`` garantiza al leer) no se
    vuelve a validar aquí: un reparto raro solo acerca menos la mezcla.
    """
    pistas: list[dict[str, object]] = []
    for valor in valores:
        if not isinstance(valor, Mapping) or not _PISTA.is_valid(valor):
            raise ValueError("pistas_conteo no cumple conteo-referencia.v1")
        pistas.append(dict(valor))
    return pistas


# --- La cuenta y su tolerancia -------------------------------------------------


@dataclass(frozen=True)
class Cuenta:
    """Globos de UNA pieza según la foto, y si es la cuenta exacta."""

    globos: int
    exacto: bool


def cuenta_usable(lectura: Mapping[str, object]) -> Cuenta | None:
    """La cuenta que el plan puede usar, o ``None``.

    Con confianza de al menos 0,5: los globos visibles si la cuenta es exacta;
    si no, el estimado del total; si no, racimos × globos por racimo. Los globos
    visibles de una cuenta no exacta no bastan: dejan fuera los ocultos. Incluye
    metalizados y números (el prompt de ``conteo_referencia.py`` los cuenta).
    """
    confianza = lectura.get("confianza")
    if not isinstance(confianza, (int, float)) or confianza < CONFIANZA_MINIMA:
        return None
    visibles = lectura.get("globos_visibles")
    if lectura.get("exacto") is True and isinstance(visibles, int) and visibles > 0:
        return Cuenta(visibles, True)
    estimado = lectura.get("estimado_total")
    if isinstance(estimado, int) and estimado > 0:
        return Cuenta(estimado, False)
    racimos, por_racimo = lectura.get("racimos"), lectura.get("globos_por_racimo")
    if isinstance(racimos, int) and isinstance(por_racimo, int):
        # Por encima del tope del contrato no es una cuenta: no cabe en
        # conteos_referencia (revisión 10). Vale para lecturas ya guardadas.
        if 0 < racimos * por_racimo <= MAX_GLOBOS:
            return Cuenta(racimos * por_racimo, False)
    return None


def tolerancia(globos: int) -> float:
    return max(TOLERANCIA_MINIMA, TOLERANCIA_RELATIVA * globos)


def dentro_de_tolerancia(globos_foto: int, globos_plan: int) -> bool:
    return abs(globos_foto - globos_plan) <= tolerancia(globos_foto)


# --- Kits ------------------------------------------------------------------------


def total_kit_sin_armado(cuenta: Cuenta, por_pieza: int) -> int:
    """Globos por pieza de un kit sin lectura del armado.

    La cuenta exacta manda. Un estimado solo sube lo declarado, y dentro de la
    tolerancia lo deja como está.
    """
    if cuenta.exacto:
        return cuenta.globos
    if dentro_de_tolerancia(cuenta.globos, por_pieza):
        return por_pieza
    return max(por_pieza, cuenta.globos)


def total_kit_con_armado(cuenta: Cuenta, leidos: int) -> int:
    """Globos por pieza de un bouquet cuya lectura del armado identificó ``leidos``
    (látex + remate + números).

    Dentro de la tolerancia se queda el armado. Fuera de ella: la cuenta exacta,
    o el mayor de los dos si la cuenta es un estimado (un bouquet apilado casi
    nunca es exacto: tiene globos ocultos, y el estimado tiene que poder subirlo).
    """
    if dentro_de_tolerancia(cuenta.globos, leidos):
        return leidos
    return cuenta.globos if cuenta.exacto else max(leidos, cuenta.globos)


def _sueltos_por_color(colores: Sequence[str], cantidad: int) -> list[str]:
    """``cantidad`` globos sueltos repartidos por turnos entre ``colores``, agrupados por color.

    Agrupados para que el armado los junte en un nivel por color.
    """
    distintos = list(dict.fromkeys(colores))
    cuentas = {color: 0 for color in distintos}
    for posicion in range(cantidad):
        cuentas[distintos[posicion % len(distintos)]] += 1
    return [color for color in distintos for _ in range(cuentas[color])]


def _globos_de(nivel: Mapping[str, object], cantidad: int | None = None) -> int:
    """Globos de un nivel leído, contados por el dueño de esa cuenta (``total_leido``).

    Con ``cantidad``, los de ese nivel con esa cantidad de unidades (1: una unidad).
    """
    unico = dict(nivel) if cantidad is None else {**dict(nivel), "cantidad": cantidad}
    return int(total_leido({"niveles": [unico]}))


def _en_tramos(nivel: Mapping[str, object], unidades: int) -> list[dict[str, object]]:
    """El nivel con ``unidades`` unidades, en tramos consecutivos de a lo sumo el tope por nivel."""
    tramos: list[dict[str, object]] = []
    while unidades > 0:
        tramo = min(unidades, MAX_CANTIDAD_NIVEL)
        tramos.append({**dict(nivel), "cantidad": tramo})
        unidades -= tramo
    return tramos


def reescalar_lectura_armado(
    lectura: Mapping[str, object], latex_por_grupo: int
) -> dict[str, object] | None:
    """La lectura del armado con sus niveles llevados a ``latex_por_grupo`` látex.

    Cada nivel conserva su unidad, sus posiciones de color y su clase de tamaño;
    solo cambia su ``cantidad`` (1 en una lectura anterior a la cantidad). Las
    unidades se reparten por restos mayores sobre la proporción leída; en un
    empate va el nivel leído primero, así en una base de aire la base va
    primero. El sobrante que no completa una unidad va como globos sueltos de
    acento con los colores leídos. Un nivel que pasa del tope de unidades por
    nivel se parte en tramos iguales consecutivos. Remate, números y
    disposición no cambian. Las cuentas son las de ``armado_bouquet.total_leido``.
    ``None`` si no hay niveles o no alcanza para nada.
    """
    niveles = [
        n for n in cast(list[object], lectura.get("niveles") or []) if isinstance(n, Mapping)
    ]
    if not niveles or len(niveles) != len(cast(list[object], lectura.get("niveles") or [])):
        return None
    if any(not cast(list[object], nivel.get("colores") or []) for nivel in niveles):
        return None
    por_unidad = [_globos_de(nivel, 1) for nivel in niveles]
    leidas = [
        _globos_de(nivel) // k if k > 0 else 0 for nivel, k in zip(niveles, por_unidad, strict=True)
    ]
    actual = sum(k * n for k, n in zip(por_unidad, leidas, strict=True))
    if actual <= 0 or latex_por_grupo <= 0 or 0 in por_unidad:
        return None
    cuotas = [n * latex_por_grupo / actual for n in leidas]
    unidades = [math.floor(cuota) for cuota in cuotas]
    sobrante = latex_por_grupo - sum(k * u for k, u in zip(por_unidad, unidades, strict=True))
    orden = sorted(range(len(niveles)), key=lambda i: (-(cuotas[i] - unidades[i]), i))
    agregado = True
    while agregado:
        agregado = False
        for i in orden:
            if por_unidad[i] <= sobrante:
                unidades[i] += 1
                sobrante -= por_unidad[i]
                agregado = True
        orden = list(range(len(niveles)))
    nuevos = [
        tramo for nivel, n in zip(niveles, unidades, strict=True) for tramo in _en_tramos(nivel, n)
    ]
    if sobrante > 0:
        todos = [
            color
            for nivel in niveles
            for color in cast(list[object], nivel.get("colores") or [])
            if isinstance(color, str)
        ]
        nuevos.append(
            {"unidad": "suelto", "colores": _sueltos_por_color(todos, sobrante), "cantidad": 1}
        )
    if not nuevos:
        return None
    return {**dict(lectura), "niveles": nuevos}


def clases_desde_por_tamano(
    lectura: Mapping[str, object], por_tamano: Sequence[Mapping[str, object]]
) -> dict[str, object]:
    """La lectura con una clase de tamaño en cada nivel que no la trae, desde el
    reparto por tamaño del conteo.

    Los niveles sin clase se recorren en el orden leído y cada uno toma la clase
    a la que más globos le faltan para su parte del reparto (empate: la de más
    parte). Un nivel entero lleva una sola clase. Elegir el látex de esa clase
    sigue siendo de ``armado_bouquet._material_del_color``: aquí solo se le pasa
    la clase. Sin reparto, o si todos los niveles traen clase, la lectura tal cual.
    """
    partes = {
        str(item["clase"]): float(cast(float, item["proporcion"]))
        for item in por_tamano
        if isinstance(item, Mapping) and item.get("clase") in CLASES_TAMANO_NIVEL
    }
    niveles = [
        n for n in cast(list[object], lectura.get("niveles") or []) if isinstance(n, Mapping)
    ]
    sin_clase = [
        i for i, n in enumerate(niveles) if n.get("clase_tamano") not in CLASES_TAMANO_NIVEL
    ]
    if not partes or not sin_clase:
        return dict(lectura)
    globos = sum(_globos_de(niveles[i]) for i in sin_clase)
    asignados = {clase: 0.0 for clase in partes}
    nuevos = [dict(n) for n in niveles]
    for i in sin_clase:
        clase = max(partes, key=lambda c: (partes[c] * globos - asignados[c], partes[c]))
        nuevos[i]["clase_tamano"] = clase
        asignados[clase] += _globos_de(niveles[i])
    return {**dict(lectura), "niveles": nuevos}


@dataclass(frozen=True)
class _PartesLeidas:
    total: int
    fijas: int
    grupos: int


def _partes(compra: CompraLeida) -> _PartesLeidas:
    """Globos por pieza de una compra leída, las piezas fijas (remate × grupos + dígitos) y los grupos."""
    numero = compra.armado.get("numero")
    grupos = 2 if isinstance(numero, Mapping) and numero.get("disposicion") == "lados" else 1
    digitos = len(cast(list[int], numero["digitos"])) if isinstance(numero, Mapping) else 0
    remate = len(cast(list[int], compra.armado.get("remate") or []))
    return _PartesLeidas(compra.total, remate * grupos + digitos, grupos)


# --- Geométricas -------------------------------------------------------------------


def clase_de_diametro(pulgadas: float) -> str:
    """Clase de tamaño de un diámetro, con la escala del armado del bouquet.

    Una sola escala (revisión 1/11): la dueña es
    ``armado_bouquet.CLASES_TAMANO_NIVEL`` (5"–9" chico, 11"–12" mediano,
    16"–18" grande, 24"–36" gigante), la que usa ``_material_del_color`` al
    elegir el látex de una clase.
    """
    return str(clase_de_tamano(pulgadas))


def _reparto_por_clase(proporciones: Sequence[tuple[int, float]]) -> dict[str, float]:
    reparto: dict[str, float] = {}
    for diametro, proporcion in proporciones:
        clase = clase_de_diametro(diametro)
        reparto[clase] = reparto.get(clase, 0.0) + proporcion
    return reparto


def _variacion_total(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    return sum(abs(a.get(clase, 0.0) - b.get(clase, 0.0)) for clase in {*a, *b}) / 2


def mezcla_de_la_foto(
    por_tamano: Sequence[Mapping[str, object]],
    mezclas: Mapping[str, Sequence[tuple[int, float]]],
    actual: str,
) -> str | None:
    """La mezcla del contrato más cercana al reparto de la foto, solo si la de
    ``actual`` lo contradice claramente; si no, ``None`` (la mezcla no se toca)."""
    foto = {
        str(item["clase"]): float(cast(float, item["proporcion"]))
        for item in por_tamano
        if isinstance(item, Mapping)
    }
    if not foto or actual not in mezclas:
        return None
    distancia = {
        mezcla: _variacion_total(foto, _reparto_por_clase(proporciones))
        for mezcla, proporciones in mezclas.items()
    }
    mejor = min(mezclas, key=lambda mezcla: (distancia[mezcla], mezcla != actual))
    if (
        mejor != actual
        and distancia[actual] >= CONTRADICCION_MEZCLA
        and distancia[mejor] <= distancia[actual] - MEJORA_MINIMA_MEZCLA
    ):
        return mejor
    return None


def medidas_desde_referencia(
    tipo: str, medidas: Mapping[str, object], lectura: Mapping[str, object]
) -> dict[str, float] | None:
    """Medidas de la pieza según la escala de la foto (largo o alto × la altura de
    la referencia), sobre las del plan; ``None`` si la foto no trae escala útil.

    Son una estimación: sirven de centro de la ventana del eje, no de medida.
    """

    def metros(campo: str) -> float | None:
        escala = lectura.get(campo)
        if not isinstance(escala, Mapping):
            return None
        altura = ALTURA_REFERENCIA_M.get(str(escala.get("referencia")))
        veces = escala.get("veces")
        if altura is None or not isinstance(veces, (int, float)):
            return None
        valor = round(altura * float(veces), 2)
        return valor if 0 < valor <= MAX_MEDIDA_M else None

    largo, alto = metros("largo_relativo"), metros("alto_relativo")
    nuevas = {k: float(cast(float, v)) for k, v in medidas.items() if isinstance(v, (int, float))}
    cambiadas = False
    if tipo == "guirnalda" and largo is not None:
        clave = "largo_m" if "largo_m" in nuevas or "ancho_m" not in nuevas else "ancho_m"
        nuevas[clave] = largo
        cambiadas = True
    if tipo in ("arco", "semiarco", "pared", "centro_mesa") and largo is not None:
        nuevas["ancho_m"] = largo
        cambiadas = True
    if tipo in ("arco", "semiarco", "pared", "centro_mesa", "columna") and alto is not None:
        nuevas["alto_m"] = alto
        cambiadas = True
    return nuevas if cambiadas else None


@dataclass(frozen=True)
class Opcion:
    densidad: str
    mezcla: str
    medidas: Mapping[str, float]
    total: int
    #: Escala de las medidas respecto del centro de la ventana (1.0 = sin mover).
    factor: float


def _distancia_densidad(a: str, b: str) -> int:
    return (
        abs(DENSIDADES.index(a) - DENSIDADES.index(b)) if a in DENSIDADES and b in DENSIDADES else 3
    )


def elegir_opcion(objetivo: int, densidad_actual: str, opciones: Sequence[Opcion]) -> Opcion | None:
    """La opción dentro de la tolerancia que menos cambia el plan: medidas más
    cercanas, luego la densidad más cercana, luego la cuenta más cercana."""
    validas = [o for o in opciones if dentro_de_tolerancia(objetivo, o.total)]
    if not validas:
        return None
    return min(
        validas,
        key=lambda o: (
            round(abs(o.factor - 1), 4),
            _distancia_densidad(o.densidad, densidad_actual),
            abs(o.total - objetivo),
            DENSIDADES.index(o.densidad) if o.densidad in DENSIDADES else 3,
        ),
    )


# --- Aplicación sobre el plan --------------------------------------------------------


@dataclass(frozen=True)
class PuertoPlan:
    """Lo que las reglas necesitan del plan resuelto, sin depender de ``plan.py``."""

    #: Globos por instancia de una estructura (con su densidad, mezcla y medidas).
    contar: Callable[[Mapping[str, object]], int]
    #: La estructura con ese total queda dentro de la puerta física.
    dentro_de_puerta: Callable[[Mapping[str, object], int], bool]
    #: El catálogo del turno cubre cada tamaño de esa mezcla para cada material.
    mezcla_cubierta: Callable[[Mapping[str, object], str], bool]
    #: Materiales clasificados y compra de un kit (``plan._bouquet_context``).
    contexto_kit: Callable[[Mapping[str, object]], EstructuraBouquet]
    #: La estructura con su patrón re-sincronizado tras cambiar su rejilla, o ``None`` si ya no cabe.
    sincronizar_patron: Callable[[Mapping[str, object]], dict[str, object] | None]
    mezclas: Mapping[str, Sequence[tuple[int, float]]]
    #: El cliente fijó tamaños (``restricciones.tamanos``): la mezcla no se toca.
    tamanos_obligatorios: bool
    #: Las densidades que admite la estructura oficial de la pieza (revisión 2):
    #: la tabla es de ``estructuras-oficiales.ts`` y llega por el contrato.
    densidades_admitidas: Callable[[Mapping[str, object]], Sequence[str]] = lambda _e: DENSIDADES
    #: Medidas fijas por cliente, foto o edición: el conteo no las mueve.
    medidas_del_cliente: Callable[[Mapping[str, object]], bool] = lambda _e: False
    #: Las variantes redondas que el turno permite comprar de un producto: ``(variant_id, pulgadas)``.
    #: Sin catálogo (la estimación) no hay ninguna, y un centro de mesa no pasa a globos contados.
    variantes_redondas: Callable[[str], Sequence[tuple[str, float]]] = lambda _p: ()
    #: La pieza trae su armado del motor (``plan._armado_del_motor``), que la cuenta colocando cada globo:
    #: ni su densidad, ni su mezcla ni sus medidas mueven ese total (``_con_armado_del_motor``).
    cuenta_el_motor: Callable[[Mapping[str, object]], bool] = lambda _e: False


@dataclass
class _Resultado:
    estructura: dict[str, object]
    decision: str
    globos_foto: int | None
    globos_antes: int
    globos_despues: int
    cambios: list[dict[str, object]]
    motivo: str
    supuesto: str | None = None


def _numero_es(valor: float) -> str:
    return (f"{valor:.2f}".rstrip("0").rstrip(".")).replace(".", ",")


def _nombre(estructura: Mapping[str, object], defecto: str) -> str:
    nombre = estructura.get("nombre")
    return nombre if isinstance(nombre, str) and nombre.strip() else defecto


def _nombre_de_pieza(estructura: Mapping[str, object]) -> str:
    """El nombre con que el conteo encabeza el supuesto de una pieza (``_kit``, ``_geometrica``)."""
    tipo = str(estructura.get("tipo"))
    return _nombre(estructura, "La pieza" if tipo == "kit" else tipo.capitalize())


_MARCA_CONTEO = re.compile(
    r": la foto muestra (?:unos )?\d+ globos(?: por pieza)?"
    r"(?: y el plan tenía |; el armado leído tenía |, así que la cantidad quedó en )"
)


def _es_supuesto_de_conteo(texto: str, nombre: str) -> bool:
    """Si ``texto`` es un supuesto que el conteo escribió para la pieza ``nombre``.

    El del armado del bouquet (ADR-0030, "globos por bouquet") no lo es.
    """
    return any(
        texto.startswith(cabeza) and _MARCA_CONTEO.match(texto, len(cabeza)) is not None
        for cabeza in {nombre_corto(nombre), nombre}
    )


def _unos(cuenta: Cuenta) -> str:
    return f"{cuenta.globos}" if cuenta.exacto else f"unos {cuenta.globos}"


def _kit(
    estructura: dict[str, object],
    cuenta: Cuenta,
    armado_leido: Mapping[str, object] | None,
    por_tamano: Sequence[Mapping[str, object]],
    puerto: PuertoPlan,
) -> tuple[_Resultado, Mapping[str, object] | None, bool]:
    """Un kit con la cuenta de la foto.

    Devuelve el resultado, la lectura del armado que deben usar los armados (con
    la clase de tamaño del conteo en los niveles que no la traen y, si hace
    falta, reescalada) y si esa lectura se descarta.
    """
    reps = max(1, cast(int, estructura.get("repeticiones") or 1))
    antes_total = cast(int, estructura.get("unidades_declaradas") or 0)
    antes = round(antes_total / reps)
    nombre = _nombre_de_pieza(estructura)

    def sin_cambio(decision: str, motivo: str, despues: int = antes) -> _Resultado:
        return _Resultado(estructura, decision, cuenta.globos, antes, despues, [], motivo)

    if estructura.get("armado_bouquet") is not None:
        return (
            sin_cambio("sin_aplicar", "La pieza ya trae su armado, que fija la cantidad."),
            armado_leido,
            False,
        )
    contexto = puerto.contexto_kit(estructura)
    if not contexto.materiales or any(m is None for m in contexto.materiales):
        return (
            sin_cambio("sin_ajuste_posible", "La pieza no se compra por globos sueltos."),
            armado_leido,
            False,
        )

    compra = None
    if armado_leido is not None and contexto.es_bouquet:
        # Los niveles sin clase de tamaño la toman del reparto del conteo; el
        # látex de esa clase lo sigue eligiendo armado_bouquet.
        con_clases = clases_desde_por_tamano(armado_leido, por_tamano)
        compra = compra_desde_lectura(contexto, con_clases)
        if compra is not None:
            armado_leido = con_clases
        else:
            compra = compra_desde_lectura(contexto, armado_leido)
    if compra is not None:
        partes = _partes(compra)
        total = total_kit_con_armado(cuenta, partes.total)
        if total == partes.total:
            resultado = (
                sin_cambio(
                    "coincide",
                    f"La foto y el armado leído coinciden ({partes.total} globos por pieza).",
                    partes.total,
                )
                if dentro_de_tolerancia(cuenta.globos, partes.total)
                else sin_cambio(
                    "sin_aplicar",
                    f"Un estimado ({cuenta.globos}) no baja lo que el armado leído identificó "
                    f"({partes.total}).",
                    partes.total,
                )
            )
            return resultado, armado_leido, False
        latex = (total - partes.fijas) // partes.grupos
        reescalada = reescalar_lectura_armado(armado_leido or {}, latex)
        nueva = compra_desde_lectura(contexto, reescalada) if reescalada is not None else None
        esperado = latex * partes.grupos + partes.fijas
        if (
            nueva is not None
            and nueva.total == esperado
            and nueva.total * reps <= MAX_UNIDADES_DECLARADAS
        ):
            final = nueva.total
            item = {**estructura, "unidades_declaradas": final * reps}
            supuesto = acotar_supuesto(
                nombre,
                f"la foto muestra {_unos(cuenta)} globos; el armado leído tenía "
                f"{partes.total}: la cantidad quedó en {final * reps} (el plan decía {antes_total}).",
            )
            return (
                _Resultado(
                    item,
                    "ajustado",
                    cuenta.globos,
                    antes,
                    final,
                    [
                        {
                            "campo": "unidades_declaradas",
                            "antes": antes_total,
                            "despues": final * reps,
                        }
                    ],
                    f"El conteo da la cantidad y el armado leído la distribución ({partes.total} → {final}).",
                    supuesto,
                ),
                reescalada,
                False,
            )
        # El armado leído no se puede llevar a esa cantidad: se descarta y la
        # cuenta decide sola, como si no hubiera lectura del armado.
        descartar = True
    else:
        descartar = False

    por_pieza = total_kit_sin_armado(cuenta, antes)
    if por_pieza == antes:
        resultado = (
            sin_cambio("coincide", "La cantidad del plan ya sigue la foto.")
            if dentro_de_tolerancia(cuenta.globos, antes)
            else sin_cambio(
                "sin_aplicar",
                f"Un estimado ({cuenta.globos}) no baja lo que el plan declara ({antes}).",
            )
        )
        return resultado, armado_leido, descartar
    nuevo_total = por_pieza * reps
    if nuevo_total > MAX_UNIDADES_DECLARADAS or nuevo_total < len(contexto.materiales):
        return (
            sin_cambio(
                "sin_ajuste_posible", "La cantidad de la foto no cabe en la compra de la pieza."
            ),
            armado_leido,
            descartar,
        )
    item = {**estructura, "unidades_declaradas": nuevo_total}
    supuesto = acotar_supuesto(
        nombre,
        f"la foto muestra {_unos(cuenta)} globos por pieza, así que la cantidad quedó en "
        f"{nuevo_total} (el plan decía {antes_total}).",
    )
    return (
        _Resultado(
            item,
            "ajustado",
            cuenta.globos,
            antes,
            por_pieza,
            [{"campo": "unidades_declaradas", "antes": antes_total, "despues": nuevo_total}],
            "La cuenta exacta de la foto manda."
            if cuenta.exacto
            else "El estimado de la foto supera lo declarado.",
            supuesto,
        ),
        armado_leido,
        descartar,
    )


def _con(estructura: Mapping[str, object], opcion: Opcion) -> dict[str, object]:
    return {
        **dict(estructura),
        "densidad": opcion.densidad,
        "mezcla": opcion.mezcla,
        "medidas": dict(opcion.medidas),
    }


def _opciones(
    estructura: Mapping[str, object],
    mezcla: str,
    centro: Mapping[str, float],
    factores: Sequence[float],
    puerto: PuertoPlan,
) -> list[Opcion]:
    opciones: list[Opcion] = []
    for factor in factores:
        medidas = {clave: round(valor * factor, 2) for clave, valor in centro.items()}
        if any(not 0 < valor <= MAX_MEDIDA_M for valor in medidas.values()):
            continue
        admitidas = puerto.densidades_admitidas(estructura)
        for densidad in (d for d in DENSIDADES if d in admitidas):
            candidata = {
                **dict(estructura),
                "densidad": densidad,
                "mezcla": mezcla,
                "medidas": medidas,
            }
            total = puerto.contar(candidata)
            if total > 0 and puerto.dentro_de_puerta(candidata, total):
                opciones.append(Opcion(densidad, mezcla, medidas, total, factor))
    return opciones


def eje_libre(tipo: str, medidas: Mapping[str, float]) -> str | None:
    """La única medida de la que depende la cuenta de la pieza, o ``None``.

    Guirnalda: su largo (o su ancho si no trae largo), como la cuenta la mide
    (``plan._eje``, también con la cuerda de un armado). Columna: su alto. Un
    arco, un semiarco, una pared o un centro de mesa dependen de dos medidas: la
    cantidad no decide cuál mover y se quedan en la ventana de ±35 %.
    """
    if tipo == "guirnalda":
        return (
            "largo_m" if medidas.get("largo_m") else "ancho_m" if medidas.get("ancho_m") else None
        )
    if tipo == "columna":
        return "alto_m" if medidas.get("alto_m") else None
    return None


def _eje_desde_conteo(
    estructura: Mapping[str, object],
    densidad: str,
    mezcla: str,
    medidas: Mapping[str, float],
    objetivo: int,
    puerto: PuertoPlan,
) -> Opcion | None:
    """El eje libre que da la cantidad de la foto, o ``None``.

    Con la densidad del plan (y, si no queda opción, la admitida más cercana) y
    la mezcla elegida, el menor eje en centímetros cuya cuenta llega al
    objetivo, o el anterior si queda más cerca. Se cuenta con ``puerto.contar``
    (la cuerda con caída y arqueo si la guirnalda tiene armado), hasta
    ``MAX_MEDIDA_M`` y dentro de la puerta física. La cuenta crece con el eje;
    si en algún tramo no lo hiciera, la tolerancia y la puerta lo descartan.
    """
    clave = eje_libre(str(estructura.get("tipo")), medidas)
    if clave is None:
        return None
    tope = round(MAX_MEDIDA_M / PASO_EJE_M)
    admitidas = puerto.densidades_admitidas(estructura)
    for opcion_densidad in sorted(
        (d for d in DENSIDADES if d in admitidas),
        key=lambda d: (_distancia_densidad(d, densidad), DENSIDADES.index(d)),
    ):

        def candidata(pasos: int, d: str = opcion_densidad) -> dict[str, object]:
            return {
                **dict(estructura),
                "densidad": d,
                "mezcla": mezcla,
                "medidas": {**dict(medidas), clave: round(pasos * PASO_EJE_M, 2)},
            }

        bajo, alto = 1, tope
        while bajo < alto:
            medio = (bajo + alto) // 2
            if puerto.contar(candidata(medio)) >= objetivo:
                alto = medio
            else:
                bajo = medio + 1
        validas: list[Opcion] = []
        for pasos in (bajo - 1, bajo):
            if not 1 <= pasos <= tope:
                continue
            probada = candidata(pasos)
            total = puerto.contar(probada)
            if (
                total > 0
                and dentro_de_tolerancia(objetivo, total)
                and puerto.dentro_de_puerta(probada, total)
            ):
                nuevas = cast(Mapping[str, float], probada["medidas"])
                validas.append(
                    Opcion(opcion_densidad, mezcla, nuevas, total, nuevas[clave] / medidas[clave])
                )
        if validas:
            return min(validas, key=lambda o: (abs(o.total - objetivo), o.medidas[clave]))
    return None


def _cambios(antes: Mapping[str, object], despues: Mapping[str, object]) -> list[dict[str, object]]:
    cambios: list[dict[str, object]] = []
    for campo in ("densidad", "mezcla"):
        if antes.get(campo) != despues.get(campo):
            cambios.append(
                {"campo": campo, "antes": antes.get(campo), "despues": despues.get(campo)}
            )
    medidas_antes = cast(Mapping[str, object], antes.get("medidas") or {})
    medidas_despues = cast(Mapping[str, object], despues.get("medidas") or {})
    for campo in ("ancho_m", "alto_m", "largo_m"):
        if medidas_antes.get(campo) != medidas_despues.get(campo) and campo in medidas_despues:
            cambios.append(
                {
                    "campo": campo,
                    "antes": medidas_antes.get(campo, 0),
                    "despues": medidas_despues[campo],
                }
            )
    return cambios


def _frase_cambio(cambio: Mapping[str, object]) -> str:
    campo = str(cambio["campo"])
    if campo == "densidad":
        return f"densidad {cambio['antes']} → {cambio['despues']}"
    if campo == "mezcla":
        antes, despues = str(cambio["antes"]), str(cambio["despues"])
        return (
            f"tamaños {_NOMBRE_MEZCLA.get(antes, antes.replace('_', ' '))} → "
            f"{_NOMBRE_MEZCLA.get(despues, despues.replace('_', ' '))}, los de la foto"
        )
    return (
        f"{_NOMBRE_MEDIDA[campo]} {_numero_es(float(cast(float, cambio['antes'])))} → "
        f"{_numero_es(float(cast(float, cambio['despues'])))} m"
    )


def _frases_de_cambios(cambios: Sequence[Mapping[str, object]]) -> str:
    """Los cambios en palabras; las medidas en una sola cláusula que dice una vez
    que son equivalentes a la foto (el supuesto tiene que caber en el contrato)."""
    frases = [_frase_cambio(c) for c in cambios if not str(c["campo"]).endswith("_m")]
    medidas = [_frase_cambio(c) for c in cambios if str(c["campo"]).endswith("_m")]
    if len(medidas) == 1:
        frases.append(f"{medidas[0]} equivalente a la foto (no medido)")
    elif medidas:
        frases.append(f"{' y '.join(medidas)} equivalentes a la foto (no medidos)")
    return ", ".join(frases)


def _solo_mezcla(
    estructura: dict[str, object],
    lectura: Mapping[str, object],
    *,
    mezcla_fija: bool,
    puerto: PuertoPlan,
) -> _Resultado | None:
    """La mezcla de tamaños que muestra la foto, SIN tocar la cantidad.

    ``por_tamano`` es un dato independiente de la cuenta: una foto puede enseñar
    clarísimamente que hay muchos globos chicos de relleno y unos pocos grandes
    sin que se pueda contar cuántos hay. Hasta el 2026-09-30 el despachador se
    rendía antes de mirarlo —si la cuenta no era usable, la lectura ENTERA se
    tiraba— y la mezcla se quedaba con la de la tabla.

    Lo que costó: en la pared "Mr & Mrs" el plan compró 10 globos de 24"
    (0,56 m de diámetro, un cuarto del ancho de la pieza) porque la tabla
    `organica_fina` lleva un 2 % de R-24. La foto no tiene ninguno.

    Solo mueve la mezcla. La cantidad, las medidas y la densidad no se tocan:
    para eso hace falta una cuenta, y no la hay.
    """
    if mezcla_fija or puerto.tamanos_obligatorios:
        return None
    por_tamano = cast(Sequence[Mapping[str, object]], lectura.get("por_tamano") or [])
    if not por_tamano:
        return None
    confianza = lectura.get("confianza")
    if not isinstance(confianza, (int, float)) or float(confianza) < CONFIANZA_MINIMA_LECTURA:
        return None
    mezcla = str(estructura.get("mezcla") or "organica_fina")
    cambiar = mezcla_de_la_foto(por_tamano, puerto.mezclas, mezcla)
    if cambiar is None or not puerto.mezcla_cubierta(estructura, cambiar):
        return None
    despues = {**estructura, "mezcla": cambiar}
    return _Resultado(
        despues,
        "ajustado",
        None,
        puerto.contar(estructura),
        puerto.contar(despues),
        _cambios(estructura, despues),
        "La lectura no trae una cuenta confiable, pero sí el reparto por tamaño:"
        " se ajusta la mezcla y no la cantidad.",
    )


def _geometrica(
    estructura: dict[str, object],
    lectura: Mapping[str, object],
    cuenta: Cuenta,
    *,
    medidas_fijas: bool,
    mezcla_fija: bool,
    puerto: PuertoPlan,
) -> _Resultado:
    tipo = str(estructura.get("tipo"))
    densidad = str(estructura.get("densidad") or "media")
    mezcla = str(estructura.get("mezcla") or "organica_fina")
    medidas = {
        clave: float(cast(float, valor))
        for clave, valor in cast(Mapping[str, object], estructura.get("medidas") or {}).items()
        if isinstance(valor, (int, float))
    }
    antes = puerto.contar(estructura)
    nombre = _nombre_de_pieza(estructura)

    cambiar_mezcla = None
    if not mezcla_fija and not puerto.tamanos_obligatorios:
        cambiar_mezcla = mezcla_de_la_foto(
            cast(Sequence[Mapping[str, object]], lectura.get("por_tamano") or []),
            puerto.mezclas,
            mezcla,
        )
        if cambiar_mezcla is not None and not puerto.mezcla_cubierta(estructura, cambiar_mezcla):
            cambiar_mezcla = None
    mezcla_objetivo = cambiar_mezcla or mezcla

    elegida: Opcion | None = None
    if cambiar_mezcla is None and dentro_de_tolerancia(cuenta.globos, antes):
        return _Resultado(
            estructura, "coincide", cuenta.globos, antes, antes, [], "El plan ya sigue la foto."
        )
    # 1) Densidad (y la mezcla de la foto, si cambió) con las medidas del plan.
    elegida = elegir_opcion(
        cuenta.globos, densidad, _opciones(estructura, mezcla_objetivo, medidas, [1.0], puerto)
    )
    # 2) Solo si no alcanza: el eje dentro de ±35 % del plan o de la escala de la foto.
    if elegida is None and not medidas_fijas:
        centro = medidas_desde_referencia(tipo, medidas, lectura) or medidas
        pasos = round(VENTANA_EJE / PASO_VENTANA)
        factores = [round(1 + PASO_VENTANA * i, 2) for i in range(-pasos, pasos + 1)]
        elegida = elegir_opcion(
            cuenta.globos,
            densidad,
            _opciones(estructura, mezcla_objetivo, centro, factores, puerto),
        )
    # 3) Enmienda del 2026-09-28: las medidas no son fijas y la ventana no
    #    alcanza (su centro puede ser un largo que el chat puso sin dato): la
    #    cantidad de la foto decide el eje libre, si la pieza tiene uno solo.
    desde_conteo = False
    if elegida is None and not medidas_fijas:
        elegida = _eje_desde_conteo(
            estructura, densidad, mezcla_objetivo, medidas, cuenta.globos, puerto
        )
        desde_conteo = elegida is not None
    if elegida is None:
        if medidas_fijas:
            motivo = (
                "Con las medidas físicas fijas (cliente, foto o edición) ninguna densidad"
                " alcanza la cuenta de la foto."
            )
        elif eje_libre(tipo, medidas) is None:
            motivo = "Ninguna densidad ni medida dentro de ±35 % alcanza la cuenta de la foto."
        else:
            motivo = "Ningún largo dentro de la puerta física alcanza la cuenta de la foto."
        return _Resultado(estructura, "sin_ajuste_posible", cuenta.globos, antes, antes, [], motivo)

    candidata = _con(estructura, elegida)
    if candidata.get("patron_color") is not None:
        sincronizada = puerto.sincronizar_patron(candidata)
        if sincronizada is None:
            return _Resultado(
                estructura,
                "sin_ajuste_posible",
                cuenta.globos,
                antes,
                antes,
                [],
                "El patrón de color de la pieza no cabe en la pieza ajustada.",
            )
        candidata = sincronizada
    cambios = _cambios(estructura, candidata)
    if not cambios:
        return _Resultado(
            estructura, "coincide", cuenta.globos, antes, antes, [], "El plan ya sigue la foto."
        )
    por_pieza = " por pieza" if cast(int, estructura.get("repeticiones") or 1) > 1 else ""
    supuesto = acotar_supuesto(
        nombre,
        f"la foto muestra {_unos(cuenta)} globos{por_pieza} y el plan tenía {antes}; "
        f"{_frases_de_cambios(cambios)}: quedó en {elegida.total}.",
    )
    medidas_movidas = any(str(cambio["campo"]).endswith("_m") for cambio in cambios)
    motivo = (
        "La ventana de ±35 % no alcanzaba: la cantidad de la foto decide"
        " el eje. Es un largo equivalente a la foto, no una medida tomada."
        if desde_conteo and medidas_movidas
        else "Largo equivalente a la foto dentro de ±35 %: no es una medida tomada."
        if medidas_movidas
        else "Densidad y tamaños ajustados con las medidas del plan."
    )
    return _Resultado(
        candidata, "ajustado", cuenta.globos, antes, elegida.total, cambios, motivo, supuesto
    )


def _con_armado_del_motor(
    estructura: dict[str, object], cuenta: Cuenta, puerto: PuertoPlan
) -> _Resultado:
    """Una pieza geométrica que ya trae su armado del motor: el armado fija la cantidad, como el de un bouquet.

    El motor coloca cada globo y no lee la densidad, la mezcla ni las medidas del plan, así que ningún mando
    que este módulo mueve cambia su total. Probarlos solo dejaba un motivo falso («medidas físicas fijas»,
    «ningún largo alcanza…») o una mezcla cambiada en el plan que nada de lo que se compra seguía. Lo que acerca
    una pieza así a la foto son los mandos de su armado (``estimar_conteo``), no el conteo al confirmar.
    """
    antes = puerto.contar(estructura)
    if dentro_de_tolerancia(cuenta.globos, antes):
        return _Resultado(
            estructura, "coincide", cuenta.globos, antes, antes, [], "El plan ya sigue la foto."
        )
    return _Resultado(
        estructura,
        "sin_aplicar",
        cuenta.globos,
        antes,
        antes,
        [],
        f"La pieza trae armado del motor, que fija la cantidad ({antes} globos por pieza): ni la"
        " densidad, ni la mezcla ni las medidas del plan la mueven.",
    )


@dataclass(frozen=True)
class Ajuste:
    """Lo que la búsqueda geométrica halla para una pieza y una cuenta, sin tocar ningún plan.

    ``decision``: ``coincide`` (ya está dentro de la tolerancia), ``ajustado`` (``estructura``
    es la pieza con la menor variación que llega) o ``sin_ajuste_posible``.
    """

    decision: str
    estructura: Mapping[str, object]
    globos_antes: int
    globos_despues: int
    cambios: tuple[Mapping[str, object], ...]
    motivo: str


def buscar_ajuste(
    estructura: Mapping[str, object],
    cuenta: Cuenta,
    puerto: PuertoPlan,
    *,
    medidas_fijas: bool,
) -> Ajuste:
    """La menor variación de densidad y medidas que acerca una pieza geométrica a ``cuenta``.

    Es la misma búsqueda que corre al confirmar un plan con la foto (``_geometrica``: la
    densidad con las medidas fijas, luego las medidas dentro de ±35 %, y por último, si la
    pieza tiene un solo eje libre, el eje que da la cantidad), expuesta para consultarla
    sin aplicarla. Sin lectura de la foto no hay escala ni reparto por tamaño que la
    guíen, así que la mezcla nunca cambia. ``medidas_fijas``: las medidas son del cliente
    y no se mueven. Lo que devuelve es una propuesta; este módulo no la escribe.
    """
    resultado = _geometrica(
        dict(estructura),
        {},
        cuenta,
        medidas_fijas=medidas_fijas,
        mezcla_fija=True,
        puerto=puerto,
    )
    return Ajuste(
        resultado.decision,
        resultado.estructura,
        resultado.globos_antes,
        resultado.globos_despues,
        tuple(resultado.cambios),
        resultado.motivo,
    )


def _clase_leida(lectura: Mapping[str, object]) -> str | None:
    """La clase de tamaño que más pesa en ``por_tamano`` (empate: la mayor), o ``None`` sin reparto."""
    reparto = [
        item
        for item in cast(Sequence[object], lectura.get("por_tamano") or [])
        if isinstance(item, Mapping)
        and item.get("clase") in CLASES_TAMANO_NIVEL
        and isinstance(item.get("proporcion"), (int, float))
    ]
    if not reparto:
        return None
    clases = list(CLASES_TAMANO_NIVEL)
    mayor = max(
        reparto,
        key=lambda item: (float(cast(float, item["proporcion"])), clases.index(str(item["clase"]))),
    )
    return str(mayor["clase"])


def _variante_de_clase(variantes: Sequence[tuple[str, float]], clase: str | None) -> str | None:
    """La variante que compra un globo de esa clase.

    La mayor de la clase (un globo solo es el que destaca); si el producto no tiene ninguna de esa
    clase, la más cercana a su rango; sin clase leída, la mayor. Empates por ``variant_id`` para
    que dos resoluciones elijan lo mismo.
    """
    if not variantes:
        return None
    if clase is None:
        return max(variantes, key=lambda v: (v[1], v[0]))[0]
    minimo, maximo = CLASES_TAMANO_NIVEL[clase]
    de_la_clase = [v for v in variantes if minimo <= v[1] <= maximo]
    if de_la_clase:
        return max(de_la_clase, key=lambda v: (v[1], v[0]))[0]
    return min(variantes, key=lambda v: (max(minimo - v[1], v[1] - maximo), -v[1], v[0]))[0]


def _centro_contado(
    estructura: Mapping[str, object],
    lectura: Mapping[str, object],
    cuenta: Cuenta,
    puerto: PuertoPlan,
) -> _Resultado | None:
    """Un centro de mesa que la foto cuenta EXACTAMENTE en 1 a 3 globos se compra por globos (UI-6).

    La geometría no puede: la banda × eje de ``plan._total_globos`` no baja de unos 3 globos y
    ``_geometrica`` acababa en ``sin_ajuste_posible`` con 14 globos, o ajustaba a 3 o a 22, ante una
    foto que dice «1 globo, exacto» con confianza 0,9 (CASE-006 de images-judge, 3 de 3 corridas).

    La pieza pasa a ``unidades_declaradas`` = cuenta × repeticiones, cada material con la variante
    redonda del tamaño que la foto leyó (``_variante_de_clase``). Con más materiales que globos se
    quedan los que más pesan (el principal primero): cada material comprado es al menos un globo.
    El patrón de color deja de aplicar (no hay racimos). ``None`` cuando no es un caso de esto o el
    turno no trae una variante para algún material: entonces decide la geometría, como antes.
    """
    if not cuenta.exacto or not 1 <= cuenta.globos <= MAX_GLOBOS_CENTRO_CONTADO:
        return None
    if es_centro_contado(estructura) and _globos_actuales(estructura, puerto) == cuenta.globos:
        # Una segunda resolución del mismo plan es punto fijo: no se reelige nada.
        actual = cuenta.globos
        return _Resultado(dict(estructura), "coincide", actual, actual, actual, [], "El plan ya sigue la foto.")
    materiales = [dict(m) for m in cast(Sequence[Mapping[str, object]], estructura.get("materiales") or [])]
    if not materiales:
        return None

    def peso(indice: int) -> tuple[bool, float, int]:
        material = materiales[indice]
        participacion = material.get("participacion")
        return (
            material.get("rol_material") != "principal",
            -float(participacion) if isinstance(participacion, (int, float)) else 0.0,
            indice,
        )

    quedan = sorted(sorted(range(len(materiales)), key=peso)[: cuenta.globos])
    clase = _clase_leida(lectura)
    elegidos: list[dict[str, object]] = []
    for indice in quedan:
        material = materiales[indice]
        variante = _variante_de_clase(puerto.variantes_redondas(str(material.get("product_id") or "")), clase)
        if variante is None:
            return None
        elegidos.append({**material, "variant_id": variante})
    suma = sum(
        float(cast(float, m["participacion"])) for m in elegidos if isinstance(m.get("participacion"), (int, float))
    )
    for material in elegidos:
        parte = material.get("participacion")
        material["participacion"] = (
            round(float(cast(float, parte)) / suma, 4)
            if suma > 0 and isinstance(parte, (int, float))
            else round(1 / len(elegidos), 4)
        )
    # Las participaciones suman 1 (±0,001): el redondeo se lo queda el primero.
    elegidos[0]["participacion"] = round(1 - sum(float(cast(float, m["participacion"])) for m in elegidos[1:]), 4)
    if not any(m.get("rol_material") == "principal" for m in elegidos):
        elegidos[0]["rol_material"] = "principal"
    reps = max(1, cast(int, estructura.get("repeticiones") or 1))
    antes = _globos_actuales(estructura, puerto)
    item = {k: v for k, v in estructura.items() if k != "patron_color"}
    item["materiales"] = elegidos
    item["unidades_declaradas"] = cuenta.globos * reps
    nombre = _nombre_de_pieza(estructura)
    quitados = len(materiales) - len(elegidos)
    supuesto = acotar_supuesto(
        nombre,
        f"la foto muestra {cuenta.globos} {'globo' if cuenta.globos == 1 else 'globos'} por pieza, contados uno a uno:"
        f" se compran {cuenta.globos * reps} en vez de {antes * reps}"
        + (f" y se dejan fuera {quitados} {'color' if quitados == 1 else 'colores'} que no caben" if quitados else "")
        + ".",
    )
    return _Resultado(
        item,
        "ajustado",
        cuenta.globos,
        antes,
        cuenta.globos,
        [{"campo": "unidades_declaradas", "antes": antes * reps, "despues": cuenta.globos * reps}],
        "La cuenta exacta de la foto manda: un centro de mesa de pocos globos se compra por globos, no por banda.",
        supuesto,
    )


def _globos_actuales(estructura: Mapping[str, object], puerto: PuertoPlan) -> int:
    """Globos por pieza del plan tal como está (kits y centros contados: lo declarado entre las repeticiones)."""
    if es_geometrica(estructura):
        return puerto.contar(estructura)
    if estructura.get("tipo") == "kit" or es_centro_contado(estructura):
        reps = max(1, cast(int, estructura.get("repeticiones") or 1))
        return round(cast(int, estructura.get("unidades_declaradas") or 0) / reps)
    return 0


def aplicar(
    plan: Mapping[str, object],
    pistas: Sequence[Mapping[str, object]],
    pistas_armado: Sequence[Mapping[str, object]],
    *,
    usar_armados: bool,
    solo: Collection[str] | None,
    puerto: PuertoPlan,
    mezclas_leidas: Collection[str] = (),
) -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]]]:
    """El plan con cada pieza ajustada a la cuenta de su foto.

    Devuelve el plan, las lecturas del armado que deben usar los armados (las
    reescaladas en lugar de las leídas, sin las descartadas) y
    ``conteos_referencia``: una entrada por estructura con pista, con lo que se
    decidió y por qué. ``usar_armados``: la resolución completa armados de
    bouquet (sin eso, la lectura del armado no decide nada). ``solo``: tras una
    edición, solo esas estructuras se ajustan (con la mezcla que eligió el
    decorador); las demás con pista quedan ``sin_aplicar`` y conservan su
    lectura en ``conteos_referencia``.

    ``mezclas_leidas``: los elementos cuya mezcla ya la dijo la lectura de tamaños de la foto
    (``pistas_tamanos``, la misma que arma el motor). Su reparto por tamaño no la vuelve a mover: el
    del conteo cuenta también el globo que corona una columna, y unas columnas clásicas que la lectura
    de tamaños dejó en ``clasica`` salían ``organica_fina`` con un armado de anillos (2026-10-05).
    """
    por_elemento = {str(p["referencia_element_id"]): p for p in pistas}
    armados = {str(p.get("referencia_element_id")): dict(p) for p in pistas_armado}
    medidas_fijas = cast(Mapping[str, object], plan.get("espacio") or {}).get("fuente") == "cliente"
    estructuras: list[object] = []
    supuestos = [s for s in cast(list[object], plan.get("supuestos") or []) if isinstance(s, str)]
    originales = list(supuestos)
    if solo is not None:
        # Tras una edición, el supuesto que el conteo escribió al confirmar esa
        # pieza ya no describe el plan (revisión 34): se reemplaza, no se suma.
        for cruda in cast(list[object], plan.get("estructuras") or []):
            estructura = cast(Mapping[str, object], cruda)
            if str(estructura.get("estructura_id")) in solo and (
                str(estructura.get("referencia_element_id")) in por_elemento
            ):
                nombre = _nombre_de_pieza(estructura)
                supuestos = [s for s in supuestos if not _es_supuesto_de_conteo(s, nombre)]
    conteos: list[dict[str, object]] = []
    for cruda in cast(list[object], plan.get("estructuras") or []):
        estructura = dict(cast(Mapping[str, object], cruda))
        estructura_id = str(estructura.get("estructura_id"))
        elemento = estructura.get("referencia_element_id")
        pista = por_elemento.get(str(elemento)) if isinstance(elemento, str) else None
        if pista is None:
            estructuras.append(cruda)
            continue
        lectura = {k: v for k, v in pista.items() if k != "referencia_element_id"}
        cuenta = cuenta_usable(lectura)
        tipo = estructura.get("tipo")
        if solo is not None and estructura_id not in solo:
            # Tras una edición solo se ajusta la pieza editada; las demás
            # conservan su lectura (una edición posterior la vuelve a mandar).
            actual = _globos_actuales(estructura, puerto)
            resultado = _Resultado(
                estructura,
                "sin_aplicar",
                cuenta.globos if cuenta is not None else None,
                actual,
                actual,
                [],
                "Esta resolución solo ajusta la pieza editada.",
            )
        elif cuenta is None:
            # Sin cuenta usable no se puede ajustar la cantidad, pero el reparto
            # por TAMAÑO es otro dato y puede venir perfectamente legible.
            por_mezcla = _solo_mezcla(
                dict(estructura),
                lectura,
                mezcla_fija=solo is not None or elemento in mezclas_leidas,
                puerto=puerto,
            )
            if por_mezcla is not None:
                resultado = por_mezcla
            else:
                actual = _globos_actuales(estructura, puerto)
                resultado = _Resultado(
                    estructura,
                    "no_confiable",
                    None,
                    actual,
                    actual,
                    [],
                    "La lectura no trae una cuenta confiable (confianza, exacta, estimado o racimos).",
                )
        elif tipo == "kit":
            leida = armados.get(str(elemento)) if usar_armados else None
            confiable = (
                leida is not None
                and float(cast(float, leida.get("confianza", 0))) >= CONFIANZA_MINIMA_LECTURA
            )
            resultado, lectura_armado, descartar = _kit(
                estructura,
                cuenta,
                leida if confiable else None,
                cast(Sequence[Mapping[str, object]], lectura.get("por_tamano") or []),
                puerto,
            )
            if confiable and descartar:
                armados.pop(str(elemento), None)
            elif confiable and lectura_armado is not None:
                armados[str(elemento)] = dict(lectura_armado)
        elif tipo == "centro_mesa" and (
            contado := _centro_contado(estructura, lectura, cuenta, puerto)
        ) is not None:
            resultado = contado
        elif es_centro_contado(estructura):
            # Ya se compra por globos y esta cuenta no es de pocos globos exactos: la geometría no
            # aplica a una pieza declarada, así que se queda como está y se dice.
            actual = _globos_actuales(estructura, puerto)
            resultado = _Resultado(
                estructura,
                "sin_ajuste_posible",
                cuenta.globos,
                actual,
                actual,
                [],
                "Un centro de mesa de globos contados solo sigue una cuenta exacta de pocos globos.",
            )
        elif tipo in TIPOS_GEOMETRICOS and puerto.cuenta_el_motor(estructura):
            resultado = _con_armado_del_motor(estructura, cuenta, puerto)
        elif tipo in TIPOS_GEOMETRICOS:
            resultado = _geometrica(
                estructura,
                lectura,
                cuenta,
                # Del cliente (espacio o estructura), la caja de foto o una edición: el conteo
                # solo ajusta densidad (revisión 33).
                medidas_fijas=medidas_fijas
                or puerto.medidas_del_cliente(estructura)
                or solo is not None,
                mezcla_fija=solo is not None or elemento in mezclas_leidas,
                puerto=puerto,
            )
        else:
            resultado = _Resultado(
                estructura,
                "sin_ajuste_posible",
                cuenta.globos,
                0,
                0,
                [],
                "Este tipo de pieza no se cuenta en globos.",
            )
        estructuras.append(resultado.estructura)
        if resultado.supuesto:
            # Dentro de maxItems; si no cabe, el ajuste sigue en conteos_referencia.
            agregar_supuesto(supuestos, resultado.supuesto)
        conteos.append(
            {
                "estructura_id": estructura_id,
                "referencia_element_id": str(elemento),
                "decision": resultado.decision,
                "lectura": lectura,
                "globos_foto": resultado.globos_foto,
                "globos_antes": resultado.globos_antes,
                "globos_despues": resultado.globos_despues,
                "cambios": resultado.cambios,
                "motivo": resultado.motivo,
            }
        )
    nuevo = {**dict(plan), "estructuras": estructuras}
    if supuestos != originales or any(c["decision"] == "ajustado" for c in conteos):
        nuevo["supuestos"] = list(dict.fromkeys(supuestos))
    # Las lecturas del armado en el orden en que llegaron, con las reescaladas en su lugar.
    lecturas_armado = [
        armados[str(p.get("referencia_element_id"))]
        for p in pistas_armado
        if str(p.get("referencia_element_id")) in armados
    ]
    return nuevo, lecturas_armado, conteos


__all__ = [
    "ALTURA_REFERENCIA_M",
    "MAX_GLOBOS_CENTRO_CONTADO",
    "Ajuste",
    "Cuenta",
    "Opcion",
    "PuertoPlan",
    "aplicar",
    "buscar_ajuste",
    "clase_de_diametro",
    "cuenta_usable",
    "dentro_de_tolerancia",
    "eje_libre",
    "es_centro_contado",
    "es_geometrica",
    "elegir_opcion",
    "medidas_desde_referencia",
    "mezcla_de_la_foto",
    "reescalar_lectura_armado",
    "total_kit_con_armado",
    "total_kit_sin_armado",
    "validar_pistas",
]
