"""Arco orgánico: el motor, migrado 1 a 1 desde ``clasificador-decoraciones``.

Un arco orgánico es una banda irregular de globos de varios tamaños que sube por una pata, corre por la cima y
baja por la otra, con racimos que se solapan, globos que se salen de la banda, follaje y flores. No es la
rejilla de patrones de ``armado_arco.py`` (sólido, espiral, chevrón…): el motor coloca cada globo con una
relajación que los separa hasta que dejan de pisarse, y de ahí salen el conteo, la compra y el dibujo.

**Un medio arco es este armado con ``forma.corte`` menor que 1** (y ``espejo`` para el que sube por el otro
lado): la taxonomía retiró ``semiarco`` porque todo medio arco es orgánico.

**La fuente de verdad es el repo ``clasificador-decoraciones``**: ``src/lib/organico/`` es el motor del arco
orgánico —su diseñador es ``/arcos-organicos``, y el encabezado de ``formas.ts`` dice literalmente «Formas
listas: la disposición de un arco orgánico»—, migrado a ``app/organico/``. La columna y la guirnalda orgánicas
usan el mismo motor con su propia línea guía; el arco usa la de casa (``app.organico.espina``), así que aquí no
hace falta ningún envoltorio: ``generar`` ya es el arco.

Este módulo es su puerta: traduce entre el vocabulario del plan (índices de material) y el del motor (una
paleta de colores con su acabado).

**Convive con ``armado-arco.v1``, no lo reemplaza.** Aquel describe el arco clásico de patrones, con sus capas
y secciones; este, el orgánico. Cuando una pieza trae los dos, manda el clásico: es el que ya existía, como la
columna clásica sobre la orgánica.

Como la guirnalda y la columna orgánicas y a diferencia del arco clásico, **aquí no hacen falta colores
testigo**: el motor orgánico ya guarda en cada globo el índice de su color dentro de la paleta
(``GloboOrg.indice``), así que dos materiales del mismo tono no se confunden sin tener que engañar al motor.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast

from jsonschema import Draft7Validator

from app.armado_validacion import MENSAJE_NO_FINITO, MOTIVO_NO_FINITO, hay_numero_no_finito
from app.generated_models import contract_schema
from app.merma import MERMA
from app.organico.config import normalizar_config_con_cambios
from app.organico.dibujo import svg_documento
from app.organico.formas import FORMAS_LISTAS
from app.organico.limites import (
    ANCHO_MAX,
    ANCHO_MIN,
    ALTO_MAX,
    GROSOR_MIN,
    GROSOR_TOPE,
    limites,
    tamanos_permitidos,
)
from app.organico.medidas import calcular_compra, calcular_medidas
from app.organico.motor import LIENZO, MAX_GLOBOS, estimar_globos, generar
from app.organico.tipos import ACABADOS, ESTILOS, REPARTOS, TAMANOS_GLOBO, ConfigOrg, config_inicial
from app.organico.unir import unir_compra, unir_conteo

VERSION = "armado-arco-organico.v1"

#: Hasta cuántos colores admite un arco. Es el tope de la paleta del motor.
MAX_MATERIALES = 8

#: Margen de compra cuando quien llama no dice otro: el del plan (``app/merma.py``). El diseñador orgánico abre
#: con 0,12 (``REAL_INICIAL``, dentro de los vectores de oro), pero ninguna llamada de la aplicación lo usa: el
#: margen es política de compra del plan y una vista previa con otro número daría una compra distinta de la que
#: se cobra.
DESPERDICIO_POR_DEFECTO = MERMA

#: Los papeles que puede tener un color: uno normal, o un acento repartido suelto entre los demás.
ROLES = ("normal", "acento")

#: Hasta cuántos globos **estimados** (antes de colocarlos) arma un arco orgánico. Colocar es una relajación de
#: colisiones y su coste crece más que lineal con los globos: medido en esta máquina (una sola hebra, Python
#: 3.11), 113 globos reales en 0,3 s, 273 en 1,0 s, 589 en 3,4 s, 900 en 7,0–9,7 s. El plazo de la edición es de
#: 5 s y el hilo no se cancela cuando vence, así que lo que pasa de aquí se rechaza con su frase en vez de dejar
#: el hilo ocupado ~10 s detrás de una petición que ya dio por perdida. El tope no puede bajar de 485: es lo que
#: estima «Arco de entrada lleno», una de las formas listas que el motor publica, y una forma lista que la
#: puerta rechaza no sería una forma lista. La estimación del motor (``estimar_globos``) es la misma con la que
#: ``sanear`` baja el relleno: sale sin colocar nada.
MAX_GLOBOS_ESTIMADOS = 500

#: Los globos que publica el contrato por arco. El motor ya no coloca más (``sanear`` baja el relleno hasta que
#: la estimación cabe), pero la estimación no es el conteo: se comprueba después de colocar.
MAX_GLOBOS_PUBLICADOS = MAX_GLOBOS


def _alto_minimo_absoluto() -> float:
    """El alto más bajo que el motor admite en cualquier arco: el del más estrecho y delgado posible.

    Sale de ``limites`` y no de un número escrito aquí: el motor lo aplica dentro de un ``max(1, …)`` sin
    publicarlo como constante, y copiarlo haría de esta puerta un segundo dueño de ese límite.
    """
    base = config_inicial()
    cfg = {
        **base,
        "forma": {**base["forma"], "anchoM": ANCHO_MIN},
        "volumen": {**base["volumen"], "grosorCimaM": GROSOR_MIN},
    }
    return float(limites(cast(ConfigOrg, cfg))["altoMin"])


#: Alto mínimo (m) de cualquier arco. El vivo, con el armado puesto, lo da ``limites_de``.
ALTO_MIN = _alto_minimo_absoluto()


class ArmadoInvalido(ValueError):
    """Un armado de arco orgánico que no se puede armar o no corresponde a la pieza."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


def avisos_colores_sin_uso(nombres: Sequence[str], usados: Sequence[int]) -> list[str]:
    """Qué colores de la pieza la paleta del armado no toma, para decirlo antes de que se guarde.

    Un color de la pieza que ningún globo del arco usa no se compra, pero sigue en el plan con su
    participación: el plan dice una cosa y la compra otra. No es un armado inválido (un arco de un solo color
    sobre una pieza de dos es lo que pidió el decorador), así que no se rechaza: se avisa, con qué hacer.
    ``nombres`` son los colores de la pieza en su orden (el de ``materiales``); ``usados``, los índices de
    ``armado.colores.paleta[].material``. Es el gemelo de ``armado_arco.avisos_colores_sin_uso``.
    """
    tomados = set(usados)
    return [
        f"El arco no usa el color {nombre.capitalize() if nombre else 'sin nombre'} de la pieza: no se "
        "comprarán globos de ese color. Agrégalo a la paleta o quítalo de la pieza."
        for indice, nombre in enumerate(nombres)
        if indice not in tomados
    ]


def indices_usados(armado: Mapping[str, object]) -> list[int]:
    """Los índices de material que usa el armado: los de su paleta. El arco no tiene remate."""
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    return [int(cast(int, color["material"])) for color in paleta]


@dataclass(frozen=True)
class EstructuraArcoOrganico:
    """La pieza del plan que lleva el armado, con lo poco que el motor necesita de ella."""

    es_arco: bool
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


_ESQUEMA_ARMADO: Mapping[str, object] = cast(
    Mapping[str, object],
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_arco_organico"
    ],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)


def _validar_forma(armado: Mapping[str, object]) -> None:
    """Comprueba la forma contra el esquema publicado de ``armado-arco-organico.v1``.

    La forma la valida el contrato, no una lista de comprobaciones a mano: se exporta desde el Zod de
    ``src/lib/plan/armado-arco-organico.ts`` y repetirlo aquí sería un segundo dueño que se desincroniza en
    silencio. Lo que queda en este módulo son las reglas que un esquema no puede expresar —que cada índice de
    material exista en la pieza, que la mezcla nombre algún tamaño, que el arco quepa en el tope de globos—,
    que son las que sí son suyas.
    """
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido("forma_invalida", f"El armado no tiene la forma de {VERSION}.")


def validar(estructura: EstructuraArcoOrganico, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la pieza. Lanza ``ArmadoInvalido`` si no se sostiene."""
    if not estructura.es_arco:
        raise ArmadoInvalido(
            "no_es_arco", "Solo un arco se arma como una banda orgánica de racimos."
        )
    if hay_numero_no_finito(armado):
        raise ArmadoInvalido(MOTIVO_NO_FINITO, MENSAJE_NO_FINITO)
    _validar_forma(armado)
    # Lo que el esquema no puede decir: «al menos un tamaño». Todas las claves de la mezcla son opcionales
    # —un arco nombra los tamaños que usa y no más—, así que un `{}` pasa la forma y no es una mezcla.
    mezcla = _mapa(armado, "tamanos").get("mezcla")
    if not isinstance(mezcla, Mapping) or not any(
        float(cast(float, v)) > 0 for v in mezcla.values()
    ):
        raise ArmadoInvalido("sin_mezcla", "El armado no dice de que tamanos son los globos.")
    if not estructura.materiales:
        raise ArmadoInvalido("sin_materiales", "El arco no lleva colores que armar.")
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    for numero, color in enumerate(paleta, start=1):
        indice = _entero(
            color.get("material"), "material_invalido", f"El color {numero} no es un indice."
        )
        if indice < 0 or indice >= len(estructura.materiales):
            raise ArmadoInvalido(
                "material_fuera_de_rango", "El armado nombra un color que el arco no lleva."
            )


def _config_desde_armado(
    armado: Mapping[str, object],
    colores: Sequence[str],
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> tuple[ConfigOrg, list[str]]:
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
            # El plan decide CUÁNTOS globos lleva cada color y el motor DÓNDE (2026-10-05): sin cuotas, un arco
            # orgánico declarado 70/20/10 se armaba y se cobraba 47/28/25. Ver ``cuotas_por_peso`` en
            # ``organico/motor.py`` (puerto 1 a 1 del clasificador, con sus vectores de oro).
            "cuotas": True,
        },
        "adornos": dict(_mapa(armado, "adornos")),
        "aspecto": dict(_mapa(armado, "aspecto")),
        "real": {**inicial["real"], "desperdicio": desperdicio},
    }
    cfg, cambios = normalizar_config_con_cambios(crudo)
    return cfg, list(cambios)


def armado_resuelto(
    estructura: EstructuraArcoOrganico,
    armado: Mapping[str, object],
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> dict[str, Any]:
    """El arco resuelto: cada globo colocado, el conteo, la compra, los avisos y el dibujo.

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
    estimados = estimar_globos(cfg)
    if estimados > MAX_GLOBOS_ESTIMADOS:
        raise ArmadoInvalido(
            "demasiado_grande",
            f"Con ese tamaño y grosor el arco llevaría unos {int(estimados)} globos y aquí se arman hasta "
            f"{MAX_GLOBOS_ESTIMADOS} a la vez: usa globos más grandes, un arco más chico o más delgado, o "
            "menos relleno.",
        )
    res = generar(cfg)
    if len(res.globos) > MAX_GLOBOS_PUBLICADOS:
        # El contrato no publica más globos por arco, y un armado así no se arma ni se compra: es un armado
        # inválido con su frase, no un fallo del servidor. Lo dice Python porque cuenta Python.
        raise ArmadoInvalido(
            "demasiados_globos",
            f"Con ese tamaño y grosor el arco llevaría {len(res.globos)} globos y el máximo son "
            f"{MAX_GLOBOS_PUBLICADOS}: usa globos más grandes o un arco más chico o más delgado.",
        )
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
        "grosor_patas_m": res.grosorPatasM,
        "grosor_cima_m": res.grosorCimaM,
        "globos_por_metro": medidas["globosPorMetro"],
        "globos_por_pie": medidas["globosPorPie"],
        # Globos que quedaron sin tocar a ningún otro: con el motor bien puesto es 0, y si no lo es, se ve.
        "sueltos": int(res.sueltos),
        "conteo": unir_conteo(
            {
                "material": material_de(int(cast(int, e["indice"]))),
                "tamano": int(cast(int, e["nominal"])),
                "acabado": e["acabado"],
                "cantidad": int(cast(int, e["cantidad"])),
            }
            for e in res.conteo
        ),
        # Una fila por material de la pieza: dos entradas de la paleta pueden ser el mismo material con otro
        # acabado, y el motor las cuenta aparte.
        "compra": unir_compra(
            {
                "material": material_de(int(cast(int, fila["indice"]))),
                # La clave es la pulgada **en texto**, como la escribe `tamanos.mezcla` del armado: un entero
                # pasa el `json.dumps` sin ruido pero rompe la validación del contrato contra el diccionario,
                # que es donde se comprueba.
                "por_tamano": {
                    str(int(t)): int(c)
                    for t, c in cast(Mapping[Any, Any], fila["porTamano"]).items()
                },
                "cantidad": int(cast(int, fila["cantidad"])),
                # `Math.ceil` devuelve un número en JavaScript y aquí un `float`; el contrato pide enteros.
                "comprar": int(cast(float, fila["comprar"])),
            }
            for fila in cast(Sequence[Mapping[str, object]], compra["filas"])
        ),
        "total_comprar": int(cast(float, compra["total"])),
        # El follaje y las flores no se cotizan en el catálogo de globos: se listan para que nadie los olvide.
        "adornos": {"ramas": len(res.ramas), "flores": len(res.flores)},
        "avisos": cambios,
        # Derivado: el SVG no entra en el plan ni en `plan_hash`. Se regenera cuando haga falta.
        "grafica": {
            "ancho": LIENZO,
            "alto": LIENZO,
            "svg": res.svg,
            "documento": svg_documento(res.svg, "Arco orgánico de globos", LIENZO, LIENZO),
        },
    }


def _por_tamano_texto(mezcla: Mapping[int, float]) -> dict[str, float]:
    return {str(t): mezcla[t] for t in TAMANOS_GLOBO}


def _tamanos_de(tamanos: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "mezcla": _por_tamano_texto(tamanos["mezcla"]),
        "grandesAbajo": tamanos["grandesAbajo"],
        "inflado": tamanos["inflado"],
        "variacion": tamanos["variacion"],
    }


def opciones_admitidas() -> dict[str, Any]:
    """Lo que el editor y la IA pueden ofrecer, sacado del motor y no de una lista escrita a mano.

    Las formas listas y los estilos llevan sus valores: aplicar una es copiar esos campos al armado, así que la
    interfaz no repite ninguna cifra del diseñador. Las once formas son las de ``FORMAS_LISTAS`` del repo
    dueño, medios arcos incluidos (``forma.corte`` menor que 1).
    """
    inicial = config_inicial()
    estilos: list[dict[str, Any]] = []
    for estilo in ESTILOS:
        aplicado = estilo.aplicar(inicial)
        item: dict[str, Any] = {
            "id": estilo.id,
            "nombre": estilo.nombre,
            "ayuda": estilo.ayuda,
            "volumen": dict(aplicado["volumen"]),
        }
        if aplicado["tamanos"] != inicial["tamanos"]:
            item["tamanos"] = _tamanos_de(aplicado["tamanos"])
        estilos.append(item)
    return {
        "acabados": [dict(a) for a in ACABADOS],
        "repartos": [dict(r) for r in REPARTOS],
        "roles": list(ROLES),
        "tamanos": list(TAMANOS_GLOBO),
        "ancho_m": {"min": ANCHO_MIN, "max": ANCHO_MAX},
        "alto_m": {"min": ALTO_MIN, "max": ALTO_MAX},
        "grosor_m": {"min": GROSOR_MIN, "max": GROSOR_TOPE},
        "max_materiales": MAX_MATERIALES,
        "formas": [
            {
                "id": f.id,
                "nombre": f.nombre,
                "descripcion": f.descripcion,
                "forma": dict(f.forma),
                "volumen": dict(f.volumen),
                "tamanos": _tamanos_de(f.tamanos),
                "semilla": f.semilla,
            }
            for f in FORMAS_LISTAS
        ],
        "estilos": estilos,
    }


def limites_de(armado: Mapping[str, object], estructura: EstructuraArcoOrganico) -> dict[str, Any]:
    """Los rangos que la interfaz puede ofrecer con este armado puesto, y qué tamaños caben en esa banda.

    Son los rangos **vivos**: el alto mínimo sube con el ancho y con el grosor de la cima, y el grosor máximo
    baja con el ancho (una banda gruesa taparía la abertura). ``tamanos`` dice qué globos caben en el grosor de
    ahora: los que no, ``sanear`` los quita de la mezcla y lo avisa.
    """
    validar(estructura, armado)
    tonos = list(estructura.materiales)
    cfg = _config_desde_armado(armado, tonos)[0]
    permitidos = tamanos_permitidos(cast(dict[str, Any], cfg))
    return {**limites(cfg), "tamanos": [t for t in TAMANOS_GLOBO if permitidos[t]]}
