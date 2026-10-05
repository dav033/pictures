"""La puerta del motor del diseñador: el catálogo de armados, armar una pieza y completar un plan.

Vivía en ``app/omoikane/`` porque la llama el agente de chat, pero **aquí no hay ninguna IA**: no se habla con
ningún proveedor y todo es CPU. Su sitio es este, junto a las puertas de los motores que usa
(``armado_arco.py``, ``armado_columna.py``, ``armado_columna_organica.py``, ``armado_guirnalda_organica.py``).
Cada IA se encarga de una cosa, y la de Omoikane es conversar con el cliente (2026-10-03).

El nombre de la **operación** no cambia —``omoikane.armado_estructura`` y ``omoikane-armado-estructura.v1``—
porque es un identificador publicado: viaja firmado en cada petición y lo nombran el contrato, la ruta y la
caché. Mover el módulo es ordenar el código; renombrar la operación sería romper la frontera.

El chat no tenía ningún mando de armado (ADR-0034 §5): el patrón lo ponía el servidor desde la foto o desde un
preset. Este módulo le abre al modelo las mismas herramientas que usa el diseñador —los catorce patrones del arco y los
nueve de la columna, con sus mandos, rangos y mínimos de color— y es la **puerta** por la que pasa lo que el
modelo proponga.

Tres acciones, una sola operación porque son el mismo trabajo visto desde tres momentos del turno:

``catalogo``
    Lo que el modelo puede usar, sacado de ``opciones_admitidas()`` del motor. Es una consulta: así no tiene
    que adivinar un nombre de patrón ni un rango, y si allá se añade un patrón, aquí se ve sin tocar nada.

``armar``
    Un armado concreto para una pieza: el patrón, sus mandos y los índices de material. Lo valida la puerta
    del motor (``app/armado_arco.py``, ``app/armado_columna.py``) y, si se sostiene, lo resuelve para devolver
    lo que de verdad lleva —globos, conteo por material, compra y medidas— con sus avisos. Si no se sostiene,
    sale el motivo estable y el mensaje en español, nunca un armado a medias. Es la acción del **patrón**, así
    que ninguna pieza orgánica pasa por aquí: la columna y la guirnalda del motor, el arco que el plan declara
    orgánico y el ``semiarco`` reciben su armado por ``completar``.

``completar``
    Al confirmar el plan: cada arco, cada medio arco y cada columna sale con armado. El que el modelo armó si se sostiene
    contra la pieza de verdad (los índices de material se comprueban otra vez contra sus materiales, que es lo
    que el modelo no podía saber cuando lo armó), y si no, la **receta del motor**: ``config_inicial()`` del
    patrón que mejor encaje con lo que la pieza ya dice. Un plan no se queda sin armado por un olvido del
    modelo, igual que ``completar_armados_guirnalda`` hace con la guirnalda (ADR-0032).

**Por qué `completar` vive aquí y no dentro de `resolve_plan`.** Su sitio natural es la resolución, al lado de
``completar_armados_guirnalda``. Mientras ``app/plan.py`` esté cambiando por el conteo con motor del ADR-0034,
la frontera de Next pide la receta aquí y la escribe en el plan **antes** de resolver: el dueño de la receta
sigue siendo Python y el resultado es el mismo plan. Cuando la resolución pueda recibir el interruptor, esta
acción se mueve allá y la frontera deja de llamarla.

Nada de esto decide catálogo, precio ni aprobación: son globos colocados y aritmética del motor. El dibujo no
sale por aquí —el SVG viaja por la ruta del editor— porque el modelo no mira píxeles y pesa decenas de
kilobytes por pieza.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Mapping, Sequence, cast

from pydantic import Field, field_validator, model_validator

from app.arco.limites import ALTO_MAX as ARCO_ALTO_MAX
from app.arco.limites import ALTO_MIN as ARCO_ALTO_MIN
from app.arco.limites import ANCHO_MAX as ARCO_ANCHO_MAX
from app.arco.limites import ANCHO_MIN as ARCO_ANCHO_MIN
from app.arco.limites import limites as limites_arco
from app.arco.patrones import PATRONES as PATRONES_ARCO
from app.arco.patrones import config_inicial as config_inicial_arco
from app.arco.patrones import globos_ancho_por_defecto
from app.arco.tipos import PATRON_IDS as PATRON_IDS_ARCO
from app.armado_arco import ArmadoInvalido as ArmadoArcoInvalido
from app.color_catalogo import acabado_del_motor, es_aproximacion_del_motor
from app.armado_arco import EstructuraArco
from app.armado_arco import MAX_MATERIALES as MAX_MATERIALES_ARCO
from app.armado_arco import VERSION as VERSION_ARMADO_ARCO
from app.armado_arco import armado_resuelto as armado_arco_resuelto
from app.armado_arco import opciones_admitidas as opciones_arco
from app.armado_arco import validar as validar_arco
from app.armado_columna import ALTO_MAX as COLUMNA_ALTO_MAX
from app.armado_columna import ALTO_MIN as COLUMNA_ALTO_MIN
from app.armado_columna import PATRONES as PATRONES_COLUMNA
from app.armado_columna import PATRON_IDS as PATRON_IDS_COLUMNA
from app.armado_columna import ArmadoInvalido as ArmadoColumnaInvalido
from app.armado_columna import EstructuraColumna
from app.armado_columna import armado_resuelto as armado_columna_resuelto
from app.armado_columna import config_inicial as config_inicial_columna
from app.armado_columna_organica import ArmadoInvalido as ArmadoColumnaOrganicaInvalido
from app.armado_columna_organica import EstructuraColumnaOrganica
from app.armado_arco_organico import EstructuraArcoOrganico
from app.armado_arco_organico import VERSION as VERSION_ARMADO_ARCO_ORGANICO
from app.armado_arco_organico import opciones_admitidas as opciones_arco_organico
from app.armado_arco_organico import validar as validar_arco_organico
from app.armado_columna_organica import VERSION as VERSION_ARMADO_COLUMNA_ORGANICA
from app.armado_columna_organica import validar as validar_columna_organica
from app.columnaorg.formas import ESTILOS_COL, FORMAS_COLUMNA
from app.columnaorg.tipos import config_inicial as config_inicial_columna_organica
from app.armado_columna import opciones_admitidas as opciones_columna
from app.armado_columna import validar as validar_columna
from app.armado_guirnalda_organica import ArmadoInvalido as ArmadoGuirnaldaInvalido
from app.armado_guirnalda_organica import EstructuraGuirnalda
from app.armado_guirnalda_organica import ROLES as ROLES_GUIRNALDA
from app.armado_guirnalda_organica import VERSION as VERSION_ARMADO_GUIRNALDA
from app.armado_guirnalda_organica import armado_resuelto as armado_guirnalda_resuelto
from app.armado_guirnalda_organica import opciones_admitidas as opciones_guirnalda
from app.armado_guirnalda_organica import validar as validar_guirnalda
from app.armado_guirnalda_organica import MAX_GLOBOS_ESTIMADOS as GUIRNALDA_MAX_GLOBOS
from app.armado_guirnalda_organica import globos_estimados as globos_estimados_guirnalda
from app.armado_guirnalda_organica import limites_de as limites_guirnalda
from app.armado_guirnalda import CONFIANZA_MINIMA_LECTURA as CONFIANZA_MINIMA_LECTURA_GUIRNALDA
from app.armado_guirnalda import FORMAS as FORMAS_LECTURA_GUIRNALDA
from app.armado_guirnalda import SOPORTE_POR_UBICACION
from app.armado_guirnalda import SOPORTES as SOPORTES_LECTURA_GUIRNALDA
from app.armado_guirnalda import linea_de_lectura as linea_guirnalda_de_lectura
from app.armado_guirnalda import linea_del_motor as linea_guirnalda_del_motor
from app.guirnalda.limites import LARGO_MAX as GUIRNALDA_LARGO_MAX
from app.guirnalda.limites import LARGO_MIN as GUIRNALDA_LARGO_MIN
from app.guirnalda.formas import (
    ESTILOS_GUIR,
    FORMAS_GUIRNALDA,
    aplicar_forma_guir,
)
from app.guirnalda.tipos import config_inicial as config_inicial_guirnalda
from app.patron_de_la_foto import (
    RACIMO_MAX_MOTOR,
    RACIMO_MIN_MOTOR,
    PatronLeido,
    RemateLeido as RemateDeLaFoto,
    RepartoLeido,
    mezcla_del_motor,
    patron_del_motor,
    remate_del_motor,
    reparto_del_motor,
)
from app.operational_models import ContractModel, OperationalRequest
from app.organico.espina import crear_espina
from app.organico.formas import FORMAS_LISTAS
from app.organico.limites import ANCHO_MAX as ARCO_ORGANICO_ANCHO_MAX
from app.organico.limites import ANCHO_MIN as ARCO_ORGANICO_ANCHO_MIN
from app.organico.limites import sanear as sanear_arco_organico
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO
from app.organico.tipos import ESTILOS as ESTILOS_ARCO_ORGANICO
from app.organico.tipos import config_inicial as config_inicial_arco_organico
from app.patron_color import MaterialPatron

# El orden de los materiales de un patrón tiene un solo dueño, ``patron_color``, que no lo publica: se lee de
# ahí en vez de repetir aquí qué campo de cada modo nombra los colores.
from app.patron_color import _indices_base, _leer
from app.plan import (
    OFICIALES_ASIMETRICAS,
    OFICIALES_SIN_MOTOR,
    PistaPatron,
    PlanResolutionError,
    proporciones_de_mezcla,
)

OMOIKANE_ARMADO_SCOPE = "omoikane.armado_estructura"
OMOIKANE_ARMADO_SCHEMA_VERSION = "omoikane-armado-estructura.v1"
OMOIKANE_ARMADO_RESULT_VERSION = "omoikane-armado-estructura-result.v1"

#: La versión del contrato de la columna. La del arco se importa de su puerta (``armado_arco.VERSION``);
#: la de la columna la escribe su ``armado_resuelto`` y no la exporta, así que aquí está su único reflejo.
VERSION_ARMADO_COLUMNA = "armado-columna.v1"

#: La versión del contrato de la guirnalda orgánica, importada de su puerta.
VERSION_ARMADO_GUIRNALDA_ORGANICA = VERSION_ARMADO_GUIRNALDA

#: Los cuatro tipos de pieza con motor migrado y puerta en este repo. Las demás no tienen motor y siguen por
#: el camino de siempre.
#:
#: ``guirnalda`` es la **orgánica** del motor (``armado-guirnalda-organica.v1``). No tiene nada que ver con
#: ``armado-guirnalda.v1`` de ADR-0032 —racimos, relleno y remates—, que sigue vivo con su editor y su
#: ``completar_armados_guirnalda``: una pieza puede traer los dos y esta operación **nunca** toca el viejo.
#:
#: ``semiarco`` es un medio arco, y lo arma **siempre** el motor orgánico: «un medio arco es este armado con
#: ``forma.corte`` menor que 1» (encabezado de ``app/armado_arco_organico.py``), y la taxonomía retiró
#: ``semiarco`` de las formas del motor porque todo medio arco es orgánico. No tiene la puerta clásica de
#: patrones, así que su armado **no** depende de la mezcla que el plan declare, al contrario que ``arco`` y
#: ``columna``, que tienen dos motores cada uno y es la mezcla la que elige.
TIPOS_CON_MOTOR = ("arco", "semiarco", "columna", "guirnalda")

#: Tope de piezas que una acción ``completar`` puede traer: el mismo que ``estructuras`` en el plan.
MAX_ESTRUCTURAS = 8

#: Tope de colores que nombra un armado. Los tres contratos coinciden en 8 (``materiales`` del arco y de
#: la columna, ``colores.paleta`` de la guirnalda), y lo publica la puerta de cada motor.
MAX_MATERIALES = MAX_MATERIALES_ARCO

#: Índice de material más alto que admiten los tres contratos (``IndiceMaterialSchema``).
MAX_INDICE_MATERIAL = 11

#: El campo del plan donde vive el armado de cada tipo.
#:
#: ``arco`` y ``columna`` apuntan al armado **clásico**, que es el que les toca cuando el plan no los declara
#: orgánicos; cuando sí, el campo lo corrige ``_CLAVE_POR_VERSION``, que mira la versión del armado que de
#: verdad se eligió. Un ``semiarco`` no tiene esa doble puerta —su único motor es el orgánico—, así que aquí
#: ya apunta a ``armado_arco_organico`` y ``_CLAVE_POR_VERSION`` no le corrige nada.
CLAVE_ARMADO: dict[str, str] = {
    "arco": "armado_arco",
    "semiarco": "armado_arco_organico",
    "columna": "armado_columna",
    "guirnalda": "armado_guirnalda_organica",
}

#: Los acabados y los repartos que el motor admite, por su valor. No se escriben aquí: se leen del motor, como
#: los patrones, para que añadir uno allá se vea sin tocar nada.
VALORES_ACABADO = tuple(cast(str, a["valor"]) for a in ACABADOS)
VALORES_REPARTO = tuple(cast(str, r["valor"]) for r in REPARTOS)

#: El ``corte`` de cada forma lista del arco orgánico, por su id. **El dueño de la cifra es el motor**
#: (``app/organico/formas.py``, puerto 1 a 1 de ``clasificador-decoraciones``): aquí solo se indexa, para no
#: escribir a mano un número del diseño ajeno.
_CORTE_DE_FORMA: dict[str, float] = {forma.id: forma.forma["corte"] for forma in FORMAS_LISTAS}

#: La forma lista con la que sale un ``semiarco``, por su id, aplicada **entera** (silueta, volumen, tamaños y
#: semilla), no solo su ``corte``. Es la que la vista previa del clasificador da a la ficha «medio arco»
#: (``referencias/vista-previa.ts``, ``ORG_FORMA["medio-arco"]``): «Sube por un lado y termina en el aire antes
#: de bajar» (``organico/formas.ts``). Criterio escrito en ``docs/investigacion-arco-organico.md`` («Medio arco
#: en un plan»). Antes salía ``medio-pila`` con solo su corte (0,82): la segunda pata bajaba casi hasta el suelo
#: y el semiarco se leía como un arco completo, igual que un arco asimétrico.
FORMA_SEMIARCO = "medio-corto"

#: La del ``semiarco_asimetrico`` («Semiarco de contorno irregular, más grueso en una parte»): la carga, el
#: volumen y los tamaños de «Medio arco con pila en el suelo» —una pata gruesa con globos gigantes de anclaje que
#: se afina hacia el otro lado—, pero con el corte de ``FORMA_SEMIARCO``, para que siga siendo de un solo lado.
FORMA_SEMIARCO_ASIMETRICO = "medio-pila"

#: Las formas listas del arco orgánico, por su id, para aplicar una entera (no solo su ``corte``).
_FORMA_LISTA_ARCO = {forma.id: forma for forma in FORMAS_LISTAS}

#: La forma lista con la que sale un arco que el plan declara asimétrico (``arco_asimetrico``). En el diseñador
#: el arco de patrones solo es simétrico («Arco simétrico, sin orgánicos», galería de arcos) y la asimetría es
#: esta forma del orgánico: «Cima corrida hacia un lado y una pata mucho más cargada que la otra»
#: (``organico/formas.ts``), la misma que su vista previa usa para la ficha «Asimétrico sobre fondo»
#: (``referencias/vista-previa.ts``, ``ORG_FORMA``).
FORMA_ARCO_ASIMETRICO = "asimetrico"

#: La forma lista de columna orgánica con la que sale una ``columna_asimetrica`` («Columna de contorno irregular,
#: con racimos a un lado»): «Sube torcida hacia un lado» (``columnaorg/formas.ts``), la que la vista previa del
#: clasificador da a la columna con guirnalda (``COLORG_FORMA``). Una columna de anillos no puede ser asimétrica,
#: así que esta oficial —que se llama «Columna orgánica»— la arma siempre el motor orgánico, como el arco
#: asimétrico. Criterio en ``docs/investigacion-columna-organica.md`` («Columna en un plan»).
FORMA_COLUMNA_ASIMETRICA = "inclinada"
_FORMA_LISTA_COLUMNA = {forma.id: forma for forma in FORMAS_COLUMNA}

#: El estilo de la columna orgánica por densidad del plan (``columnaorg/formas.ts``, ``ESTILOS_COL``: «Cuánto se
#: llena la columna»), con la misma regla que el arco: ``media`` no aplica ``estandar`` y la columna no cambia.
_ESTILO_COLUMNA_POR_DENSIDAD = {
    densidad: next(estilo for estilo in ESTILOS_COL if estilo.id == ident)
    for densidad, ident in (("sencilla", "ligero"), ("lujosa", "lleno"))
}

#: Los globos por capa de la columna **clásica** por densidad: «cuartetos de 4 (lo normal), de 5 (más gruesa y
#: redonda) y de 3 (delgada)» (``clasificador-decoraciones/docs/investigacion-columnas.md``, «Cómo se construye»
#: y «Densidad y remate en un plan»). ``media`` no tiene entrada: es la capa del motor (4).
_GLOBOS_CAPA_POR_DENSIDAD = {"sencilla": 3, "lujosa": 5}

#: El estilo de partida del arco orgánico para cada densidad del plan. Los estilos son del diseñador
#: (``organico/tipos.ts``, ``ESTILOS``: «distinta densidad y grosor, como los que usan los decoradores (ligero /
#: estándar / lleno)»); ``media`` no tiene entrada a propósito (ver ``_armado_arco_organico``).
_ESTILO_POR_DENSIDAD = {
    densidad: next(estilo for estilo in ESTILOS_ARCO_ORGANICO if estilo.id == ident)
    for densidad, ident in (("sencilla", "ligero"), ("lujosa", "lleno"))
}

#: Lo mismo en la guirnalda orgánica: sus estilos «Cuánto se llena la guirnalda» (``guirnalda/formas.ts``,
#: ``ESTILOS_GUIR``: ligero «delgado y aireado», estándar «el punto medio», lleno «denso y voluminoso, sin
#: huecos»), que mueven el grosor, el relleno y el racimo. ``media`` tampoco tiene entrada: es la guirnalda de
#: siempre (ver la rama de la guirnalda en ``_receta``). El criterio está escrito en
#: ``clasificador-decoraciones/docs/investigacion-guirnalda.md`` (§ Densidad).
_ESTILO_GUIR_POR_DENSIDAD = {
    densidad: next(estilo for estilo in ESTILOS_GUIR if estilo.id == ident)
    for densidad, ident in (("sencilla", "ligero"), ("lujosa", "lleno"))
}

Identificador = Annotated[str, Field(min_length=1, max_length=160)]
Tipo = Literal["arco", "semiarco", "columna", "guirnalda"]


class PiezaArmado(ContractModel):
    """Lo que la pieza dice de sí misma, que es de dónde sale la geometría por defecto.

    El modelo no tiene que repetir el ancho ni el alto: si la estructura del plan ya los trae, llegan aquí y
    el motor arranca con ellos. ``colores`` es cuántos materiales lleva la pieza, y es el único tope de los
    índices que el armado puede nombrar: un índice que la pieza no tiene se rechaza en el momento, no en el
    plan.
    """

    tipo: Tipo
    colores: int = Field(ge=1, le=MAX_INDICE_MATERIAL + 1)
    ancho_m: float | None = Field(default=None, gt=0, le=100)
    alto_m: float | None = Field(default=None, gt=0, le=100)
    #: El largo de la pieza, que es lo que define una guirnalda.
    largo_m: float | None = Field(default=None, gt=0, le=100)
    #: La participación de cada material de la pieza, en su orden. La paleta de la guirnalda reparte sus pesos
    #: con esto: un material que lleva la mitad de la pieza pesa el doble que uno que lleva un cuarto. El
    #: patrón del arco y de la columna no lo lee, así que en esas dos piezas no viaja.
    pesos: list[float] | None = Field(default=None, max_length=MAX_INDICE_MATERIAL + 1)
    #: El acabado que el plan declara para cada material, en su orden; ``None`` donde no dice nada.
    acabados: list[str | None] | None = Field(default=None, max_length=MAX_INDICE_MATERIAL + 1)
    #: La mezcla de tamaños que el plan declara para la pieza (``clasica``, ``organica_fina``,
    #: ``organica_gruesa``, ``solo_grandes``). Es lo que distingue una columna de anillos de una columna
    #: orgánica: la clásica va de un tamaño y la orgánica mezcla varios (ADR-0035). Sin ella, la receta armaba
    #: siempre la clásica y una propuesta hecha desde una foto de columnas orgánicas salía con anillos.
    mezcla: str | None = Field(default=None, min_length=1, max_length=40)
    #: El color de catálogo de cada material, en su orden. Es con lo que se resuelve la lectura de la foto,
    #: que nombra los colores por nombre y no por índice (ADR-0039): sin esto, una pista no se puede usar.
    tonos: list[str | None] | None = Field(default=None, max_length=MAX_INDICE_MATERIAL + 1)
    #: La densidad que el plan declara para la pieza. La lee la receta del arco (``_globos_ancho_por_densidad``
    #: en el de patrones y ``ESTILOS`` en el orgánico); sin ella, la receta es la de siempre (``media``).
    #: Solo la llena ``completar`` desde la estructura del plan, igual que ``mezcla`` y ``tonos``.
    densidad: Literal["sencilla", "media", "lujosa"] | None = None
    #: Que el plan declara la pieza **asimétrica** (su oficial es de forma ``asimetrica``). Un arco así lo arma el
    #: motor orgánico con la forma lista ``asimetrico``: el arco de patrones del diseñador solo es simétrico.
    asimetrica: bool = False
    #: Que la pieza va volteada: un semiarco en ``lateral_derecho`` sube por la derecha y se curva hacia la
    #: izquierda (el mismo criterio con el que la tarjeta voltea su icono). Solo la llena ``completar``.
    espejo: bool = False
    #: La línea de una guirnalda que el plan ya declara por su armado por partes (``armado_guirnalda.forma``,
    #: ADR-0032), traducida a los campos de la espina del motor por ``armado_guirnalda.linea_del_motor``. Sin
    #: esto la receta orgánica armaba igual una recta, un festón y una U invertida.
    linea: dict[str, float] | None = None


class ColorPedido(ContractModel):
    """Un color de la paleta de la guirnalda: qué material es y, si el modelo lo dice, cómo se ve.

    El peso, el acabado y el papel son opcionales: sin ellos salen de lo que la pieza ya dice (la
    participación del material y su acabado declarado) o del valor del motor.
    """

    material: int = Field(ge=0, le=MAX_INDICE_MATERIAL)
    peso: float | None = Field(default=None, gt=0, le=100)
    #: Un valor de los que publica ``opciones_admitidas()["acabados"]``; otro se rechaza con su motivo.
    acabado: str | None = Field(default=None, min_length=1, max_length=40)
    rol: str | None = Field(default=None, min_length=1, max_length=40)


class PesoTamano(ContractModel):
    """Cuánto pesa un tamaño de globo en la mezcla. Los pesos son relativos y el motor los normaliza."""

    tamano: Literal[5, 9, 12, 18, 24, 36]
    peso: float = Field(ge=0, le=100)


class FormaPedida(ContractModel):
    """La línea de la guirnalda. Todo opcional: lo que falte sale de las medidas de la pieza o del motor."""

    largo_m: float | None = Field(default=None, gt=0, le=100)
    altura_m: float | None = Field(default=None, ge=0, le=10)
    pendiente_m: float | None = Field(default=None, ge=-5, le=5)
    onda_m: float | None = Field(default=None, ge=0, le=5)
    ondas: float | None = Field(default=None, ge=0, le=20)
    colgado_m: float | None = Field(default=None, ge=0, le=5)
    festones: int | None = Field(default=None, ge=1, le=20)
    carga: float | None = Field(default=None, ge=-1, le=1)
    suelo: bool | None = None


class VolumenPedido(ContractModel):
    """El grosor de la banda y cómo se agrupan los globos."""

    grosor_extremos_m: float | None = Field(default=None, gt=0, le=5)
    grosor_centro_m: float | None = Field(default=None, gt=0, le=5)
    irregularidad: float | None = Field(default=None, ge=0, le=1)
    relleno: float | None = Field(default=None, ge=0, le=1)
    racimo: int | None = Field(default=None, ge=1, le=20)
    salientes: float | None = Field(default=None, ge=0, le=1)


class AdornosPedidos(ContractModel):
    """Follaje y flores por metro. No se cotizan: no están en el catálogo de globos."""

    follaje: float | None = Field(default=None, ge=0, le=5)
    flores: float | None = Field(default=None, ge=0, le=5)


class GeometriaPedida(ContractModel):
    """Los ajustes de geometría que el modelo puede pedir. Todos opcionales: lo que falte lo pone el motor.

    ``forma``, ``globos_ancho``, ``suelo`` y ``tamano_globo`` son del arco; ``globos_capa``, ``abajo`` y
    ``arriba``, de la columna. El ancho y el alto valen para las dos. Lo que se salga del rango del motor se
    **acota** con un aviso en vez de rechazarse, porque es lo que hace el propio diseñador.
    """

    forma: Literal["alto", "semi", "herradura"] | None = None
    ancho_m: float | None = Field(default=None, gt=0, le=100)
    alto_m: float | None = Field(default=None, gt=0, le=100)
    globos_ancho: int | None = Field(default=None, ge=1, le=40)
    suelo: bool | None = None
    tamano_globo: Literal[5, 9, 12, 18, 24, 36] | None = None
    globos_capa: int | None = Field(default=None, ge=1, le=12)
    abajo: Literal[5, 9, 12, 18, 24, 36] | None = None
    arriba: Literal[5, 9, 12, 18, 24, 36] | None = None


class RematePedido(ContractModel):
    """El remate de una columna. Sin él, el motor pone el suyo (un globo de 24")."""

    tipo: Literal["ninguno", "globo", "racimo", "estrella", "corazon"]
    material: int | None = Field(default=None, ge=0, le=MAX_INDICE_MATERIAL)
    tamano: Literal[5, 9, 12, 18, 24, 36] | None = None
    cantidad: int | None = Field(default=None, ge=3, le=5)
    foil_m: float | None = Field(default=None, gt=0, le=4)


class ArmadoPropuesto(ContractModel):
    """Un armado que el modelo ya armó en este turno, para validarlo contra la pieza de verdad."""

    estructura_id: Identificador
    tipo: Tipo
    armado: dict[str, Any]


class RematePistaFoto(ContractModel):
    """Lo que la foto leyó coronando una columna, por elemento de la referencia (``RemateLeidoSchema``).

    El tamaño, los globos del racimo y el alto del foil no viajan: la foto no los mide y los pone el motor.
    """

    referencia_element_id: Identificador
    tipo: Literal["ninguno", "globo", "racimo", "estrella", "corazon"]
    #: Por NOMBRE de catálogo, como el resto de la lectura: quien mira la foto no conoce los índices de
    #: ``materiales`` de la pieza, y los resuelve ``patron_color.material_de_color``.
    color: str | None = Field(default=None, min_length=1, max_length=80)


class InclinacionPistaFoto(ContractModel):
    """Hacia dónde se va una pieza y cuánto, leído de la foto.

    Es una **fracción de su alto** con signo: negativo a la izquierda, positivo a la derecha. Sale de lo que el
    análisis ya contesta (`curves_toward` y `top_overhang`) y el motor orgánico sabe usarla: la columna tiene
    `forma.inclinacionM` en metros y la guirnalda `pendienteM` y `carga`. Hasta ahora todas salían rectas.
    """

    referencia_element_id: Identificador
    inclinacion: float = Field(ge=-1, le=1)


class CurvaPistaFoto(ContractModel):
    """La línea de una guirnalda leída en la foto (``LecturaGuirnaldaSchema``, ADR-0032, decisiones 27 a 29).

    Lo lee ``guirnalda-referencia``; antes de que llegara al motor toda guirnalda salía plana. ``arriba`` es la
    tendida sobre un fondo que cae por los dos lados; ``abajo``, el festón que cuelga. ``flecha`` es cuánto, en
    fracción del largo horizontal.

    Solo viajaban el sentido y la flecha, y el desnivel de los extremos se perdía: la foto del 2026-09-28 (curva
    hacia arriba 0,107 y el extremo derecho 0,335 del largo más bajo) salía nivelada, que es la regresión que
    corrige el resto de los campos. ``desnivel`` es el extremo derecho menos el izquierdo y ``caida`` la de las
    lecturas v2, los dos en fracción del largo; ``forma``, ``soporte`` y ``puntos_de_anclaje`` son los de la
    lectura y ``confianza`` la suya. La receta los traduce con las mismas funciones que el armado por partes
    (``armado_guirnalda.linea_de_lectura``), así que las dos guirnaldas leen igual la misma foto.

    Todos opcionales: una pista de antes de estos campos (solo sentido y flecha) se sigue leyendo como entonces.
    Los rangos son holgados frente a los de la lectura (``MAX_*_LECTURA_GUIRNALDA``, 0,6): el tope de verdad lo
    pone quien arma, con su aviso.
    """

    referencia_element_id: Identificador
    sentido: Literal["arriba", "abajo"] | None = None
    flecha: float | None = Field(default=None, ge=0, le=1)
    desnivel: float | None = Field(default=None, ge=-1, le=1)
    caida: float | None = Field(default=None, ge=0, le=1)
    forma: str | None = None
    soporte: str | None = None
    puntos_de_anclaje: int | None = Field(default=None, ge=2, le=6)
    confianza: float | None = Field(default=None, ge=0, le=1)

    @field_validator("forma")
    @classmethod
    def forma_del_contrato(cls, valor: str | None) -> str | None:
        """Una de las formas de ``armado-guirnalda.v1``; la lista es de ``armado_guirnalda``, no de aquí."""
        if valor is not None and valor not in FORMAS_LECTURA_GUIRNALDA:
            raise ValueError("forma de guirnalda desconocida")
        return valor

    @field_validator("soporte")
    @classmethod
    def soporte_del_contrato(cls, valor: str | None) -> str | None:
        """Uno de los soportes de ``armado-guirnalda.v1``, con la misma lista que la forma."""
        if valor is not None and valor not in SOPORTES_LECTURA_GUIRNALDA:
            raise ValueError("soporte de guirnalda desconocido")
        return valor


class TamanosPistaFoto(ContractModel):
    """De qué tamaños de globo es una pieza, leído de la foto (``TAMANOS_LEIDOS``).

    Viaja también al armado, y no solo a la resolución, porque **el motor arma antes de que el plan se
    resuelva**: si la lectura solo llegara a `plan.py`, la pieza quedaría dibujada con la mezcla declarada y
    cobrada con la leída, que es peor que no leer nada. Las dos ramas la traducen con la misma función
    (``mezcla_del_motor``), así que no pueden discrepar.
    """

    referencia_element_id: Identificador
    tamanos: str = Field(min_length=1, max_length=40)
    confianza: float = Field(ge=0, le=1)


class ArmadoEstructuraRequest(OperationalRequest):
    """``omoikane-armado-estructura.v1``: las tres acciones de la herramienta del agente.

    Un solo modelo con ``accion`` y un validador que exige lo de cada una, en vez de tres operaciones con tres
    ámbitos: es el mismo trabajo (el motor del diseñador sobre una pieza) y comparten los dos tipos, la
    geometría y la forma del armado.
    """

    schema_version: Literal["omoikane-armado-estructura.v1"]
    accion: Literal["catalogo", "armar", "completar"]
    tipo: Tipo | None = None
    # --- `armar` ---
    estructura_id: Identificador | None = None
    pieza: PiezaArmado | None = None
    patron: str | None = Field(default=None, min_length=1, max_length=40)
    materiales: list[int] | None = Field(default=None, min_length=1, max_length=MAX_MATERIALES)
    opciones: dict[str, float] | None = Field(default=None, max_length=24)
    geometria: GeometriaPedida | None = None
    remate: RematePedido | None = None
    # --- `armar`, solo la guirnalda orgánica: no tiene patrón, la definen estos bloques ---
    paleta: list[ColorPedido] | None = Field(default=None, min_length=1, max_length=MAX_MATERIALES)
    reparto: str | None = Field(default=None, min_length=1, max_length=40)
    mezcla_colores: float | None = Field(default=None, ge=0, le=1)
    forma: FormaPedida | None = None
    volumen: VolumenPedido | None = None
    tamanos: list[PesoTamano] | None = Field(
        default=None, min_length=1, max_length=len(TAMANOS_GLOBO)
    )
    adornos: AdornosPedidos | None = None
    #: La forma lista y el estilo del catálogo del motor (``opciones_admitidas``), por su id. Son un atajo,
    #: no una decisión nueva: aplicarlos copia las cifras del diseñador a los bloques de arriba, y cualquier
    #: campo que el modelo mande explícitamente manda sobre ellos. Sin esto, pedir «la de festones» obligaba
    #: al modelo a copiar a mano ocho números del catálogo, y copiarlos mal no se distinguía de elegir otra
    #: cosa. El id lo valida esta puerta contra lo que el motor publica, nunca una lista escrita a mano.
    forma_lista: str | None = Field(default=None, min_length=1, max_length=40)
    estilo: str | None = Field(default=None, min_length=1, max_length=40)
    # --- `completar` ---
    plan: dict[str, Any] | None = None
    armados: list[ArmadoPropuesto] | None = Field(default=None, max_length=MAX_ESTRUCTURAS)
    #: Lo que la foto leyó del patrón de cada elemento de la referencia (ADR-0028 §7), con el que la receta
    #: elige el patrón del motor en vez de contar colores (ADR-0039). Mismo modelo y mismo tope que
    #: ``pistas_patron`` de la resolución: una pista por elemento, y Python la aplica a cada estructura que
    #: lo materializa. Sin pistas, la receta es la de siempre.
    pistas: list[PistaPatron] = Field(default_factory=list, max_length=16)
    #: Lo que la foto leyó del remate de cada columna (ADR-0039), por elemento de la referencia. Que una
    #: columna no esté en esta lista es «no se ve su punta» y deja el remate del motor; estar con
    #: ``tipo: "ninguno"`` es «su punta no lleva nada».
    remates: list[RematePistaFoto] = Field(default_factory=list, max_length=16)
    #: Hacia dónde se va cada pieza y cuánto (ADR-0039). Una pieza recta no viaja: el motor ya arranca recto.
    inclinaciones: list[InclinacionPistaFoto] = Field(default_factory=list, max_length=16)
    #: Cómo se curva la línea de cada guirnalda (ADR-0032, decisión 28). Sin esto todas salen planas.
    curvas: list[CurvaPistaFoto] = Field(default_factory=list, max_length=16)
    #: De qué tamaños es cada pieza. No se llama ``tamanos`` porque ese nombre ya es el de los pesos por
    #: diámetro con los que se arma una guirnalda a mano.
    tamanos_leidos: list[TamanosPistaFoto] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def exigir_lo_de_cada_accion(self) -> "ArmadoEstructuraRequest":
        if self.accion == "catalogo" and self.tipo is None:
            raise ValueError("catalogo necesita tipo")
        if self.accion == "armar":
            if self.pieza is None:
                raise ValueError("armar necesita pieza")
            # Una guirnalda orgánica no tiene patrón: lo que la define es su paleta, con el acabado y el papel
            # de cada color. El arco y la columna sí, y sin él no hay nada que armar.
            if self.pieza.tipo == "guirnalda":
                if self.paleta is None:
                    raise ValueError("armar una guirnalda necesita paleta")
            elif self.patron is None or self.materiales is None:
                raise ValueError("armar un arco o una columna necesita patron y materiales")
        if self.accion == "completar" and self.plan is None:
            raise ValueError("completar necesita plan")
        if self.materiales is not None and any(
            indice < 0 or indice > MAX_INDICE_MATERIAL for indice in self.materiales
        ):
            raise ValueError("un indice de material no cabe en el contrato")
        return self


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(maximo, max(minimo, valor))


def _numero(valor: object) -> float | None:
    """Un número finito, o nada. Un booleano no es un número (``True`` no es un ancho)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if valor == valor and valor not in (float("inf"), float("-inf")) else None


# ---------------------------------------------------------------------------
# El catálogo: lo que el modelo puede usar
# ---------------------------------------------------------------------------


def catalogo_de(tipo: str) -> dict[str, Any]:
    """``opciones_admitidas()`` del tipo que se pregunte, tal cual sale del motor."""
    if tipo == "arco":
        return dict(opciones_arco())
    if tipo == "semiarco":
        # Un medio arco no tiene patrones que ofrecer: su catálogo es el del motor orgánico, que ya publica
        # las tres formas listas de medio arco (``medio-*``, con ``forma.corte`` menor que 1) entre las once
        # del diseñador, con sus cifras, para que la interfaz no repita ninguna.
        return dict(opciones_arco_organico())
    if tipo == "columna":
        return dict(opciones_columna())
    return dict(opciones_guirnalda())


# ---------------------------------------------------------------------------
# Los mandos del patrón: lo que el modelo pide, acotado por el motor
# ---------------------------------------------------------------------------


def _controles_arco(patron: str) -> dict[str, tuple[float, float, float]]:
    return {
        cast(str, c["clave"]): (
            float(cast(float, c["min"])),
            float(cast(float, c["max"])),
            float(cast(float, c["def_"])),
        )
        for c in PATRONES_ARCO[patron].controles
    }


def _controles_columna(patron: str) -> dict[str, tuple[float, float, float]]:
    return {
        c.clave: (float(c.minimo), float(c.maximo), float(c.defecto))
        for c in PATRONES_COLUMNA[patron].controles
    }


def _opciones_del_patron(
    controles: Mapping[str, tuple[float, float, float]],
    pedidas: Mapping[str, float] | None,
    avisos: list[str],
) -> dict[str, float]:
    """Los mandos del patrón: el valor por defecto del motor, y el pedido cuando cabe en su rango.

    Un valor fuera de rango se **acota** (es lo que hace el diseñador al mover el control a su tope) y un
    mando que ese patrón no usa se deja fuera: el aviso lo dice, para que el modelo no crea que se aplicó.
    """
    salida = {clave: defecto for clave, (_, _, defecto) in controles.items()}
    for clave, valor in (pedidas or {}).items():
        rango = controles.get(clave)
        if rango is None:
            avisos.append(f"El patron no usa el mando «{clave}»; se ignoro.")
            continue
        minimo, maximo, _ = rango
        acotado = _acotar(float(valor), minimo, maximo)
        if acotado != float(valor):
            avisos.append(
                f"«{clave}» se acoto a {acotado:g} (su rango es {minimo:g} a {maximo:g})."
            )
        salida[clave] = acotado
    return salida


# ---------------------------------------------------------------------------
# Armar un arco
# ---------------------------------------------------------------------------


def _geometria_arco(
    pieza: PiezaArmado, pedida: GeometriaPedida | None, patron: str, colores: int, avisos: list[str]
) -> dict[str, Any]:
    """La geometría del arco: la del motor, con las medidas de la pieza y lo que el modelo ajuste encima."""
    base = config_inicial_arco()
    inicial = dict(base["geometria"])
    ancho = (pedida.ancho_m if pedida else None) or pieza.ancho_m or float(inicial["anchoM"])
    alto = (pedida.alto_m if pedida else None) or pieza.alto_m or float(inicial["altoM"])
    acotado_ancho = _acotar(ancho, ARCO_ANCHO_MIN, ARCO_ANCHO_MAX)
    acotado_alto = _acotar(alto, ARCO_ALTO_MIN, ARCO_ALTO_MAX)
    if acotado_ancho != ancho:
        avisos.append(
            f"El ancho se acoto a {acotado_ancho:g} m (el motor arma de {ARCO_ANCHO_MIN:g} a {ARCO_ANCHO_MAX:g} m)."
        )
    if acotado_alto != alto:
        avisos.append(
            f"El alto se acoto a {acotado_alto:g} m (el motor arma de {ARCO_ALTO_MIN:g} a {ARCO_ALTO_MAX:g} m)."
        )
    # Los globos a lo ancho los decide el motor por patrón (el arcoíris quiere uno por banda de color); el
    # modelo puede subirlos o bajarlos, y el saneado de la puerta recorta lo que no cabe en la banda.
    # `globos_ancho_por_defecto` solo mira cuántos colores tiene el patrón, así que basta con una lista de ese
    # largo: los tonos no deciden geometría.
    cfg = dict(base)
    cfg["colores"] = {**base["colores"], patron: ["#ffffff"] * max(1, colores)}
    por_defecto = globos_ancho_por_defecto(patron, cast(Any, cfg))
    forma = (pedida.forma if pedida else None) or inicial["forma"]
    if pieza.densidad in ("sencilla", "lujosa"):
        cfg["patron"] = patron
        cfg["geometria"] = {
            **inicial,
            "forma": forma,
            "anchoM": acotado_ancho,
            "altoM": acotado_alto,
            "globosAncho": por_defecto,
        }
        if pedida is not None and pedida.tamano_globo is not None:
            cfg["globo"] = {**base["globo"], "nominal": pedida.tamano_globo}
        por_defecto = _globos_ancho_por_densidad(cast(Any, cfg), por_defecto, pieza.densidad)
    globos_ancho = (pedida.globos_ancho if pedida else None) or por_defecto
    return {
        "forma": forma,
        "anchoM": acotado_ancho,
        "altoM": acotado_alto,
        "globosAncho": int(_acotar(globos_ancho, 2, 16)),
        "suelo": inicial["suelo"] if pedida is None or pedida.suelo is None else pedida.suelo,
    }


def _globos_ancho_por_densidad(cfg: Any, por_defecto: int, densidad: str) -> int:
    """Los globos a lo ancho de la banda para la densidad del plan: una capa menos (sencilla) o una más (lujosa).

    **De dónde sale.** El diseñador del arco de patrones no tiene un mando «densidad» ni presets por densidad.
    Su investigación (``clasificador-decoraciones/docs/investigacion-arcos.md``) nombra el mando que la decide
    en un arco clásico: «Cuartetos de 4 o 5 globos por capa (globos por capa / "qué tan empacado")» (§b,
    control 3) y «Globos por capa: 2, 3, 4 (por defecto), 5. Varía el grosor y la densidad» (§e, control 5),
    con la fórmula de cuartetos ``N = 4,8·L/d`` frente a ``6,3·L/d`` con cinco (§c, 2.1). En el motor ese mando
    es ``geometria.globosAncho``. ``media`` es el arco de siempre (sin tocar: los vectores no cambian); las
    otras dos mueven **un paso** del control (``nPaso``: una capa, o una banda entera en el arcoíris), dentro de
    los límites del propio motor (``limites``): una banda que taparía la abertura no se pide, así que un arco
    angosto puede no tener sitio para la capa de más y ``lujosa`` queda igual que ``media``.

    La correspondencia sencilla → −1 capa y lujosa → +1 capa es de este repo y no un criterio publicado del
    diseñador; cuando el clasificador lo fije, se cambia allá primero.
    """
    rango = limites_arco(cfg)
    paso = int(rango["nPaso"])
    minimo, maximo = int(rango["nMin"]), int(rango["nMax"])
    # El punto de partida es la banda que el motor de verdad arma con ``media``: si el defecto no cabe, el
    # motor la recorta a ``maximo`` y la capa de menos se cuenta desde ahí, no desde una banda que no existe.
    efectivo = min(por_defecto, maximo)
    if densidad == "sencilla":
        return max(minimo, efectivo - paso)
    return min(maximo, efectivo + paso)


def _armado_arco(
    pieza: PiezaArmado,
    patron: str,
    materiales: Sequence[int],
    opciones: Mapping[str, float] | None,
    geometria: GeometriaPedida | None,
    avisos: list[str],
) -> dict[str, Any]:
    """Un ``armado-arco.v1`` con la receta del motor debajo y lo que el modelo pidió encima."""
    if patron not in PATRON_IDS_ARCO:
        raise ArmadoArcoInvalido(
            "patron_desconocido",
            f"«{patron}» no es un patron de arco. Los que hay: {', '.join(PATRON_IDS_ARCO)}.",
        )
    base = config_inicial_arco()
    globo = dict(base["globo"])
    if geometria is not None and geometria.tamano_globo is not None:
        globo["nominal"] = geometria.tamano_globo
    return {
        "version": VERSION_ARMADO_ARCO,
        "origen": "sugerido",
        "patron": patron,
        "opciones": _opciones_del_patron(_controles_arco(patron), opciones, avisos),
        "geometria": _geometria_arco(pieza, geometria, patron, len(materiales), avisos),
        "globo": globo,
        "capas": [],
        "secciones": [],
        "materiales": list(materiales),
    }


# ---------------------------------------------------------------------------
# Armar una columna
# ---------------------------------------------------------------------------


def _armado_columna(
    pieza: PiezaArmado,
    patron: str,
    materiales: Sequence[int],
    opciones: Mapping[str, float] | None,
    geometria: GeometriaPedida | None,
    remate: RematePedido | None,
    avisos: list[str],
) -> dict[str, Any]:
    """Un ``armado-columna.v1`` con la receta del motor debajo y lo que el modelo pidió encima."""
    if patron not in PATRON_IDS_COLUMNA:
        raise ArmadoColumnaInvalido(
            "patron_desconocido",
            f"«{patron}» no es un patron de columna. Los que hay: {', '.join(PATRON_IDS_COLUMNA)}.",
        )
    base = config_inicial_columna()
    cuerpo_motor = base.columna
    inflado_motor = base.globo
    remate_motor = base.remate
    alto = (geometria.alto_m if geometria else None) or pieza.alto_m or float(cuerpo_motor.alto_m)
    acotado = _acotar(alto, COLUMNA_ALTO_MIN, COLUMNA_ALTO_MAX)
    if acotado != alto:
        avisos.append(
            f"El alto se acoto a {acotado:g} m (el motor arma de {COLUMNA_ALTO_MIN:g} a {COLUMNA_ALTO_MAX:g} m)."
        )
    return {
        "version": VERSION_ARMADO_COLUMNA,
        "origen": "sugerido",
        # Por altura: se pide un alto y el patrón decide el tamaño y el color de cada capa. Dictar las capas
        # una por una es trabajo del editor, no de una frase del cliente.
        "modo": "altura",
        "patron": patron,
        "opciones": _opciones_del_patron(_controles_columna(patron), opciones, avisos),
        "cuerpo": {
            "alto_m": acotado,
            # Lo que se pidió (o la foto leyó) manda; si no, la densidad del plan decide la capa
            # (``_GLOBOS_CAPA_POR_DENSIDAD``), y sin densidad o con ``media``, la del motor.
            "globos_capa": int(
                _acotar(
                    (geometria.globos_capa if geometria else None)
                    or _GLOBOS_CAPA_POR_DENSIDAD.get(pieza.densidad or "")
                    or cuerpo_motor.globos_capa,
                    3,
                    6,
                )
            ),
            "abajo": (geometria.abajo if geometria else None) or cuerpo_motor.abajo,
            "arriba": (geometria.arriba if geometria else None) or cuerpo_motor.arriba,
            "escalonado": cuerpo_motor.escalonado,
            "base": cuerpo_motor.base,
        },
        "inflado": {
            "inflado": inflado_motor.inflado,
            "tamano": inflado_motor.tamano,
            "compresion": inflado_motor.compresion,
            "variacion_tam": inflado_motor.variacion_tam,
            "variacion_tono": inflado_motor.variacion_tono,
            "desorden": inflado_motor.desorden,
            "semilla": inflado_motor.semilla,
        },
        "remate": {
            "tipo": remate.tipo if remate else remate_motor.tipo,
            "tamano": (remate.tamano if remate else None) or remate_motor.tamano,
            "cantidad": (remate.cantidad if remate else None) or remate_motor.cantidad,
            "foil_m": (remate.foil_m if remate else None) or remate_motor.foil_m,
            # El remate apunta a un material de la pieza; sin indicación, al principal.
            "material": (
                remate.material if remate and remate.material is not None else materiales[0]
            ),
        },
        "capas": [],
        "materiales": list(materiales),
    }


# ---------------------------------------------------------------------------
# Armar una guirnalda orgánica
# ---------------------------------------------------------------------------


#: El color del catálogo que **es** un acabado del motor. Un globo cristal no es un globo de un color que
#: además es transparente: su transparencia es lo único que lo describe, y el motor la expresa como acabado
#: (``app/organico/tipos.py``). Sin esto el cristal llegaba con su acabado comercial —`fashion`, `cristal`—,
#: que el motor no conoce, y se pintaba mate: los globos burbuja de la foto salían opacos (2026-10-03).
#: No es una tabla de equivalencias de vocabulario comercial, que es lo que `_acabado_de` se niega a tener:
#: es el mismo concepto con el mismo nombre en los dos lados.
COLOR_TRANSPARENTE = "transparente"


def _acabado_del_material(
    pieza: PiezaArmado, indice: int, pedido: str | None, avisos: list[str]
) -> str:
    """El acabado con el que el motor pinta este material de la pieza.

    Manda el color cuando el color **es** la transparencia; si no, lo de siempre: lo que pida el modelo, lo
    que declare el plan, o mate.
    """
    tonos = pieza.tonos or []
    tono = tonos[indice] if 0 <= indice < len(tonos) else None
    if pedido is None and isinstance(tono, str) and tono.strip().lower() == COLOR_TRANSPARENTE:
        return COLOR_TRANSPARENTE
    acabados = pieza.acabados or []
    declarado = acabados[indice] if 0 <= indice < len(acabados) else None
    return _acabado_de(declarado, pedido, avisos, tono if isinstance(tono, str) else None)


def _acabado_de(
    declarado: str | None, pedido: str | None, avisos: list[str], color: str | None = None
) -> str:
    """El acabado de un color: el que pide el modelo, el que declara el plan, o mate.

    Lo que el plan escribe de un material es la palabra del catálogo, y el motor solo conoce cuatro acabados.
    La equivalencia **no** se escribe aquí: es la del repo dueño (``acabado_del_motor`` de
    ``color_catalogo.py``, por la familia Sempertex de la referencia que se compra), así que un «reflex» se
    pinta cromado. Antes caía a mate con un aviso y un dorado cromado se dibujaba mate (auditoría
    2026-10-04, M3). Lo que pida el modelo se sigue validando contra los acabados del motor.
    """
    if pedido is not None:
        limpio = pedido.strip().lower()
        if limpio not in VALORES_ACABADO:
            raise ArmadoGuirnaldaInvalido(
                "acabado_desconocido",
                f"«{pedido}» no es un acabado. Los que hay: {', '.join(VALORES_ACABADO)}.",
            )
        return limpio
    if declarado is not None:
        limpio = declarado.strip().lower()
        if limpio in VALORES_ACABADO:
            return limpio
        if es_aproximacion_del_motor(color, declarado):
            avisos.append(f"El acabado «{declarado}» no es uno del motor; ese color va mate.")
        return str(acabado_del_motor(color, declarado))
    return "mate"


def _rol_del_material(indice: int, leido: RepartoLeido | None, pedido: str | None) -> str:
    """El papel de un color en la paleta del motor: el que pida el modelo, o el que la foto haya leído.

    Un material que la foto vio como **mota** se arma como ``acento``: globos sueltos salpicados sobre las
    secciones, que es lo que el motor hace con ese papel.
    """
    if pedido is None and leido is not None and indice in leido.acentos:
        return "acento"
    return _rol_de(pedido)


def _rol_de(pedido: str | None) -> str:
    """El papel de un color: normal, o un acento repartido suelto entre los demás."""
    if pedido is None:
        return "normal"
    limpio = pedido.strip().lower()
    if limpio not in ROLES_GUIRNALDA:
        raise ArmadoGuirnaldaInvalido(
            "rol_desconocido",
            f"«{pedido}» no es un papel. Los que hay: {', '.join(ROLES_GUIRNALDA)}.",
        )
    return limpio


def _peso_de(pieza: PiezaArmado, indice: int, pedido: float | None) -> float:
    """El peso de un color: el que pide el modelo o el que sale de la participación del material en la pieza.

    La participación va de 0 a 1 y el peso del motor de 1 a 100, así que se escala; un material sin
    participación conocida pesa lo mismo que los demás, que es el reparto neutro.
    """
    if pedido is not None:
        return pedido
    pesos = pieza.pesos or []
    participacion = pesos[indice] if 0 <= indice < len(pesos) else None
    if participacion is None or participacion <= 0:
        return max(1.0, round(100 / max(1, pieza.colores), 2))
    return _acotar(round(participacion * 100, 2), 1, 100)


def _mezcla_tamanos(
    pedidos: Sequence[PesoTamano] | None,
    pieza: PiezaArmado | None = None,
    base: Mapping[str, Any] | None = None,
    del_preset: bool = False,
) -> dict[str, float]:
    """La mezcla de tamaños con las claves del contrato (la pulgada como texto), solo los que se usan.

    Tres dueños, en este orden: lo que el modelo pide tamaño a tamaño; la forma lista o el estilo que se
    aplicó, que traen el suyo; y, si no hay ninguna de las dos, la mezcla que el plan declara para la pieza
    (`organica_fina`, `solo_grandes`, …), que es la misma con la que se cuenta y se compra.

    Las dos últimas faltaban. La guirnalda se armaba siempre con la mezcla del diseño de partida del motor:
    elegir «la de festones» no traía sus tamaños, y una guirnalda `solo_grandes` salía de globos chicos
    (2026-10-03). Es la misma rotura que tenían la columna y el arco orgánicos.
    """
    if pedidos:
        return {str(peso.tamano): float(peso.peso) for peso in pedidos if peso.peso > 0}
    inicial = cast(
        Mapping[Any, Any],
        base
        if base is not None
        else cast(Mapping[str, Any], config_inicial_guirnalda()["tamanos"])["mezcla"],
    )
    if not del_preset and pieza is not None:
        puesta = _mezcla_de_tamanos(pieza, {"mezcla": inicial})
        return {t: p for t, p in puesta.items() if p > 0}
    return {str(t): float(p) for t, p in inicial.items() if float(p) > 0}


class FormaListaDesconocida(ValueError):
    """Un id de forma lista o de estilo que el motor no publica."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.motivo = motivo
        self.mensaje = mensaje


def _base_guirnalda(forma_lista: str | None, estilo: str | None) -> dict[str, Any]:
    """La config de la que parte la guirnalda: la del motor, con la forma lista y el estilo puestos.

    Es **una capa, no una decisión**: las cifras son las del diseñador (``FORMAS_GUIRNALDA``, ``ESTILOS_GUIR``)
    y lo que el modelo mande campo a campo sigue mandando encima. El orden importa y es el del editor: primero
    la forma (qué tipo de guirnalda es) y después el estilo (cuánto se llena), porque el estilo se calcula
    sobre el grosor que dejó la forma.

    Un id que el motor no publica **no se ignora**: levanta ``FormaListaDesconocida`` con la lista de los que
    hay. Ignorarlo armaría una guirnalda distinta de la que se pidió y nadie lo sabría.
    """
    config: Any = config_inicial_guirnalda()
    if forma_lista is not None:
        clave = forma_lista.strip().lower()
        elegida = next((f for f in FORMAS_GUIRNALDA if f.id == clave), None)
        if elegida is None:
            raise FormaListaDesconocida(
                "forma_lista_desconocida",
                f"«{forma_lista}» no es una forma de guirnalda. Las que hay: "
                f"{', '.join(f.id for f in FORMAS_GUIRNALDA)}.",
            )
        config = aplicar_forma_guir(config, elegida)
    if estilo is not None:
        clave = estilo.strip().lower()
        elegido = next((e for e in ESTILOS_GUIR if e.id == clave), None)
        if elegido is None:
            raise FormaListaDesconocida(
                "estilo_desconocido",
                f"«{estilo}» no es un estilo de guirnalda. Los que hay: "
                f"{', '.join(e.id for e in ESTILOS_GUIR)}.",
            )
        config = elegido.aplicar(config)
    return dict(config)


def _largo_guirnalda(pieza: PiezaArmado) -> float:
    """El largo con el que el motor arma la guirnalda de la receta: el del plan, dentro del rango del motor.

    Es el mismo que ``_forma_guirnalda`` pone en ``largoM`` cuando el modelo no pide otro, y es sobre el que se
    pasan a metros las medidas relativas de la foto (la flecha, el desnivel).
    """
    inicial = cast(Mapping[str, Any], config_inicial_guirnalda()["forma"])
    return _acotar(
        pieza.largo_m or float(inicial["largoM"]), GUIRNALDA_LARGO_MIN, GUIRNALDA_LARGO_MAX
    )


def _forma_guirnalda(
    pieza: PiezaArmado,
    pedida: FormaPedida | None,
    avisos: list[str],
    inclinacion: float | None = None,
    linea_leida: Mapping[str, float] | None = None,
    base: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """La línea de la guirnalda: la del motor, con el largo de la pieza y lo que el modelo ajuste encima.

    ``inclinacion`` es lo que la foto vio: hacia dónde se va la pieza, en fracción de su alto y con signo. En
    una guirnalda eso son **dos** cosas del contrato y no cabe en un solo mando: ``pendienteM`` es cuánto baja
    un extremo respecto al otro (la caída) y ``carga`` es qué lado pesa más y lleva los globos más grandes. Lo
    que pida el modelo manda sobre las dos.

    ``linea_leida`` es la línea que la foto midió de esta guirnalda, ya en los campos del motor y en el contrato
    (``armado_guirnalda.linea_de_lectura`` y ``_linea_en_contrato``): la curva, los festones, la onda y el
    desnivel de los extremos. Va por debajo de lo que pida el modelo y por encima de la inclinación: el
    desnivel medido entre los dos extremos dice la caída mejor que hacia dónde se inclina la pieza.
    """
    # ``base`` es la config con la forma lista y el estilo ya puestos (``_base_guirnalda``); sin ella, la del
    # motor, que es lo que pasaba antes de que hubiera formas listas.
    inicial = cast(
        Mapping[str, Any],
        (base or config_inicial_guirnalda())["forma"],
    )
    largo = (pedida.largo_m if pedida else None) or pieza.largo_m or float(inicial["largoM"])
    acotado = _acotar(largo, GUIRNALDA_LARGO_MIN, GUIRNALDA_LARGO_MAX)
    if acotado != largo:
        avisos.append(
            f"El largo se acoto a {acotado:g} m "
            f"(el motor arma de {GUIRNALDA_LARGO_MIN:g} a {GUIRNALDA_LARGO_MAX:g} m)."
        )
    leida = linea_leida or {}

    def elegir(clave: str, valor: object) -> Any:
        """El valor del motor cuando el modelo no dice nada."""
        return inicial[clave] if valor is None else valor

    def de_la_foto(clave: str, pedido: object) -> Any:
        """Lo que pida el modelo; si no, lo que midió la foto; si no, el valor del motor."""
        return elegir(clave, leida.get(clave) if pedido is None else pedido)

    pendiente_pedida = pedida.pendiente_m if pedida else None
    # Solo las claves del contrato: `config_inicial` trae además `espejo`, que
    # `armado-guirnalda-organica.v1` no publica y la puerta rellena desde el motor.
    return {
        "largoM": acotado,
        "alturaM": elegir("alturaM", pedida.altura_m if pedida else None),
        # La caída: el extremo hacia el que se va la pieza queda más bajo. La altura de la línea da la
        # escala y el contrato lo acota a ±2 m. El desnivel que la foto midió manda sobre la inclinación.
        "pendienteM": elegir(
            "pendienteM",
            pendiente_pedida
            if pendiente_pedida is not None
            else leida["pendienteM"]
            if "pendienteM" in leida
            else None
            if inclinacion is None
            else _acotar(
                -abs(float(elegir("alturaM", pedida.altura_m if pedida else None))) * inclinacion,
                -2.0,
                2.0,
            ),
        ),
        "ondaM": de_la_foto("ondaM", pedida.onda_m if pedida else None),
        "ondas": de_la_foto("ondas", pedida.ondas if pedida else None),
        # La curva que vio la foto, ya en metros: negativo arquea hacia arriba —la guirnalda tendida sobre un
        # fondo que cae por los dos lados— y positivo cuelga en U. El saneado del motor lo acota a su tope, que
        # vale en los dos sentidos.
        "colgadoM": de_la_foto("colgadoM", pedida.colgado_m if pedida else None),
        "festones": de_la_foto("festones", pedida.festones if pedida else None),
        # El lado cargado es aquel hacia el que se va la pieza: ahí es más gruesa y lleva los globos
        # grandes. La lectura ya viene en −1..1, así que entra tal cual.
        "carga": elegir(
            "carga",
            (pedida.carga if pedida else None)
            if (pedida and pedida.carga is not None) or inclinacion is None
            else _acotar(inclinacion, -1.0, 1.0),
        ),
        "suelo": elegir("suelo", pedida.suelo if pedida else None),
        "persona": inicial["persona"],
    }


def _linea_en_contrato(linea: Mapping[str, float]) -> dict[str, Any]:
    """La línea del motor dentro de los rangos de ``armado-guirnalda-organica.v1`` (``festones`` entero).

    El motor la vuelve a acotar al armarla (``guirnalda.limites.sanear``: el colgado hasta 0,3 × largo /
    festones, cada festón de al menos 0,9 m) y lo dice en sus avisos; aquí solo se evita escribir en el plan un
    número que el contrato rechace.
    """
    rangos = {
        "pendienteM": (-2.0, 2.0),
        "ondaM": (0.0, 0.8),
        "ondas": (0.0, 6.0),
        "colgadoM": (-1.5, 1.5),
    }
    salida: dict[str, Any] = {
        clave: _acotar(float(valor), *rangos[clave])
        for clave, valor in linea.items()
        if clave in rangos
    }
    if "festones" in linea:
        salida["festones"] = int(_acotar(round(float(linea["festones"])), 1, 6))
    return salida


#: Los mandos de la línea que el motor acota con el largo y los festones de cada guirnalda
#: (``guirnalda.limites.limites``), con el límite que publica para cada uno: ``(mínimo, máximo)``.
_LIMITES_DE_LA_LINEA: Mapping[str, tuple[str | None, str]] = {
    "pendienteM": ("pendienteMax", "pendienteMax"),
    "colgadoM": ("colgadoMax", "colgadoMax"),
    "ondaM": (None, "ondaMax"),
    "festones": (None, "festonesMax"),
}


def _acotar_linea_leida(
    armado: dict[str, Any],
    pieza: PiezaArmado,
    leida: Mapping[str, float],
    avisos: list[str],
) -> None:
    """La línea que midió la foto, recortada a lo que el motor arma con esta guirnalda, y dicho.

    El contrato admite ±2 m de desnivel, pero el motor no arma una pendiente de más del 25 % del largo —«o deja
    de ser una guirnalda y es una caída»— ni un colgado de más del 30 % del largo por festón, y lo recorta al
    armar. Sin esto el plan guardaba una línea que no se arma y la frase de la imagen la contaba: la foto del
    2026-09-28 mide 1,01 m de desnivel en 3 m y el motor arma 0,75 m. Se acota con los límites vivos del propio
    motor (``armado_guirnalda_organica.limites_de``), y solo lo que vino de la foto: ``leida`` es la línea en
    metros, antes de acotar nada, con la que se compara para decir cuánto se recortó.
    """
    limites = limites_guirnalda(armado, _estructura_guirnalda(pieza.colores))
    forma = cast(dict[str, Any], armado["forma"])
    for clave, (desde, hasta) in _LIMITES_DE_LA_LINEA.items():
        if clave not in leida:
            continue
        minimo = -limites[desde] if desde is not None else (1.0 if clave == "festones" else 0.0)
        maximo = limites[hasta]
        acotado = _acotar(float(forma[clave]), minimo, maximo)
        if clave == "festones":
            acotado = float(int(acotado))
        if abs(acotado - float(leida[clave])) > 1e-6:
            avisos.append(
                f"La foto midio «{clave}» {float(leida[clave]):g}; con {forma['largoM']:g} m de largo el "
                f"motor arma de {minimo:g} a {maximo:g}, asi que va {acotado:g}."
            )
        forma[clave] = int(acotado) if clave == "festones" else acotado


def _acabados_de(
    pieza: PiezaArmado, entradas: Sequence[tuple[int, str | None]], avisos: list[str]
) -> dict[tuple[int, str | None], str]:
    """El acabado de cada material de la paleta (con el acabado pedido, si lo hay), una sola vez por material.

    Una paleta puede nombrar el mismo material en varias entradas —los tramos blanco | dorado | blanco que leyó
    la foto—, y el aviso de un acabado que el motor no tiene se decía una vez por entrada. En el orden de la
    paleta, así que una paleta sin repetidos avisa igual que siempre.
    """
    acabados: dict[tuple[int, str | None], str] = {}
    for material, pedido in entradas:
        if (material, pedido) not in acabados:
            acabados[(material, pedido)] = _acabado_del_material(pieza, material, pedido, avisos)
    return acabados


def _armado_guirnalda(
    pieza: PiezaArmado,
    paleta: Sequence[ColorPedido],
    request: ArmadoEstructuraRequest,
    avisos: list[str],
    leido_reparto: RepartoLeido | None = None,
    inclinacion: float | None = None,
    linea_leida: Mapping[str, float] | None = None,
    linea: Mapping[str, float] | None = None,
    densidad: str | None = None,
    linea_soporte: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Un ``armado-guirnalda-organica.v1`` con la receta del motor debajo y lo que el modelo pidió encima.

    **No hay patrón.** Lo que define una guirnalda es su línea, su volumen, su mezcla de tamaños y su paleta
    —con el acabado y el papel de cada color—, así que cada bloque se compone igual que los mandos de un
    patrón de arco: el valor del motor, y el pedido cuando viene.

    ``linea``, ``densidad`` y ``linea_soporte`` son de la receta (``_receta``), no del modelo: la línea que la
    pieza ya declara por su armado por partes (``PiezaArmado.linea``), el estilo del motor para la densidad del
    plan (``_ESTILO_GUIR_POR_DENSIDAD``) y la altura de la línea según dónde se apoya la guirnalda
    (``_linea_del_soporte``). Se ponen **debajo** de lo pedido, como una forma lista, pero sin cambiar de dónde
    sale la mezcla de tamaños: la del plan, que es la que se cobra. ``linea_leida`` es la línea que midió la
    foto (``_forma_guirnalda``).
    """
    inicial = _base_guirnalda(request.forma_lista, request.estilo)
    estilo = _ESTILO_GUIR_POR_DENSIDAD.get(densidad or "")
    if estilo is not None:
        # Solo el volumen: el estilo del diseñador no toca la línea ni, en ligero y lleno, los tamaños.
        inicial["volumen"] = dict(estilo.aplicar(cast(Any, inicial))["volumen"])
    if linea_soporte or linea:
        # Primero el soporte (a qué altura corre la línea) y encima la forma que la pieza declara, que es más
        # concreta: una ondulada en el piso ondula como dice su forma, no como la forma lista del piso.
        inicial["forma"] = {
            **cast(Mapping[str, Any], inicial["forma"]),
            **(linea_soporte or {}),
            **_linea_en_contrato(linea or {}),
        }
    volumen_motor = cast(Mapping[str, Any], inicial["volumen"])
    tamanos_motor = cast(Mapping[str, Any], inicial["tamanos"])
    colores_motor = cast(Mapping[str, Any], inicial["colores"])
    adornos_motor = cast(Mapping[str, Any], inicial["adornos"])
    pedido_volumen = request.volumen
    pedido_adornos = request.adornos
    reparto = (
        colores_motor["reparto"] if request.reparto is None else request.reparto.strip().lower()
    )
    if reparto not in VALORES_REPARTO:
        raise ArmadoGuirnaldaInvalido(
            "reparto_desconocido",
            f"«{request.reparto}» no es un reparto. Los que hay: {', '.join(VALORES_REPARTO)}.",
        )

    def de_volumen(clave: str, valor: object) -> Any:
        return volumen_motor[clave] if valor is None else valor

    forma = _forma_guirnalda(pieza, request.forma, avisos, inclinacion, linea_leida, base=inicial)
    acabados = _acabados_de(pieza, [(color.material, color.acabado) for color in paleta], avisos)
    return {
        "version": VERSION_ARMADO_GUIRNALDA_ORGANICA,
        "origen": "sugerido",
        "forma": forma,
        "volumen": {
            "grosorPatasM": de_volumen(
                "grosorPatasM", pedido_volumen.grosor_extremos_m if pedido_volumen else None
            ),
            "grosorCimaM": de_volumen(
                "grosorCimaM", pedido_volumen.grosor_centro_m if pedido_volumen else None
            ),
            "irregularidad": de_volumen(
                "irregularidad", pedido_volumen.irregularidad if pedido_volumen else None
            ),
            "relleno": de_volumen("relleno", pedido_volumen.relleno if pedido_volumen else None),
            "racimo": de_volumen("racimo", pedido_volumen.racimo if pedido_volumen else None),
            "salientes": de_volumen(
                "salientes", pedido_volumen.salientes if pedido_volumen else None
            ),
        },
        "tamanos": {
            "mezcla": _mezcla_tamanos(
                request.tamanos,
                pieza,
                cast(Mapping[str, Any], tamanos_motor["mezcla"]),
                del_preset=request.forma_lista is not None or request.estilo is not None,
            ),
            "grandesAbajo": tamanos_motor["grandesAbajo"],
            "inflado": tamanos_motor["inflado"],
            "variacion": tamanos_motor["variacion"],
        },
        "colores": {
            "paleta": [
                {
                    "material": color.material,
                    "peso": _peso_de(pieza, color.material, color.peso),
                    "acabado": acabados[(color.material, color.acabado)],
                    "rol": _rol_del_material(color.material, leido_reparto, color.rol),
                }
                for color in paleta
            ],
            "reparto": reparto,
            "mezcla": colores_motor["mezcla"]
            if request.mezcla_colores is None
            else request.mezcla_colores,
        },
        "adornos": {
            "follaje": adornos_motor["follaje"]
            if pedido_adornos is None or pedido_adornos.follaje is None
            else pedido_adornos.follaje,
            "flores": adornos_motor["flores"]
            if pedido_adornos is None or pedido_adornos.flores is None
            else pedido_adornos.flores,
        },
        # El aspecto es pantalla (brillo, sombra, contorno, profundidad) y la semilla hace al motor
        # determinista: ninguno de los dos es una decisión del modelo, van tal cual los trae el motor.
        "aspecto": dict(cast(Mapping[str, Any], inicial["aspecto"])),
    }


# ---------------------------------------------------------------------------
# La receta: el patrón que mejor encaja con lo que la pieza ya dice
# ---------------------------------------------------------------------------


def _patron_arco_para(colores: int) -> str:
    """El patrón del arco que encaja con esos colores, con el del diseñador como preferido.

    Un color solo se puede pintar sólido. Con dos a cuatro va el patrón con el que arranca el diseñador (la
    espiral, que es la técnica más usada en un arco). Con cinco o más, el único que reparte tantas bandas es
    el arcoíris; cualquier otro dejaría colores de la pieza sin usar.
    """
    if colores <= 1:
        return "solido"
    maximo_espiral = PATRONES_ARCO["espiral"].lista["max"]
    inicial = cast(str, config_inicial_arco()["patron"])
    if colores <= int(cast(int, maximo_espiral)):
        return inicial
    return "arcoiris"


def _patron_columna_para(colores: int) -> str:
    """Lo mismo en la columna: sólido con un color, el del diseñador con dos, y el ombré de tres en adelante.

    El ombré es el único de los nueve que pide tres colores, así que es el que no deja ninguno fuera.
    """
    if colores <= 1:
        return "solido"
    if colores >= PATRONES_COLUMNA["ombre"].min_colores:
        return "ombre"
    return str(config_inicial_columna().patron)


#: Una petición vacía con la que la receta compone la guirnalda: sin nada pedido, cada bloque sale del motor.
#: Se construye una vez porque es inmutable y no lleva contexto operativo que mirar.
_PETICION_RECETA = ArmadoEstructuraRequest.model_construct(
    accion="armar", schema_version=OMOIKANE_ARMADO_SCHEMA_VERSION
)


def _peticion_con_reparto(
    leido: RepartoLeido | None, racimo: int | None = None
) -> ArmadoEstructuraRequest:
    """La petición con la que la receta compone la guirnalda, con lo que la foto leyó si lo hay.

    El reparto, el difuminado que dice el modo leído (``RepartoLeido.mezcla``) y los globos por racimo ya
    acotados (``_racimo_leido``) entran como si los hubiera pedido el modelo: por encima de la densidad y del
    motor, que es donde manda lo que se vio en la foto.

    La conversión explícita es por ``follow_imports = "skip"``: lo que devuelve ``model_construct`` llega
    como ``Any`` y el proyecto no admite devolver ``Any`` donde se declara un tipo.
    """
    if leido is None:
        return cast(ArmadoEstructuraRequest, _PETICION_RECETA)
    return cast(
        ArmadoEstructuraRequest,
        ArmadoEstructuraRequest.model_construct(
            accion="armar",
            schema_version=OMOIKANE_ARMADO_SCHEMA_VERSION,
            reparto=leido.reparto,
            mezcla_colores=leido.mezcla,
            volumen=None if racimo is None else VolumenPedido(racimo=racimo),
        ),
    )


def _materiales_patron(pieza: PiezaArmado) -> list[MaterialPatron]:
    """La pieza como la ve ``patron_color`` para resolver un color leído en la foto: tono y acabado, en orden."""
    tonos = pieza.tonos or []
    acabados = pieza.acabados or []
    pesos = pieza.pesos or []

    def en(valores: Sequence[Any], indice: int) -> Any:
        return valores[indice] if indice < len(valores) else None

    return [
        MaterialPatron(
            color=en(tonos, indice),
            acabado=en(acabados, indice),
            participacion=float(en(pesos, indice) or 0.0),
        )
        for indice in range(pieza.colores)
    ]


def _geometria_del_racimo(pieza: PiezaArmado, leido: PatronLeido) -> GeometriaPedida | None:
    """Los globos de un racimo leídos en la foto, puestos donde el motor los cuenta.

    En un arco el racimo es la banda (``globos_ancho``) y en una columna es la capa (``globos_capa``). Lo que
    se salga del rango lo acota quien arma, con su aviso, igual que si lo hubiera pedido el modelo.
    """
    cuantos = leido.globos_por_racimo
    if cuantos is None:
        return None
    if pieza.tipo == "arco":
        return GeometriaPedida(globos_ancho=cuantos)
    return GeometriaPedida(globos_capa=cuantos)


#: Las mezclas del plan que describen una pieza **orgánica**: varios tamaños de globo en racimos, sin rejilla.
#: Solo `clasica` es de un tamaño (R-12 al 100 %) y se arma con el motor clásico, que reparte por anillos y
#: bandas. `solo_grandes` entró aquí el 2026-10-03: son 18" y 24" en proporción 60/40 —racimos de dos tamaños,
#: no una rejilla—, y sobre todo es la mezcla a la que llega una foto de globos casi todos gigantes
#: (`MEZCLA_DE_TAMANOS`), así que dejarla fuera convertía «la foto es de gigantes» en «arma la columna en
#: anillos», que es lo contrario de lo que la foto dice. El dueño de la lista de mezclas es
#: `src/lib/plan/mezclas.ts`; aquí solo se nombra cuáles de las cuatro son orgánicas.
MEZCLAS_ORGANICAS = frozenset({"organica_fina", "organica_gruesa", "solo_grandes"})


def _mezcla_de_tamanos(pieza: PiezaArmado, base: Mapping[str, Any]) -> dict[str, float]:
    """Los tamaños del motor para la mezcla que el plan declara, o los del diseño de partida si no la trae.

    Las piezas orgánicas se armaban **siempre** con la mezcla inicial del diseñador, dijera lo que dijera el
    plan: una columna `organica_fina` y una `solo_grandes` salían con los mismos globos (2026-10-03). Lo que
    se dibujaba y lo que se cobraba hablaban de piezas distintas, y ninguna lectura de la foto podía mover
    nada, porque el único sitio donde el tamaño vive en el plan es `mezcla`.

    Las proporciones son las del contrato (`x-reglas-mezclas`), las mismas con las que `plan.py` cuenta y
    compra; el motor las quiere en porcentaje y con sus diámetros presentes, aunque algunos vayan a 0.
    """
    inicial = {str(t): float(p) for t, p in cast(Mapping[int, float], base["mezcla"]).items()}
    proporciones = proporciones_de_mezcla(pieza.mezcla or "")
    if proporciones is None:
        return inicial
    pedida = {str(pulgadas): round(proporcion * 100, 4) for pulgadas, proporcion in proporciones}
    return {diametro: pedida.get(diametro, 0.0) for diametro in inicial}


def _orden_de_paleta(leido: RepartoLeido | None, cuantos: int) -> tuple[int, ...]:
    """El orden de la paleta de una pieza orgánica: el de la foto delante, y **todos** los materiales.

    La lectura decide el ORDEN, no quiénes están. Antes la paleta se quedaba con los materiales que la foto
    nombraba y el resto desaparecía del dibujo aunque el plan los comprara: una guirnalda de rosa, plata,
    blanco y cristal salía de tres colores, sin el cristal, porque la lectura solo nombró tres (2026-10-03).
    """
    secciones = [i for i in (leido.materiales if leido is not None else ()) if i < cuantos]
    motas = [
        i
        for i in (leido.acentos if leido is not None else ())
        if i < cuantos and i not in secciones
    ]
    nombrados = [*secciones, *motas]
    return (*nombrados, *(i for i in range(cuantos) if i not in nombrados))


def _racimo_leido(leido: RepartoLeido | None, avisos: list[str]) -> int | None:
    """Los globos por racimo que leyó la foto, dentro de lo que arma el motor; ``None`` si no los leyó.

    Antes la lectura no llegaba: el racimo era siempre el de la densidad del plan, se viera lo que se viera.
    Lo que se sale del rango del motor (``RACIMO_MIN_MOTOR`` a ``RACIMO_MAX_MOTOR``) se acota aquí, con su
    aviso, para que el plan no diga un racimo que el motor no arma.
    """
    if leido is None or leido.globos_por_racimo is None:
        return None
    leidos = leido.globos_por_racimo
    racimo = int(_acotar(leidos, RACIMO_MIN_MOTOR, RACIMO_MAX_MOTOR))
    if racimo != leidos:
        avisos.append(
            f"La foto leyo racimos de {leidos} globos; el motor organico arma de {RACIMO_MIN_MOTOR} a "
            f"{RACIMO_MAX_MOTOR} por racimo, asi que van de {racimo}."
        )
    return racimo


#: Lo más corto que puede quedar el tramo de fondo entre dos manchas para contarse como un tramo.
_TRAMO_VACIO = 1e-9

#: Una entrada de la paleta orgánica: el material, su peso (``None``: el de su participación, ``_peso_de``) y su
#: papel (``None``: el que diga la lectura, ``_rol_del_material``).
Entrada = tuple[int, float | None, str | None]


def _unir_seguidos(tramos: Sequence[tuple[int, float]]) -> list[tuple[int, float]]:
    """Los tramos con los vecinos del mismo material unidos en uno, sumando su largo."""
    unidos: list[tuple[int, float]] = []
    for material, largo in tramos:
        if unidos and unidos[-1][0] == material:
            unidos[-1] = (material, unidos[-1][1] + largo)
        else:
            unidos.append((material, largo))
    return unidos


def _tramos_de_manchas(
    fondo: int, manchas: Sequence[tuple[int, float, float]], peso: Mapping[int, float]
) -> list[tuple[int, float]]:
    """Las manchas de unas zonas como tramos a lo largo de la pieza: el fondo entre ellas y cada una en su sitio.

    El motor reparte sus tramos en el orden de la paleta y cada uno ocupa la parte del largo que pesa, así que
    una mancha se pone en su sitio con el tramo de fondo que la precede. Cada mancha mide lo que su color pesa
    en el plan, repartido entre sus manchas por la extensión que leyó la foto —lo mismo que ``patron_color``
    hace en una pared: la foto dice dónde y cuántas, la participación cuánto—; se centra en su ancla y, si pisa
    a otra o se sale de la pieza, se corre lo justo. El fondo se queda con lo que sobra, en uno o varios tramos.

    Devuelve ``(material, largo relativo dentro de su material)``: la extensión en las manchas y el largo del
    hueco en el fondo. ``peso`` es lo que pesa cada material en el motor.
    """
    por_material: dict[int, float] = {}
    for material, _centro, extension in manchas:
        por_material[material] = por_material.get(material, 0.0) + extension
    total = peso[fondo] + sum(peso[material] for material in por_material)
    anchos = [
        peso[material] * extension / por_material[material] / total
        for material, _centro, extension in manchas
    ]
    orden = sorted(range(len(manchas)), key=lambda k: (manchas[k][1], k))
    inicio = [0.0] * len(manchas)
    fin_previo = 0.0
    for k in orden:
        inicio[k] = max(manchas[k][1] - anchos[k] / 2, fin_previo, 0.0)
        fin_previo = inicio[k] + anchos[k]
    limite = 1.0
    for k in reversed(orden):
        inicio[k] = min(inicio[k], limite - anchos[k])
        limite = inicio[k]
    tramos: list[tuple[int, float]] = []
    cursor = 0.0
    for k in orden:
        hueco = inicio[k] - cursor
        if hueco > _TRAMO_VACIO:
            tramos.append((fondo, hueco))
        tramos.append((manchas[k][0], manchas[k][2]))
        cursor = inicio[k] + anchos[k]
    if 1.0 - cursor > _TRAMO_VACIO:
        tramos.append((fondo, 1.0 - cursor))
    return _unir_seguidos(tramos)


def _entradas_de_paleta(
    pieza: PiezaArmado,
    leido: RepartoLeido | None,
    cuantos: int,
    avisos: list[str],
    *,
    invertida: bool = False,
) -> list[Entrada]:
    """Las entradas de la paleta de una pieza orgánica, en el orden en que el motor las recorre.

    Sin tramos leídos, las de siempre: un material por entrada en el orden de ``_orden_de_paleta``, con su peso
    y su papel por defecto. Una pieza sin lectura sale así igual que antes, globo por globo.

    Con tramos leídos (bloques, degradé o zonas a lo largo de la pieza), una entrada **por tramo**, con el
    material repetido cuando la foto lo ve en dos sitios. Es lo que el motor y el contrato ya sabían armar —dos
    entradas de la paleta pueden ser el mismo material, y la puerta une su conteo y su compra—, y lo que la
    lectura perdía al quedarse con cada color una sola vez: blanco | dorado | blanco salía de blanco a dorado, y
    un dorado en el centro acababa en un extremo (2026-10-05). El peso de cada material es el de su
    participación en el plan **repartido** entre sus tramos por el largo que leyó la foto: lo que se compra de
    cada color no cambia, cambia dónde va.

    Los materiales que la foto no pone en ningún tramo van de **acento**, globos sueltos por toda la pieza, como
    los que ``patron_color`` deja sin uso al leer un patrón: ponerlos de tramo al final pintaría en un extremo
    un color que la foto no tiene ahí.

    ``invertida`` recorre los tramos al revés: un medio arco volteado empieza por su punta y la foto se lee
    desde su pata. Más entradas de las que caben en la paleta (``MAX_MATERIALES``) vuelven a las de siempre,
    con su aviso.
    """
    de_siempre: list[Entrada] = [
        (indice, None, None) for indice in _orden_de_paleta(leido, cuantos)
    ]
    if leido is None or leido.reparto != "tramos" or not (leido.tramos or leido.manchas):
        return de_siempre
    peso = {indice: _peso_de(pieza, indice, None) for indice in range(cuantos)}
    if leido.manchas:
        fondo = leido.materiales[0]
        # Una mancha del color del fondo ya es fondo.
        manchas = [mancha for mancha in leido.manchas if mancha[0] != fondo and mancha[0] < cuantos]
        if fondo >= cuantos or not manchas:
            return de_siempre
        tramos = _tramos_de_manchas(fondo, manchas, peso)
    else:
        tramos = _unir_seguidos(
            [(material, largo) for material, largo in leido.tramos if material < cuantos]
        )
    if not tramos:
        return de_siempre
    if invertida:
        tramos.reverse()
    largo_de: dict[int, float] = {}
    for material, largo in tramos:
        largo_de[material] = largo_de.get(material, 0.0) + largo
    base: list[Entrada] = [
        (material, _acotar(round(peso[material] * largo / largo_de[material], 2), 1, 100), "normal")
        for material, largo in tramos
    ]
    # Primero las motas que leyó la foto y después los materiales que no nombró, en su orden.
    sueltos = dict.fromkeys(
        indice
        for indice in (*leido.acentos, *range(cuantos))
        if indice < cuantos and indice not in largo_de
    )
    acentos: list[Entrada] = [(indice, peso[indice], "acento") for indice in sueltos]
    if len(base) + len(acentos) > MAX_MATERIALES:
        avisos.append(
            f"La foto leyo {len(base)} tramos de color y la paleta del motor admite {MAX_MATERIALES} "
            "entradas; los colores van en el orden de la foto, sin sus tramos."
        )
        return de_siempre
    return [*base, *acentos]


def _paleta_organica(
    pieza: PiezaArmado, entradas: Sequence[Entrada], leido: RepartoLeido | None, avisos: list[str]
) -> list[dict[str, Any]]:
    """La paleta de un ``armado-arco-organico.v1`` o ``armado-columna-organica.v1`` con estas entradas."""
    acabados = _acabados_de(pieza, [(material, None) for material, _peso, _rol in entradas], avisos)
    return [
        {
            "material": material,
            "peso": _peso_de(pieza, material, peso),
            "acabado": acabados[(material, None)],
            "rol": _rol_del_material(material, leido, rol),
        }
        for material, peso, rol in entradas
    ]


#: La altura de la línea guía de una guirnalda que va sobre la mesa principal: la de una mesa de eventos
#: (0,75 m), con la tira corriendo por su borde. **Provisional y pendiente de una decisión del negocio**: el
#: motor no tiene forma lista de mesa y el diseñador no publica una cifra. Solo se usa con lectura de la foto.
ALTURA_MESA_M = 0.75

#: La forma lista «A lo largo del piso» del diseñador (``guirnalda/formas.py``): de ahí sale la línea de una
#: guirnalda de piso, en vez de escribir sus cifras aquí.
_FORMA_GUIRNALDA_PISO = next(forma for forma in FORMAS_GUIRNALDA if forma.id == "piso")


def _linea_del_soporte(soporte: str | None) -> dict[str, float]:
    """A qué altura corre la línea de una guirnalda según dónde se apoya; ``{}`` para la de siempre.

    - ``piso``: la línea de la forma lista «A lo largo del piso» del diseñador, su altura y su onda. No su
      largo, su volumen, sus tamaños ni su semilla, que son del plan y de su densidad: lo que se cobra.
    - ``mesa``: ``ALTURA_MESA_M`` (provisional).
    - pared, colgada o sobre otra pieza: la de siempre (2,2 m), la de una guirnalda en alto.

    La receta no miraba dónde va la guirnalda: una de piso o de mesa salía a 2,2 m como la de la pared, y la
    frase de la imagen la contaba «montada en la pared, en alto» (2026-10-05).
    """
    if soporte == "piso":
        return {
            clave: float(_FORMA_GUIRNALDA_PISO.forma[clave])
            for clave in ("alturaM", "ondaM", "ondas")
        }
    if soporte == "mesa":
        return {"alturaM": ALTURA_MESA_M}
    return {}


def _soporte_de_la_lectura(lectura: Mapping[str, object] | None) -> str | None:
    """El soporte de la guirnalda que vio la foto, si la lectura lo trae con confianza; si no, ``None``."""
    if lectura is None:
        return None
    soporte = lectura.get("soporte")
    confianza = lectura.get("confianza")
    if (
        isinstance(soporte, str)
        and soporte in SOPORTES_LECTURA_GUIRNALDA
        and isinstance(confianza, (int, float))
        and not isinstance(confianza, bool)
        and confianza >= CONFIANZA_MINIMA_LECTURA_GUIRNALDA
    ):
        return soporte
    return None


#: Lo que una pista de la línea de antes del 2026-10-05 no traía (solo sentido y flecha): se lee como entonces,
#: la guirnalda de pared que la foto vio con esa curva, sin filtro de confianza. Solo completa la traducción de
#: la línea: un soporte que la pista no trae no cuenta como leído (``_soporte_de_la_lectura``).
_LECTURA_DE_ANTES: Mapping[str, object] = {"soporte": "pared", "forma": "recta", "confianza": 1.0}


def _lectura_de_la_curva(curva: CurvaPistaFoto) -> dict[str, object]:
    """La pista de la línea con los nombres de ``LecturaGuirnaldaSchema``, solo con lo que trae.

    Así la traduce ``armado_guirnalda.linea_de_lectura``, la misma función que la del armado por partes. El
    sentido y la flecha viajan juntos o la caída de una lectura v2, nunca las dos: es como esa función distingue
    una lectura de la otra.
    """
    lectura: dict[str, object] = {}
    for campo, clave in (
        ("soporte", "soporte"),
        ("forma", "forma"),
        ("puntos_de_anclaje", "puntos_de_anclaje"),
        ("confianza", "confianza"),
        ("desnivel", "desnivel_relativo"),
    ):
        valor = getattr(curva, campo)
        if valor is not None:
            lectura[clave] = valor
    if curva.sentido is not None or curva.flecha is not None:
        lectura["sentido_curva"] = curva.sentido
        lectura["flecha_relativa"] = curva.flecha
    elif curva.caida is not None:
        lectura["caida_relativa"] = curva.caida
    return lectura


def _armado_columna_organica(
    pieza: PiezaArmado,
    avisos: list[str],
    leido: RepartoLeido | None = None,
    inclinacion: float | None = None,
    remate: RemateDeLaFoto | None = None,
) -> dict[str, Any]:
    """Un ``armado-columna-organica.v1`` con la receta del motor y el alto y los colores de la pieza.

    Es la hermana de ``_armado_columna`` para las columnas que el plan declara orgánicas. No toma mandos del
    modelo: ninguna herramienta compone una columna orgánica todavía (ADR-0035), así que lo único que la pieza
    aporta es su alto y su paleta, y el resto sale del diseño de partida del diseñador.
    """
    inicial = config_inicial_columna_organica()
    # El contrato publica menos campos que el motor: `carga` y `espejo` son del diseño del clasificador y no
    # viajan en el plan, y la corona apunta a un material por índice en vez de a un tono.
    forma = {
        clave: valor
        for clave, valor in cast(Mapping[str, Any], inicial["forma"]).items()
        if clave not in ("carga", "espejo")
    }
    volumen = dict(inicial["volumen"])
    tamanos = dict(inicial["tamanos"])
    aspecto = dict(cast(Mapping[str, Any], inicial["aspecto"]))
    colores_motor = cast(Mapping[str, Any], inicial["colores"])
    # La columna que el plan declara asimétrica toma la forma lista entera (silueta, volumen, tamaños y semilla),
    # como la aplica el diseñador (``aplicarFormaCol``). El alto y la mezcla siguen siendo los del plan.
    lista = _FORMA_LISTA_COLUMNA[FORMA_COLUMNA_ASIMETRICA] if pieza.asimetrica else None
    if lista is not None:
        forma = {**forma, **lista.forma}
        volumen = dict(lista.volumen)
        tamanos = dict(lista.tamanos)
        aspecto["semilla"] = int(lista.semilla)
    estilo = _ESTILO_COLUMNA_POR_DENSIDAD.get(pieza.densidad or "")
    if estilo is not None:
        # La densidad del plan es el estilo del diseñador (ligero / lleno), que solo mueve el volumen.
        volumen = dict(estilo.aplicar(cast(Any, {"volumen": volumen}))["volumen"])
    racimo = _racimo_leido(leido, avisos)
    if racimo is not None:
        # Los globos por racimo que vio la foto mandan sobre los de la densidad.
        volumen["racimo"] = racimo
    alto = pieza.alto_m or float(forma["altoM"])
    forma["altoM"] = alto
    if inclinacion is None and lista is not None:
        # Sin lectura de la foto, la asimétrica se tuerce lo que su forma lista, en proporción a su alto: la
        # inclinación ES lo que la hace asimétrica. Una lectura de la foto manda sobre ella.
        inclinacion = float(lista.forma["inclinacionM"]) / float(lista.forma["altoM"])
    if inclinacion is not None:
        # La lectura viene en fracción del alto y el motor la quiere en metros. El contrato la acota a ±2 m,
        # que con una columna de 2,2 m y un vuelo «strong» (45 %) no se alcanza; el tope está por si la pieza
        # es muy alta.
        forma["inclinacionM"] = _acotar(alto * inclinacion, -2.0, 2.0)
    else:
        # Sin lectura, recta. El diseño de partida del diseñador trae 0,12 m de vuelo y 0,10 m de serpenteo, que
        # son un gusto de arranque en su editor, no algo que la foto o el cliente pidieran; y las frases de
        # imagen nombran todo lo que pase de 0,05 m, así que cada columna orgánica salía «leaning toward the
        # right, curving in a soft S» y el modelo dibujaba dos medios arcos (2026-10-04, foto de ejemplo 01).
        # Misma política que la corona: lo que la foto no dice no se inventa.
        forma["inclinacionM"] = 0.0
    # El serpenteo no lo lee nadie todavía: sin dato, la columna sube derecha.
    forma["serpenteoM"] = 0.0
    cuantos = min(pieza.colores, MAX_MATERIALES)
    # La corona (el globo grande de la punta) solo se enciende si la foto la vio: coronar una columna que nadie
    # vio coronada es inventar globos que se cobran. Con lectura sí se sabe, y antes se ignoraba porque esta
    # rama retornaba antes de leer el remate (auditoría 2026-10-04, M6.a). El motor orgánico solo corona con un
    # globo: un racimo, una estrella o un corazón se avisan y la columna queda sin corona.
    corona_activa = remate is not None and remate.tipo == "globo"
    if remate is not None and remate.tipo not in ("globo", "ninguno"):
        avisos.append(
            f"La foto corona la columna con «{remate.tipo}»; el motor orgánico solo corona con un globo "
            "y la deja sin corona."
        )
    # El orden de la paleta es el de la foto cuando la hay (el dominante primero), con sus tramos de la base a
    # la punta si los leyó (``_entradas_de_paleta``); sin lectura, el orden del plan.
    paleta = _paleta_organica(
        pieza, _entradas_de_paleta(pieza, leido, cuantos, avisos), leido, avisos
    )
    return {
        "version": VERSION_ARMADO_COLUMNA_ORGANICA,
        "origen": "sugerido",
        "forma": forma,
        "volumen": volumen,
        "tamanos": {
            **tamanos,
            "mezcla": _mezcla_de_tamanos(pieza, tamanos),
        },
        "colores": {
            "paleta": paleta,
            "reparto": leido.reparto if leido is not None else colores_motor["reparto"],
            # El difuminado que dice el modo leído (bloques limpios, degradé fundido, racimos puros).
            "mezcla": colores_motor["mezcla"]
            if leido is None or leido.mezcla is None
            else leido.mezcla,
        },
        "adornos": dict(cast(Mapping[str, Any], inicial["adornos"])),
        "aspecto": aspecto,
        # Sin lectura de remate la corona va apagada: la misma decisión que el remate de la columna clásica, al
        # revés, porque allá el valor de partida del diseñador sí la trae (decisión pendiente D9 del plan).
        "corona": {
            "activa": corona_activa,
            "tamano": cast(Mapping[str, Any], inicial["corona"])["tamano"],
            "material": remate.material
            if corona_activa and remate is not None and remate.material is not None
            else 0,
        },
    }


def _ancho_visible_del_medio(cfg: Mapping[str, Any], ancho_completo: float) -> float:
    """Lo que mide de lado a lado un medio arco cuyo arco completo mide ``ancho_completo``, globos incluidos.

    Pasa por el ``sanear`` del motor (que acota el grosor al ancho) y por su línea guía con las fases neutras
    de ``estimar_globos``: es la banda que el motor recorre, con medio grosor a cada lado de cada punto.
    """
    prueba = cast(Any, {**cfg, "forma": {**cfg["forma"], "anchoM": ancho_completo}})
    saneado, _cambios = sanear_arco_organico(prueba)
    espina = crear_espina(saneado, [0.5] * 8)
    largo = espina.largo or 1.0
    bordes = [
        (punto.x - espina.grosor(punto.s / largo) / 2, punto.x + espina.grosor(punto.s / largo) / 2)
        for punto in espina.puntos
    ]
    return float(max(b for _a, b in bordes) - min(a for a, _b in bordes))


def _ancho_del_arco_completo(
    cfg: Mapping[str, Any], ancho_visible: float, avisos: list[str]
) -> float:
    """El ``anchoM`` del arco completo que, cortado como medio arco, mide ``ancho_visible`` (bisección).

    Lo que no cabe en el motor se acota a su rango y se avisa: un semiarco más angosto que el más angosto que
    el motor sabe cortar sale con ese.
    """
    bajo, alto = float(ARCO_ORGANICO_ANCHO_MIN), float(ARCO_ORGANICO_ANCHO_MAX)
    minimo = _ancho_visible_del_medio(cfg, bajo)
    if minimo >= ancho_visible:
        if minimo > ancho_visible * 1.05:
            avisos.append(
                f"El semiarco más angosto que arma el motor mide {minimo:.2f} m de ancho; el plan pide "
                f"{ancho_visible:g} m."
            )
        return bajo
    if _ancho_visible_del_medio(cfg, alto) <= ancho_visible:
        return alto
    for _ in range(24):
        medio = (bajo + alto) / 2
        if _ancho_visible_del_medio(cfg, medio) < ancho_visible:
            bajo = medio
        else:
            alto = medio
    return round((bajo + alto) / 2, 3)


def _armado_arco_organico(
    pieza: PiezaArmado,
    avisos: list[str],
    leido: RepartoLeido | None = None,
    inclinacion: float | None = None,
    medio: bool = False,
) -> dict[str, Any]:
    """Un ``armado-arco-organico.v1`` con la receta del motor y el ancho, el alto y los colores de la pieza.

    Es la hermana de ``_armado_arco`` para los arcos que el plan declara orgánicos, y el espejo exacto de
    ``_armado_columna_organica``. El contrato y la puerta (``app/armado_arco_organico.py``) existían y
    ``plan.py`` ya sabía resolver y publicar uno, pero **nadie lo construía nunca**: un arco orgánico salía
    armado con un patrón de bandas, que es otra técnica. Cablear no es portar: el puerto estaba completo y el
    camino no empezaba.

    Dos diferencias con la columna, las dos del contrato: aquí ``carga`` y ``espejo`` **sí** viajan (son lo
    que hace que un lado del arco pese más y por dónde se corta un medio arco), y no hay corona.

    ``medio`` es lo que hace de este armado un **medio arco**: aplica entera la forma lista ``FORMA_SEMIARCO``
    (o ``FORMA_SEMIARCO_ASIMETRICO``, con el mismo corte), voltea al lado de ``pieza.espejo`` y busca el ancho
    del arco completo que, cortado, mide el ancho del plan. El motor es el mismo: «un medio arco es este armado
    con ``forma.corte`` menor que 1» (encabezado de ``app/armado_arco_organico.py``).
    """
    inicial = config_inicial_arco_organico()
    forma = dict(cast(Mapping[str, Any], inicial["forma"]))
    volumen = dict(cast(Mapping[str, Any], inicial["volumen"]))
    tamanos = dict(cast(Mapping[str, Any], inicial["tamanos"]))
    aspecto = dict(cast(Mapping[str, Any], inicial["aspecto"]))
    colores_motor = cast(Mapping[str, Any], inicial["colores"])
    if medio:
        # Un medio arco toma su forma lista **entera** (silueta, volumen, tamaños y semilla), como el diseñador
        # al elegirla: copiar solo el corte dejaba la carga y el volumen del arco completo. El simétrico es
        # «medio-corto» y el asimétrico la pata gruesa de «medio-pila» con el mismo corte (``FORMA_SEMIARCO``).
        lista = _FORMA_LISTA_ARCO[FORMA_SEMIARCO_ASIMETRICO if pieza.asimetrica else FORMA_SEMIARCO]
        forma = {**forma, **lista.forma}
        forma["corte"] = min(float(forma["corte"]), _CORTE_DE_FORMA[FORMA_SEMIARCO])
        # El lado: el que la tarjeta ya dibuja (`IconoEstructura`, `ubicacion === "lateral_derecho"`). Sin
        # espejo la pata queda a la izquierda y la punta se va a la derecha.
        forma["espejo"] = pieza.espejo
        if pieza.espejo:
            # La carga se voltea con la pieza. El motor la mide de izquierda a derecha **después** de voltear
            # (``organico/espina.py``, el grosor; ``organico/motor.py``, el sesgo de los tamaños), y las formas
            # listas de medio arco la traen negativa porque su pata está a la izquierda: un medio arco derecho
            # que se quedaba con la carga sin voltear engordaba la punta libre y le ponía los globos grandes,
            # mientras la pata, en el suelo, quedaba flaca (2026-10-05). Su frase de imagen lo decía igual:
            # «heavier on the left, with the largest balloons massed there», que es la punta.
            forma["carga"] = -float(forma["carga"])
        volumen = dict(lista.volumen)
        tamanos = dict(lista.tamanos)
        aspecto["semilla"] = int(lista.semilla)
    elif pieza.asimetrica:
        # La disposición entera de la forma lista, como la aplica el diseñador al elegirla
        # (`clasificador-decoraciones/src/lib/referencias/vista-previa.ts`, `arcoOrganico`: forma, volumen,
        # tamaños y semilla): cima corrida, una pata más cargada y la otra cortada antes del suelo
        # (`corte` < 1). Las medidas y la mezcla de tamaños siguen siendo las del plan, que es lo que se cobra.
        lista = _FORMA_LISTA_ARCO[FORMA_ARCO_ASIMETRICO]
        forma = dict(lista.forma)
        volumen = dict(lista.volumen)
        tamanos = dict(lista.tamanos)
        aspecto["semilla"] = int(lista.semilla)
    estilo = _ESTILO_POR_DENSIDAD.get(pieza.densidad or "")
    if estilo is not None:
        # La densidad del plan es el estilo de partida del diseñador (ligero / estándar / lleno), que solo
        # mueve el volumen. `media` no aplica `estandar`: es el volumen que la pieza ya trae (el inicial, que
        # coincide con `estandar`, o el de su forma lista), y así el arco de siempre no cambia.
        volumen = dict(estilo.aplicar(cast(Any, {"volumen": volumen}))["volumen"])
    racimo = _racimo_leido(leido, avisos)
    if racimo is not None:
        # Los globos por racimo que vio la foto mandan sobre los de la densidad y la forma lista.
        volumen["racimo"] = racimo
    if pieza.alto_m:
        forma["altoM"] = pieza.alto_m
    if pieza.ancho_m and medio:
        # El ancho de un semiarco en el plan es lo que mide **la pieza que se ve** (de la pata a la punta), y el
        # `anchoM` del motor es el del arco completo antes de cortarlo: se busca el que deja ese ancho.
        forma["anchoM"] = _ancho_del_arco_completo(
            {**inicial, "forma": forma, "volumen": volumen, "tamanos": tamanos},
            pieza.ancho_m,
            avisos,
        )
    elif pieza.ancho_m:
        forma["anchoM"] = pieza.ancho_m
    if inclinacion is not None and medio:
        # Un medio arco ya se va hacia su punta: es lo que lo hace medio. Su lado cargado es su pata —la forma
        # lista la trae así y arriba se voltea con la pieza—, así que la lectura no se lo lleva a la punta libre
        # (antes `carga` tomaba la inclinación y la punta salía con los globos grandes de los dos lados). Lo que
        # sí dice es cuánto se corre la cima hacia donde va la pieza; `cima` se mide en el medio arco sin
        # voltear, así que la lectura, que es de la foto, se voltea con él.
        hacia_la_punta = -inclinacion if pieza.espejo else inclinacion
        forma["cima"] = _acotar(0.5 + hacia_la_punta * 0.2, 0.3, 0.7)
    elif inclinacion is not None:
        # En un arco la inclinación de la foto no es una medida, es un reparto: el lado hacia el que se va la
        # pieza es el que pesa más y lleva los globos más grandes (`carga`, de −1 a +1), y la cima se corre
        # hacia allá. No hay un `inclinacionM` que mover como en la columna: un arco con una pata desplazada
        # ya no es un arco. El contrato acota `cima` a [0,3; 0,7], así que el corrimiento es el que cabe.
        forma["carga"] = _acotar(inclinacion, -1.0, 1.0)
        forma["cima"] = _acotar(0.5 + inclinacion * 0.2, 0.3, 0.7)
    cuantos = min(pieza.colores, MAX_MATERIALES)
    # Un medio arco volteado empieza por su punta (el motor lo recorre de izquierda a derecha), y los tramos que
    # leyó la foto van desde su pata: se recorren al revés.
    entradas = _entradas_de_paleta(pieza, leido, cuantos, avisos, invertida=medio and pieza.espejo)
    return {
        "version": VERSION_ARMADO_ARCO_ORGANICO,
        "origen": "sugerido",
        "forma": forma,
        "volumen": volumen,
        "tamanos": {
            **tamanos,
            "mezcla": _mezcla_de_tamanos(pieza, tamanos),
        },
        "colores": {
            "paleta": _paleta_organica(pieza, entradas, leido, avisos),
            "reparto": leido.reparto if leido is not None else colores_motor["reparto"],
            # El difuminado que dice el modo leído (bloques limpios, degradé fundido, racimos puros).
            "mezcla": colores_motor["mezcla"]
            if leido is None or leido.mezcla is None
            else leido.mezcla,
        },
        "adornos": dict(cast(Mapping[str, Any], inicial["adornos"])),
        "aspecto": aspecto,
    }


def _orden_por_peso(pieza: PiezaArmado, cuantos: int) -> list[int]:
    """Los materiales del patrón clásico, del de más participación al de menos; a igual peso, el orden del plan.

    El patrón de bandas o anillos reparte más el primer color, así que el dominante va primero. Antes iban en
    el orden del plan y un arco declarado 70/20/10 se armaba y cobraba 30/29/29 con el dominante donde cayera
    (auditoría 2026-10-04, M4). Sin pesos declarados es el orden de siempre. Repartir **por peso** dentro del
    patrón es un criterio de armado nuevo y va primero por el clasificador.
    """
    pesos = pieza.pesos or []
    return sorted(range(cuantos), key=lambda i: (-(pesos[i] if i < len(pesos) else 0.0), i))


def _receta(
    pieza: PiezaArmado,
    avisos: list[str],
    pista: Mapping[str, object] | None = None,
    lectura_remate: Mapping[str, object] | None = None,
    inclinacion: float | None = None,
    lectura_linea: Mapping[str, object] | None = None,
    soporte: str | None = None,
) -> dict[str, Any]:
    """La receta del motor para la pieza: lo que la foto leyó si se puede armar, y si no lo que la pieza dice.

    El patrón de la foto manda sobre el conteo de colores (ADR-0039): una columna que en la foto es un
    apilado de anillos sale apilada, no en la espiral con la que arranca el diseñador. Cuando no hay lectura
    —o no se puede honrar, y entonces ya lo dijo en ``avisos``— vuelve el criterio de siempre.

    De una guirnalda llegan además ``lectura_linea``, la línea que leyó la foto en el vocabulario de la lectura
    (``LecturaGuirnaldaSchema``: forma, soporte, flecha, desnivel...), y ``soporte``, dónde la pone el plan
    (``SOPORTE_POR_UBICACION``). El soporte solo se usa con alguna lectura de la foto: una pieza sin lectura se
    cuenta, se dibuja y se firma igual que siempre, porque los planes sin armado guardado se vuelven a contar
    con esta misma receta (``armado_guirnalda_de_receta``) y un cambio ahí movería su ``plan_hash``.
    """
    de_la_pieza = _materiales_patron(pieza)
    # **Qué motor arma la pieza lo decide la mezcla que el plan declara**, y se decide antes que nada: una
    # columna orgánica son racimos de varios tamaños y no tiene patrón que elegir, así que la lectura de la
    # foto le sirve para el reparto, igual que a la guirnalda. Preguntar primero por el patrón hacía que una
    # columna orgánica con patrón legible saliera de anillos (visto el 2026-10-03 con una foto de dos
    # columnas orgánicas: la gráfica salía clásica y nadie pedía la ruta orgánica).
    # Un `semiarco` es SIEMPRE este armado, y por eso se decide antes que las dos ramas de abajo y **sin
    # mirar `mezcla`**: el arco y la columna tienen dos motores y la mezcla elige cuál; un medio arco solo
    # tiene el orgánico —«un medio arco es este armado con `forma.corte` menor que 1», encabezado de
    # `app/armado_arco_organico.py`, y la taxonomía retiró `semiarco` porque todo medio arco es orgánico—,
    # así que declararlo `clasica` no lo convierte en una rejilla de patrones, que además no sabe cortarse.
    # Sin esto, un medio arco del plan caía al patrón del arco clásico por el número de colores.
    if pieza.tipo == "semiarco":
        del_reparto = reparto_del_motor("arco_organico", pista, de_la_pieza, avisos, medio=True)
        armado = _armado_arco_organico(pieza, avisos, del_reparto, inclinacion, medio=True)
        if del_reparto is not None:
            armado["origen"] = "referencia"
        return armado
    # Una columna asimétrica también es del orgánico, diga lo que diga la mezcla: sus anillos no tienen un lado
    # distinto del otro (``FORMA_COLUMNA_ASIMETRICA``).
    if pieza.tipo == "columna" and (pieza.mezcla in MEZCLAS_ORGANICAS or pieza.asimetrica):
        del_reparto = reparto_del_motor("columna_organica", pista, de_la_pieza, avisos)
        remate_organico = remate_del_motor("columna", lectura_remate, de_la_pieza, avisos)
        armado = _armado_columna_organica(pieza, avisos, del_reparto, inclinacion, remate_organico)
        if del_reparto is not None or (
            remate_organico is not None and remate_organico.tipo == "globo"
        ):
            armado["origen"] = "referencia"
        return armado
    # Un arco asimétrico también es del orgánico, diga lo que diga la mezcla: el arco de patrones no sabe hacer
    # una pata distinta de la otra, y armarlo ahí lo dejaba simétrico (``FORMA_ARCO_ASIMETRICO``).
    if pieza.tipo == "arco" and (pieza.mezcla in MEZCLAS_ORGANICAS or pieza.asimetrica):
        del_reparto = reparto_del_motor("arco_organico", pista, de_la_pieza, avisos)
        armado = _armado_arco_organico(pieza, avisos, del_reparto, inclinacion)
        if del_reparto is not None:
            armado["origen"] = "referencia"
        return armado
    leido = patron_del_motor(pieza.tipo, pista, de_la_pieza, avisos, tope_materiales=MAX_MATERIALES)
    # El remate es independiente del patrón: una columna cuya disposición de color no se ve puede llevar su
    # globo grande igual, y una que se ve puede no llevar nada. Sin lectura, **sin remate**: el plan no tiene
    # campo con el que pedirlo y coronar una columna que nadie pidió es cobrar globos inventados (1,8 m salía de
    # 2,24 m con un 24" encima). Es el criterio del clasificador —su vista previa solo corona la ficha
    # «con-remate» (``referencias/vista-previa.ts``, ``REMATE``)— y el de la columna orgánica (corona apagada).
    del_remate = remate_del_motor(pieza.tipo, lectura_remate, de_la_pieza, avisos)
    remate = (
        RematePedido(tipo=cast(Any, del_remate.tipo), material=del_remate.material)
        if del_remate is not None
        else RematePedido(tipo="ninguno")
    )
    if leido is not None:
        geometria = _geometria_del_racimo(pieza, leido)
        armado = (
            _armado_arco(pieza, leido.patron, leido.materiales, leido.opciones, geometria, avisos)
            if pieza.tipo == "arco"
            else _armado_columna(
                pieza, leido.patron, leido.materiales, leido.opciones, geometria, remate, avisos
            )
        )
        # El contrato de los tres armados ya tiene este origen, y es el mismo que `patron_color` escribe
        # cuando el patrón sale de una pista: lo que se armó describe la foto, no una sugerencia del motor.
        armado["origen"] = "referencia"
        return armado
    if pieza.tipo == "arco":
        patron = _patron_arco_para(pieza.colores)
        cuantos = min(
            pieza.colores,
            int(cast(int, PATRONES_ARCO[patron].lista["max"]))
            if PATRONES_ARCO[patron].lista
            else len(PATRONES_ARCO[patron].colores),
        )
        return _armado_arco(pieza, patron, _orden_por_peso(pieza, cuantos), None, None, avisos)
    if pieza.tipo == "columna":
        patron = _patron_columna_para(pieza.colores)
        cuantos = min(pieza.colores, MAX_MATERIALES)
        armado = _armado_columna(
            pieza, patron, _orden_por_peso(pieza, cuantos), None, None, remate, avisos
        )
        if del_remate is not None:
            # El patrón lo eligió el conteo de colores, pero la punta es lo que la foto vio.
            armado["origen"] = "referencia"
        return armado
    # La guirnalda no tiene patrón que elegir: lo que decide dónde va cada color es su **reparto**, y la foto
    # sí puede decirlo (ADR-0039). Su receta es `config_inicial()` con el largo de la pieza y una paleta con
    # todos sus colores; los pesos salen de la participación que el plan declara, no de la foto.
    #
    # Su línea es la que la pieza ya declara por su armado por partes (``PiezaArmado.linea``: recta, curva,
    # ondulada, U invertida o arco caído), y su volumen el estilo del motor para la densidad del plan
    # (``_ESTILO_GUIR_POR_DENSIDAD``). Sin forma declarada y en densidad media, la guirnalda de siempre.
    #
    # Con lectura de la foto, además: los tramos que leyó (``_entradas_de_paleta``), el difuminado de su modo y
    # sus globos por racimo, la línea que midió —curva, festones, onda y el desnivel de los extremos, con la
    # misma traducción que el armado por partes (``linea_guirnalda_de_lectura``)— y la altura de la línea según
    # dónde se apoya: la que vio la foto o, si no la dice, la del plan.
    del_reparto = reparto_del_motor(pieza.tipo, pista, de_la_pieza, avisos)
    cuantos = min(pieza.colores, MAX_MATERIALES)
    paleta = [
        ColorPedido(material=material, peso=peso, rol=rol)
        for material, peso, rol in _entradas_de_paleta(pieza, del_reparto, cuantos, avisos)
    ]
    peticion = _peticion_con_reparto(del_reparto, _racimo_leido(del_reparto, avisos))
    # La línea que midió la foto, en metros sobre el largo que arma el motor. Entra en el contrato aquí y en lo
    # que arma el motor al final (``_acotar_linea_leida``), que es donde se dice lo que se recortó.
    linea_medida = (
        linea_guirnalda_de_lectura({**_LECTURA_DE_ANTES, **lectura_linea}, _largo_guirnalda(pieza))
        if lectura_linea is not None
        else {}
    )
    linea_leida = _linea_en_contrato(linea_medida)
    soporte_leido = _soporte_de_la_lectura(lectura_linea)
    con_lectura = (
        del_reparto is not None
        or bool(linea_leida)
        or soporte_leido is not None
        or inclinacion is not None
    )
    linea_soporte = _linea_del_soporte(soporte_leido or soporte) if con_lectura else {}
    propios: list[str] = []
    armado = _armado_guirnalda(
        pieza,
        paleta,
        peticion,
        propios,
        del_reparto,
        inclinacion,
        linea_leida,
        pieza.linea,
        pieza.densidad,
        linea_soporte,
    )
    if pieza.densidad == "lujosa" and globos_estimados_guirnalda(armado) > GUIRNALDA_MAX_GLOBOS:
        # El estilo lleno no puede dejar una guirnalda que la resolución rechace por grande
        # (``demasiado_grande``, ``armado_guirnalda_organica.MAX_GLOBOS_ESTIMADOS``): se queda el volumen de
        # la densidad media, y se dice. La sencilla no hace falta mirarla: lleva menos globos que la media.
        propios = [
            f"Con la densidad lujosa la guirnalda pasaria de {GUIRNALDA_MAX_GLOBOS} globos; "
            "va con el volumen estandar."
        ]
        armado = _armado_guirnalda(
            pieza,
            paleta,
            peticion,
            propios,
            del_reparto,
            inclinacion,
            linea_leida,
            pieza.linea,
            linea_soporte=linea_soporte,
        )
    avisos.extend(propios)
    if linea_medida:
        _acotar_linea_leida(armado, pieza, linea_medida, avisos)
    if del_reparto is not None:
        armado["origen"] = "referencia"
    return armado


# ---------------------------------------------------------------------------
# La puerta: validar y resolver
# ---------------------------------------------------------------------------


def _estructura_arco(colores: int, es_arco: bool = True) -> EstructuraArco:
    """La pieza como la ve el motor del arco.

    Los tonos son **marcadores**, no los colores que se compran: esta operación no dibuja nada y el plan es el
    dueño de qué color va en cada índice. El conteo y la compra salen por índice de material igual (el motor se
    alimenta de colores testigo propios, ``armado_arco._testigos``), así que nada de lo que se devuelve
    depende de estos tonos. El SVG con los colores de verdad lo emite la ruta del editor.
    """
    return EstructuraArco(es_arco=es_arco, materiales=[f"#{i + 1:06x}" for i in range(colores)])


def _estructura_columna(colores: int, es_columna: bool = True) -> EstructuraColumna:
    """Lo mismo para la columna, cuyo motor nunca mira estos tonos (ni dibuja)."""
    return EstructuraColumna(
        es_columna=es_columna, materiales=[f"#{i + 1:06x}" for i in range(colores)]
    )


def _estructura_guirnalda(colores: int, es_guirnalda: bool = True) -> EstructuraGuirnalda:
    """La pieza como la ve el motor de la guirnalda. Mismos tonos marcadores, por lo mismo que el arco."""
    return EstructuraGuirnalda(
        es_guirnalda=es_guirnalda, materiales=[f"#{i + 1:06x}" for i in range(colores)]
    )


def _resumen_arco(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber del arco resuelto. Sin globos y sin SVG: no mira píxeles."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "filas": resuelto["filas"],
        "columnas": resuelto["columnas"],
        "largo_m": resuelto["largo_m"],
        "ancho_m": resuelto["ancho_m"],
        "alto_m": resuelto["alto_m"],
        "grosor_m": resuelto["grosor_m"],
        "globos_por_metro": resuelto["globos_por_metro"],
        "conteo": resuelto["conteo"],
        "compra": resuelto["compra"],
        "total_comprar": resuelto["total_comprar"],
    }


def _resumen_columna(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber de la columna resuelta."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "capas": resuelto["capas"],
        "alto_cuerpo_m": resuelto["alto_cuerpo_m"],
        "alto_total_m": resuelto["alto_total_m"],
        "diametro_m": resuelto["diametro_m"],
        "conteo": resuelto["conteo"],
        "remate": cast(Mapping[str, Any], resuelto["remate"])["descripcion"],
    }


def _resumen_guirnalda(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber de la guirnalda resuelta. Sin globos y sin SVG."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "capas": resuelto["capas"],
        "largo_m": resuelto["largo_m"],
        "ancho_m": resuelto["ancho_m"],
        "alto_m": resuelto["alto_m"],
        "grosor_extremos_m": resuelto["grosor_extremos_m"],
        "grosor_centro_m": resuelto["grosor_centro_m"],
        "globos_por_metro": resuelto["globos_por_metro"],
        # Globos que no tocan a ningún otro: con el motor bien puesto es 0, y si no lo es, se ve.
        "sueltos": resuelto["sueltos"],
        "conteo": resuelto["conteo"],
        "compra": resuelto["compra"],
        "total_comprar": resuelto["total_comprar"],
        # El follaje y las flores no se cotizan: van para que nadie los olvide al montar.
        "adornos": resuelto["adornos"],
    }


def _motivo(motivo: str, mensaje: str, estructura_id: str | None) -> PlanResolutionError:
    """Un armado que no se sostiene: motivo estable y mensaje en español, nunca un éxito a medias."""
    detalles: dict[str, object] = {"motivo": motivo, "mensaje": mensaje}
    if estructura_id is not None:
        detalles["estructura_id"] = estructura_id
    return PlanResolutionError("armado_invalido", 422, detalles)


#: Las tres puertas lanzan la misma excepción con distinto nombre; se atrapan juntas.
_INVALIDOS = (
    ArmadoArcoInvalido,
    ArmadoColumnaInvalido,
    ArmadoColumnaOrganicaInvalido,
    ArmadoGuirnaldaInvalido,
    #: Un id de forma lista o de estilo que el motor no publica. Lleva ``motivo`` y ``mensaje`` como las
    #: puertas, así que sale por el mismo error estable de la frontera y el modelo puede corregirlo.
    FormaListaDesconocida,
)


def _rechazo(
    error: (
        ArmadoArcoInvalido | ArmadoColumnaInvalido | ArmadoGuirnaldaInvalido | FormaListaDesconocida
    ),
    estructura_id: str | None,
) -> PlanResolutionError:
    """Lo que dijo la puerta del motor, traducido al error estable de la frontera."""
    return _motivo(error.motivo, error.mensaje, estructura_id)


def armar(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """Un armado concreto, validado por la puerta del motor y resuelto para decir qué lleva de verdad."""
    pieza = cast(PiezaArmado, request.pieza)
    avisos: list[str] = []
    if pieza.tipo == "semiarco":
        # ``armar`` es la acción del **patrón**: el modelo elige uno y mueve sus mandos. Ninguna pieza
        # orgánica pasa por aquí (ni la columna ni la guirnalda del motor, ni el arco que el plan declara
        # orgánico), y un medio arco solo tiene ese motor, así que esta acción lo dice en vez de armarle otra
        # pieza. Su armado lo pone ``completar``, que es por donde entra de verdad.
        raise _motivo(
            "sin_armado_a_mano",
            "Un medio arco solo lo arma el motor organico: su armado lo pone la accion completar.",
            request.estructura_id,
        )
    if pieza.tipo == "guirnalda":
        paleta = cast("list[ColorPedido]", request.paleta)
        materiales = [color.material for color in paleta]
    else:
        paleta = []
        materiales = cast("list[int]", request.materiales)
    fuera = [indice for indice in materiales if indice >= pieza.colores]
    if fuera:
        # Un índice que la pieza no tiene se rechaza aquí y no en el plan: es el único dato de la pieza que el
        # modelo no puede comprobar solo, y llega como `colores`.
        raise _motivo(
            "material_fuera_de_rango",
            f"La pieza lleva {pieza.colores} colores y el armado nombra el indice {fuera[0]}.",
            request.estructura_id,
        )
    patron = cast(str, request.patron) if pieza.tipo != "guirnalda" else ""
    try:
        if pieza.tipo == "arco":
            armado = _armado_arco(
                pieza, patron, materiales, request.opciones, request.geometria, avisos
            )
            resuelto = armado_arco_resuelto(_estructura_arco(pieza.colores), armado)
            resumen = _resumen_arco(resuelto)
        elif pieza.tipo == "columna":
            armado = _armado_columna(
                pieza,
                patron,
                materiales,
                request.opciones,
                request.geometria,
                request.remate,
                avisos,
            )
            resuelto = cast(
                "dict[str, Any]",
                armado_columna_resuelto(_estructura_columna(pieza.colores), armado),
            )
            resumen = _resumen_columna(resuelto)
        else:
            armado = _armado_guirnalda(pieza, paleta, request, avisos)
            resuelto = armado_guirnalda_resuelto(_estructura_guirnalda(pieza.colores), armado)
            resumen = _resumen_guirnalda(resuelto)
    except _INVALIDOS as error:
        raise _rechazo(error, request.estructura_id) from None
    return {
        "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
        "accion": "armar",
        "tipo": pieza.tipo,
        **({"estructura_id": request.estructura_id} if request.estructura_id is not None else {}),
        "armado": armado,
        "resumen": resumen,
        "avisos": [*avisos, *cast("list[str]", resuelto["avisos"])],
    }


# ---------------------------------------------------------------------------
# Completar: ningún arco ni ninguna columna del plan se queda sin armado
# ---------------------------------------------------------------------------


def _pieza_del_plan(
    estructura: Mapping[str, Any], mezcla_leida: str | None = None
) -> PiezaArmado | None:
    """La pieza vista desde su estructura del plan, o nada si no tiene motor o no lleva materiales.

    ``mezcla_leida`` es la mezcla que la foto pide para esta pieza, cuando la foto lo dijo. Manda sobre la
    que el plan declara por la misma razón que en ``plan.py``: la mezcla declarada la eligió la IA que armó
    el plan desde la descripción, sin ver la foto. Decide además **qué motor** arma la pieza, así que tiene
    que entrar aquí y no más abajo.
    """
    tipo = estructura.get("tipo")
    if tipo not in TIPOS_CON_MOTOR:
        return None
    # Y el tipo no basta: un aro circular se construye con tipo `arco` y un techo de globos con `guirnalda`,
    # pero ningún motor hace un aro ni un techo. La regla sale de la tabla de oficiales y no de una lista
    # escrita aquí: una oficial de forma `circular` o `libre` no es una forma que un motor produzca
    # (`plan.OFICIALES_SIN_MOTOR`). Sin esto, la receta les ponía el armado de un arco o de una guirnalda y la
    # pieza quedaba contada y dibujada con otra forma; lo que necesitan es su fórmula, que ya las cuenta, y el
    # dibujo esquemático de `app/dibujo_estructura.py`.
    if estructura.get("estructura_oficial") in OFICIALES_SIN_MOTOR:
        return None
    materiales = estructura.get("materiales")
    if (
        not isinstance(materiales, Sequence)
        or isinstance(materiales, (str, bytes))
        or not materiales
    ):
        return None
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    cuantos = min(len(materiales), MAX_INDICE_MATERIAL + 1)
    crudos = cast(Sequence[Mapping[str, object]], materiales)[:cuantos]
    # La participación y el acabado que el plan declara de cada material los lee **la paleta**, que es lo que
    # tienen las piezas del motor orgánico: la guirnalda siempre, y la columna y el arco cuando el plan los
    # declara orgánicos. El patrón del arco y de la columna clásicos no tiene paleta —reparte por bandas y
    # anillos—, así que por esa rama no se arrastran.
    #
    # Iban solo por la guirnalda y eso le costaba su acabado a las dos piezas orgánicas nuevas: una columna
    # de dorado CROMADO salía con la paleta en mate y con pesos iguales, porque `_acabado_del_material` y
    # `_peso_de` no encontraban nada que leer y caían a su valor por defecto (2026-10-03). El cromado está en
    # los cuatro acabados del motor: no era que no lo supiera pintar, era que no se lo decían.
    mezcla_declarada = mezcla_leida or estructura.get("mezcla")
    # Una guirnalda **clásica** no es de este motor: «Racimos de cuatro globos iguales en línea» (clasificador,
    # ``referencias/variantes.ts``) es el armado por partes de ADR-0032 (``armado_guirnalda``), que cuenta y
    # dibuja la resolución (``plan.vista_previa_de_armado_guirnalda``, la misma que pinta la guía en
    # ``guia_piezas/clasica.py``). Armarla con el orgánico la cobraba y dibujaba con tamaños mezclados.
    if tipo == "guirnalda" and mezcla_declarada == "clasica":
        return None
    asimetrica = estructura.get("estructura_oficial") in OFICIALES_ASIMETRICAS
    densidad = estructura.get("densidad")
    pesos = [_numero(m.get("participacion")) or 0.0 for m in crudos]
    de_paleta: dict[str, Any] = (
        {
            "pesos": pesos,
            "acabados": [
                m.get("acabado") if isinstance(m.get("acabado"), str) else None for m in crudos
            ],
        }
        # Un `semiarco` va por la rama orgánica **sin mirar la mezcla**: su único motor es el de racimos, y
        # su paleta es la única que puede llevar el acabado y la participación que el plan declara.
        if tipo in ("guirnalda", "semiarco")
        or (
            tipo in ("columna", "arco")
            and isinstance(mezcla_declarada, str)
            and mezcla_declarada in MEZCLAS_ORGANICAS
        )
        # Un arco y una columna asimétricos van siempre por el orgánico (``_receta``), así que llevan su paleta.
        or (tipo in ("arco", "columna") and asimetrica)
        # El arco y la columna clásicos llevan solo los pesos: su patrón no tiene paleta, pero el color que el
        # plan declara dominante tiene que ser el primero del patrón (auditoría 2026-10-04, M4), que es el que
        # el motor más reparte. El acabado sigue sin viajar por esta rama.
        else ({"pesos": pesos} if any(peso > 0 for peso in pesos) else {})
    )
    return PiezaArmado(
        tipo=cast(Tipo, tipo),
        colores=cuantos,
        ancho_m=_numero(medidas.get("ancho_m")),
        alto_m=_numero(medidas.get("alto_m")),
        largo_m=_numero(medidas.get("largo_m")),
        mezcla=mezcla_declarada if isinstance(mezcla_declarada, str) else None,
        # El color de cada material viaja siempre: es lo único con lo que la lectura de la foto, que nombra
        # colores y no índices, se puede poner sobre esta pieza (ADR-0039).
        tonos=[m.get("color") if isinstance(m.get("color"), str) else None for m in crudos],
        densidad=densidad if densidad in ("sencilla", "media", "lujosa") else None,
        asimetrica=asimetrica,
        espejo=tipo == "semiarco" and estructura.get("ubicacion") == "lateral_derecho",
        linea=_linea_por_partes(estructura) if tipo == "guirnalda" else None,
        **de_paleta,
    )


def _linea_por_partes(estructura: Mapping[str, Any]) -> dict[str, float] | None:
    """La línea del motor para el ``armado_guirnalda`` (ADR-0032) que la guirnalda ya trae, o ``None``."""
    por_partes = estructura.get("armado_guirnalda")
    if not isinstance(por_partes, Mapping):
        return None
    linea: dict[str, float] = linea_guirnalda_del_motor(cast(Mapping[str, object], por_partes))
    return linea


#: El campo del plan que le toca a cada armado **orgánico**, que son los que no se deducen del tipo: una
#: columna orgánica es una columna y un arco orgánico es un arco, pero su armado vive en su propio campo.
_CLAVE_POR_VERSION: Mapping[str, str] = {
    VERSION_ARMADO_COLUMNA_ORGANICA: "armado_columna_organica",
    VERSION_ARMADO_ARCO_ORGANICO: "armado_arco_organico",
}


def _valida(pieza: PiezaArmado, armado: Mapping[str, Any]) -> str | None:
    """``None`` si el armado se sostiene contra la pieza; si no, el motivo estable del motor.

    Quien decide la puerta es la **versión del armado**, no solo el tipo de la pieza: una columna puede traer
    el clásico (anillos) o el orgánico (racimos), y cada uno lo valida su propio motor.

    Un ``semiarco`` pasa por la puerta orgánica como un arco (es la misma pieza con ``forma.corte`` menor que
    1) y por la clásica con ``es_arco=False``, que es lo que la hace responder ``no_es_arco``: su único motor
    es el de racimos y el de patrones no sabe cortar la banda por la mitad.
    """
    try:
        if armado.get("version") == VERSION_ARMADO_COLUMNA_ORGANICA:
            validar_columna_organica(
                EstructuraColumnaOrganica(
                    es_columna=pieza.tipo == "columna",
                    materiales=[f"#{i + 1:06x}" for i in range(pieza.colores)],
                ),
                armado,
            )
        elif armado.get("version") == VERSION_ARMADO_ARCO_ORGANICO:
            validar_arco_organico(
                EstructuraArcoOrganico(
                    es_arco=pieza.tipo in ("arco", "semiarco"),
                    materiales=[f"#{i + 1:06x}" for i in range(pieza.colores)],
                ),
                armado,
            )
            if pieza.tipo == "semiarco":
                return _semiarco_fuera_del_plan(pieza, armado)
        elif pieza.tipo in ("arco", "semiarco"):
            validar_arco(_estructura_arco(pieza.colores, es_arco=pieza.tipo == "arco"), armado)
        elif pieza.tipo == "columna":
            validar_columna(_estructura_columna(pieza.colores), armado)
        else:
            validar_guirnalda(_estructura_guirnalda(pieza.colores), armado)
    except _INVALIDOS as error:
        return str(error.motivo)
    return None


def _semiarco_fuera_del_plan(pieza: PiezaArmado, armado: Mapping[str, Any]) -> str | None:
    """Por qué un armado orgánico válido **no es el semiarco del plan**, o ``None`` si lo es.

    La puerta del motor acepta un arco completo en un ``semiarco`` (es el mismo contrato), y así salía: un
    «Semiarco orgánico derecho» de 1,2 × 2,2 m se quedaba con un arco de dos patas de 3,68 × 2,61 m (2026-10-04).
    Un medio arco tiene ``corte`` menor que 1 y mide lo que el plan dice: el alto con un 15 % de holgura y el
    ancho que se ve con un 25 % (o el más angosto que el motor sabe cortar, si el plan pide menos).
    """
    forma = cast(Mapping[str, Any], armado["forma"])
    if float(forma.get("corte", 1)) >= 1:
        return "no_es_medio_arco"
    if pieza.alto_m and abs(float(forma["altoM"]) - pieza.alto_m) > 0.15 * pieza.alto_m:
        return "medidas_del_plan"
    if pieza.ancho_m:
        inicial = config_inicial_arco_organico()
        cfg = {
            **inicial,
            "forma": {**inicial["forma"], **forma},
            "volumen": {**inicial["volumen"], **cast(Mapping[str, Any], armado["volumen"])},
            # La mezcla no mueve la línea guía, y el contrato la trae con claves de texto: va la del motor.
            "tamanos": {
                **inicial["tamanos"],
                **{
                    clave: valor
                    for clave, valor in cast(Mapping[str, Any], armado["tamanos"]).items()
                    if clave != "mezcla"
                },
            },
        }
        visible = _ancho_visible_del_medio(cfg, float(forma["anchoM"]))
        objetivo = max(pieza.ancho_m, _ancho_visible_del_medio(cfg, ARCO_ORGANICO_ANCHO_MIN))
        if not pieza.ancho_m * 0.75 <= visible <= objetivo * 1.25:
            return "medidas_del_plan"
    return None


def armado_semiarco_de_receta(estructura: Mapping[str, Any]) -> dict[str, Any] | None:
    """El ``armado-arco-organico.v1`` de la receta para un ``semiarco`` que no trae el suyo.

    El mismo medio arco que ``completar`` le escribe al confirmar sin lecturas (forma lista de medio arco, del
    lado de su ubicación, con el ancho que se ve y el alto del plan y su densidad), para que la resolución y la
    guía no lo dejen en la fórmula y en ``sin_dibujo`` cuando la confirmación no lo armó. También es la receta
    a la que vuelve el editor (``plan_armado_arco_organico._receta``). ``None`` si no es un semiarco, ya trae
    ``armado_arco_organico`` o no es pieza del motor. Puro y determinista.
    """
    if estructura.get("tipo") != "semiarco" or isinstance(
        estructura.get("armado_arco_organico"), Mapping
    ):
        return None
    pieza = _pieza_del_plan(estructura)
    if pieza is None or pieza.tipo != "semiarco":
        return None
    armado = _receta(pieza, [])
    if _valida(pieza, armado) is not None:
        return None
    return armado


def completar(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """El armado de cada arco y cada columna del plan: el del modelo si se sostiene, y si no la receta.

    Lo que el modelo armó durante el turno llega en ``armados``, y lo que escribió directamente en el plan
    llega dentro de la estructura. Las dos cosas se vuelven a validar aquí **contra la pieza de verdad**: es el
    único momento en el que se sabe cuántos materiales tiene y, por tanto, si un índice existe. Lo que no se
    sostiene se reemplaza por la receta con su motivo, nunca se cuela.
    """
    plan = cast("dict[str, Any]", request.plan)
    estructuras = plan.get("estructuras")
    if not isinstance(estructuras, Sequence) or isinstance(estructuras, (str, bytes)):
        raise PlanResolutionError("invalid_plan", 422)
    propuestos = {propuesto.estructura_id: propuesto for propuesto in (request.armados or [])}
    # Una pista por elemento de la referencia: la aplica cada estructura que materializa ese elemento, que es
    # la misma regla que `pistas_patron` en la resolución (ADR-0028 §7).
    pistas = {
        pista.referencia_element_id: pista.model_dump(exclude_none=True) for pista in request.pistas
    }
    remates = {
        lectura.referencia_element_id: lectura.model_dump(exclude_none=True)
        for lectura in request.remates
    }
    inclinaciones = {
        lectura.referencia_element_id: lectura.inclinacion for lectura in request.inclinaciones
    }
    # La línea de cada guirnalda en el vocabulario de la lectura: la traduce la receta, con el largo de la pieza.
    lineas = {
        lectura.referencia_element_id: _lectura_de_la_curva(lectura) for lectura in request.curvas
    }
    tamanos_leidos = {
        lectura.referencia_element_id: lectura.model_dump(exclude_none=True)
        for lectura in request.tamanos_leidos
    }
    salida: list[dict[str, Any]] = []
    for cruda in cast(Sequence[object], estructuras)[:MAX_ESTRUCTURAS]:
        if not isinstance(cruda, Mapping):
            continue
        estructura = cast(Mapping[str, Any], cruda)
        elemento = estructura.get("referencia_element_id")
        del_elemento = elemento if isinstance(elemento, str) else None
        # La mezcla que pide la foto se resuelve ANTES de mirar la pieza: decide qué motor la arma. Lo que
        # la lectura no se pueda honrar ya lo dice `mezcla_del_motor` en estos avisos, que viajan con el
        # armado; que haya cambiado la mezcla lo dice el supuesto que escribe la resolución, una sola vez.
        avisos_de_la_foto: list[str] = []
        mezcla_leida = mezcla_del_motor(
            tamanos_leidos.get(del_elemento) if del_elemento else None, avisos_de_la_foto
        )
        pieza = _pieza_del_plan(estructura, mezcla_leida)
        if pieza is None:
            continue
        estructura_id = estructura.get("estructura_id")
        if not isinstance(estructura_id, str) or not estructura_id:
            continue
        # El campo del plan de ESTE tipo. En una guirnalda es `armado_guirnalda_organica`: el
        # `armado_guirnalda` de ADR-0032 es otro contrato, con su propio dueño, y esta operación no lo lee ni
        # lo escribe nunca —una pieza puede traer los dos y entonces manda el del motor—.
        clave = CLAVE_ARMADO[pieza.tipo]
        candidatos: list[tuple[str, Mapping[str, Any]]] = []
        del_plan = estructura.get(clave)
        if isinstance(del_plan, Mapping):
            candidatos.append(("plan", cast(Mapping[str, Any], del_plan)))
        propuesto = propuestos.get(estructura_id)
        if propuesto is not None and propuesto.tipo == pieza.tipo:
            candidatos.append(("herramienta", propuesto.armado))
        elegido: dict[str, Any] | None = None
        avisos: list[str] = list(avisos_de_la_foto)
        for procedencia, candidato in candidatos:
            motivo = _valida(pieza, candidato)
            if motivo is None:
                elegido = dict(candidato)
                break
            avisos.append(
                f"El armado que venia de la {procedencia} no se sostiene ({motivo}); va la receta."
            )
        origen = "modelo"
        pista = pistas.get(del_elemento) if del_elemento else None
        if elegido is None and pista is None:
            # Sin lectura de la foto, el patrón que el propio plan declara es la pista, igual que en la resolución
            # (``plan._armado_del_motor`` → ``armado_arco_de_patron``): sin esto, la confirmación armaba por el
            # número de colores y escribía en el plan un arco distinto del que la resolución cuenta y la rejilla
            # de patrón enseña. Es la misma función, así que las dos dan el mismo armado.
            elegido = _armado_del_patron_declarado(estructura, pieza)
            if elegido is not None:
                origen = "referencia"
        if elegido is None:
            origen = "receta"
            ubicacion = estructura.get("ubicacion")
            elegido = _receta(
                pieza,
                avisos,
                pista,
                remates.get(del_elemento) if del_elemento else None,
                inclinaciones.get(del_elemento) if del_elemento else None,
                lineas.get(del_elemento) if del_elemento else None,
                # Dónde apoya la pieza según el plan, con la tabla del armado por partes. Solo cuenta si la
                # pieza trae alguna lectura de la foto (``_receta``).
                SOPORTE_POR_UBICACION.get(ubicacion) if isinstance(ubicacion, str) else None,
            )
            # La receta dice en el propio armado si describe la foto; el origen de la respuesta lo refleja
            # para que el registro de la confirmación distinga las dos ramas (ADR-0039).
            if elegido.get("origen") == "referencia":
                origen = "referencia"
            motivo = _valida(pieza, elegido)
            if motivo is not None:  # pragma: no cover - la receta del motor siempre se sostiene
                raise PlanResolutionError(
                    "armado_invalido", 422, {"estructura_id": estructura_id, "motivo": motivo}
                )
        salida.append(
            {
                "estructura_id": estructura_id,
                "tipo": pieza.tipo,
                # El campo del plan lo decide la versión del armado que de verdad se eligió: una columna
                # orgánica es una columna, pero su armado vive en `armado_columna_organica`.
                "clave": _CLAVE_POR_VERSION.get(cast(str, elegido.get("version") or ""), clave),
                "origen": origen,
                "armado": elegido,
                "avisos": avisos,
            }
        )
    return {
        "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
        "accion": "completar",
        "armados": salida,
    }


#: El elemento de la referencia con el que el patrón del plan viaja como pista hasta la receta del arco. No es
#: un elemento de ninguna foto: solo casa la pista con su pieza dentro de ``completar``.
_ELEMENTO_DEL_PATRON = "patron-del-plan"


def _nombre_testigo(indice: int) -> str:
    return f"material-{indice}"


def _armado_del_patron_declarado(
    estructura: Mapping[str, Any], pieza: PiezaArmado
) -> dict[str, Any] | None:
    """El armado de un arco clásico con el ``patron_color`` del plan como pista, o ``None`` si no le toca.

    Solo un arco que la receta arma con el motor de patrones: la mezcla de la pieza (la leída de la foto si la
    hubo) decide, igual que en ``_receta``, y un arco asimétrico es del orgánico. Los armados que la pieza
    trae y no se sostuvieron se quitan: ``armado_arco_de_patron`` no arma una pieza que ya trae el suyo.
    """
    if pieza.tipo != "arco" or pieza.mezcla in MEZCLAS_ORGANICAS or pieza.asimetrica:
        return None
    sin_armados = {
        clave: valor
        for clave, valor in estructura.items()
        if clave not in ("armado_arco", "armado_arco_organico")
    }
    if pieza.mezcla is not None:
        sin_armados["mezcla"] = pieza.mezcla
    return armado_arco_de_patron(sin_armados)


def armado_arco_de_patron(estructura: Mapping[str, Any]) -> dict[str, Any] | None:
    """El ``armado-arco.v1`` de un arco clásico que trae ``patron_color`` y ningún armado; ``None`` si no lo es.

    Un arco así lo arma **la receta del motor del arco clásico** (``completar``), con el patrón del plan como
    pista: la traducción de un modo de ``patron-color.v1`` a un patrón del motor es de
    ``patron_de_la_foto.patron_del_motor``, la misma que sigue una lectura de la foto. Es lo que
    ``plan._armado_del_motor`` usa para que la resolución cuente estos arcos con el motor y no con la fórmula
    (antes un arco de 3 × 2,4 m se cotizaba con 132 globos y el motor le coloca 88): la cotización, la lista
    de materiales, la hoja de armado y la guía de escena salen así del mismo armado.

    Qué arco es: ``tipo`` ``arco`` con una mezcla clásica o sin mezcla (la mezcla orgánica lo arma el otro
    motor), con ``patron_color`` y sin ``armado_arco`` ni ``armado_arco_organico``. Un aro u otra oficial sin
    motor no tiene receta (``_pieza_del_plan``), y un ``arco_asimetrico`` tampoco es de este motor. La densidad
    de la pieza sí entra: decide los globos a lo ancho (``_globos_ancho_por_densidad``).

    Los colores de la pista son nombres testigo por índice, así que dos materiales del mismo color no se
    confunden; los colores de verdad no los mira el motor del arco al armar. Puro y determinista.
    """
    patron = estructura.get("patron_color")
    if (
        estructura.get("tipo") != "arco"
        or estructura.get("mezcla") in MEZCLAS_ORGANICAS
        # Un arco asimétrico lo arma el orgánico (``FORMA_ARCO_ASIMETRICO``), no el de patrones.
        or estructura.get("estructura_oficial") in OFICIALES_ASIMETRICAS
        or not isinstance(patron, Mapping)
        or isinstance(estructura.get("armado_arco"), Mapping)
        or isinstance(estructura.get("armado_arco_organico"), Mapping)
    ):
        return None
    crudos = estructura.get("materiales")
    materiales = (
        [m for m in crudos if isinstance(m, Mapping)]
        if isinstance(crudos, Sequence) and not isinstance(crudos, (str, bytes))
        else []
    )
    try:
        indices = cast(Sequence[int], _indices_base(_leer(patron)))
    except ValueError:
        # Un patrón que no cumple su contrato lo rechaza la resolución con ``patron_invalido``; aquí no hay
        # pista que dar.
        return None
    orden = list(dict.fromkeys(i for i in indices if 0 <= i < len(materiales)))
    if not orden:
        return None
    pista: dict[str, object] = {
        "referencia_element_id": _ELEMENTO_DEL_PATRON,
        "modo": cast(Mapping[str, object], patron["base"])["modo"],
        "colores": [_nombre_testigo(i) for i in orden][:12],
        "confianza": 1.0,
    }
    for campo in ("globos_por_racimo", "direccion", "simetria"):
        if patron.get(campo) is not None:
            pista[campo] = patron[campo]
    copia = {
        **estructura,
        "referencia_element_id": _ELEMENTO_DEL_PATRON,
        "materiales": [
            {**material, "color": _nombre_testigo(i)} for i, material in enumerate(materiales)
        ],
    }
    peticion = ArmadoEstructuraRequest.model_construct(
        schema_version=OMOIKANE_ARMADO_SCHEMA_VERSION,
        accion="completar",
        plan={"estructuras": [copia]},
        armados=None,
        pistas=[PistaPatron.model_validate(pista)],
        remates=[],
        inclinaciones=[],
        curvas=[],
        tamanos_leidos=[],
    )
    armados = cast(Sequence[Mapping[str, Any]], completar(peticion)["armados"])
    if not armados or armados[0]["clave"] != CLAVE_ARMADO["arco"]:
        return None
    return dict(cast(Mapping[str, Any], armados[0]["armado"]))


def armado_arco_de_receta(estructura: Mapping[str, Any]) -> dict[str, Any] | None:
    """El ``armado-arco.v1`` de un arco clásico que no trae armado, **con o sin** ``patron_color``.

    Con patrón es ``armado_arco_de_patron`` (el patrón del plan como pista). Sin patrón es lo que ``completar``
    le escribe al confirmar cuando no hay lectura de la foto: la receta del motor del arco clásico por número
    de colores (``_receta`` sin pista). Antes este arco se quedaba fuera de los dos caminos: la resolución lo
    cobraba con la fórmula y la guía de escena lo omitía (``sin_dibujo``), mientras uno con patrón se contaba
    y se dibujaba con el motor. Así la cotización, los materiales, la hoja de armado y la guía salen del mismo
    armado en los dos casos. La densidad de la pieza entra igual que allí (``_globos_ancho_por_densidad``).

    ``None`` si no le toca: no es un arco, ya trae ``armado_arco`` o ``armado_arco_organico``, su mezcla es
    orgánica o es un ``arco_asimetrico`` (los arma el otro motor solo con su armado; sin él, la fórmula), o no
    es pieza del motor (un aro circular, una pieza sin materiales: ``_pieza_del_plan``). Puro y determinista.
    """
    if isinstance(estructura.get("patron_color"), Mapping):
        return armado_arco_de_patron(estructura)
    if (
        estructura.get("tipo") != "arco"
        or estructura.get("mezcla") in MEZCLAS_ORGANICAS
        or estructura.get("estructura_oficial") in OFICIALES_ASIMETRICAS
        or isinstance(estructura.get("armado_arco"), Mapping)
        or isinstance(estructura.get("armado_arco_organico"), Mapping)
    ):
        return None
    pieza = _pieza_del_plan(estructura)
    if pieza is None or pieza.tipo != "arco":
        return None
    armado = _receta(pieza, [])
    if armado.get("version") != VERSION_ARMADO_ARCO or _valida(pieza, armado) is not None:
        return None
    return armado


def armado_guirnalda_de_receta(estructura: Mapping[str, Any]) -> dict[str, Any] | None:
    """El ``armado-guirnalda-organica.v1`` de la receta para una guirnalda orgánica que no trae el suyo.

    Es lo que ``completar`` le escribe al confirmar (sin lecturas de la foto), para que la resolución cuente
    y la guía dibuje la misma guirnalda cuando la confirmación no la armó: la bandera del motor apagada, o
    Python no disponible y ``sinArmadosDeMotor`` quitó el armado. Sin esto la pieza se cobraba con la fórmula
    y la guía se quedaba en ``sin_dibujo``. Es el gemelo de ``armado_arco_de_receta``.

    ``None`` si no le toca: no es una guirnalda, ya trae ``armado_guirnalda_organica``, no es pieza del motor
    (la clásica, el techo, sin materiales: ``_pieza_del_plan``) o la receta pasaría del tope de globos que la
    resolución arma (``demasiado_grande``), y entonces se queda con su fórmula como antes. Puro y determinista.
    """
    if estructura.get("tipo") != "guirnalda" or isinstance(
        estructura.get("armado_guirnalda_organica"), Mapping
    ):
        return None
    pieza = _pieza_del_plan(estructura)
    if pieza is None:
        return None
    armado = _receta(pieza, [])
    if (
        _valida(pieza, armado) is not None
        or globos_estimados_guirnalda(armado) > GUIRNALDA_MAX_GLOBOS
    ):
        return None
    return armado


def resolver_armado_estructura(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """La puerta de la operación: despacha la acción. CPU puro, sin catálogo y sin efecto."""
    if request.accion == "catalogo":
        tipo = cast(str, request.tipo)
        return {
            "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
            "accion": "catalogo",
            "tipo": tipo,
            "opciones": catalogo_de(tipo),
        }
    if request.accion == "armar":
        return armar(request)
    return completar(request)


__all__ = [
    "CLAVE_ARMADO",
    "FORMA_SEMIARCO",
    "MAX_ESTRUCTURAS",
    "MAX_MATERIALES",
    "OMOIKANE_ARMADO_RESULT_VERSION",
    "OMOIKANE_ARMADO_SCHEMA_VERSION",
    "OMOIKANE_ARMADO_SCOPE",
    "TIPOS_CON_MOTOR",
    "VERSION_ARMADO_GUIRNALDA_ORGANICA",
    "AdornosPedidos",
    "ArmadoEstructuraRequest",
    "ArmadoPropuesto",
    "ColorPedido",
    "FormaPedida",
    "GeometriaPedida",
    "PesoTamano",
    "PiezaArmado",
    "RematePedido",
    "VolumenPedido",
    "armado_arco_de_patron",
    "armado_guirnalda_de_receta",
    "armado_arco_de_receta",
    "armar",
    "catalogo_de",
    "completar",
    "resolver_armado_estructura",
]
