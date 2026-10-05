"""La figura con globos (número, letra, animal, personaje, figura de foil) en la guía de escena.

La figura no tiene forma fija ni dibujo en el clasificador (el único dibujo de figura que hay es el corazón del
centro de mesa, que ya pinta ``dibujo_estructura``), y el plan la describe solo con palabras: su ``nombre`` (y
``forma`` si la trae), sus materiales y ``unidades_declaradas``. Así que aquí no se copia ningún armado: se
dibuja una silueta que le dice al modelo de imagen **dónde va la figura, de qué tamaño y de qué colores**, con
los globos que se compran.

- **Es figura** la estructura oficial ``figura``; sin el campo (un plan de antes), el tipo ``escultura`` o un
  nombre con «figura», «escultura» o «sculpture» que no sea un bouquet (la misma inferencia que
  ``identificarEstructuraOficial`` de ``estructuras-oficiales.ts``). Cualquier otra oficial no es de aquí.
- **Cuántos globos y de qué color**: los que compra el resolutor (``plan._distribute_units`` sobre
  ``unidades_declaradas``, que suma las repeticiones), divididos entre ``repeticiones``: la guía dibuja una
  instancia y TypeScript la repite. Los colores se intercalan en la proporción de cada material.
- **De qué tamaño**: los que se compran. El látex, de la ``mezcla_real`` del contexto (los tamaños que la
  resolución eligió); sin ella, de la ``mezcla`` declarada (``plan.proporciones_de_mezcla``, dueño
  ``mezclas.ts``); sin mezcla reconocible, el globo estándar (R-12). Inflados según ``INFLADO_PULG``. Un foil
  o una burbuja que el contexto conoce miden lo que dice su etiqueta.
- **La forma**: un número o una letra nombrados («número 5», «figura 18», «18 años», «letra A», «iniciales
  A y B», una palabra en mayúsculas tras «palabra» o «nombre») se rellenan sobre un esqueleto de trazos de
  4 × 6 unidades, con tantas filas de globos como pide su grosor; lo demás («osito», «jirafa») es un óvalo
  compacto del área que ocupan sus globos. Su proporción es la de la caja de la foto donde va la figura
  (``aspecto_caja`` del contexto: una jirafa alta sale alta, una ballena ancha sale ancha); sin foto, 1,4
  vertical. La escala sale del número de globos, no de ``medidas``.
- **Foil**: un material que el contexto clasifica como metalizado o número (por su tipo en el catálogo, no por
  el nombre) o, sin contexto, un nombre con «foil», «mylar» o «metalizado». La figura es un globo plano y
  grande del color de ese material —el número o la letra trazados con discos gruesos y solapados, o un
  disco—, de su tamaño de etiqueta si el contexto lo sabe (un 34" mide 0,86 m), si no de ``medidas.alto_m``
  (1 m si no la trae: un número de 40"), y los demás globos van en un montículo a sus pies.

Todo es determinista: sin azar, sin reloj y sin catálogo.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence

from app.arco.tipos import INFLADO_PULG, TAMANO_ESTANDAR, TAMANOS_GLOBO
from app.guia_piezas import ContextoPieza
from app.plan import _distribute_units, proporciones_de_mezcla
from app.plan_armado_comun import materiales_de

Globo = tuple[float, float, float, str]
Punto = tuple[float, float]
Trazo = tuple[Punto, ...]

#: Separación entre centros de dos globos vecinos, en diámetros: se aprietan un poco, como en una figura.
_PASO = 0.9
#: Fracción del plano que cubren los globos apretados al paso (empaquetado hexagonal).
_EMPAQUE = math.sqrt(3) / 2
#: Alto sobre ancho del óvalo de una figura sin forma conocida.
_ASPECTO_FIGURA = 1.4
#: Lo más ancho y lo más alto que sale el óvalo cuando lo dice la caja de la foto (una caja de 20:1 es un error
#: de lectura, no una figura).
_ASPECTO_CAJA_RANGO = (0.3, 3.5)
#: Alto sobre ancho del montículo de globos al pie de una figura de foil.
_ASPECTO_BASE = 0.45
#: El grosor del trazo de un número o una letra, como fracción de su alto (una cifra «gorda» de globos).
_GROSOR_TRAZO = 1 / 7
#: Alto de una figura de foil sin medidas: un número de 40".
_ALTO_FOIL_M = 1.0
_ALTO_FOIL_RANGO = (0.3, 3.0)
#: Radio de los discos de un trazo de foil, como fracción del alto de la cifra.
_RADIO_FOIL = 0.09
_MAX_GLIFOS = 4
_ANCHO_GLIFO = 4.0
_ALTO_GLIFO = 6.0
_ANGULO_AUREO = math.pi * (3 - math.sqrt(5))

# Tabla de coordenadas: un punto por par y una cifra por línea se leen mejor que una columna de cientos.
# fmt: off
_O: Trazo = ((1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0))
_P: Trazo = ((0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3))

#: El esqueleto de cada cifra y letra: trazos en una caja de 4 de ancho y 6 de alto, ``y`` hacia arriba.
TRAZOS: Mapping[str, tuple[Trazo, ...]] = {
    "0": (_O,),
    "1": (((1, 4.8), (2, 6), (2, 0)),),
    "2": (((0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (0, 0), (4, 0)),),
    "3": (
        ((0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (1.5, 3)),
        ((3, 3), (4, 2), (4, 1), (3, 0), (1, 0), (0, 1)),
    ),
    "4": (((3, 0), (3, 6), (0, 2), (4, 2)),),
    "5": (((4, 6), (0, 6), (0, 3.5), (3, 3.5), (4, 2.5), (4, 1), (3, 0), (0, 0)),),
    "6": (
        (
            (3.5, 6), (2, 6), (0, 4), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2.5), (3, 3.5),
            (1, 3.5), (0, 2.5),
        ),
    ),
    "7": (((0, 6), (4, 6), (1.5, 0)),),
    "8": (
        (
            (1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (1, 3), (0, 2),
            (0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3),
        ),
    ),
    "9": (
        ((0.5, 0), (2, 0), (4, 2), (4, 5), (3, 6), (1, 6), (0, 5), (0, 3.5), (1, 2.5), (3, 2.5),
         (4, 3.5)),
    ),
    "A": (((0, 0), (2, 6), (4, 0)), ((1, 3), (3, 3))),
    "B": (_P, ((3, 3), (4, 2), (4, 1), (3, 0), (0, 0))),
    "C": (((4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0), (3, 0), (4, 1)),),
    "D": (((0, 0), (0, 6), (2.5, 6), (4, 4.5), (4, 1.5), (2.5, 0), (0, 0)),),
    "E": (((4, 6), (0, 6), (0, 0), (4, 0)), ((0, 3), (3, 3))),
    "F": (((4, 6), (0, 6), (0, 0)), ((0, 3), (3, 3))),
    "G": (((4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0), (3, 0), (4, 1), (4, 3), (2, 3)),),
    "H": (((0, 0), (0, 6)), ((4, 0), (4, 6)), ((0, 3), (4, 3))),
    "I": (((2, 0), (2, 6)), ((1, 6), (3, 6)), ((1, 0), (3, 0))),
    "J": (((4, 6), (4, 1), (3, 0), (1, 0), (0, 1)),),
    "K": (((0, 0), (0, 6)), ((4, 6), (0, 2.5)), ((1.3, 3.6), (4, 0))),
    "L": (((0, 6), (0, 0), (4, 0)),),
    "M": (((0, 0), (0, 6), (2, 3), (4, 6), (4, 0)),),
    "N": (((0, 0), (0, 6), (4, 0), (4, 6)),),
    "O": (_O,),
    "P": (_P,),
    "Q": (_O, ((2.5, 1.5), (4, 0))),
    "R": (_P, ((2, 3), (4, 0))),
    "S": (((4, 5), (3, 6), (1, 6), (0, 5), (0, 4), (1, 3), (3, 3), (4, 2), (4, 1), (3, 0), (1, 0),
           (0, 1)),),
    "T": (((0, 6), (4, 6)), ((2, 6), (2, 0))),
    "U": (((0, 6), (0, 1), (1, 0), (3, 0), (4, 1), (4, 6)),),
    "V": (((0, 6), (2, 0), (4, 6)),),
    "W": (((0, 6), (1, 0), (2, 4), (3, 0), (4, 6)),),
    "X": (((0, 0), (4, 6)), ((0, 6), (4, 0))),
    "Y": (((0, 6), (2, 3), (4, 6)), ((2, 3), (2, 0))),
    "Z": (((0, 6), (4, 6), (0, 0), (4, 0)),),
}
# fmt: on

_NUMERO = re.compile(
    r"\b(?:numeros?|num|nro|no\.|n°|#|edad)\s*(\d{1,3}(?:\s*(?:,|y|e|&|-)\s*\d{1,3})*)"
)
_NUMERO_DE_FIGURA = re.compile(r"\b(?:figura|escultura)\s+(\d{1,3})\b(?!\s*[a-z])")
_ANOS = re.compile(r"\b(\d{1,3})\s*anos\b")
_LETRAS = re.compile(r"\b(?:letras?|iniciale?s?|palabra|nombre)\s+(.+)", re.IGNORECASE)
_FOIL = re.compile(r"\b(?:foil|mylar|metalizad[ao]s?)\b")
_ES_FIGURA = re.compile(r"\bfigura|\bescultura|\bsculpture")
_ES_BOUQUET = re.compile(r"\bbouquet|\bramillete")


def _sin_tildes(texto: str) -> str:
    plano = unicodedata.normalize("NFD", texto)
    return "".join(c for c in plano if unicodedata.category(c) != "Mn")


def _plegar(texto: str) -> str:
    return " ".join(_sin_tildes(texto).lower().split())


def _texto(valor: object) -> str:
    return valor.strip() if isinstance(valor, str) else ""


def _entero(valor: object) -> int | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, float) and math.isfinite(valor) and valor.is_integer():
        return int(valor)
    return None


def es_figura(estructura: Mapping[str, object]) -> bool:
    """Si la estructura es una figura con globos; el campo declarado manda y el nombre solo lo suple."""
    oficial = _texto(estructura.get("estructura_oficial"))
    if oficial:
        return oficial == "figura"
    nombre = _plegar(_texto(estructura.get("nombre")))
    if _ES_BOUQUET.search(nombre):
        return False
    return estructura.get("tipo") == "escultura" or _ES_FIGURA.search(nombre) is not None


def _letras(original: str) -> str:
    """Las letras nombradas tras «letra», «iniciales», «palabra» o «nombre»; una palabra solo si va en mayúsculas."""
    coincidencia = _LETRAS.search(_sin_tildes(original))
    if coincidencia is None:
        return ""
    letras = ""
    for posicion, palabra in enumerate(re.findall(r"[A-Za-z]+|[,&]", coincidencia.group(1))):
        if palabra in {",", "&"} or (posicion > 0 and palabra in {"y", "e"}):
            continue
        if len(palabra) == 1:
            letras += palabra.upper()
        elif palabra.isupper() and len(palabra) <= 6:
            letras += palabra
        else:
            break
    return letras


def glifos_de(texto: str) -> str:
    """Las cifras o letras que la figura dibuja según su nombre, o ``""`` si no nombra ninguna."""
    plegado = _plegar(texto)
    for patron in (_NUMERO, _NUMERO_DE_FIGURA, _ANOS):
        coincidencia = patron.search(plegado)
        if coincidencia is not None:
            return re.sub(r"\D", "", coincidencia.group(1))[:_MAX_GLIFOS]
    return _letras(texto)[:_MAX_GLIFOS]


def _restos_mayores(total: int, pesos: Sequence[float]) -> list[int]:
    """Reparte ``total`` en proporción a ``pesos`` por restos mayores (empates por posición)."""
    suma = sum(pesos)
    if total <= 0 or suma <= 0:
        return [0] * len(pesos)
    cuotas = [total * peso / suma for peso in pesos]
    partes = [math.floor(cuota) for cuota in cuotas]
    orden = sorted(range(len(cuotas)), key=lambda i: (-(cuotas[i] - partes[i]), i))
    for indice in orden[: total - sum(partes)]:
        partes[indice] += 1
    return partes


def _intercalar(cuotas: Sequence[int]) -> list[int]:
    """Una secuencia de índices con ``cuotas[i]`` apariciones de cada ``i``, repartidas a lo largo."""
    total = sum(cuotas)
    puestos = [0] * len(cuotas)
    secuencia: list[int] = []
    for paso in range(total):
        indice = max(
            (i for i in range(len(cuotas)) if puestos[i] < cuotas[i]),
            key=lambda i: (cuotas[i] * (paso + 1) / total - puestos[i], -i),
        )
        puestos[indice] += 1
        secuencia.append(indice)
    return secuencia


def _radio_m(pulgadas: int) -> float:
    return float(INFLADO_PULG.get(pulgadas, pulgadas)) * 0.0254 / 2


def _cantidades(estructura: Mapping[str, object], cuantos: int) -> list[int]:
    """Los globos de cada material en **una** instancia: lo que se compra entre las repeticiones."""
    materiales = materiales_de(estructura)[:cuantos]
    compra = _distribute_units(_entero(estructura.get("unidades_declaradas")) or 0, materiales)
    repeticiones = max(1, _entero(estructura.get("repeticiones")) or 1)
    return [max(1, round(cantidad / repeticiones)) for cantidad in compra]


def _radio_fijo(contexto: ContextoPieza | None, indice: int) -> float | None:
    """El radio de un foil o una burbuja que el contexto conoce: medio tamaño de etiqueta, sin inflado."""
    sabido = contexto.material(indice) if contexto is not None else None
    if sabido is None or sabido.tipo == "latex" or not sabido.tamano_pulg:
        return None
    return float(sabido.tamano_pulg) * 0.0254 / 2


def _unidades(
    cantidades: Sequence[int],
    colores: Sequence[str],
    mezcla: object,
    contexto: ContextoPieza | None = None,
) -> list[tuple[float, str]]:
    """Cada globo como ``(radio_m, hex)``: colores y tamaños intercalados en su proporción.

    El látex toma los tamaños de la ``mezcla_real`` si el contexto la trae, y si no los de la ``mezcla``
    declarada; un foil o una burbuja conocidos, el suyo, y van al final.
    """
    fijos = [_radio_fijo(contexto, i) for i in range(len(cantidades))]
    latex = [
        0 if fijo is not None else cantidad
        for cantidad, fijo in zip(cantidades, fijos, strict=True)
    ]
    total = sum(latex)
    reales = contexto.tamanos_latex(TAMANOS_GLOBO) if contexto is not None else ()
    proporciones = reales or proporciones_de_mezcla(mezcla if isinstance(mezcla, str) else "")
    tamanos = proporciones or ((TAMANO_ESTANDAR, 1.0),)
    por_tamano = _restos_mayores(total, [proporcion for _pulgadas, proporcion in tamanos])
    radios = [_radio_m(int(tamanos[i][0])) for i in _intercalar(por_tamano)]
    tonos = [colores[i] for i in _intercalar(latex)]
    unidades = list(zip(radios, tonos, strict=True))
    for i, fijo in enumerate(fijos):
        if fijo is not None:
            unidades.extend((fijo, colores[i]) for _ in range(cantidades[i]))
    return unidades


def _longitud(trazo: Trazo) -> float:
    return sum(math.dist(a, b) for a, b in zip(trazo, trazo[1:], strict=False))


def _punto_en(trazo: Trazo, distancia: float) -> tuple[Punto, Punto]:
    """El punto a ``distancia`` a lo largo del trazo y la normal (unitaria) del tramo en que cae."""
    ultimo = len(trazo) - 2
    for indice, (a, b) in enumerate(zip(trazo, trazo[1:], strict=False)):
        tramo = math.dist(a, b)
        if tramo == 0:
            continue
        if distancia <= tramo or indice == ultimo:
            t = min(distancia / tramo, 1.0)
            dx, dy = (b[0] - a[0]) / tramo, (b[1] - a[1]) / tramo
            return (a[0] + dx * t * tramo, a[1] + dy * t * tramo), (-dy, dx)
        distancia -= tramo
    return trazo[0], (0.0, 1.0)


def _trazos_de(glifos: str, avance: float) -> list[Trazo]:
    """Los trazos de los glifos uno tras otro, separados por ``avance`` unidades de caja a caja."""
    return [
        tuple((x + i * avance, y) for x, y in trazo)
        for i, glifo in enumerate(glifos)
        for trazo in TRAZOS[glifo]
    ]


def _sobre_trazos(glifos: str, unidades: Sequence[tuple[float, str]]) -> list[Globo]:
    """Los globos repartidos por los trazos de los glifos, en tantas filas paralelas como pide su grosor."""
    total = len(unidades)
    paso = _PASO * 2 * sum(r for r, _ in unidades) / total
    largo = sum(_longitud(t) for t in _trazos_de(glifos, _ANCHO_GLIFO))
    # Con ``filas`` filas, la cifra mide ``alto = 6 · escala`` y el trazo ``filas · paso``: el grosor pedido.
    filas = max(1, math.ceil(math.sqrt(_GROSOR_TRAZO * _ALTO_GLIFO * total / largo)))
    escala = (total / filas) * paso / largo
    trazos = _trazos_de(glifos, _ANCHO_GLIFO + (filas + 1) * paso / escala)
    por_trazo = _restos_mayores(total, [_longitud(t) for t in trazos])
    globos: list[Globo] = []
    for trazo, cuantos in zip(trazos, por_trazo, strict=True):
        largo_trazo = _longitud(trazo)
        carriles = min(filas, cuantos)
        for carril, en_carril in enumerate(_restos_mayores(cuantos, [1.0] * carriles)):
            desvio = (carril - (carriles - 1) / 2) * paso
            for k in range(en_carril):
                (x, y), (nx, ny) = _punto_en(trazo, largo_trazo * (k + 0.5) / en_carril)
                radio, tono = unidades[len(globos)]
                globos.append((x * escala + nx * desvio, y * escala + ny * desvio, radio, tono))
    # Los grandes detrás y los pequeños delante, como se ven en una figura armada.
    return sorted(globos, key=lambda g: -g[2])


def _ovalo(unidades: Sequence[tuple[float, str]], aspecto: float) -> list[Globo]:
    """Un óvalo compacto (espiral de girasol) del área de sus globos; los grandes y los del borde, detrás."""
    total = len(unidades)
    paso = _PASO * 2 * sum(r for r, _ in unidades) / total
    ancho = math.sqrt(total * _EMPAQUE * paso**2 / (math.pi * aspecto))
    alto = aspecto * ancho
    colocados: list[tuple[float, Globo]] = []
    for i, (radio, tono) in enumerate(unidades):
        rho = math.sqrt((i + 0.5) / total)
        angulo = i * _ANGULO_AUREO
        x = ancho * rho * math.cos(angulo)
        y = alto + alto * rho * math.sin(angulo)
        colocados.append((rho, (x, y, radio, tono)))
    return [globo for _rho, globo in sorted(colocados, key=lambda c: (-c[1][2], -c[0]))]


def _foil(glifos: str, alto: float, tono: str) -> list[Globo]:
    """La figura de foil: los glifos trazados con discos gruesos y solapados, o un disco grande."""
    if not glifos:
        return [(0.0, alto / 2, alto / 2, tono)]
    radio = _RADIO_FOIL * alto
    escala = (alto - 2 * radio) / _ALTO_GLIFO
    globos: list[Globo] = []
    for trazo in _trazos_de(glifos, _ANCHO_GLIFO + 4 * radio / escala):
        largo = _longitud(trazo) * escala
        cuantos = max(2, math.ceil(largo / (0.8 * radio)) + 1)
        for k in range(cuantos):
            (x, y), _normal = _punto_en(trazo, _longitud(trazo) * k / (cuantos - 1))
            globos.append((x * escala, radio + y * escala, radio, tono))
    centro = (min(g[0] for g in globos) + max(g[0] for g in globos)) / 2
    return [(x - centro, y, r, t) for x, y, r, t in globos]


def _principal(estructura: Mapping[str, object], cuantos: int) -> int:
    materiales = materiales_de(estructura)[:cuantos]
    return next((i for i, m in enumerate(materiales) if m.get("rol_material") == "principal"), 0)


def _acotar(valor: float, rango: tuple[float, float]) -> float:
    return min(max(valor, rango[0]), rango[1])


def _alto_foil(estructura: Mapping[str, object]) -> float:
    medidas = estructura.get("medidas")
    alto = medidas.get("alto_m") if isinstance(medidas, Mapping) else None
    if isinstance(alto, (int, float)) and not isinstance(alto, bool) and math.isfinite(alto):
        return _acotar(float(alto), _ALTO_FOIL_RANGO)
    return _ALTO_FOIL_M


def _foil_principal(
    estructura: Mapping[str, object], cuantos: int, contexto: ContextoPieza | None, texto: str
) -> int | None:
    """El material que es la figura de foil: el foil que el contexto conoce (el principal si hay varios) o,
    sin contexto que lo diga, el principal si el nombre dice foil. ``None``: la figura no es de foil."""
    foils = [
        i
        for i in range(cuantos)
        if contexto is not None and (sabido := contexto.material(i)) is not None and sabido.es_foil
    ]
    if foils:
        principal = _principal(estructura, cuantos)
        return principal if principal in foils else foils[0]
    if _FOIL.search(_plegar(texto)):
        return _principal(estructura, cuantos)
    return None


def _aspecto_ovalo(contexto: ContextoPieza | None) -> float:
    """La proporción del óvalo: la de la caja de la foto si se sabe, la de siempre si no."""
    if contexto is None or contexto.aspecto_caja is None:
        return _ASPECTO_FIGURA
    return _acotar(contexto.aspecto_caja, _ASPECTO_CAJA_RANGO)


def globos_de(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> list[Globo] | None:
    """Los globos de una figura con globos, o ``None`` si la estructura no es una figura."""
    if not es_figura(estructura) or not colores:
        return None
    cuantos = min(len(colores), len(materiales_de(estructura)))
    if cuantos == 0:
        return None
    texto = " ".join(_texto(estructura.get(campo)) for campo in ("forma", "nombre"))
    glifos = "".join(g for g in glifos_de(texto) if g in TRAZOS)
    cantidades = _cantidades(estructura, cuantos)
    mezcla = estructura.get("mezcla")
    principal = _foil_principal(estructura, cuantos, contexto, texto)
    if principal is not None:
        sabido = contexto.material(principal) if contexto is not None else None
        if not glifos and sabido is not None and sabido.digito:
            glifos = sabido.digito
        alto = (
            _acotar(sabido.tamano_pulg * 0.0254, _ALTO_FOIL_RANGO)
            if sabido is not None and sabido.tamano_pulg
            else _alto_foil(estructura)
        )
        cantidades[principal] -= 1  # El globo de foil es uno de los del material principal.
        figura = _foil(glifos, alto, colores[principal])
        if sum(cantidades) == 0:
            return figura
        base = _ovalo(_unidades(cantidades, colores, mezcla, contexto), _ASPECTO_BASE)
        suelo = min(y - r for _x, y, r, _t in base)
        # El montículo va detrás: el foil se ve entero y los globos asoman a sus pies.
        return [(x, y - suelo, r, t) for x, y, r, t in base] + figura
    unidades = _unidades(cantidades, colores, mezcla, contexto)
    if glifos:
        return _sobre_trazos(glifos, unidades)
    return _ovalo(unidades, _aspecto_ovalo(contexto))
