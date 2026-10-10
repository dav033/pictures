"""Columna orgánica: el motor, migrado 1 a 1 desde ``clasificador-decoraciones``.

Una columna orgánica es una columna irregular de globos de varios tamaños, más ancha abajo que arriba, con racimos
que se solapan, globos que se salen de la banda, follaje, flores y, si se pide, un globo grande sobre la punta. No
es la torre de anillos de ``armado_columna.py`` (cuartetos y patrones de color): el motor coloca cada globo con una
relajación que los separa hasta que dejan de pisarse, y de ahí salen el conteo, la compra y el dibujo.

**La fuente de verdad es el repo ``clasificador-decoraciones``** (``src/lib/columnaorg/`` y ``src/lib/organico/``),
migrado a ``app/columnaorg/`` y ``app/organico/`` y probado contra 216 vectores de oro —18 864 globos y el sha256
de cada SVG— en ``tests/test_columnaorg.py``. Este módulo es su puerta: traduce entre el vocabulario del plan
(índices de material) y el del motor (una paleta de colores con su acabado).

**Convive con ``armado-columna.v1``, no lo reemplaza.** Aquel describe la columna clásica de anillos y patrones; este,
la orgánica. Cuando una pieza trae los dos, manda el clásico (``plan.py``): es el que ya existía.

Como la guirnalda orgánica y a diferencia del arco, **aquí no hacen falta colores testigo**: el motor orgánico ya
guarda en cada globo el índice de su color dentro de la paleta (``GloboOrg.indice``). El globo grande de la punta
lleva ``indice = −1``: se traduce al material que el armado le asigna en ``corona.material``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast

from jsonschema import Draft7Validator

from app.armado_validacion import MENSAJE_NO_FINITO, MOTIVO_NO_FINITO, hay_numero_no_finito
from app.columnaorg.formas import ESTILOS_COL, FORMAS_COLUMNA
from app.columnaorg.limites import (
    ALTO_MIN,
    ALTO_TOPE,
    GROSOR_MIN,
    GROSOR_TOPE,
    estimar_globos,
    limites,
    normalizar_config_con_cambios,
)
from app.columnaorg.motor import LIENZO_COL, disposicion_col, pintar_col
from app.columnaorg.tipos import ConfigCol, config_inicial
from app.generated_models import contract_schema
from app.merma import MERMA
from app.organico.dibujo import svg_documento
from app.organico.medidas import calcular_compra, calcular_medidas
from app.organico.motor import MAX_GLOBOS
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO
from app.organico.unir import unir_compra, unir_conteo

VERSION = "armado-columna-organica.v1"

#: Hasta cuántos colores admite una columna. Es el tope de la paleta del motor.
MAX_MATERIALES = 8

#: Margen de compra cuando quien llama no dice otro: el del plan (``app/merma.py``). El diseñador orgánico abre con
#: 0,12 (`REAL_INICIAL`, dentro de los vectores de oro), pero ninguna llamada de la aplicación lo usa: el margen es
#: política de compra del plan y una vista previa con otro número daría una compra distinta de la que se cobra.
DESPERDICIO_POR_DEFECTO = MERMA

#: Los papeles que puede tener un color: uno normal, o un acento repartido suelto entre los demás.
ROLES = ("normal", "acento")


#: Hasta cuántos globos **estimados** (antes de colocarlos) arma un columna orgánica. Colocar es una relajación de colisiones y su
#: coste crece más que lineal con los globos: medido en esta máquina (una sola hebra, Python 3.11), 54 globos reales en 0,2 s, 328 en 2,8 s, 507 en 5,1 s y 741 en 9,4 s. El
#: plazo de la edición es de 5 s y el hilo no se cancela cuando vence, así que lo que pasa de aquí se rechaza con su
#: frase en vez de dejar el hilo ocupado ~10 s detrás de una petición que ya dio por perdida. La estimación del motor
#: (``estimar_globos``) es la misma con la que ``sanear`` baja el relleno: sale sin colocar nada.
MAX_GLOBOS_ESTIMADOS = 300

#: Los globos que publica el contrato por columna: los del cuerpo más el de la punta.
MAX_GLOBOS_PUBLICADOS = MAX_GLOBOS + 1


class ArmadoInvalido(ValueError):
    """Un armado de columna orgánica que no se puede armar o no corresponde a la pieza."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


def avisos_colores_sin_uso(nombres: Sequence[str], usados: Sequence[int]) -> list[str]:
    """Qué colores de la pieza el armado no toma, para decirlo antes de que se guarde.

    Un color de la pieza que ningún globo de la columna usa no se compra, pero sigue en el plan con su
    participación: el plan dice una cosa y la compra otra. No es un armado inválido (una columna de un solo color
    sobre una pieza de dos es lo que pidió el decorador), así que no se rechaza: se avisa, con qué hacer.
    ``nombres`` son los colores de la pieza en su orden; ``usados``, los índices de ``colores.paleta[].material`` y
    el de ``corona.material`` si el globo de la punta está puesto.
    """
    tomados = set(usados)
    return [
        f"La columna no usa el color {nombre.capitalize() if nombre else 'sin nombre'} de la pieza: no se "
        "comprarán globos de ese color. Agrégalo a la paleta o quítalo de la pieza."
        for indice, nombre in enumerate(nombres)
        if indice not in tomados
    ]


def indices_usados(armado: Mapping[str, object]) -> list[int]:
    """Los índices de material que usa el armado: los de la paleta y el del globo de la punta, si lo lleva."""
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    usados = [int(cast(int, color["material"])) for color in paleta]
    corona = _mapa(armado, "corona")
    if corona.get("activa") is True:
        usados.append(int(cast(int, corona["material"])))
    return usados


@dataclass(frozen=True)
class EstructuraColumnaOrganica:
    """La pieza del plan que lleva el armado, con lo poco que el motor necesita de ella."""

    es_columna: bool
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
        "armado_columna_organica"
    ],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)


def _validar_forma(armado: Mapping[str, object]) -> None:
    """Comprueba la forma contra el esquema publicado de ``armado-columna-organica.v1``.

    La forma la valida el contrato, no una lista de comprobaciones a mano: se exporta desde el Zod de
    ``src/lib/plan/armado-columna-organica.ts`` y repetirlo aquí sería un segundo dueño que se desincroniza en
    silencio. Lo que queda en este módulo son las reglas que un esquema no puede expresar —que cada índice de
    material exista en la pieza—, que son las que sí son suyas.
    """
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido("forma_invalida", f"El armado no tiene la forma de {VERSION}.")


def validar(estructura: EstructuraColumnaOrganica, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la pieza. Lanza ``ArmadoInvalido`` si no se sostiene."""
    if not estructura.es_columna:
        raise ArmadoInvalido(
            "no_es_columna", "Solo una columna se arma como una pila irregular de globos."
        )
    if hay_numero_no_finito(armado):
        raise ArmadoInvalido(MOTIVO_NO_FINITO, MENSAJE_NO_FINITO)
    _validar_forma(armado)
    # Lo que el esquema no puede decir: «al menos un tamaño». Todas las claves de la mezcla son opcionales
    # —una columna nombra los tamaños que usa y no más—, así que un `{}` pasa la forma y no es una mezcla.
    mezcla = _mapa(armado, "tamanos").get("mezcla")
    if not isinstance(mezcla, Mapping) or not any(
        float(cast(float, v)) > 0 for v in mezcla.values()
    ):
        raise ArmadoInvalido("sin_mezcla", "El armado no dice de que tamanos son los globos.")
    if not estructura.materiales:
        raise ArmadoInvalido("sin_materiales", "La columna no lleva colores que armar.")
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    indices = [
        _entero(color.get("material"), "material_invalido", f"El color {numero} no es un indice.")
        for numero, color in enumerate(paleta, start=1)
    ]
    corona = _mapa(armado, "corona")
    indices.append(
        _entero(
            corona.get("material"),
            "material_invalido",
            "El color del globo de la punta no es un indice.",
        )
    )
    if any(i < 0 or i >= len(estructura.materiales) for i in indices):
        raise ArmadoInvalido(
            "material_fuera_de_rango", "El armado nombra un color que la columna no lleva."
        )


def _config_desde_armado(
    armado: Mapping[str, object],
    colores: Sequence[str],
    tono_corona: str,
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> tuple[ConfigCol, list[str], list[int]]:
    """El diseño del motor a partir del armado, con los tonos que se le quiera dar a la paleta y a la punta.

    El desperdicio entra aquí porque ``calcular_compra`` lo lee de ``cfg.real``: es el único sitio donde el motor lo
    mira, y dejarlo en el valor inicial hacía que el parámetro de ``armado_resuelto`` no hiciera nada.
    """
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    corona = _mapa(armado, "corona")
    materiales_por_color = [
        _entero(color.get("material"), "material_invalido", "Un color del armado no es un indice.")
        for color in paleta
    ]
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
            # El plan decide CUÁNTOS globos lleva cada color y el motor DÓNDE (2026-10-05): sin cuotas, una
            # columna orgánica declarada 70/20/10 se armaba y se cobraba 47/29/24. Ver ``cuotas_por_peso`` en
            # ``organico/motor.py`` (puerto 1 a 1 del clasificador, con sus vectores de oro).
            "cuotas": True,
        },
        "adornos": dict(_mapa(armado, "adornos")),
        "aspecto": dict(_mapa(armado, "aspecto")),
        "real": {**inicial["real"], "desperdicio": desperdicio},
        "corona": {
            "activa": corona.get("activa", False),
            "tamano": corona.get("tamano", 24),
            "color": tono_corona,
        },
    }
    cfg, cambios = normalizar_config_con_cambios(crudo)
    # Un acento disperso no debe heredar las tallas grandes de la mezcla general:
    # unos pocos R18/R24 ocupan mucha área y dominan tanto el montaje como la guía.
    # Fijamos colores por talla en el mismo motor que cuenta y cotiza. Se conserva
    # la cuota global de cada color y la mezcla global de tallas; los acentos pasan
    # a las tallas <= R12, repartidos allí proporcionalmente.
    colores_cfg = cast(dict[str, object], cfg["colores"])
    lista = cast(list[dict[str, object]], colores_cfg["lista"])
    materiales_por_capa = list(materiales_por_color)
    acentos = [i for i, color in enumerate(lista) if color.get("rol") == "acento"]
    base = [i for i in range(len(lista)) if i not in acentos]
    tamanos = cast(Mapping[int, float], cast(Mapping[str, object], cfg["tamanos"])["mezcla"])
    fraccion_pequena = sum(float(tamanos.get(t, 0)) for t in (5, 9, 12))
    total_tamanos = sum(float(tamanos.get(t, 0)) for t in TAMANOS_GLOBO)
    pesos = [max(0.0, float(color.get("peso", 0))) for color in lista]
    total_pesos = sum(pesos)
    peso_acento = sum(pesos[i] for i in acentos)
    peso_base = total_pesos - peso_acento
    fraccion_acento = peso_acento / total_pesos if total_pesos else 0.0
    if (
        acentos
        and base
        and peso_base > 0
        and total_tamanos > 0
        and 0 < fraccion_pequena < total_tamanos
        and 0 < fraccion_acento < fraccion_pequena / total_tamanos
    ):
        capas: list[dict[str, object]] = []
        materiales_expandidos: list[int] = []
        tamanos_por_capa: list[int] = []
        share_pequeno = fraccion_pequena / total_tamanos
        for tamano in TAMANOS_GLOBO:
            if float(tamanos.get(tamano, 0)) <= 0:
                continue
            permitido_acento = tamano <= 12
            for indice, color in enumerate(lista):
                if indice in acentos and not permitido_acento:
                    continue
                if indice in acentos:
                    cuota_local = pesos[indice] / (total_pesos * share_pequeno)
                elif permitido_acento:
                    cuota_local = (1 - fraccion_acento / share_pequeno) * pesos[indice] / peso_base
                else:
                    cuota_local = pesos[indice] / peso_base
                if cuota_local <= 0:
                    continue
                capas.append({**color, "peso": cuota_local * 100})
                tamanos_por_capa.append(tamano)
                materiales_expandidos.append(materiales_por_color[indice])
        if capas:
            colores_cfg["lista"] = capas
            colores_cfg["tamanoDe"] = tamanos_por_capa
            materiales_por_capa = materiales_expandidos
    return cfg, list(cambios), materiales_por_capa


def armado_resuelto(
    estructura: EstructuraColumnaOrganica,
    armado: Mapping[str, object],
    desperdicio: float = DESPERDICIO_POR_DEFECTO,
) -> dict[str, Any]:
    """La columna resuelta: cada globo colocado, el conteo, la compra, los avisos y el dibujo.

    Los globos salen en el orden en el que hay que pintarlos. El SVG viene del mismo motor que los colocó, así que
    la gráfica no recalcula nada: la muestra.
    """
    validar(estructura, armado)
    paleta = cast(Sequence[Mapping[str, object]], _mapa(armado, "colores")["paleta"])
    materiales = [
        _entero(color.get("material"), "material_invalido", "Un color del armado no es un indice.")
        for color in paleta
    ]
    tonos = [estructura.materiales[i] for i in materiales]
    material_corona = int(cast(int, _mapa(armado, "corona")["material"]))
    tono_corona = estructura.materiales[material_corona]

    cfg, cambios, materiales_por_color = _config_desde_armado(
        armado, tonos, tono_corona, desperdicio
    )
    estimados = estimar_globos(cfg)
    if estimados > MAX_GLOBOS_ESTIMADOS:
        raise ArmadoInvalido(
            "demasiado_grande",
            f"Con ese tamaño y grosor la columna llevaría unos {int(estimados)} globos y aquí se arman hasta "
            f"{MAX_GLOBOS_ESTIMADOS} a la vez: usa globos más grandes, una columna más delgada o más baja, o menos relleno.",
        )
    disposicion = disposicion_col(cfg)
    res = pintar_col(cfg, disposicion)
    if len(res.globos) > MAX_GLOBOS_PUBLICADOS:
        # El contrato no publica más globos por columna, y un armado así no se arma ni se compra: es un armado
        # inválido con su frase, no un fallo del servidor. Lo dice Python porque cuenta Python.
        raise ArmadoInvalido(
            "demasiados_globos",
            f"Con ese tamaño y grosor la columna llevaría {len(res.globos)} globos y el máximo son "
            f"{MAX_GLOBOS_PUBLICADOS}: usa globos más grandes o una columna más delgada o más baja.",
        )
    medidas = calcular_medidas(res, cfg)
    compra = calcular_compra(res, cfg)

    def material_de(indice: int) -> int:
        """Del lugar en la paleta del motor al material de la estructura; el globo de la punta (−1), a su material."""
        if indice < 0:
            return material_corona
        color_indice = (
            materiales_por_color[indice] if indice < len(materiales_por_color) else indice
        )
        return color_indice if 0 <= color_indice < len(estructura.materiales) else -1

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
        "grosor_base_m": res.grosorPatasM,
        "grosor_punta_m": res.grosorCimaM,
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
        "compra": unir_compra(
            {
                "material": material_de(int(cast(int, fila["indice"]))),
                # La clave es la pulgada **en texto**, como la publica `armados_columna_organica[]` (y como la
                # escribe `tamanos.mezcla` del armado): un entero pasa el `json.dumps` sin ruido pero rompe la
                # validación del contrato contra el diccionario, que es donde se comprueba.
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
            "ancho": LIENZO_COL["w"],
            "alto": LIENZO_COL["h"],
            "svg": res.svg,
            "documento": svg_documento(
                res.svg, "Columna orgánica de globos", LIENZO_COL["w"], LIENZO_COL["h"]
            ),
        },
    }


def _por_tamano_texto(mezcla: Mapping[int, float]) -> dict[str, float]:
    return {str(t): mezcla[t] for t in TAMANOS_GLOBO}


def opciones_admitidas() -> dict[str, Any]:
    """Lo que el editor y la IA pueden ofrecer, sacado del motor y no de una lista escrita a mano.

    Las formas listas y los estilos llevan sus valores: aplicar una es copiar esos campos al armado, así que la
    interfaz no repite ninguna cifra del diseñador.
    """
    inicial = config_inicial()
    estilos: list[dict[str, Any]] = []
    for estilo in ESTILOS_COL:
        aplicado = estilo.aplicar(inicial)
        item: dict[str, Any] = {
            "id": estilo.id,
            "nombre": estilo.nombre,
            "ayuda": estilo.ayuda,
            "volumen": dict(aplicado["volumen"]),
        }
        if aplicado["tamanos"] != inicial["tamanos"]:
            item["tamanos"] = {
                "mezcla": _por_tamano_texto(aplicado["tamanos"]["mezcla"]),
                "grandesAbajo": aplicado["tamanos"]["grandesAbajo"],
                "inflado": aplicado["tamanos"]["inflado"],
                "variacion": aplicado["tamanos"]["variacion"],
            }
        estilos.append(item)
    return {
        "acabados": [dict(a) for a in ACABADOS],
        "repartos": [dict(r) for r in REPARTOS],
        "roles": list(ROLES),
        "tamanos": list(TAMANOS_GLOBO),
        "alto_m": {"min": ALTO_MIN, "max": ALTO_TOPE},
        "grosor_m": {"min": GROSOR_MIN, "max": GROSOR_TOPE},
        "max_materiales": MAX_MATERIALES,
        "formas": [
            {
                "id": f.id,
                "nombre": f.nombre,
                "descripcion": f.descripcion,
                "forma": dict(f.forma),
                "volumen": dict(f.volumen),
                "tamanos": {
                    "mezcla": _por_tamano_texto(f.tamanos["mezcla"]),
                    "grandesAbajo": f.tamanos["grandesAbajo"],
                    "inflado": f.tamanos["inflado"],
                    "variacion": f.tamanos["variacion"],
                },
                "semilla": f.semilla,
            }
            for f in FORMAS_COLUMNA
        ],
        "estilos": estilos,
    }


def limites_de(
    armado: Mapping[str, object], estructura: EstructuraColumnaOrganica
) -> dict[str, Any]:
    """Los rangos que la interfaz puede ofrecer con este armado puesto, y qué globos caben en la punta."""
    validar(estructura, armado)
    tonos = list(estructura.materiales)
    vivos = limites(_config_desde_armado(armado, tonos, tonos[0])[0])
    permitidos = cast(Mapping[int, bool], vivos.pop("coronaPermitida"))
    return {**vivos, "coronaTamanos": [t for t in TAMANOS_GLOBO if permitidos[t]]}
