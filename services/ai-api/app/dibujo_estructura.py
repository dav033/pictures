"""El dibujo esquemático de una pieza del plan a la que ningún motor arma.

**Para qué.** Cuatro estructuras oficiales se quedaban sin nada que ver en la propuesta: la pared, el aro
circular, el techo de globos y el centro de mesa. Ninguna tiene motor —no hay un diseñador que coloque sus
globos uno a uno— y, cuando el camino de siempre les ponía un armado de arco o de guirnalda, la pieza se
dibujaba con la forma equivocada. ``app/referencias/dibujos.py`` es el puerto 1 a 1 de los dibujos que el
repo dueño hace para justo estas piezas; este módulo es el único sitio donde una estructura del plan se
convierte en lo que esos dibujos piden.

**Qué NO hace.** No cuenta, no mide y no compra. Los dibujos son esquemáticos —«No calculan cantidades: la
medida es la típica de cada estructura», encabezado de ``dibujos.py``—, así que nada de aquí entra en
``_conteo_del_motor``, en el despiece, en ``compras``, en el snapshot ni en ``plan_hash``. En particular, el
aro circular sigue contándose con su fórmula (``π × diámetro``, ``x-geometria-estructuras-oficiales``), que es
la cifra correcta de la pieza; este módulo solo le da cara.

**De dónde sale cada dato.**

- El **color** de cada material es el hexadecimal de la **tinta** de su referencia Sempertex
  (``color_catalogo.referencia_de(...)["hexTinta"]``). Es con el que dibujan los motores a propósito: copian al
  diseñador del repo dueño. El del globo inflado (``hexGlobo``) es para describirle el color a un modelo de
  imagen, no para pintar un esquema. Lo explica el encabezado de ``app/color_catalogo.py``.
- El **acabado** del dibujo sale de la **familia** de esa misma referencia, como en el repo dueño
  (``acabadoDe`` de ``src/lib/referencias/vista-previa.ts``): cristal es transparente, Metal y Reflex son
  cromados y el resto son mates. No se adivina desde la palabra del plan, que es más ancha que estos cuatro.
- El **peso** de un color es su ``participacion`` en la pieza: el dibujo reparte los globos en esa proporción.
- La **mezcla de tamaños** es la que la resolución ya calculó (``plan_resuelto.estructuras[].mezcla_real``).
  No se vuelve a calcular aquí: la pieza tiene una sola cuenta de globos y es la de ``plan.py``.

Puro: sin catálogo, sin E/S y sin reloj. Determinista, como los dibujos que usa.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import cast

from app.arco.tipos import TAMANO_ESTANDAR, TAMANOS_GLOBO
from app.color_catalogo import ACABADO_MOTOR_POR_FAMILIA, referencia_de
from app.generated_models import contract_schema
from app.motores.canonico import hex_de
from app.organico.tipos import Acabado
from app.referencias.dibujos import (
    GLOBOS_POR_AREA,
    ColorDibujo,
    DatosDibujo,
    DensidadDibujo,
    Dibujo,
    dibujar_centro,
    dibujar_circulo,
    dibujar_pared,
    dibujar_techo,
)
from app.organico.motor import GloboOrg
from app.referencias.dibujos import ElementoDibujo, con_globos, con_globos_y_estructura

#: Un dibujo de ``app/referencias/dibujos.py``: recibe ``(forma, patron, datos)`` y devuelve el interior del
#: ``<svg>`` con su lienzo.
Dibujante = Callable[[str | None, str | None, DatosDibujo], Dibujo]

#: Qué dibujo le toca a cada estructura oficial sin motor. Son las cuatro piezas que el repo dueño dibuja él
#: mismo porque no tienen diseñador, y la pared son tres oficiales (densa, no densa y orgánica) sobre el mismo
#: dibujo: cuál de las tres es lo diría su forma, que hoy no viaja (ver ``FORMA``, abajo).
#:
#: Una oficial que no está aquí **no se dibuja**: o la arma un motor —y entonces manda su armado, que coloca
#: cada globo— o no tiene dibujo propio (el bouquet, que tiene el suyo; la figura, que no tiene forma fija).
DIBUJO_POR_OFICIAL: Mapping[str, Dibujante] = {
    "pared_densa": dibujar_pared,
    "pared_no_densa": dibujar_pared,
    "pared_organica": dibujar_pared,
    "aro_circular": dibujar_circulo,
    "techo_globos": dibujar_techo,
    "centro_mesa": dibujar_centro,
}

#: Lo mismo por ``tipo``, para un plan de antes de que existiera ``estructura_oficial``. Solo estos dos: son
#: los dos tipos del plan que **ningún** motor arma, así que el tipo basta para saber qué se dibuja. Un ``arco``
#: y una ``guirnalda`` no están porque sin la oficial no se sabe si es un arco de verdad —y entonces lo dibuja
#: su motor— o si es el aro circular o el techo de globos, que se construyen con esos mismos tipos.
DIBUJO_POR_TIPO: Mapping[str, Dibujante] = {
    "pared": dibujar_pared,
    "centro_mesa": dibujar_centro,
}

#: Del modo de color del plan al patrón del dibujo. **Es un adaptador entre dos vocabularios con dos dueños**:
#:
#: - Los **modos** son del plan (ADR-0028, ``app.patron_color.MODOS``, cuyo dueño es el Zod de
#:   ``patron-color.v1`` en este repo): ``espiral, anillos, bloques, degradado, aleatorio, flor, damero,
#:   zonas``.
#: - Los **patrones** son de los dibujos (dueño: ``referencias/dibujos.ts`` del clasificador, que este repo
#:   solo porta): ``liso, franjas, ajedrez, degradado, arcoiris, por-zonas, espiral, mural``.
#:
#: Ninguno de los dos se renombra desde aquí, así que la traducción vive en esta tabla y en ningún otro sitio.
#: Las equivalencias que no son literales: ``anillos`` son franjas (bandas transversales de un color cada
#: una), ``damero`` es el ajedrez y ``bloques`` cae en ``por-zonas``, que es lo que hace un dibujo con manchas
#: de color contiguas.
#:
#: Dos modos valen ``None`` **a propósito**, y ``None`` no es un hueco: es el pintor por defecto de
#: ``dibujos._pintor``, que reparte los colores al azar en proporción a sus pesos.
#:
#: - ``aleatorio`` es exactamente eso, así que nombrarlo sería decir lo mismo dos veces.
#: - ``flor`` **no tiene equivalente**: es un racimo con pétalos alrededor de un centro, y ninguno de los ocho
#:   patrones del clasificador dibuja una flor. Antes que pintar otra cosa y llamarla flor, el dibujo sale con
#:   los colores mezclados. Se cambia el día que el clasificador tenga un patrón floral, allá primero.
PATRON_DEL_MODO: Mapping[str, str | None] = {
    "espiral": "espiral",
    "anillos": "franjas",
    "bloques": "por-zonas",
    "degradado": "degradado",
    "aleatorio": None,
    "flor": None,
    "damero": "ajedrez",
    "zonas": "por-zonas",
}

#: La forma del dibujo que le corresponde a cada estructura oficial.
#:
#: **Por qué hace falta.** Sin esto la forma iba siempre en ``None``, la rama por defecto de cada dibujo, y eso
#: dejaba dos cosas mal y una a medias:
#:
#: - **Las tres paredes oficiales salían iguales**, y sin patrón de color las tres caían en la rama
#:   ``organica``: una ``pared_densa`` —«Fondo completo de globos, sin huecos»— se dibujaba con la textura de
#:   racimos irregulares de la orgánica. Medido: ``dibujar_pared(None, None, …)`` da el mismo SVG que
#:   ``dibujar_pared("organica", None, …)``.
#: - **El centro de mesa salía alto**: su rama por defecto es ``helio``, que la lámina del dueño describe «De
#:   tres a siete globos con helio atados a una pesa: **alto**», y la oficial dice «Arreglo **bajo** de globos
#:   sobre una mesa». La forma ``base`` es la que dice «bajo».
#: - **El techo salía con cintas colgando** (``helio``: «Globos flotando contra el techo, con cintas
#:   colgando»), y la oficial solo dice «Globos suspendidos que cubren el techo». ``malla`` es «una capa pareja
#:   de globos que cubre el techo», sin cintas que nadie pidió.
#:
#: **De dónde sale cada par.** De emparejar la descripción de la oficial (``estructuras-oficiales.ts``) con la
#: ayuda de la forma en la lámina del dueño (``referencias/variantes.ts``), que se dicen casi con las mismas
#: palabras. No es una elección de gusto: es la traducción entre dos vocabularios que ya existen.
#:
#: ``aro_circular`` va a ``organico`` —«Guirnalda de tamaños mezclados que cubre todo el aro»— que ya era su
#: rama por defecto; se escribe igual para que deje de depender de un respaldo.
#:
#: ``pared_no_densa`` comparte la geometría de la densa a propósito. Su texto («deja ver la pared») se empareja
#: con ``malla-links``, pero esa forma dibuja **globos link** —nodos de R-5 y enlaces— y eso es un producto que
#: el plan puede no llevar: sería pintar lo que nadie compró, el mismo error que coronar una columna que nadie
#: coronó. Lo ligero de una pared es cuánto se llena, no cómo se construye, y eso lo dicen sus líneas y su
#: total en la tarjeta. El día que el dibujo sepa ralear una rejilla, aquí es donde se cambia.
#:
#: Las demás formas del dueño (``rombos``, ``doble``, ``media-luna``, ``nube``, ``topiario``…) **ya se pueden
#: elegir**: viajan en el plan como ``estructuras[].forma`` (``FORMAS_POR_OFICIAL``, abajo) y cuando la pieza
#: trae una **manda la elegida**. Esta tabla es el respaldo de la pieza que no eligió ninguna, que es la
#: mayoría: así un plan de antes de que la forma existiera se dibuja exactamente igual que hoy.
FORMA_POR_OFICIAL: Mapping[str, str] = {
    "pared_densa": "cuadriculada",
    "pared_no_densa": "cuadriculada",
    "pared_organica": "organica",
    "aro_circular": "organico",
    "techo_globos": "malla",
    "centro_mesa": "base",
}

#: Las formas que el decorador **puede elegir** para cada estructura oficial. Dueño único:
#: ``src/lib/plan/formas-pieza.ts``, que es el puerto de las ``formas`` de ``referencias/variantes.ts`` del
#: repo dueño; viaja al contrato en ``x-formas-pieza`` y se lee de ahí, igual que ``plan.py`` lee la geometría
#: y las formas de las oficiales. Aquí no se repite ningún id.
#:
#: **Para qué la necesita el dibujo**, si el contrato ya rechaza una forma que no es de esa pieza: porque este
#: módulo no es solo la ruta. ``dibujo_de`` se llama con el plan que le pasen y una forma ajena —una
#: ``media-luna`` en una pared— saldría dibujada en la rama equivocada en vez de en la que la oficial implica.
#: El contrato es la puerta; esta tabla es que el dibujo no le crea a ciegas a lo que entró por ella.
FORMAS_POR_OFICIAL: Mapping[str, tuple[str, ...]] = {
    oficial: tuple(str(forma) for forma in cast(Sequence[object], formas))
    for oficial, formas in cast(
        Mapping[str, object], contract_schema("PlanDecoracion").get("x-formas-pieza", {})
    ).items()
}

#: La familia de la referencia del catálogo, en el acabado con el que pinta el motor orgánico: la tabla
#: ``acabadoDe`` del repo dueño, cuya única copia en pictures es ``color_catalogo.ACABADO_MOTOR_POR_FAMILIA``
#: (la leen también las recetas de los motores orgánicos).
_ACABADO_POR_FAMILIA = cast(Mapping[str, Acabado], ACABADO_MOTOR_POR_FAMILIA)
#: Lo que es un globo de látex normal, y lo que se usa cuando el color no está en la lámina.
_ACABADO_POR_DEFECTO: Acabado = "mate"

#: Peso de un color cuyo material no declara una participación usable. Es el respaldo del repo dueño
#: (``peso: g.porColor.get(c) ?? 1``): un color sin peso cuenta como uno, no como ninguno.
_PESO_POR_DEFECTO = 1.0

#: Los seis tamaños redondos del catálogo y el estándar, con su tipo puesto aquí: ``mypy`` corre con
#: ``follow_imports = "skip"``, así que lo que llega de ``app.arco.tipos`` le llega como ``Any``. Es la misma
#: envoltura que usa ``app/referencias/dibujos.py``, y el dueño de las cifras sigue siendo ``arco/tipos.py``.
_REDONDOS: tuple[int, ...] = tuple(int(tamano) for tamano in TAMANOS_GLOBO)
_ESTANDAR: int = int(TAMANO_ESTANDAR)

#: La forma de globo que los dibujos colocan. Un corazón o un link no son un globo redondo y no entran en la
#: mezcla, igual que en el repo dueño, que solo cuenta los formatos ``R-``. Sin forma declarada se asume
#: redondo, que es el supuesto del propio resolutor (``plan.py``, ``requested_shape``).
_FORMA_REDONDA = "redondo"

#: Las densidades que el dibujo sabe aplicar, leídas de su propia tabla: una densidad que no está ahí no viaja
#: y la pieza se dibuja en media.
_DENSIDADES: frozenset[str] = frozenset(GLOBOS_POR_AREA)

#: La oficial que un ``tipo`` implica **sin ambigüedad**, para un plan sin ``estructura_oficial``: solo el
#: centro de mesa, que tiene una sola oficial. La pared son tres (densa, no densa, orgánica) y elegir una por
#: el tipo sería inventarla; un plan nuevo ya llega con la suya sellada al confirmar
#: (``sellarEstructurasOficiales`` de ``estructuras-oficiales.ts``).
#:
#: Sin esto, un centro de mesa sin oficial se dibujaba con la rama por defecto de ``dibujar_centro``, que es
#: ``helio`` —el bouquet **alto** de tres a siete globos—, en vez de la ``base`` baja que dice su oficial.
_OFICIAL_POR_TIPO: Mapping[str, str] = {"centro_mesa": "centro_mesa"}


def _peso_de(material: Mapping[str, object]) -> float:
    """La participación del material como peso de su color en el dibujo."""
    parte = material.get("participacion")
    if isinstance(parte, bool) or not isinstance(parte, (int, float)) or parte <= 0:
        return _PESO_POR_DEFECTO
    return float(parte)


def _texto(valor: object) -> str | None:
    """Una cadena con contenido, o ``None``: así un campo vacío del plan no se confunde con un valor."""
    return valor if isinstance(valor, str) and valor.strip() else None


def _color_de(material: Mapping[str, object]) -> ColorDibujo:
    """Un color del dibujo: la tinta de su referencia Sempertex, su acabado y su peso.

    Un color que no es un nombre de la lámina (la paleta del plan tiene más palabras que referencias) sale en
    el gris de respaldo de ``hex_de``, que es el mismo con el que dibujan los motores cuando no les llega un
    tono: aquí no se inventa un hexadecimal.
    """
    referencia = referencia_de(_texto(material.get("color")), _texto(material.get("acabado")))
    if referencia is None:
        return {"hex": hex_de(None), "acabado": _ACABADO_POR_DEFECTO, "peso": _peso_de(material)}
    familia = _texto(referencia.get("familia")) or ""
    return {
        "hex": str(referencia["hexTinta"]).lower(),
        "acabado": _ACABADO_POR_FAMILIA.get(familia, _ACABADO_POR_DEFECTO),
        "peso": _peso_de(material),
    }


def colores_de(materiales: Sequence[Mapping[str, object]]) -> list[ColorDibujo]:
    """Los colores de la pieza **del que más globos lleva al que menos**, que es lo que piden los dibujos.

    El orden importa: el primero es el fondo de un mural y el color de un liso, y el degradado se reordena
    luego por claridad. En un empate queda el orden del plan, donde el primer material es el principal.
    """
    return sorted(
        (_color_de(material) for material in materiales), key=lambda color: -color["peso"]
    )


def mezcla_de(mezcla_real: Sequence[Mapping[str, object]]) -> dict[int, float]:
    """Globos por tamaño redondo, leídos de ``plan_resuelto.estructuras[].mezcla_real``.

    Los seis tamaños van siempre, con cero los que la pieza no lleva: los dibujos indexan la mezcla por tamaño
    y un hueco sería un fallo, no un cero. Lo que no es un globo redondo del catálogo no cuenta.
    """
    mezcla: dict[int, float] = {tamano: 0.0 for tamano in _REDONDOS}
    for linea in mezcla_real:
        forma = _texto(linea.get("forma"))
        if forma is not None and forma != _FORMA_REDONDA:
            continue
        pulgadas = linea.get("diam_pulg")
        if isinstance(pulgadas, bool) or not isinstance(pulgadas, (int, float)):
            continue
        tamano = int(pulgadas)
        if tamano not in mezcla:
            continue
        unidades = linea.get("unidades")
        if isinstance(unidades, bool) or not isinstance(unidades, (int, float)):
            continue
        mezcla[tamano] += float(unidades)
    return mezcla


def _dominante(mezcla: Mapping[int, float]) -> int:
    """El tamaño redondo que más se usa; R-12 si la pieza no lleva ninguno.

    Mismo recorrido que el repo dueño: se parte de R-12 y solo lo desplaza un tamaño con **más** globos, así
    que un empate se queda con el estándar o con el primero de los empatados en el orden de los tamaños.
    """
    mejor = _ESTANDAR
    for tamano in _REDONDOS:
        if mezcla[tamano] > mezcla[mejor]:
            mejor = tamano
    if mezcla[mejor] > 0:
        return mejor
    return next((tamano for tamano in _REDONDOS if mezcla[tamano] > 0), _ESTANDAR)


def datos_de(
    estructura: Mapping[str, object], mezcla_real: Sequence[Mapping[str, object]]
) -> DatosDibujo:
    """Lo que el dibujo necesita de la pieza: sus colores, su mezcla de tamaños, cuántos globos redondos y su
    densidad.

    La **densidad** es la del plan (``sencilla``, ``media`` o ``lujosa``) y el dibujo la aplica con el criterio
    del dueño (``GLOBOS_POR_AREA`` de ``referencias/dibujos.py``): una pared sencilla deja huecos, una lujosa
    lleva relleno, un techo o un centro de mesa lujoso lleva más piezas. Sin densidad, o con ``media``, el
    dibujo es el de siempre byte a byte.
    """
    mezcla = mezcla_de(mezcla_real)
    materiales = estructura.get("materiales")
    crudos = (
        [m for m in cast(Sequence[object], materiales) if isinstance(m, Mapping)]
        if isinstance(materiales, Sequence) and not isinstance(materiales, (str, bytes))
        else []
    )
    datos: DatosDibujo = {
        "colores": colores_de(crudos),
        "mezcla": mezcla,
        "dominante": _dominante(mezcla),
        "redondos": int(sum(mezcla.values())),
    }
    densidad = _texto(estructura.get("densidad"))
    if densidad in _DENSIDADES:
        datos["densidad"] = cast(DensidadDibujo, densidad)
    return datos


def patron_de(estructura: Mapping[str, object]) -> str | None:
    """El patrón del dibujo que le toca al modo de color de la pieza, o ``None`` para el pintor por defecto."""
    patron = estructura.get("patron_color")
    if not isinstance(patron, Mapping):
        return None
    base = patron.get("base")
    if not isinstance(base, Mapping):
        return None
    return PATRON_DEL_MODO.get(_texto(base.get("modo")) or "")


def dibujante_de(estructura: Mapping[str, object]) -> Dibujante | None:
    """El dibujo de esta pieza, o ``None`` si no le toca ninguno.

    Se mira ``estructura_oficial`` y, si la pieza no lo trae (un plan de antes del campo), su ``tipo``, que
    solo alcanza para la pared y el centro de mesa (``DIBUJO_POR_TIPO``). ``None`` para todo lo demás: una
    pieza con armado de motor **nunca** llega aquí, porque su propio motor la dibuja colocando cada globo.
    """
    oficial = _texto(estructura.get("estructura_oficial"))
    if oficial is not None:
        return DIBUJO_POR_OFICIAL.get(oficial)
    return DIBUJO_POR_TIPO.get(_texto(estructura.get("tipo")) or "")


def forma_de(estructura: Mapping[str, object]) -> str | None:
    """La forma del dibujo de esta pieza: **la que eligió el decorador** y, si no eligió, la de su oficial.

    Solo por la oficial: el ``tipo`` no alcanza. Las tres paredes son el mismo ``tipo`` y distinta forma, que es
    justo lo que ``FORMA_POR_OFICIAL`` arregla, así que resolverla por tipo las volvería a igualar. La única
    excepción es el tipo que implica una sola oficial (``_OFICIAL_POR_TIPO``: el centro de mesa, que sin ella
    salía alto). Sin oficial no hay forma (``None``, la rama por defecto de cada dibujo), aunque la pieza traiga
    una ``forma``: una forma
    elegida no significa nada sin la pieza a la que pertenece, y el contrato tampoco la admite así.

    Una ``forma`` que **no es de esa oficial** se ignora y la pieza vuelve a su respaldo: el contrato ya la
    rechaza (``reglasJsonSchemaFormaPieza``), y este módulo se llama con el plan que le pasen, así que no le
    cree a ciegas. Ignorarla y dibujar la forma que la oficial implica es lo mismo que hace una pieza sin forma,
    que es el caso de todo plan anterior a este campo.
    """
    oficial = _texto(estructura.get("estructura_oficial")) or _OFICIAL_POR_TIPO.get(
        _texto(estructura.get("tipo")) or ""
    )
    if oficial is None:
        return None
    elegida = _texto(estructura.get("forma"))
    if elegida is not None and elegida in FORMAS_POR_OFICIAL.get(oficial, ()):
        return elegida
    return FORMA_POR_OFICIAL.get(oficial)


def dibujo_de(
    estructura: Mapping[str, object], mezcla_real: Sequence[Mapping[str, object]]
) -> Dibujo | None:
    """El dibujo esquemático de la pieza (``svg``, ``ancho`` y ``alto``), o ``None`` si no le toca ninguno.

    ``None`` también cuando la pieza no tiene materiales: sin un solo color no hay nada que pintar, y los
    dibujos piden al menos uno (es lo que hace la vista previa del repo dueño, que no llama a ningún dibujo
    cuando la ficha no tiene globos reconocibles).
    """
    dibujante = dibujante_de(estructura)
    if dibujante is None:
        return None
    datos = datos_de(estructura, mezcla_real)
    if not datos["colores"]:
        return None
    return dibujante(forma_de(estructura), patron_de(estructura), datos)


def globos_de(
    estructura: Mapping[str, object], mezcla_real: Sequence[Mapping[str, object]]
) -> list[GloboOrg] | None:
    """Los globos que el dibujo esquemático de la pieza coloca, o ``None`` si no le toca dibujo.

    Los mismos que pinta ``dibujo_de`` (la misma forma, el mismo patrón, la misma mezcla), leídos de la lista
    que se pinta: en metros, ``y`` hacia arriba, y con el color de la **tinta** con que dibuja el esquema. Quien
    necesita otro color (la guía de escena pinta el del globo inflado) lo traduce por material.

    En la pared ``malla-links`` incluye los **globos link**, cada uno como una hilera de discos solapados en el
    color de su material (``con_globos``): son globos de la pieza aunque el dibujo los pinte como elipses.
    """
    if dibujante_de(estructura) is None or not datos_de(estructura, mezcla_real)["colores"]:
        return None
    _dibujo, globos = con_globos(lambda: cast(Dibujo, dibujo_de(estructura, mezcla_real)))
    return cast(list[GloboOrg], globos)


def globos_y_estructura_de(
    estructura: Mapping[str, object], mezcla_real: Sequence[Mapping[str, object]]
) -> tuple[list[GloboOrg], list[ElementoDibujo]] | None:
    """Lo de ``globos_de`` y además **lo que no es globo y se construye** (``con_globos_y_estructura``).

    Hoy solo lo anotan el aro (su anillo de metal, su poste con su base, el forro del aro «con fondo» y la tela
    de la media luna) y el mini aro del centro de mesa (anillo y poste), en metros y en el marco de los globos.
    Las demás piezas devuelven la lista vacía. Un solo dibujo para las dos cosas: la guía no dibuja dos veces.
    """
    if dibujante_de(estructura) is None or not datos_de(estructura, mezcla_real)["colores"]:
        return None
    _dibujo, globos, elementos = con_globos_y_estructura(
        lambda: cast(Dibujo, dibujo_de(estructura, mezcla_real))
    )
    return cast(list[GloboOrg], globos), elementos


__all__ = [
    "DIBUJO_POR_OFICIAL",
    "FORMAS_POR_OFICIAL",
    "FORMA_POR_OFICIAL",
    "DIBUJO_POR_TIPO",
    "PATRON_DEL_MODO",
    "Dibujante",
    "colores_de",
    "datos_de",
    "dibujante_de",
    "dibujo_de",
    "forma_de",
    "globos_de",
    "globos_y_estructura_de",
    "mezcla_de",
    "patron_de",
]
