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

Supuestos de negocio (marcados en ADR-0030, a validar con el negocio): los
números de 16" o menos van con aire en varilla; qué variante sugiere la receta
cuando la foto no dice nada.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from jsonschema import Draft7Validator

from app.generated_models import contract_schema
from app.patron_color import MaterialPatron, material_de_color


VERSION_ARMADO = "armado-bouquet.v1"
CONFIANZA_MINIMA_LECTURA = 0.5
MAX_NIVELES = 8
MAX_REMATE = 4

GLOBOS_POR_UNIDAD: Mapping[str, int] = {
    "suelto": 1,
    "pareja": 2,
    "trio": 3,
    "cuarteto": 4,
    "quinteto": 5,
    "sexteto": 6,
}
VARIANTES_HELIO = frozenset({"helio_apilado", "helio_escalonado"})
#: Por debajo de este diámetro el látex va con aire (Anagram; R-5 no flota).
LATEX_MINIMO_HELIO_PULG = 9.0
#: Números de este tamaño o menos van con aire en varilla (supuesto, ADR-0030).
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

_ESQUEMA_ARMADO: Mapping[str, object] = cast(
    Mapping[str, object],
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_bouquet"
    ],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)


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


def sugerir_armado(
    estructura: EstructuraBouquet, lectura: Mapping[str, object] | None = None
) -> dict[str, object] | None:
    """Un armado que acomoda exactamente lo que el plan compra, o ``None``.

    Con ``lectura`` (y confianza suficiente) la foto decide la variante, la
    disposición del número y el orden de colores; si lo que leyó no se puede
    armar con esos globos, decide la receta. ``None`` cuando no se puede
    armar sin cambiar la compra (materiales sin clasificar, cantidades que no
    se reparten entre repeticiones): la estructura queda como hoy.
    """
    if not estructura.es_bouquet or any(m is None for m in estructura.materiales):
        return None
    materiales = [m for m in estructura.materiales if m is not None]
    reps = estructura.repeticiones
    if any(c % reps for c in estructura.cantidades):
        return None
    por_instancia = [c // reps for c in estructura.cantidades]
    if (
        lectura is not None
        and float(cast(float, lectura.get("confianza", 0))) < CONFIANZA_MINIMA_LECTURA
    ):
        lectura = None

    digitos = [
        m.indice for m in materiales for _ in range(por_instancia[m.indice]) if m.tipo == "numero"
    ]
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
    numero_chico = any(
        m.tipo == "numero"
        and m.tamano_pulg is not None
        and m.tamano_pulg <= NUMERO_MAXIMO_AIRE_PULG
        for m in materiales
        if por_instancia[m.indice] > 0
    )
    puede_helio = not numero_chico and not any(por_instancia[m.indice] for m in chicos)

    prioridad = _orden_por_lectura(materiales, lectura)
    cuentas_grandes = sorted(
        ((m.indice, por_instancia[m.indice]) for m in grandes),
        key=lambda item: (prioridad.get(item[0], len(prioridad)), -item[1], item[0]),
    )
    total_grandes = sum(c for _, c in cuentas_grandes)

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

    disposicion = "centro"
    if digitos:
        pedida = str(lectura.get("disposicion", "")) if lectura is not None else ""
        if pedida in ("centro", "arriba"):
            disposicion = pedida
        elif pedida == "lados" and len(digitos) == 2:
            disposicion = "lados"
    grupos = 2 if disposicion == "lados" else 1
    no_digitos = [por_instancia[m.indice] for m in materiales if m.tipo != "numero"]
    if grupos > 1 and any(c % grupos for c in no_digitos):
        disposicion, grupos = "centro", 1
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
    if len(niveles) > MAX_NIVELES or len(digitos) > 3:
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
        flotantes = globos_grupo + [materiales[i] for i in digitos_grupo]
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
    }


__all__ = [
    "ArmadoInvalido",
    "EstructuraBouquet",
    "GloboCatalogo",
    "MaterialBouquet",
    "VERSION_ARMADO",
    "armado_resuelto",
    "clasificar",
    "sugerir_armado",
    "validar",
]
