"""Armado de un bouquet por niveles (ADR-0030): el único dueño de sus reglas.

Un armado dice qué globo va en cada nivel del bouquet, cuál es el remate y
dónde van los globos número. Apunta a ``materiales`` por índice, como
``patron_color``. Este módulo lo valida, sugiere uno cuando falta (desde la
lectura de la foto o por receta), y lo resuelve en lo que dibuja la hoja de
armado: leyenda con un código por globo comprado, niveles, insumos que el
catálogo no vende, pasos y avisos.

**Nunca cambia lo que se compra.** Las cantidades por material las decide
``plan._distribute_units`` a partir de ``unidades_declaradas``; un armado solo
las acomoda. Por eso validar exige que el armado cuente exactamente esas
cantidades, y la receta reparte esas mismas unidades (el sobrante queda como
globos sueltos). El precio de un plan es idéntico con y sin armado.

Tablas y su fuente (datos publicados, no supuestos):

- Unidades de armado: Sempertex, "Conceptos y técnicas – globos redondos"
  (pareja 2, trío 3, cuarteto 4, quinteto 5, sexteto 6).
- Látex con helio: tabla de especificaciones de helio de Sempertex (2022):
  sustentación en gramos, gas en m³ y horas de flotación por tamaño. R-5 no
  flota. Anagram: el látex de menos de 9" va con aire.
- Peso para sujetar cada globo: "Helium & Weight Chart", Balloons Are
  Everywhere (2014): 11" látex 12 g, 16" látex 36 g, foil estándar 8 g, 32" XL
  jumbo 50 g, 36" jumbo 55 g, burbujas 30 g; "para un bouquet, suma el peso de
  cada globo". Donde la tabla no tiene fila se usa la sustentación de Sempertex
  y el valor queda marcado como estimado.

Reglas del negocio (propuestas en ADR-0030 y validadas el 2026-09-25): los
números de 16" o menos van con aire en varilla; la receta sin foto elige base
de aire si hay látex chico o números chicos, helio apilado con 6 o más látex
grandes en múltiplos de 3 y, si no, escalonado; con base, los dos primeros
cuartetos son la base y el resto el cuerpo; una cantidad par en helio solo
avisa; los pesos sin fila en la tabla se marcan como estimados.

Además de resolver, este módulo redacta la frase del armado para el prompt de
imagen (``prompt_gemini``, ``prompt_lora``), como hace ``patron_color`` con los
patrones: TypeScript la inserta tal cual y nunca la redacta (ADR-0028 §12).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from jsonschema import Draft7Validator

from app.generated_models import contract_schema
from app.patron_color import (
    MaterialPatron,
    color_con_acabado_en,
    lista_en,
    material_de_color,
    nombre_color_en,
)


VERSION_ARMADO = "armado-bouquet.v1"
CONFIANZA_MINIMA_LECTURA = 0.5
MAX_NIVELES = 8
MAX_REMATE = 4
VARIANTES = ("base_aire", "helio_apilado", "helio_escalonado")
DISPOSICIONES = ("centro", "lados", "arriba", "abajo")

GLOBOS_POR_UNIDAD: Mapping[str, int] = {
    "suelto": 1,
    "pareja": 2,
    "trio": 3,
    "cuarteto": 4,
    "quinteto": 5,
    "sexteto": 6,
}
#: Unidades iguales que puede tener un nivel (contrato ``armado-bouquet.v1``).
MAX_CANTIDAD_NIVEL = 24
#: Globos sueltos que la lectura describe por grupo repetido (``LecturaArmadoSchema``).
MAX_SUELTOS_LEIDOS = 6
#: Clase de tamaño que la lectura de la foto puede dar a un nivel, en pulgadas
#: (rangos del catálogo Sempertex: R-5/R-9, R-11/R-12, R-16/R-18, R-24 a R-36).
CLASES_TAMANO_NIVEL: Mapping[str, tuple[float, float]] = {
    "chico": (5.0, 9.0),
    "mediano": (11.0, 12.0),
    "grande": (16.0, 18.0),
    "gigante": (24.0, 36.0),
}
#: Techo de ``total_leido``: todos los niveles de sueltos al tope, remate y dos
#: grupos (números a los lados), más tres dígitos.
MAX_TOTAL_LEIDO = (MAX_NIVELES * MAX_SUELTOS_LEIDOS * MAX_CANTIDAD_NIVEL + 1) * 2 + 3
VARIANTES_HELIO = frozenset({"helio_apilado", "helio_escalonado"})
#: Por debajo de este diámetro el látex va con aire (Anagram; R-5 no flota).
LATEX_MINIMO_HELIO_PULG = 9.0
#: Números de este tamaño o menos van con aire en varilla (regla del negocio, ADR-0030).
NUMERO_MAXIMO_AIRE_PULG = 16.0
FORMAS_LATEX = frozenset({"redondo", "corazon", "link", "modelar"})

_FT3_A_M3 = 0.0283168


@dataclass(frozen=True)
class _Helio:
    #: Gramos que hay que sujetar por globo.
    peso_g: int
    peso_estimado: bool
    gas_m3: float
    horas_min: int
    horas_max: int


# Látex redondo por diámetro (Sempertex; peso del distribuidor cuando hay fila).
_LATEX: Mapping[int, _Helio] = {
    9: _Helio(6, True, 0.007, 10, 14),
    10: _Helio(6, True, 0.008, 12, 16),
    11: _Helio(12, False, 0.015, 18, 24),
    12: _Helio(12, False, 0.015, 18, 24),
    16: _Helio(36, False, 0.042, 30, 30),
    18: _Helio(51, True, 0.056, 36, 36),
    24: _Helio(90, True, 0.110, 48, 48),
    30: _Helio(186, False, 0.183, 48, 96),
    36: _Helio(184, True, 0.226, 72, 120),
}
_CORAZON_LATEX_12 = _Helio(3, True, 0.009, 14, 14)
# Metalizados (distribuidor): estándar hasta 20", jumbo 32"/36", burbujas.
_FOIL_ESTANDAR = _Helio(8, False, 0.5 * _FT3_A_M3, 168, 336)
_FOIL_JUMBO_32 = _Helio(50, False, 1.5 * _FT3_A_M3, 336, 504)
_FOIL_JUMBO_36 = _Helio(55, False, 4.4 * _FT3_A_M3, 336, 504)
_FOIL_FORMA_GRANDE = _Helio(50, True, 1.5 * _FT3_A_M3, 504, 840)
_BURBUJA = _Helio(30, False, 1.2 * _FT3_A_M3, 168, 240)

_ESQUEMA_ESTRUCTURA: Mapping[str, Mapping[str, object]] = contract_schema("PlanDecoracion")[
    "properties"
]["estructuras"]["items"]["properties"]
_ESQUEMA_ARMADO: Mapping[str, object] = _ESQUEMA_ESTRUCTURA["armado_bouquet"]
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)
#: Tope de ``unidades_declaradas`` del contrato del plan: una foto que pida más
#: globos no manda (la compra sigue siendo la del plan).
MAX_UNIDADES_DECLARADAS = cast(int, _ESQUEMA_ESTRUCTURA["unidades_declaradas"]["maximum"])


class ArmadoInvalido(ValueError):
    """Un armado que no se puede armar o no corresponde a lo que se compra."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True)
class GloboCatalogo:
    """Lo que el catálogo dice de la variante que compra un material."""

    product_id: str
    variant_id: str
    titulo: str
    forma: str | None
    diam_pulg: float | None
    codigo_tamano: str | None
    color: str | None
    acabado: str | None


@dataclass(frozen=True)
class MaterialBouquet:
    indice: int
    tipo: str  # latex | metalizado | burbuja | numero
    tamano_pulg: float | None
    digito: str | None
    globo: GloboCatalogo


@dataclass(frozen=True)
class EstructuraBouquet:
    estructura_id: str
    es_bouquet: bool
    repeticiones: int
    #: ``None`` en la posición de un material que el catálogo no permite clasificar.
    materiales: tuple[MaterialBouquet | None, ...]
    #: Unidades por material de toda la estructura (todas sus repeticiones).
    cantidades: tuple[int, ...]


@dataclass(frozen=True)
class _Expansion:
    grupos: int
    por_grupo: tuple[int, ...]


def _plegar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto)
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").lower()


def _tamano(globo: GloboCatalogo) -> float | None:
    if globo.diam_pulg is not None and globo.diam_pulg > 0:
        return globo.diam_pulg
    for texto in (globo.codigo_tamano or "", globo.titulo):
        encontrado = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:in\b|pulg|\")", _plegar(texto))
        if encontrado:
            return float(encontrado.group(1).replace(",", "."))
    return None


def clasificar(indice: int, globo: GloboCatalogo) -> MaterialBouquet | None:
    """El tipo de globo de un material, o ``None`` si no se puede saber."""
    titulo = _plegar(globo.titulo)
    tamano = _tamano(globo)
    if globo.forma in FORMAS_LATEX:
        return MaterialBouquet(indice, "latex", tamano, None, globo)
    # Un cartel o una guirnalda metalizada no es un globo: no se arma (visto en
    # el catálogo real el 2026-09-25, "Cartel Letras Metalizado Corazones").
    if re.search(r"\b(?:cartel|banner|guirnalda|letrero)\b", titulo):
        return None
    digito = re.search(r"\bnumero\s+(\d)(?!\d)", titulo)
    if digito:
        return MaterialBouquet(indice, "numero", tamano, digito.group(1), globo)
    if re.search(r"\b(?:burbuja|bubble)", titulo):
        return MaterialBouquet(indice, "burbuja", tamano, None, globo)
    if re.search(r"\b(?:metalizad|foil)", titulo):
        return MaterialBouquet(indice, "metalizado", tamano, None, globo)
    return None


def _helio_de(material: MaterialBouquet) -> _Helio | None:
    tamano = material.tamano_pulg
    if material.tipo == "latex":
        if tamano is None or tamano < LATEX_MINIMO_HELIO_PULG:
            return None
        if material.globo.forma == "corazon":
            return _CORAZON_LATEX_12
        clave = min(_LATEX, key=lambda diametro: (abs(diametro - tamano), diametro))
        return _LATEX[clave]
    if material.tipo == "burbuja":
        return _BURBUJA
    if material.tipo == "numero":
        if tamano is not None and tamano <= NUMERO_MAXIMO_AIRE_PULG:
            return None
        if tamano is not None and tamano <= 32:
            return _FOIL_JUMBO_32 if tamano >= 30 else _FOIL_FORMA_GRANDE
        return _FOIL_FORMA_GRANDE
    if tamano is not None and tamano >= 36:
        return _FOIL_JUMBO_36
    if tamano is not None and tamano >= 30:
        return _FOIL_JUMBO_32
    return _FOIL_ESTANDAR


# --- Validación --------------------------------------------------------------


def _indices(armado: Mapping[str, object]) -> list[int]:
    usados: list[int] = []
    for nivel in cast(list[Mapping[str, object]], armado.get("niveles", [])):
        usados.extend(cast(list[int], nivel["posiciones"]))
    usados.extend(cast(list[int], armado.get("remate", [])))
    numero = armado.get("numero")
    if isinstance(numero, Mapping):
        usados.extend(cast(list[int], numero["digitos"]))
    return usados


def _grupos(armado: Mapping[str, object]) -> int:
    numero = armado.get("numero")
    if isinstance(numero, Mapping) and numero.get("disposicion") == "lados":
        return len(cast(list[int], numero["digitos"]))
    return 1


def validar(estructura: EstructuraBouquet, armado: Mapping[str, object]) -> _Expansion:
    """Valida el armado contra la estructura y lo que compra. ``ArmadoInvalido`` si no."""
    if not estructura.es_bouquet:
        raise ArmadoInvalido("no_es_bouquet", "Solo un bouquet puede tener armado por niveles.")
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido("forma_invalida", "El armado no tiene la forma de armado-bouquet.v1.")
    n = len(estructura.materiales)
    niveles = cast(list[Mapping[str, object]], armado["niveles"])
    if not niveles and "remate" not in armado and "numero" not in armado:
        raise ArmadoInvalido("armado_vacio", "El armado no tiene ningún globo.")
    for nivel in niveles:
        if len(cast(list[int], nivel["posiciones"])) != GLOBOS_POR_UNIDAD[str(nivel["unidad"])]:
            raise ArmadoInvalido(
                "posiciones_no_coinciden_con_unidad",
                f"Un {nivel['unidad']} lleva {GLOBOS_POR_UNIDAD[str(nivel['unidad'])]} globos.",
            )
    usados = _indices(armado)
    if any(indice >= n for indice in usados):
        raise ArmadoInvalido(
            "material_fuera_de_rango", "El armado nombra un material que no existe."
        )
    numero = armado.get("numero")
    grupos = _grupos(armado)
    if isinstance(numero, Mapping) and numero.get("disposicion") == "lados" and grupos != 2:
        raise ArmadoInvalido("lados_sin_dos_digitos", "Un número a cada lado necesita dos dígitos.")
    por_grupo = [0] * n
    for nivel in niveles:
        for indice in cast(list[int], nivel["posiciones"]):
            por_grupo[indice] += cast(int, nivel["cantidad"])
    for indice in cast(list[int], armado.get("remate", [])):
        por_grupo[indice] += 1
    digitos = cast(list[int], numero["digitos"]) if isinstance(numero, Mapping) else []
    totales = [cantidad * grupos * estructura.repeticiones for cantidad in por_grupo]
    for indice in digitos:
        # Con "lados" cada grupo lleva uno de los dígitos: cada dígito se compra una vez.
        totales[indice] += estructura.repeticiones
    if tuple(totales) != estructura.cantidades:
        raise ArmadoInvalido(
            "unidades_no_coinciden",
            "El armado no usa exactamente los globos que el plan compra.",
        )
    if armado["variante"] in VARIANTES_HELIO:
        for material in estructura.materiales:
            if (
                material is not None
                and material.tipo == "latex"
                and estructura.cantidades[material.indice] > 0
                and (material.tamano_pulg is None or material.tamano_pulg < LATEX_MINIMO_HELIO_PULG)
            ):
                raise ArmadoInvalido(
                    "latex_pequeno_con_helio",
                    'El látex de menos de 9" no flota con helio: ese bouquet va con base de aire.',
                )
    return _Expansion(grupos, tuple(por_grupo))


# --- Sugerencia (lectura de la foto o receta) --------------------------------


def _intercalar(cuentas: Sequence[tuple[int, int]]) -> list[int]:
    """Globos por material en orden intercalado: el de más cuota primero, por turnos."""
    restantes = [list(item) for item in cuentas if item[1] > 0]
    secuencia: list[int] = []
    while restantes:
        for item in restantes:
            secuencia.append(item[0])
            item[1] -= 1
        restantes = [item for item in restantes if item[1] > 0]
    return secuencia


def _en_unidades(
    secuencia: Sequence[int], unidad: str, roles: Sequence[str]
) -> tuple[list[dict[str, object]], list[int]]:
    """Corta la secuencia en unidades y junta las consecutivas iguales en niveles.

    ``roles[i]`` es el rol de la unidad ``i`` (el último se repite). Devuelve los
    niveles y los globos que no completan una unidad.
    """
    k = GLOBOS_POR_UNIDAD[unidad]
    completas = len(secuencia) // k
    niveles: list[dict[str, object]] = []
    for i in range(completas):
        posiciones = list(secuencia[i * k : (i + 1) * k])
        rol = roles[min(i, len(roles) - 1)]
        if niveles and niveles[-1]["posiciones"] == posiciones and niveles[-1]["rol"] == rol:
            niveles[-1]["cantidad"] = cast(int, niveles[-1]["cantidad"]) + 1
        else:
            niveles.append({"rol": rol, "unidad": unidad, "cantidad": 1, "posiciones": posiciones})
    return niveles, list(secuencia[completas * k :])


def _sueltos(cuentas: Sequence[tuple[int, int]], rol: str) -> list[dict[str, object]]:
    return [
        {"rol": rol, "unidad": "suelto", "cantidad": cantidad, "posiciones": [indice]}
        for indice, cantidad in cuentas
        if cantidad > 0
    ]


def _cuentas(indices: Sequence[int]) -> list[tuple[int, int]]:
    orden: dict[int, int] = {}
    for indice in indices:
        orden[indice] = orden.get(indice, 0) + 1
    return list(orden.items())


def _orden_por_lectura(
    materiales: Sequence[MaterialBouquet], lectura: Mapping[str, object] | None
) -> dict[int, int]:
    """Prioridad de cada material según el orden de colores que leyó la foto."""
    if lectura is None:
        return {}
    patrones = [MaterialPatron(m.globo.color, m.globo.acabado, 1.0) for m in materiales]
    prioridad: dict[int, int] = {}
    for nivel in cast(list[Mapping[str, object]], lectura.get("niveles", [])):
        for color in cast(list[str], nivel.get("colores", [])):
            posicion = material_de_color(patrones, color)
            if posicion is not None and materiales[posicion].indice not in prioridad:
                prioridad[materiales[posicion].indice] = len(prioridad)
    return prioridad


@dataclass(frozen=True)
class _Capacidades:
    """Lo que la compra de un bouquet permite armar, antes de elegir cómo."""

    materiales: tuple[MaterialBouquet, ...]
    por_instancia: tuple[int, ...]
    #: Un índice por globo número comprado (por instancia).
    digitos: tuple[int, ...]
    puede_helio: bool

    @property
    def variantes(self) -> list[str]:
        return list(VARIANTES) if self.puede_helio else ["base_aire"]

    @property
    def disposiciones(self) -> list[str]:
        """Sin números no hay disposición; ``lados`` exige dos dígitos y reparto par."""
        if not self.digitos:
            return []
        no_digitos = [self.por_instancia[m.indice] for m in self.materiales if m.tipo != "numero"]
        lados = len(self.digitos) == 2 and not any(c % 2 for c in no_digitos)
        return [d for d in DISPOSICIONES if d != "lados" or lados]


def _capacidades(estructura: EstructuraBouquet) -> _Capacidades | None:
    """``None`` si la compra no se puede armar: sin clasificar o sin repartir por repetición."""
    if not estructura.es_bouquet or any(m is None for m in estructura.materiales):
        return None
    reps = estructura.repeticiones
    if any(c % reps for c in estructura.cantidades):
        return None
    materiales = tuple(m for m in estructura.materiales if m is not None)
    por_instancia = tuple(c // reps for c in estructura.cantidades)
    digitos = tuple(
        m.indice for m in materiales for _ in range(por_instancia[m.indice]) if m.tipo == "numero"
    )
    if len(digitos) > 3:
        return None
    numero_chico = any(
        m.tipo == "numero"
        and m.tamano_pulg is not None
        and m.tamano_pulg <= NUMERO_MAXIMO_AIRE_PULG
        for m in materiales
        if por_instancia[m.indice] > 0
    )
    latex_chico = any(
        por_instancia[m.indice]
        for m in materiales
        if m.tipo == "latex" and (m.tamano_pulg or 0) < LATEX_MINIMO_HELIO_PULG
    )
    return _Capacidades(materiales, por_instancia, digitos, not numero_chico and not latex_chico)


def variantes_admitidas(estructura: EstructuraBouquet) -> list[str]:
    """Estilos que el editor ofrece para la pieza: vacío si no se puede armar."""
    capacidades = _capacidades(estructura)
    return capacidades.variantes if capacidades is not None else []


def disposiciones_admitidas(estructura: EstructuraBouquet) -> list[str]:
    """Dónde pueden ir los números de la pieza: vacío sin números o sin armado posible."""
    capacidades = _capacidades(estructura)
    return capacidades.disposiciones if capacidades is not None else []


def sugerir_armado(
    estructura: EstructuraBouquet,
    lectura: Mapping[str, object] | None = None,
    *,
    variante: str | None = None,
    disposicion: str | None = None,
) -> dict[str, object] | None:
    """Un armado que acomoda exactamente lo que el plan compra, o ``None``.

    Con ``lectura`` (y confianza suficiente) la foto decide la variante, la
    disposición del número y el orden de colores; si lo que leyó no se puede
    armar con esos globos, decide la receta. ``variante`` y ``disposicion``
    son lo que el decorador eligió en el editor (vista previa): mandan sobre la
    foto y, si la compra no los admite, ``ArmadoInvalido``
    (``variante_no_admitida``, ``disposicion_no_admitida``). ``None`` cuando no
    se puede armar sin cambiar la compra (materiales sin clasificar, cantidades
    que no se reparten entre repeticiones): la estructura queda como hoy.
    """
    capacidades = _capacidades(estructura)
    if capacidades is None:
        return None
    materiales = capacidades.materiales
    por_instancia = capacidades.por_instancia
    digitos = list(capacidades.digitos)
    puede_helio = capacidades.puede_helio
    if variante is not None and variante not in capacidades.variantes:
        raise ArmadoInvalido(
            "variante_no_admitida",
            'El látex de menos de 9" y los números chicos no flotan: este bouquet va con base de aire.',
        )
    if disposicion is not None and disposicion not in capacidades.disposiciones:
        raise ArmadoInvalido(
            "disposicion_no_admitida",
            "Un número a cada lado necesita dos dígitos y un reparto par del resto de los globos.",
        )
    if (
        lectura is not None
        and float(cast(float, lectura.get("confianza", 0))) < CONFIANZA_MINIMA_LECTURA
    ):
        lectura = None

    foils = sorted(
        (m for m in materiales if m.tipo in ("metalizado", "burbuja")),
        key=lambda m: -(m.tamano_pulg or 0),
    )
    grandes = [
        m
        for m in materiales
        if m.tipo == "latex" and (m.tamano_pulg or 0) >= LATEX_MINIMO_HELIO_PULG
    ]
    chicos = [
        m
        for m in materiales
        if m.tipo == "latex" and (m.tamano_pulg or 0) < LATEX_MINIMO_HELIO_PULG
    ]

    prioridad = _orden_por_lectura(materiales, lectura)
    cuentas_grandes = sorted(
        ((m.indice, por_instancia[m.indice]) for m in grandes),
        key=lambda item: (prioridad.get(item[0], len(prioridad)), -item[1], item[0]),
    )
    total_grandes = sum(c for _, c in cuentas_grandes)

    if variante is None:
        variante = str(lectura["variante"]) if lectura is not None else None
        if variante in VARIANTES_HELIO and not puede_helio:
            variante = None
    if variante is None:
        if not puede_helio:
            variante = "base_aire"
        elif total_grandes >= 6 and total_grandes % 3 == 0:
            variante = "helio_apilado"
        else:
            variante = "helio_escalonado"

    if disposicion is None:
        disposicion = "centro"
        if digitos:
            pedida = str(lectura.get("disposicion", "")) if lectura is not None else ""
            if pedida in capacidades.disposiciones:
                disposicion = pedida
    grupos = 2 if disposicion == "lados" else 1
    cuentas_grupo = [(i, c // grupos) for i, c in cuentas_grandes]
    remate_grupo = [m.indice for m in foils for _ in range(por_instancia[m.indice] // grupos)]

    secuencia = _intercalar(cuentas_grupo)
    niveles: list[dict[str, object]]
    if variante == "base_aire":
        niveles, sobra = _en_unidades(secuencia, "cuarteto", ["base", "base", "cuerpo"])
        rol_chicos = "relleno" if any(m.tipo == "burbuja" for m in foils) else "acento"
        niveles += _sueltos(_cuentas(sobra), "acento")
        niveles += _sueltos(
            [(m.indice, por_instancia[m.indice] // grupos) for m in chicos], rol_chicos
        )
    elif variante == "helio_apilado":
        niveles, sobra = _en_unidades(secuencia, "trio", ["capa"])
        niveles += _sueltos(_cuentas(sobra), "alrededor")
    else:
        niveles = _sueltos(cuentas_grupo, "alrededor")

    if len(remate_grupo) > MAX_REMATE:
        niveles += _sueltos(_cuentas(remate_grupo[MAX_REMATE:]), "alrededor")
        remate_grupo = remate_grupo[:MAX_REMATE]
    if len(niveles) > MAX_NIVELES:
        return None
    armado: dict[str, object] = {
        "version": VERSION_ARMADO,
        "origen": "referencia" if lectura is not None else "sugerido",
        "variante": variante,
        "niveles": niveles,
    }
    if remate_grupo:
        armado["remate"] = remate_grupo
    if digitos:
        armado["numero"] = {"digitos": digitos, "disposicion": disposicion}
    try:
        validar(estructura, armado)
    except ArmadoInvalido:
        return None
    return armado


# --- La foto manda sobre la compra (ADR-0030, 2026-09-25) --------------------------


@dataclass(frozen=True)
class CompraLeida:
    """Lo que la foto dice que compra un bouquet y cómo se arma.

    ``cantidades`` son las unidades por material de UNA instancia, contando
    todos los grupos (con números "a los lados" hay dos bouquets); ``armado``
    es la lectura misma en forma de ``armado-bouquet.v1`` (``origen:
    referencia``), con los índices de ``materiales`` de la estructura.
    """

    cantidades: tuple[int, ...]
    armado: dict[str, object]
    #: Por qué queda en 0 cada material que la foto no usa, por índice:
    #: ``sin_color`` (la foto no lleva ese color), ``otro_tamano`` (lo lleva en
    #: otro tamaño, según la clase leída) o ``sin_tamano`` (lo lleva, pero la
    #: lectura no dijo de qué tamaño y se usó el primero de ese color).
    quitados: tuple[tuple[int, str], ...] = ()

    @property
    def total(self) -> int:
        return sum(self.cantidades)


def _distancia_a_clase(tamano: float | None, clase: str) -> float:
    """Pulgadas que separan un globo del rango de su clase; sin tamaño, la más lejana."""
    if tamano is None:
        return float("inf")
    minimo, maximo = CLASES_TAMANO_NIVEL[clase]
    return max(minimo - tamano, tamano - maximo, 0.0)


def clase_de_tamano(pulgadas: float) -> str:
    """La clase de tamaño de un diámetro: la de rango más cercano (empate: la menor).

    Es la única escala de clases de tamaño del sistema (revisión 1/11): la usan
    la lectura del armado del bouquet y el conteo de la foto (``por_tamano``),
    así que "grande" y "gigante" dicen lo mismo en las dos lecturas.
    """
    return min(CLASES_TAMANO_NIVEL, key=lambda clase: _distancia_a_clase(pulgadas, clase))


def _material_del_color(
    materiales: Sequence[MaterialBouquet], color: str, clase_tamano: str | None = None
) -> int | None:
    """El material de un color leído y, si la lectura dio su clase, del tamaño más cercano.

    El color se casa como las pistas de patrón (igualdad o tono cercano). Con
    ``clase_tamano`` se elige, entre los materiales de ese mismo color, el de
    tamaño más cercano al rango de la clase (empate: el primero). Sin clase, el
    primero de ese color, como siempre.
    """
    patrones = [MaterialPatron(m.globo.color, m.globo.acabado, 1.0) for m in materiales]
    posicion = material_de_color(patrones, color)
    if posicion is None:
        return None
    elegido: MaterialBouquet = materiales[posicion]
    if clase_tamano not in CLASES_TAMANO_NIVEL:
        return elegido.indice
    mismo_color = [
        (orden, m)
        for orden, m in enumerate(materiales)
        if _plegar(m.globo.color or "").strip() == _plegar(elegido.globo.color or "").strip()
    ]
    _, mejor = min(
        mismo_color,
        key=lambda item: (
            _distancia_a_clase(item[1].tamano_pulg, cast(str, clase_tamano)),
            item[0],
        ),
    )
    return mejor.indice


def _cantidad_leida(nivel: Mapping[str, object]) -> int:
    """Unidades iguales del nivel; una lectura anterior a la cantidad vale 1."""
    cantidad = nivel.get("cantidad")
    if isinstance(cantidad, int) and not isinstance(cantidad, bool):
        return min(MAX_CANTIDAD_NIVEL, max(1, cantidad))
    return 1


def _globos_del_nivel(nivel: Mapping[str, object]) -> int:
    """Globos de una unidad del nivel: los colores de un grupo de sueltos, o la unidad Sempertex."""
    unidad = str(nivel.get("unidad"))
    if unidad == "suelto":
        return len(cast(list[str], nivel.get("colores") or []))
    return GLOBOS_POR_UNIDAD.get(unidad, 0)


def _grupos_leidos(lectura: Mapping[str, object]) -> int:
    """Con dos números "a los lados" la foto muestra dos bouquets iguales, uno por dígito."""
    numeros = cast(list[object], lectura.get("numeros") or [])
    return 2 if lectura.get("disposicion") == "lados" and len(numeros) == 2 else 1


def total_leido(lectura: Mapping[str, object]) -> int:
    """Globos que la lectura de la foto cuenta en UNA pieza: el único dueño de esa cuenta.

    Cada nivel suma ``cantidad`` unidades de sus globos (una lectura sin
    cantidad vale 1), el remate uno, ambos por grupo (dos con números a los
    lados), y cada dígito un globo número. Es lo que la lectura publica como
    ``total_globos`` y lo que ``compra_desde_lectura`` compra cuando la foto
    manda; TypeScript solo lo muestra (AGENTS.md: Python es dueño del conteo).
    """
    latex = sum(
        _globos_del_nivel(nivel) * _cantidad_leida(nivel)
        for nivel in cast(list[Mapping[str, object]], lectura.get("niveles") or [])
    )
    remate = 1 if isinstance(lectura.get("remate"), Mapping) else 0
    numeros = cast(list[object], lectura.get("numeros") or [])
    return (latex + remate) * _grupos_leidos(lectura) + len(numeros)


def _niveles_leidos(
    lectura: Mapping[str, object], latex: Sequence[MaterialBouquet], variante: str
) -> list[dict[str, object]] | None:
    """Los niveles de la lectura como niveles del armado; ``None`` si un color no se compra.

    Cada nivel leído trae cuántas unidades iguales lo forman (``cantidad``,
    1 si la lectura es anterior) y, opcionalmente, su clase de tamaño. Con base
    de aire los dos primeros niveles de unidades son la base y el resto el
    cuerpo. Los niveles consecutivos iguales se juntan sin pasar del tope de
    unidades por nivel del contrato.
    """
    unidades: list[tuple[str, list[int], int]] = []
    for nivel in cast(list[Mapping[str, object]], lectura.get("niveles", [])):
        unidad = str(nivel["unidad"])
        cantidad = _cantidad_leida(nivel)
        clase = nivel.get("clase_tamano")
        indices: list[int] = []
        for color in cast(list[str], nivel.get("colores", [])):
            indice = _material_del_color(latex, color, clase if isinstance(clase, str) else None)
            if indice is None:
                return None
            indices.append(indice)
        if unidad == "suelto":
            unidades.extend(("suelto", [indice], cantidad) for indice in indices)
        elif len(indices) == GLOBOS_POR_UNIDAD[unidad]:
            unidades.append((unidad, indices, cantidad))
        else:
            return None
    niveles: list[dict[str, object]] = []
    con_unidad = 0
    for unidad, posiciones, cantidad in unidades:
        if unidad == "suelto":
            rol = "acento" if variante == "base_aire" else "alrededor"
        elif variante == "base_aire":
            rol = "base" if con_unidad < 2 else "cuerpo"
            con_unidad += 1
        else:
            rol = "capa" if variante == "helio_apilado" else "alrededor"
        if (
            niveles
            and niveles[-1]["unidad"] == unidad
            and niveles[-1]["posiciones"] == posiciones
            and niveles[-1]["rol"] == rol
            and cast(int, niveles[-1]["cantidad"]) + cantidad <= MAX_CANTIDAD_NIVEL
        ):
            niveles[-1]["cantidad"] = cast(int, niveles[-1]["cantidad"]) + cantidad
        else:
            niveles.append(
                {"rol": rol, "unidad": unidad, "cantidad": cantidad, "posiciones": posiciones}
            )
    return niveles


def compra_desde_lectura(
    estructura: EstructuraBouquet, lectura: Mapping[str, object]
) -> CompraLeida | None:
    """La compra y el armado que dicta la foto, o ``None`` si no se puede seguir.

    Se sigue solo si la lectura es confiable y TODO lo que leyó se compra con
    los materiales del bouquet: cada color de los niveles con un látex del
    plan (igualdad o tono cercano, como las pistas de patrón), el remate con
    un material de su clase (y color, si lo dijo) y cada dígito con su globo
    número. Cada nivel compra ``cantidad`` unidades (1 en una lectura
    anterior) y, si la lectura dio la clase de tamaño, del látex de ese color
    más cercano a ella. El total comprado es ``total_leido(lectura)``, el que
    la lectura publicó. Un material que la foto no muestra queda en 0: la
    resolución lo quita. Sin números ni remate, nada que casar. Helio con látex
    chico o número chico baja a base de aire, como la receta.
    """
    if not estructura.es_bouquet:
        return None
    if float(cast(float, lectura.get("confianza", 0))) < CONFIANZA_MINIMA_LECTURA:
        return None
    materiales = [m for m in estructura.materiales if m is not None]
    n = len(estructura.materiales)
    latex = [m for m in materiales if m.tipo == "latex"]
    numeros = cast(list[Mapping[str, object]], lectura.get("numeros") or [])
    digitos: list[int] = []
    for numero in numeros:
        indice = next(
            (
                m.indice
                for m in materiales
                if m.tipo == "numero" and m.digito == str(numero.get("digito"))
            ),
            None,
        )
        if indice is None:
            return None
        digitos.append(indice)
    remate: list[int] = []
    leido = lectura.get("remate")
    if isinstance(leido, Mapping):
        clase = str(leido.get("clase"))
        candidatos = [m for m in materiales if m.tipo == clase]
        color = leido.get("color")
        indice = (
            _material_del_color(candidatos, str(color))
            if isinstance(color, str) and color
            else (candidatos[0].indice if candidatos else None)
        )
        if indice is None:
            return None
        remate = [indice]

    variante = str(lectura.get("variante") or "helio_escalonado")
    niveles = _niveles_leidos(lectura, latex, variante)
    if niveles is None:
        return None
    usados = (
        {i for nivel in niveles for i in cast(list[int], nivel["posiciones"])}
        | set(remate)
        | set(digitos)
    )
    por_indice = {m.indice: m for m in materiales}
    if variante in VARIANTES_HELIO and any(
        _helio_de(por_indice[i]) is None
        for i in usados
        if por_indice[i].tipo in ("latex", "numero")
    ):
        variante = "base_aire"
        niveles = _niveles_leidos(lectura, latex, variante) or niveles
    disposicion = str(lectura.get("disposicion") or "centro")
    if (
        not digitos
        or disposicion not in DISPOSICIONES
        or (disposicion == "lados" and len(digitos) != 2)
    ):
        disposicion = "centro"
    grupos = 2 if disposicion == "lados" else 1

    cantidades = [0] * n
    for nivel in niveles:
        for indice in cast(list[int], nivel["posiciones"]):
            cantidades[indice] += cast(int, nivel["cantidad"]) * grupos
    for indice in remate:
        cantidades[indice] += grupos
    for indice in digitos:
        cantidades[indice] += 1
    if sum(cantidades) == 0 or len(niveles) > MAX_NIVELES:
        return None
    if sum(cantidades) * estructura.repeticiones > MAX_UNIDADES_DECLARADAS:
        return None
    armado: dict[str, object] = {
        "version": VERSION_ARMADO,
        "origen": "referencia",
        "variante": variante,
        "niveles": niveles,
    }
    if remate:
        armado["remate"] = remate
    if digitos:
        armado["numero"] = {"digitos": digitos, "disposicion": disposicion}
    return CompraLeida(
        tuple(cantidades), armado, _motivos_quitados(estructura, lectura, latex, cantidades)
    )


def _motivos_quitados(
    estructura: EstructuraBouquet,
    lectura: Mapping[str, object],
    latex: Sequence[MaterialBouquet],
    cantidades: Sequence[int],
) -> tuple[tuple[int, str], ...]:
    """Por qué la foto deja en 0 cada material (ver ``CompraLeida.quitados``).

    Un látex cuyo color sí queda en otro tamaño no se quita "porque la foto no
    lo lleva": o la lectura dio la clase de tamaño de ese color y la foto lo
    muestra en otro, o no la dio y se usó el primero de ese color.
    """

    def color_de(material: MaterialBouquet) -> str:
        return _plegar(material.globo.color or "").strip()

    por_indice = {m.indice: m for m in latex}
    usados = {color_de(m) for m in latex if cantidades[m.indice] > 0}
    con_tamano: set[str] = set()
    for nivel in cast(list[Mapping[str, object]], lectura.get("niveles") or []):
        clase = nivel.get("clase_tamano")
        if not isinstance(clase, str) or clase not in CLASES_TAMANO_NIVEL:
            continue
        for color in cast(list[str], nivel.get("colores") or []):
            indice = _material_del_color(latex, color, clase)
            if indice is not None:
                con_tamano.add(color_de(por_indice[indice]))
    motivos: list[tuple[int, str]] = []
    for posicion, material in enumerate(estructura.materiales):
        if cantidades[posicion] > 0:
            continue
        if material is None or material.tipo != "latex" or color_de(material) not in usados:
            motivos.append((posicion, "sin_color"))
        elif color_de(material) in con_tamano:
            motivos.append((posicion, "otro_tamano"))
        else:
            motivos.append((posicion, "sin_tamano"))
    return tuple(motivos)


# --- Resolución (lo que dibuja la hoja de armado) -----------------------------

_NOMBRE_VARIANTE = {
    "base_aire": "Bouquet con base",
    "helio_apilado": "Bouquet de helio apilado",
    "helio_escalonado": "Bouquet de helio escalonado",
}
_DESCRIPCION_VARIANTE = {
    "base_aire": "Globos con aire armados por niveles sobre una base; el remate y los números van en varilla.",
    "helio_apilado": "Capas de globos con helio a la misma altura, una encima de otra, con el remate arriba.",
    "helio_escalonado": "Globos con helio a distintas alturas alrededor de la pieza central.",
}
_UNIDAD_ES = {
    "suelto": ("globo suelto", "globos sueltos"),
    "pareja": ("pareja", "parejas"),
    "trio": ("trío", "tríos"),
    "cuarteto": ("cuarteto", "cuartetos"),
    "quinteto": ("quinteto", "quintetos"),
    "sexteto": ("sexteto", "sextetos"),
}
_ROL_ES = {
    "base": "base",
    "cuerpo": "cuerpo",
    "capa": "capa",
    "alrededor": "alrededor",
    "acento": "acentos",
    "relleno": "relleno de la burbuja",
}
_DISPOSICION_ES = {
    "centro": "al centro del bouquet",
    "lados": "uno a cada lado, cada uno con su propio bouquet",
    "arriba": "arriba, como remate",
    "abajo": "abajo, de pie en la base, con los globos encima",
}


def _pulgadas(valor: float | None) -> str:
    if valor is None:
        return ""
    return f'{int(valor)}"' if float(valor).is_integer() else f'{valor:g}"'


def _descripcion(material: MaterialBouquet) -> str:
    globo = material.globo
    color = " ".join(parte for parte in (globo.color, globo.acabado) if parte)
    if material.tipo == "latex":
        tamano = globo.codigo_tamano or _pulgadas(material.tamano_pulg)
        return " ".join(parte for parte in (tamano, color) if parte) or globo.titulo
    if material.tipo == "numero":
        return " ".join(
            parte
            for parte in (f'Número "{material.digito}"', _pulgadas(material.tamano_pulg), color)
            if parte
        )
    if material.tipo == "burbuja":
        return " ".join(parte for parte in ("Burbuja", _pulgadas(material.tamano_pulg)) if parte)
    titulo = re.sub(r"(?i)^b2b\s+", "", globo.titulo.split(" — ")[0]).strip()
    return " ".join(parte for parte in (titulo, _pulgadas(material.tamano_pulg)) if parte)


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


# --- Frase del armado para el prompt de imagen (ADR-0028 §12, ADR-0030) ------------

_DIGITO_EN = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_FORMA_FOIL_EN = (
    ("corazon", "heart"),
    ("estrella", "star"),
    ("luna", "moon"),
    ("redondo", "round foil balloon"),
)
_UNIDAD_EN = {
    "suelto": ("single balloon", "single balloons"),
    "pareja": ("pair", "pairs"),
    "trio": ("trio", "trios"),
    "cuarteto": ("four-balloon cluster", "four-balloon clusters"),
    "quinteto": ("five-balloon cluster", "five-balloon clusters"),
    "sexteto": ("six-balloon cluster", "six-balloon clusters"),
}
_ROL_EN = {
    "base": "base",
    "cuerpo": "body",
    "capa": "layer",
    "alrededor": "around the center",
    "acento": "accents",
    "relleno": "inside the bubble",
}
_DISPOSICION_EN = {
    "centro": "at the center of the bouquet",
    "lados": "one on each side, each with its own bouquet",
    "arriba": "on top, as the topper",
    "abajo": "at the bottom, standing at the base with the balloons rising above them",
}
# La frase LoRA sigue al sustantivo que ya escribe el compilador del caption
# ("a balloon bouquet <materiales> <frase> placed on the main table"), como la del
# patrón de color: es un modificador, nunca otro sustantivo. Empezaba por "a helium
# balloon bouquet ..." y el caption nombraba dos bouquets seguidos (2026-09-25).
_DISPOSICION_LORA = {
    "centro": " at the center of the bouquet",
    "lados": ", one number in each bouquet",
    "arriba": " on top of the bouquet",
    "abajo": " standing at the base",
}
_VARIANTE_EN = {
    "base_aire": (
        "an air-filled balloon bouquet fixed on a weighted base, built upward in tight clusters",
        "Keep every balloon touching its cluster",
        "built in tight air-filled clusters on a weighted base",
    ),
    "helio_apilado": (
        "a helium balloon bouquet on ribbons tied to one weight, stacked in layers of balloons"
        " at the same height, one layer directly above the other",
        "Keep each layer level and centered over the one below; the topper floats highest.",
        "floating on helium ribbons in level stacked layers",
    ),
    "helio_escalonado": (
        "a helium balloon bouquet on ribbons of different lengths tied to one weight, the balloons"
        " staggered at clearly different heights around the central piece",
        "No two balloons at the same height; the central piece floats highest.",
        "floating on helium ribbons at staggered heights",
    ),
}


def _forma_foil_en(material: MaterialBouquet) -> str:
    titulo = _plegar(material.globo.titulo)
    return next((en for es, en in _FORMA_FOIL_EN if es in titulo), "foil balloon")


def _prefijo_numero(material: MaterialBouquet, color: str) -> str:
    """Lo que un globo número dice antes de "foil number": "large gold"."""
    grande = material.tamano_pulg is not None and material.tamano_pulg > NUMERO_MAXIMO_AIRE_PULG
    return " ".join(
        parte
        for parte in ("large" if grande else "small", color if material.globo.color else "")
        if parte
    )


def _globo_en(material: MaterialBouquet, *, lora: bool) -> str:
    """Un globo en inglés: para LoRA solo el color y sin cifras (ADR-0028 §8)."""
    color = (
        nombre_color_en(material.globo.color)
        if lora
        else color_con_acabado_en(material.globo.color, material.globo.acabado)
    )
    tamano = "" if lora else _pulgadas(material.tamano_pulg)
    if material.tipo == "latex":
        return " ".join(parte for parte in (color, tamano, "latex balloons") if parte)
    if material.tipo == "numero":
        cifra = _DIGITO_EN[int(material.digito or 0)] if lora else f'"{material.digito}"'
        return " ".join(
            parte
            for parte in (_prefijo_numero(material, color), f"foil number {cifra} balloon", tamano)
            if parte
        )
    if material.tipo == "burbuja":
        return " ".join(
            parte
            for parte in (color if material.globo.color else "clear", tamano, "bubble balloon")
            if parte
        )
    forma = _forma_foil_en(material)
    return " ".join(
        parte for parte in (color, "foil" if not forma.endswith("balloon") else "", forma) if parte
    )


def _numeros_lora(digitos: Sequence[MaterialBouquet]) -> str:
    """Los números deletreados para LoRA: "large gold foil numbers eight and zero"."""
    prefijos = {_prefijo_numero(m, nombre_color_en(m.globo.color)) for m in digitos}
    if len(digitos) > 1 and len(prefijos) == 1:
        palabras = [_DIGITO_EN[int(m.digito or 0)] for m in digitos]
        return " ".join(
            parte for parte in (prefijos.pop(), "foil numbers", lista_en(palabras)) if parte
        )
    uno_por_uno: str = lista_en([_globo_en(m, lora=True) for m in digitos])
    return uno_por_uno


_SIN_PIEZA_CENTRAL = " around the central piece"


def _con_pieza_central(con_remate: bool, con_numeros: bool, disposicion: str | None) -> bool:
    """Si el bouquet escalonado tiene pieza central: el remate o números que flotan."""
    return con_remate or (con_numeros and disposicion != "abajo")


def _apertura(variante: str, apertura: str, pieza_central: bool) -> str:
    """La primera frase Gemini; el escalonado sin remate ni números no rodea nada."""
    if variante == "helio_escalonado" and not pieza_central:
        return apertura.replace(_SIN_PIEZA_CENTRAL, "")
    return apertura


def _cierre(
    variante: str, cierre: str, con_remate: bool, con_numeros: bool, disposicion: str | None
) -> str:
    """La última frase Gemini: nombra solo las piezas que la compra trae.

    Con base de aire decía siempre "the topper and the numbers stand on sticks",
    también sin números, y el escalonado "the central piece floats highest" sin
    remate ni números: frases así le piden al modelo de imagen globos que no se
    compran. Abajo, los números van de pie en la base, no en varilla.
    """
    if variante == "helio_escalonado" and not _con_pieza_central(
        con_remate, con_numeros, disposicion
    ):
        return cierre.split(";")[0] + "."
    if variante != "base_aire":
        return cierre
    en_varilla = (["the topper"] if con_remate else []) + (
        ["the numbers"] if con_numeros and disposicion != "abajo" else []
    )
    if not en_varilla:
        return f"{cierre}."
    verbo = "stands on a stick" if en_varilla == ["the topper"] else "stand on sticks"
    return f"{cierre}; {' and '.join(en_varilla)} {verbo} above it."


def _frases_prompt(
    variante: str,
    materiales: Mapping[int, MaterialBouquet],
    armado: Mapping[str, object],
    grupos: int,
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` del armado; inglés, LoRA en ASCII y sin cifras."""
    apertura, cierre, apertura_lora = _VARIANTE_EN[variante]
    niveles = cast(list[Mapping[str, object]], armado["niveles"])
    remate = [materiales[i] for i in cast(list[int], armado.get("remate", []))]
    numero = armado.get("numero")
    digitos = (
        [materiales[i] for i in cast(list[int], numero["digitos"])]
        if isinstance(numero, Mapping)
        else []
    )

    partes: list[str] = []
    for posicion, nivel in enumerate(niveles, start=1):
        cantidad = cast(int, nivel["cantidad"])
        globos = [
            _globo_en(materiales[i], lora=False) for i in cast(list[int], nivel["posiciones"])
        ]
        # Un cuarteto de un solo globo se nombra una vez, no cuatro veces seguidas;
        # con globos distintos el orden de las posiciones es el del armado.
        partes.append(
            f"level {posicion} ({_ROL_EN[str(nivel['rol'])]}): "
            f"{_plural(cantidad, *_UNIDAD_EN[str(nivel['unidad'])])} of "
            + (globos[0] if len(set(globos)) == 1 else lista_en(globos))
        )
    disposicion = str(numero["disposicion"]) if isinstance(numero, Mapping) else None
    pieza_central = _con_pieza_central(bool(remate), bool(digitos), disposicion)
    frases = [f"BOUQUET ASSEMBLY — {_apertura(variante, apertura, pieza_central)}."]
    if grupos > 1:
        frases.append("Build two matching bouquets, one per number.")
    if partes:
        frases.append("From the bottom up: " + "; ".join(partes) + ".")
    if remate:
        frases.append("Topper: " + lista_en([_globo_en(g, lora=False) for g in remate]) + ".")
    if digitos and disposicion is not None:
        frases.append(
            "Number balloons: "
            + lista_en([_globo_en(g, lora=False) for g in digitos])
            + f", {_DISPOSICION_EN[disposicion]}."
        )
    frases.append(_cierre(variante, cierre, bool(remate), bool(digitos), disposicion))

    # Sin los colores del látex: la cláusula del caption ya los nombra con su
    # vocabulario, y repetirlos alargaba la frase que nunca se compacta.
    partes_lora = [apertura_lora]
    if remate:
        partes_lora.append("topped by " + lista_en([_globo_en(g, lora=True) for g in remate]))
    if digitos and disposicion is not None:
        partes_lora.append("with " + _numeros_lora(digitos) + _DISPOSICION_LORA[disposicion])
    return " ".join(frases), ", ".join(partes_lora)


def armado_resuelto(
    estructura: EstructuraBouquet, armado: Mapping[str, object]
) -> dict[str, object]:
    """``armados_bouquet[i]`` de ``plan-resuelto.v1``. ``ArmadoInvalido`` si no vale."""
    expansion = validar(estructura, armado)
    materiales = {m.indice: m for m in estructura.materiales if m is not None}
    orden = list(dict.fromkeys(_indices(armado)))
    codigo = {indice: posicion + 1 for posicion, indice in enumerate(orden)}
    numero = armado.get("numero")
    digitos = cast(list[int], numero["digitos"]) if isinstance(numero, Mapping) else []
    grupos, reps = expansion.grupos, estructura.repeticiones

    leyenda: list[dict[str, object]] = []
    for indice in orden:
        material = materiales.get(indice)
        if material is None:
            raise ArmadoInvalido(
                "material_sin_catalogo", "Un globo del armado no está en el catálogo."
            )
        leyenda.append(
            {
                "codigo": codigo[indice],
                "material": indice,
                "product_id": material.globo.product_id,
                "variant_id": material.globo.variant_id,
                "descripcion": _descripcion(material),
                "tipo_globo": material.tipo,
                "color": material.globo.color,
                "acabado": material.globo.acabado,
                "tamano_pulg": material.tamano_pulg,
                "digito": material.digito,
                "unidades_por_grupo": expansion.por_grupo[indice]
                + (digitos.count(indice) if grupos == 1 else min(1, digitos.count(indice))),
                "unidades_total": estructura.cantidades[indice],
            }
        )

    niveles_resueltos = [
        {
            "rol": nivel["rol"],
            "unidad": nivel["unidad"],
            "cantidad": nivel["cantidad"],
            "codigos": [codigo[i] for i in cast(list[int], nivel["posiciones"])],
        }
        for nivel in cast(list[Mapping[str, object]], armado["niveles"])
    ]
    remate = [codigo[i] for i in cast(list[int], armado.get("remate", []))]

    variante = str(armado["variante"])
    helio = variante in VARIANTES_HELIO
    globos_grupo: list[MaterialBouquet] = []
    for indice, cantidad in enumerate(expansion.por_grupo):
        globos_grupo.extend([materiales[indice]] * cantidad)
    avisos: list[str] = []
    insumos: list[dict[str, object]] = []
    duracion: dict[str, int] | None = None
    if helio:
        # Con "lados" cada grupo lleva un solo dígito.
        digitos_grupo = digitos[:1] if grupos > 1 else digitos
        # Abajo, los números van de pie en la base: no flotan ni pesan.
        abajo = isinstance(numero, Mapping) and numero.get("disposicion") == "abajo"
        flotantes = globos_grupo + ([] if abajo else [materiales[i] for i in digitos_grupo])
        datos = [(m, _helio_de(m)) for m in flotantes]
        peso = sum(h.peso_g for _, h in datos if h is not None)
        gas = sum(h.gas_m3 for _, h in datos if h is not None) * grupos * reps
        estimado = any(h is not None and h.peso_estimado for _, h in datos)
        insumos.append(
            {
                "insumo": "pesa",
                "cantidad": grupos * reps,
                "unidad": "pesas",
                "detalle": f"de {peso} g o más cada una (suma del peso de cada globo)",
                "estimado": estimado,
            }
        )
        insumos.append(
            {
                "insumo": "cinta",
                "cantidad": len(flotantes) * grupos * reps,
                "unidad": "cintas",
                "detalle": "una por globo, de largos distintos si el bouquet es escalonado",
                "estimado": False,
            }
        )
        insumos.append(
            {
                "insumo": "helio",
                "cantidad": round(gas, 3),
                "unidad": "m³",
                "detalle": "según la capacidad de gas de cada globo",
                "estimado": True,
            }
        )
        horas = [h for _, h in datos if h is not None]
        if horas:
            duracion = {
                "horas_min": min(h.horas_min for h in horas),
                "horas_max": min(h.horas_max for h in horas),
            }
        if len(flotantes) % 2 == 0:
            avisos.append(
                f"Cada bouquet lleva {len(flotantes)} globos: Anagram recomienda un número impar (5 o 7)."
            )
        if estimado:
            avisos.append(
                "El peso de la pesa incluye valores estimados para algún tamaño sin fila en la tabla."
            )
    else:
        varillas = (len(cast(list[int], armado.get("remate", []))) * grupos + len(digitos)) * reps
        if varillas:
            insumos.append(
                {
                    "insumo": "varilla",
                    "cantidad": varillas,
                    "unidad": "varillas",
                    "detalle": "para el remate y los números",
                    "estimado": False,
                }
            )
        insumos.append(
            {
                "insumo": "base",
                "cantidad": grupos * reps,
                "unidad": "bases",
                "detalle": "base con peso donde se fija el bouquet",
                "estimado": False,
            }
        )

    nombre_codigo = {entrada["codigo"]: entrada["descripcion"] for entrada in leyenda}
    pasos: list[str] = []
    for posicion, nivel in enumerate(niveles_resueltos, start=1):
        unidad = str(nivel["unidad"])
        cantidad = cast(int, nivel["cantidad"])
        colores = ", ".join(
            f"{nombre_codigo[c]} ({c})" for c in dict.fromkeys(cast(list[int], nivel["codigos"]))
        )
        pasos.append(
            f"Nivel {posicion} ({_ROL_ES[str(nivel['rol'])]}): {_plural(cantidad, *_UNIDAD_ES[unidad])} de {colores}."
        )
    if remate:
        pasos.append("Remate: " + ", ".join(f"{nombre_codigo[c]} ({c})" for c in remate) + ".")
    if isinstance(numero, Mapping):
        pasos.append(
            "Números: "
            + ", ".join(f"{nombre_codigo[codigo[i]]} ({codigo[i]})" for i in digitos)
            + f", {_DISPOSICION_ES[str(numero['disposicion'])]}."
        )
    pasos.append(
        "Ata cada globo a su cinta y todas las cintas a la pesa."
        if helio
        else "Fija los niveles sobre la base y el remate y los números con varilla."
    )
    prompt_gemini, prompt_lora = _frases_prompt(variante, materiales, armado, grupos)

    return {
        "estructura_id": estructura.estructura_id,
        "armado": dict(armado),
        "grupos": grupos,
        "repeticiones": reps,
        "leyenda": leyenda,
        "niveles": niveles_resueltos,
        "remate": remate,
        "numero": (
            {"codigos": [codigo[i] for i in digitos], "disposicion": numero["disposicion"]}
            if isinstance(numero, Mapping)
            else None
        ),
        "insumos": insumos,
        "duracion_estimada": duracion,
        "nombre": _NOMBRE_VARIANTE[variante],
        "descripcion": _DESCRIPCION_VARIANTE[variante],
        "pasos": pasos,
        "avisos": avisos,
        "prompt_gemini": prompt_gemini,
        "prompt_lora": prompt_lora,
    }


__all__ = [
    "ArmadoInvalido",
    "CLASES_TAMANO_NIVEL",
    "CompraLeida",
    "DISPOSICIONES",
    "EstructuraBouquet",
    "GloboCatalogo",
    "MAX_CANTIDAD_NIVEL",
    "MAX_SUELTOS_LEIDOS",
    "MAX_TOTAL_LEIDO",
    "MaterialBouquet",
    "VARIANTES",
    "VERSION_ARMADO",
    "armado_resuelto",
    "clasificar",
    "compra_desde_lectura",
    "disposiciones_admitidas",
    "sugerir_armado",
    "total_leido",
    "validar",
    "variantes_admitidas",
]
