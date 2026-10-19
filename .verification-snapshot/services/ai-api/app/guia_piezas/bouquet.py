"""Los globos de un bouquet (``tipo: kit`` + ``estructura_oficial: bouquet``) para la guía de escena.

Un bouquet no tiene motor cableado al plan ni esquema en ``dibujo_estructura`` («tiene el suyo»): sus dos
diseñadores están portados en ``app/bouquet`` desde ``clasificador-decoraciones/src/lib/bouquet``, que es el
dueño de cómo se arma. Este módulo los usa así:

- **Con ``armado_bouquet``** (el armado por partes de ADR-0030, que la resolución completa con la foto o la
  receta): la geometría de ``armado.ts`` (``app/bouquet/armado.py``, ``generar_armado``): niveles de unidades
  en un anillo que gira media vuelta por nivel, vistos de frente y un poco desde arriba; remate arriba y
  números según su disposición. ``generar_armado`` solo devuelve el SVG, así que sus pasos 1 a 3 (soporte,
  niveles, remate y números) se repiten aquí con las mismas cifras; el día que el diseñador publique su
  geometría, esto pasa a leerla. Solo se usa si el armado cuenta exactamente lo que el plan compra
  (``armado_bouquet.validar``, el dueño de esa regla); si no, se dibuja como el bouquet sin armado.
- **Sin armado**: el ramo de ``motor.ts`` (``crear_disposicion``), configurado como la vista previa del
  clasificador (``referencias/vista-previa.ts``, ``bouquet``): la forma lista que corresponde a la ``forma`` de
  la pieza (``RAMO_FORMA``, las seis de la lámina ``bouquet``, que el contrato admite desde
  ``formas-pieza.ts``) y tantos látex como globos compra una instancia. Es determinista: su azar va sembrado con
  la semilla de la forma. Cada forma sale distinta: la de helio y la caja sorpresa son el ramo clásico, una con su
  bolsa de peso y la otra con su caja de regalo; la burbuja, el número y el relleno llevan su globo especial (si
  la compra no dice cuál es, el material que menos globos compra, ``_especial_de_la_forma``); la de piso es la
  pila a ras del suelo. La **densidad** reparte el ramo de helio (``FORMA_POR_DENSIDAD``: mini, clásico o
  grande) sin cambiar cuántos globos lleva, que es la compra.

**Qué globo es cada material.** La estructura del plan no trae ni el tipo ni el tamaño de cada material (eso
está en el catálogo); los trae el contexto (``ContextoPieza``): la leyenda del armado resuelto o las líneas
resueltas de la pieza dicen si es látex, foil (metalizado o número) o burbuja y de cuántas pulgadas, y la
``mezcla_real`` da los tamaños del látex. Así un corazón metalizado de 18" sale como el corazón foil de 18" del
diseñador, no como un látex R12. **Sin contexto** se hace lo de antes, lo que el clasificador da por defecto:
sin armado todo material es un látex R12 (``TAMANO_ESTANDAR``); con armado, un material de ``numero`` es un
número foil de 16" y uno que solo va de remate es un metalizado de 18" (las formas listas de
``armado-formas.ts``).

**Dónde queda.** El diseñador pone el bouquet de helio sobre su pesa y sus cintas: con armado, el soporte es la
pesa más 0,35 m de cinta (0,5 m escalonado, ``armado.ts``); sin armado, cada nivel cuelga de su cinta
(``cintaM`` de la forma lista: 1,1 m el clásico, 1,2 m el de número, ``formas.ts``). Los globos salen con
``y`` desde el piso y la pieza se publica ``flotante`` con la altura de su globo más bajo (``elevacion_m``), para
que la composición no la pegue al piso. La base de aire y el ramo «a ras del suelo» son ``piso``. Sin armado,
las cintas (una por globo, del nudo al punto de unión) y la pesa o la caja salen como lo que se ve sin ser globo
(``PiezaConEstructura.elementos``; la guía las publica como ``trazos`` y ``rellenos``): en la pieza flotante
cuelgan por debajo de los globos hasta el piso. Con armado, el soporte todavía no sale.

Las cantidades son las de la compra (``plan._distribute_units`` sobre ``unidades_declaradas``) divididas entre
las ``repeticiones``: la guía dibuja una sola instancia y la composición pone las demás.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from app.arco.tipos import TAMANO_ESTANDAR, TAMANOS_GLOBO
from app.armado_bouquet import ArmadoInvalido, _intercalar, validar
from app.bouquet.armado import (
    BASE_M,
    GLOBOS_POR_UNIDAD,
    INCLINACION_VISTA,
    PESA_M,
    MaterialArmado,
    radio_material,
)
from app.bouquet.formas import FORMAS_RAMO, FormaListaRamo, aplicar_forma_ramo
from app.bouquet.limites import MAX_GLOBOS, sanear
from app.bouquet.motor import PESO_ESCALA_SUELO, Disposicion, ItemRamo, crear_disposicion
from app.bouquet.tipos import TAMANOS_ESPECIAL, ConfigRamo, Especial, config_inicial
from app.guia_piezas import ContextoPieza, MaterialGuia, PiezaDePlugin
from app.motores import mate
from app.plan import _distribute_units, contexto_bouquet_de_globos
from app.referencias.dibujos import ElementoDibujo, LineaDibujo, PoligonoDibujo

Globo = tuple[float, float, float, str]

#: Tamaños que el clasificador da a lo que el plan no dice (``armado-formas.ts``: ``_latex``, ``_numero`` y el
#: metalizado de remate de «Torre de aire con remate»).
NUMERO_PULG = 16.0
REMATE_PULG = 18.0

#: El tamaño que el diseñador da a un tipo de globo cuando nadie dice el suyo.
_PULGADAS_POR_TIPO: Mapping[str, float] = {
    "latex": float(TAMANO_ESTANDAR),
    "metalizado": REMATE_PULG,
    "burbuja": REMATE_PULG,
    "numero": NUMERO_PULG,
}

#: La ``forma`` de la pieza → la forma lista del ramo (``RAMO_FORMA`` de ``referencias/vista-previa.ts``).
RAMO_FORMA: Mapping[str, str] = {
    "helio": "clasico",
    "piso": "suelo-pila",
    "burbuja": "burbuja",
    "con-numero": "numero",
    "caja": "clasico",
    "relleno": "suelo-burbuja",
}

#: La forma lista del ramo con helio (``helio``, ``caja`` o sin forma) según la **densidad** de la pieza.
#: Criterio del clasificador (``FORMA_POR_DENSIDAD`` de ``bouquet/formas.ts``, escrito allá el 2026-10-04): la
#: cuenta de un bouquet es la que se compra, así que la densidad no la cambia; decide cómo se reparte, con las
#: formas listas del diseñador que son el ramo ligero, el estándar y el lleno: ``mini`` (dos niveles de cinta
#: corta, abierto), ``clasico`` (tres niveles, el de siempre) y ``grande`` (cuatro niveles, más apretado).
#: Sin densidad o ``media`` es el clásico: el dibujo de siempre.
FORMA_POR_DENSIDAD: Mapping[str, str] = {"sencilla": "mini", "media": "clasico", "lujosa": "grande"}

#: Grosor (m) con que se dibuja una cinta en la guía: una cinta de regalo de medio centímetro.
CINTA_GROSOR_M = 0.006


@dataclass(frozen=True, slots=True)
class PiezaConEstructura(PiezaDePlugin):
    """La pieza del bouquet y lo que se ve de él sin ser globo: las cintas y la pesa (o la caja sorpresa).

    En metros con ``y`` desde el piso, en el mismo marco que los globos. ``app/guia_escena.py`` los publica como
    ``trazos`` y ``rellenos`` de la pieza.
    """

    elementos: tuple[ElementoDibujo, ...] = ()


def es_bouquet(estructura: Mapping[str, object]) -> bool:
    """La misma regla que la resolución (``plan._bouquet_context``): un kit cuya oficial es el bouquet."""
    return estructura.get("tipo") == "kit" and estructura.get("estructura_oficial") == "bouquet"


def _materiales(estructura: Mapping[str, object]) -> list[Mapping[str, object]]:
    crudos = estructura.get("materiales")
    if not isinstance(crudos, Sequence):
        return []
    return [m for m in cast(Sequence[object], crudos) if isinstance(m, Mapping)]


def _entero(valor: object, respaldo: int) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int):
        return respaldo
    return valor


def cantidades_por_instancia(estructura: Mapping[str, object]) -> list[int]:
    """Globos de cada material en UNA instancia del bouquet, de lo que compra la estructura entera."""
    materiales = _materiales(estructura)
    totales = _distribute_units(_entero(estructura.get("unidades_declaradas"), 0), materiales)
    repeticiones = max(1, _entero(estructura.get("repeticiones"), 1))
    # Redondeo a la mitad hacia arriba; un material comprado sale al menos una vez.
    return [
        max(1, (total + repeticiones // 2) // repeticiones) if total > 0 else 0 for total in totales
    ]


# --------------------------------------------------------------------------------------------------------
# Con armado: la geometría de ``generar_armado`` (``armado.ts``), sin el dibujo
# --------------------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Disco:
    x: float
    y: float
    r: float
    material: int
    #: Orden de pintura del diseñador: ``(z, nivel)``, de atrás hacia adelante.
    orden: tuple[float, float]


def _material_armado(tipo: str, pulgadas: float) -> MaterialArmado:
    return {
        "color": "#ffffff",
        "acabado": "mate",
        "tipo": tipo,
        "tamanoPulg": pulgadas,
        "digito": "",
    }


def _materiales_del_armado(
    armado: Mapping[str, object], n: int, contexto: ContextoPieza | None = None
) -> list[MaterialArmado]:
    """Qué es cada material: lo que la resolución sabe de él y, si no, el papel que el armado le da."""
    niveles = cast(list[Mapping[str, object]], armado.get("niveles", []))
    en_niveles = {i for nivel in niveles for i in cast(list[int], nivel["posiciones"])}
    numero = armado.get("numero")
    digitos = set(cast(list[int], numero["digitos"])) if isinstance(numero, Mapping) else set()
    remate = set(cast(list[int], armado.get("remate", [])))
    materiales: list[MaterialArmado] = []
    for i in range(n):
        if i in digitos:
            tipo, pulgadas = "numero", NUMERO_PULG
        elif i in remate and i not in en_niveles:
            tipo, pulgadas = "metalizado", REMATE_PULG
        else:
            tipo, pulgadas = "latex", float(TAMANO_ESTANDAR)
        sabido = contexto.material(i) if contexto is not None else None
        if sabido is not None:
            pulgadas = sabido.tamano_pulg or (
                pulgadas if sabido.tipo == tipo else _PULGADAS_POR_TIPO[sabido.tipo]
            )
            tipo = sabido.tipo
        materiales.append(_material_armado(tipo, pulgadas))
    return materiales


def _discos_del_armado(
    armado: Mapping[str, object], n: int, contexto: ContextoPieza | None = None
) -> list[_Disco]:
    """Pasos 1 a 3 de ``generar_armado``: soporte, niveles, remate y números, en metros con ``y`` arriba."""
    materiales = _materiales_del_armado(armado, n, contexto)
    variante = armado.get("variante")
    helio = variante != "base_aire"
    escalonado = variante == "helio_escalonado"
    numero = armado.get("numero")
    disposicion = str(numero["disposicion"]) if isinstance(numero, Mapping) else None
    digitos = cast(list[int], numero["digitos"]) if isinstance(numero, Mapping) else []

    def alto_numero(i: int) -> float:
        return float(materiales[i]["tamanoPulg"]) * 0.0254

    # 1) Números de abajo: el bouquet se apoya sobre ellos.
    alto_digitos = max((alto_numero(i) for i in digitos), default=0.0)
    soporte = (PESA_M["alto"] + (0.5 if escalonado else 0.35)) if helio else BASE_M
    cursor = soporte + (alto_digitos * 0.7 if disposicion == "abajo" else 0)
    base0 = cursor

    # 2) Niveles de abajo hacia arriba, cada uno girado media vuelta respecto del anterior.
    globos: list[tuple[float, float, float, float, int, int]] = []  # x, y, z, r, material, nivel
    for i, nivel in enumerate(cast(list[Mapping[str, object]], armado.get("niveles", []))):
        k = GLOBOS_POR_UNIDAD[str(nivel["unidad"])]
        posiciones = cast(list[int], nivel["posiciones"])
        cantidad = cast(int, nivel["cantidad"])
        rs = [radio_material(materiales[p]) for p in posiciones]
        r_max = max(rs)
        rho = 0.0 if k == 1 else r_max / mate.sin(mate.pi / k)
        paso_x = 2 * (rho + r_max) * 0.9
        theta0 = (0 if i % 2 == 0 else mate.pi / k) + (mate.pi / 2 if k == 2 else 0)
        for u in range(cantidad):
            ux = (u - (cantidad - 1) / 2) * paso_x
            desnivel = 0.0
            if escalonado:
                par = (u if cantidad > 1 else i) % 2 == 0
                desnivel = (-0.45 if par else 0.45) * r_max
            for j in range(k):
                th = theta0 + (j / k) * mate.pi * 2
                globos.append(
                    (
                        ux + rho * mate.sin(th),
                        cursor + r_max + desnivel,
                        rho * mate.cos(th),
                        rs[j],
                        posiciones[j],
                        i,
                    )
                )
        paso = 1.8 if k >= 3 else (1.9 if k == 2 else 2)
        cursor += paso * r_max + (r_max * 0.45 if escalonado else 0)

    discos = [
        _Disco(x, y - INCLINACION_VISTA * z, r, m, (z, nivel)) for x, y, z, r, m, nivel in globos
    ]
    techo = max((d.y + d.r for d in discos), default=base0)
    izq0 = min((d.x - d.r for d in discos), default=-0.1)
    der0 = max((d.x + d.r for d in discos), default=0.1)

    # 3) Remate (arriba, delante de su nivel) y números.
    remate = cast(list[int], armado.get("remate", []))
    if remate:
        rs_remate = [radio_material(materiales[i]) for i in remate]
        x = -sum(2 * r * 1.04 for r in rs_remate) / 2
        cima = techo
        piezas: list[_Disco] = []
        for indice, r in zip(remate, rs_remate, strict=True):
            x += r * 1.04
            # Un número de remate es un número foil: su ``r`` es medio alto, igual que en el diseñador.
            piezas.append(_Disco(x, cima + r * 0.8, r, indice, (99, 99)))
            x += r * 1.04
        discos.extend(piezas)
        techo = max(p.y + p.r for p in piezas)

    if digitos:
        anchos = [alto_numero(i) * 0.68 for i in digitos]
        x = -sum(w * 1.12 for w in anchos) / 2
        numeros: list[_Disco] = []
        for k2, (indice, w) in enumerate(zip(digitos, anchos, strict=True)):
            h = alto_numero(indice)
            cx = x + (w * 1.12) / 2
            if disposicion == "arriba":
                cy = techo + h / 2 - h * 0.42
                orden: tuple[float, float] = (-0.001, 50)
            elif disposicion == "abajo":
                cy = soporte + h / 2
                orden = (98.0, 100)
            elif disposicion == "lados":
                derecha = len(digitos) == 1 or k2 > 0
                lado_izq = izq0 - w * 0.55 - 0.03
                lado_der = der0 + w * 0.55 + 0.03
                cx = lado_der + max(0, k2 - 1) * w * 1.1 if derecha else lado_izq
                cy = soporte - (PESA_M["alto"] if helio else 0) + h / 2
                orden = (98.0, 100)
            else:
                cy = (base0 + techo) / 2
                orden = (100.0, 100)
            x += w * 1.12
            numeros.append(_Disco(cx, cy, h / 2, indice, orden))
        discos.extend(numeros)

    # El diseñador pinta ordenando por ``(z, nivel)``; ``sorted`` es estable, como su ``sort``.
    return sorted(discos, key=lambda d: d.orden)


def _armado_valido(estructura: Mapping[str, object]) -> Mapping[str, object] | None:
    """El armado de la pieza si cuenta exactamente lo que compra; ``None`` si no hay o no se sostiene."""
    armado = estructura.get("armado_bouquet")
    if not isinstance(armado, Mapping):
        return None
    try:
        validar(contexto_bouquet_de_globos(estructura, None), armado)
    except ArmadoInvalido:
        return None
    return armado


# --------------------------------------------------------------------------------------------------------
# Sin armado: el ramo de ``motor.ts`` como lo dibuja la vista previa del clasificador
# --------------------------------------------------------------------------------------------------------


def _especial_de(material: MaterialGuia | None) -> str | None:
    """El especial del diseñador (``TipoEspecial``) que es un material, o ``None`` si es látex o no se sabe."""
    if material is None or material.tipo == "latex":
        return None
    if material.tipo in ("numero", "burbuja"):
        return str(material.tipo)
    return str(material.silueta or "redondo")


def _especiales(
    cantidades: Sequence[int], colores: Sequence[str], contexto: ContextoPieza | None
) -> tuple[list[Especial], list[int]]:
    """Los foils y las burbujas de la pieza como especiales del ramo, y el material de cada uno."""
    especiales: list[Especial] = []
    material_de: list[int] = []
    for i, cantidad in enumerate(cantidades):
        sabido = contexto.material(i) if contexto is not None else None
        tipo = _especial_de(sabido)
        if tipo is None or cantidad <= 0 or sabido is None:
            continue
        digito = sabido.digito
        especiales.append(
            {
                "tipo": tipo,
                "cantidad": cantidad,
                # Del tamaño de su etiqueta; ``sanear`` lo lleva al del diseñador más cercano (18" → 46 cm).
                "cm": sabido.tamano_pulg * 2.54
                if sabido.tamano_pulg
                else TAMANOS_ESPECIAL[tipo][0]["cm"],
                "color": colores[i],
                "numero": int(digito) if digito is not None and digito.isdigit() else 0,
                "contenido": "vacio",
            }
        )
        material_de.append(i)
    return especiales, material_de


def _mezcla_latex(
    latex: Sequence[tuple[int, int]], contexto: ContextoPieza | None
) -> dict[int, float]:
    """Los tamaños del látex: los de la ``mezcla_real`` y, si no la hay, los de cada material; si no, R12."""
    mezcla: dict[int, float] = {t: 0.0 for t in TAMANOS_GLOBO}
    pesos = contexto.tamanos_latex(TAMANOS_GLOBO) if contexto is not None else ()
    if not pesos and contexto is not None:
        por_material: dict[int, float] = {}
        for i, cantidad in latex:
            sabido = contexto.material(i)
            pulgadas = sabido.tamano_pulg if sabido is not None else None
            if not pulgadas:
                continue
            cercano = min(TAMANOS_GLOBO, key=lambda t: (abs(t - pulgadas), t))
            por_material[cercano] = por_material.get(cercano, 0.0) + cantidad
        pesos = tuple(por_material.items())
    total = sum(peso for _t, peso in pesos)
    if total <= 0:
        mezcla[TAMANO_ESTANDAR] = 100.0
        return mezcla
    for tamano, peso in pesos:
        mezcla[tamano] = 100.0 * peso / total
    return mezcla


def _forma_del_ramo(estructura: Mapping[str, object]) -> FormaListaRamo:
    """La forma lista del ramo: la de su ``forma`` (``RAMO_FORMA``) y, si es el clásico, la de su densidad."""
    forma_pieza = estructura.get("forma")
    id_forma = RAMO_FORMA.get(forma_pieza, "clasico") if isinstance(forma_pieza, str) else "clasico"
    densidad = estructura.get("densidad")
    if id_forma == "clasico" and isinstance(densidad, str):
        id_forma = FORMA_POR_DENSIDAD.get(densidad, id_forma)
    return next((f for f in FORMAS_RAMO if f.id == id_forma), FORMAS_RAMO[0])


def _especial_de_la_forma(
    forma: FormaListaRamo,
    cantidades: Sequence[int],
    colores: Sequence[str],
    contexto: ContextoPieza | None,
    especiales: list[Especial],
    material_de: list[int],
) -> None:
    """El especial que la forma promete (la burbuja, el número) cuando lo comprado no dice cuál es.

    Una forma ``burbuja``, ``con-numero`` o ``relleno`` dice que el ramo lleva ese globo; la compra dice cuántos
    lleva cada material, no cuál es la burbuja. Si ningún material se sabe de ese tipo, lo es **el que menos
    globos lleva** (el remate de un ramo; a igualdad, el último), siempre que no se sepa qué globo es y quede
    otro material para el látex del ramo. Sus globos son los que compra: la forma pone el tipo y el tamaño de su
    forma lista, no la cantidad.
    """
    if not forma.especiales or any(e["tipo"] == forma.especiales[0]["tipo"] for e in especiales):
        return
    comprados = [i for i, c in enumerate(cantidades) if c > 0 and i not in material_de]
    candidatos = [i for i in comprados if contexto is None or contexto.material(i) is None]
    if len(comprados) < 2 or not candidatos:
        return
    elegido = min(candidatos, key=lambda i: (cantidades[i], -i))
    plantilla = forma.especiales[0]
    especiales.append(
        {
            "tipo": plantilla["tipo"],
            "cantidad": cantidades[elegido],
            "cm": plantilla["cm"],
            "color": colores[elegido],
            "numero": plantilla["numero"],
            "contenido": plantilla["contenido"],
        }
    )
    material_de.append(elegido)


def _estructura_del_ramo(cfg: ConfigRamo, disposicion: Disposicion) -> tuple[ElementoDibujo, ...]:
    """Las cintas (del nudo de cada globo al punto de unión) y la pesa o la caja, como las pinta ``pintar``.

    En metros con ``y`` desde el piso. La pesa es la de ``_dibujar_peso``, sobre el piso bajo el punto de unión:
    la caja de regalo es un rectángulo de ``0,17 m`` de ancho y la bolsa de peso su silueta de ``0,14 m``, las
    dos del alto de ``PESO_ALTO`` (y mayores a ras del suelo). Las colas de cinta que caen sueltas son adorno y
    no van.
    """
    punto = disposicion.punto
    tono_cinta = str(cfg["cinta"]["color"]).lower()
    elementos: list[ElementoDibujo] = []
    for item in disposicion.items:
        angulo = item.rot * mate.pi / 180
        nudo_x = float(item.x - mate.sin(angulo) * item.nudoDesde)
        nudo_y = float(item.y - mate.cos(angulo) * item.nudoDesde)
        elementos.append(
            LineaDibujo(nudo_x, nudo_y, punto["x"], punto["y"], CINTA_GROSOR_M, tono_cinta)
        )
    tipo = cfg["peso"]["tipo"]
    if tipo == "ninguno":
        return tuple(elementos)
    k = PESO_ESCALA_SUELO if cfg["forma"]["modo"] == "suelo" else 1
    alto = disposicion.pesoAlto
    cx = punto["x"]
    silueta: tuple[tuple[float, float], ...]
    if tipo == "regalo":
        ancho = 0.17 * k
        silueta = ((-0.5, 0), (0.5, 0), (0.5, 1), (-0.5, 1))
    else:
        ancho = 0.14 * k
        silueta = (
            (-0.5, 0),
            (-0.56, 0.35),
            (-0.4, 0.66),
            (-0.16, 1),
            (0.16, 1),
            (0.4, 0.66),
            (0.56, 0.35),
            (0.5, 0),
        )
    pesa = tuple((cx + u * ancho, v * alto) for u, v in silueta)
    elementos.append(PoligonoDibujo(pesa, str(cfg["peso"]["color"]).lower()))
    return tuple(elementos)


def _globos_del_ramo(
    estructura: Mapping[str, object],
    cantidades: Sequence[int],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> tuple[list[Globo], bool, tuple[ElementoDibujo, ...]]:
    """Los globos del ramo con ``y`` desde el piso, si flota (``modo`` de su forma lista) y sus cintas y pesa."""
    forma = _forma_del_ramo(estructura)
    especiales, material_de = _especiales(cantidades, colores, contexto)
    _especial_de_la_forma(forma, cantidades, colores, contexto, especiales, material_de)
    latex = [(i, c) for i, c in enumerate(cantidades) if i not in material_de]
    secuencia = _intercalar(sorted(latex, key=lambda item: (-item[1], item[0])))[:MAX_GLOBOS]
    cfg = aplicar_forma_ramo(config_inicial(), forma)
    # Sin contexto todo es látex R12 (el plan no dice qué material es especial). Siempre del tamaño exacto,
    # sin la variación de inflado que el diseñador agrega para que el dibujo no se vea de molde.
    cfg["especiales"] = especiales
    cfg["latex"] = len(secuencia)
    cfg["tamanos"] = {**cfg["tamanos"], "mezcla": _mezcla_latex(latex, contexto), "variacion": 0}
    cfg["aspecto"] = {**cfg["aspecto"], "semilla": forma.semilla}
    # La pesa dice cuál es cuál, como en la vista previa del clasificador (``bouquet`` de ``vista-previa.ts``):
    # la caja sorpresa es una caja de regalo del color principal y todo lo demás lleva la bolsa de peso.
    if estructura.get("forma") == "caja":
        principal = max(range(len(cantidades)), key=lambda i: (cantidades[i], -i))
        cfg["peso"] = {"tipo": "regalo", "color": colores[principal]}
    else:
        cfg["peso"] = {**cfg["peso"], "tipo": "bolsa"}
    limpio, _cambios = sanear(cfg)
    disposicion = crear_disposicion(limpio)
    # De atrás hacia adelante por capa, como ``pintar``. El látex toma el color por turnos sobre el orden del
    # ramo; cada especial, el de su material.
    colorados: list[tuple[ItemRamo, str]] = []
    turno = 0
    for item in disposicion.items:
        if item.idxEspecial is not None and item.idxEspecial < len(material_de):
            tono = colores[material_de[item.idxEspecial]]
        elif secuencia:
            tono = colores[secuencia[turno % len(secuencia)]]
            turno += 1
        else:
            tono = colores[material_de[0]] if material_de else colores[0]
        colorados.append((item, tono))
    colorados.sort(key=lambda par: par[0].capa)
    globos = [(item.x, item.y, item.ancho / 2, tono) for item, tono in colorados]
    flota = limpio["forma"]["modo"] == "flotante"
    return globos, flota, _estructura_del_ramo(limpio, disposicion)


def _pieza_flotante_o_de_piso(
    globos: list[Globo], flota: bool, elementos: tuple[ElementoDibujo, ...] = ()
) -> PiezaDePlugin:
    if not flota:
        return PiezaConEstructura(globos, anclaje="piso", elementos=elementos)
    return PiezaConEstructura(
        globos,
        anclaje="flotante",
        elevacion_m=min(y - r for _x, y, r, _t in globos),
        elementos=elementos,
    )


def pieza_de(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> PiezaDePlugin | None:
    """Una instancia del bouquet con ``y`` desde el piso y cómo se sostiene, o ``None`` si no es un bouquet."""
    if not es_bouquet(estructura):
        return None
    materiales = _materiales(estructura)
    if not materiales or len(colores) < len(materiales):
        return None
    cantidades = cantidades_por_instancia(estructura)
    if sum(cantidades) == 0:
        return None
    armado = _armado_valido(estructura)
    if armado is not None:
        globos = [
            (d.x, d.y, d.r, colores[d.material])
            for d in _discos_del_armado(armado, len(materiales), contexto)
        ]
        return _pieza_flotante_o_de_piso(globos, armado.get("variante") != "base_aire")
    globos, flota, elementos = _globos_del_ramo(estructura, cantidades, colores, contexto)
    return _pieza_flotante_o_de_piso(globos, flota, elementos)


def globos_de(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> list[Globo] | None:
    """Los globos de una instancia del bouquet, o ``None`` si la estructura no es un bouquet."""
    pieza = pieza_de(estructura, colores, contexto)
    return pieza.globos if pieza is not None else None
