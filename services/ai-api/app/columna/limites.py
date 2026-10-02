"""Las reglas: lo que hace que una columna parezca una columna.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columna/limites.ts``. El criterio se define allá;
aquí solo se replica. Ver ``app/armado_columna.py`` y ``docs/architecture/decisions/0033-motor-de-columna-migrado.md``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, cast

from app.columna.js import (
    _abajo,
    _acotar,
    _arriba,
    _coma,
    _es_finito,
    _maximo,
    _minimo,
    _mod,
    _numero,
    _piso,
    _redondear,
)
from app.columna.motor import (
    capas_desde_altura,
    crear_capas,
    crear_capas_manuales,
    diametro_columna,
    es_por_capas,
    tamanos_entre,
)
from app.columna.patrones import PATRONES, opciones_iniciales
from app.columna.tipos import (
    COLORES_INICIALES,
    MAX_CAPAS,
    PATRON_IDS,
    TAMANOS_GLOBO,
    TIPOS_REMATE,
    CapaColumna,
    Columna,
    Config,
    Globo,
    Real,
    Remate,
    TamanoGlobo,
    _copia,
    diametro_m,
)

# ---------------------------------------------------------------------------
# Reglas (``limites.ts``)
# ---------------------------------------------------------------------------

ALTO_MIN = 0.5
ALTO_MAX = 6.0
GLOBOS_CAPA_MIN = 3
GLOBOS_CAPA_MAX = 6
MAX_GLOBOS = 900
#: Más baja que esto respecto a su diámetro parece un taburete; más alta se vuelve inestable.
RAZON_ALTO_MIN = 2
RAZON_ALTO_MAX = 12
#: Cuánto puede cambiar el diámetro del globo de abajo al de arriba.
RAZON_AFINADO_MIN = 0.45
RAZON_AFINADO_MAX = 1.8
#: Entre capas vecinas: de R12 a R24 sí, de R12 a R36 no.
RAZON_VECINA_MAX = 2.1


@dataclass
class Limites:
    diametro: float
    alto_min: float
    alto_max: float
    foil_min: float
    foil_max: float
    remates_globo: dict[TamanoGlobo, bool]
    remates_racimo: dict[TamanoGlobo, bool]


def diametro_de_columna(cfg: Config) -> float:
    """Diámetro exterior (m): el de la capa más ancha."""
    g = cfg.globo
    if es_por_capas(cfg):
        return max(
            float(diametro_columna(k.tamano, len(k.colores), g.inflado, g.tamano))
            for k in cfg.capas
        )
    c = cfg.columna
    return max(
        float(diametro_columna(t, c.globos_capa, g.inflado, g.tamano))
        for t in tamanos_entre(c.abajo, c.arriba)
    )


def limites(cfg: Config) -> Limites:
    diametro = diametro_de_columna(cfg)
    inflado = cfg.globo.inflado
    globo: dict[TamanoGlobo, bool] = {}
    racimo: dict[TamanoGlobo, bool] = {}
    for t in TAMANOS_GLOBO:
        d = diametro_m(t, inflado)
        globo[t] = d >= 0.6 * diametro - 1e-9 and d <= 2.4 * diametro + 1e-9
        racimo[t] = d <= 0.85 * diametro + 1e-9 and d >= 0.25 * diametro - 1e-9
    return Limites(
        diametro=diametro,
        alto_min=_maximo(ALTO_MIN, _arriba(RAZON_ALTO_MIN * diametro)),
        alto_max=_maximo(ALTO_MIN, _abajo(_minimo(ALTO_MAX, RAZON_ALTO_MAX * diametro))),
        foil_min=_maximo(0.3, _arriba(0.7 * diametro)),
        foil_max=_minimo(2.5, _abajo(2.4 * diametro)),
        remates_globo=globo,
        remates_racimo=racimo,
    )


def _mas_cercano(
    permitidos: Mapping[TamanoGlobo, bool], diametro: float, inflado: float, ideal: float
) -> TamanoGlobo | None:
    """El tamaño permitido más cercano a ``ideal`` (en diámetro relativo a la columna)."""
    mejor: TamanoGlobo | None = None
    dif = math.inf
    for t in TAMANOS_GLOBO:
        if not permitidos[t]:
            continue
        error = abs(diametro_m(t, inflado) / diametro - ideal)
        if error < dif:
            dif = error
            mejor = t
    return mejor


def _sanear_capas(cfg: Config) -> list[str]:
    """Reglas de la columna por capas. Devuelve lo que ajustó."""
    cambios: list[str] = []
    nc = len(cfg.colores)
    if len(cfg.capas) == 0:
        capas, colores = capas_desde_altura(cfg)
        cfg.capas = capas
        cfg.colores = colores
        cambios.append("Sin capas no hay columna: se partió de la columna por altura.")
    if len(cfg.capas) > MAX_CAPAS:
        cfg.capas = cfg.capas[:MAX_CAPAS]
        cambios.append(f"Una columna lleva como máximo {MAX_CAPAS} capas.")

    saneadas: list[CapaColumna] = []
    for capa in cfg.capas:
        dados = capa.colores if capa.colores else [0]
        n = int(_redondear(_acotar(len(dados), GLOBOS_CAPA_MIN, GLOBOS_CAPA_MAX)))
        # Un color por globo: si faltan, se repiten los de la capa; si sobran, se cortan.
        asignados: list[int] = []
        for j in range(n):
            crudo = dados[j % len(dados)]
            v = int(_redondear(crudo)) if _es_finito(crudo) else 0
            asignados.append(int(_mod(v, nc)))
        tamano = capa.tamano if capa.tamano in TAMANOS_GLOBO else 12
        saneadas.append(CapaColumna(tamano=tamano, colores=asignados))
    cfg.capas = saneadas

    # Un salto de tamaño demasiado brusco entre capas vecinas no se sostiene.
    for i in range(1, len(cfg.capas)):
        previa = diametro_m(cfg.capas[i - 1].tamano, 1)

        def cabe(t: TamanoGlobo, previa: float = previa) -> bool:
            razon = float(diametro_m(t, 1)) / previa
            return razon <= RAZON_VECINA_MAX and razon >= 1 / RAZON_VECINA_MAX

        pedido = cfg.capas[i].tamano
        if not cabe(pedido):
            permitidos = [t for t in TAMANOS_GLOBO if cabe(t)]
            nuevo = permitidos[0]
            for t in permitidos:
                if abs(diametro_m(t, 1) - diametro_m(pedido, 1)) < abs(
                    diametro_m(nuevo, 1) - diametro_m(pedido, 1)
                ):
                    nuevo = t
            cambios.append(
                f"La capa {i + 1} pasó de R{cfg.capas[i - 1].tamano} a R{pedido}: el salto de "
                f"tamaño es demasiado brusco, se cambió a R{nuevo}."
            )
            cfg.capas[i].tamano = nuevo

    # Alto máximo: el de una columna estable para su diámetro; lo que sobra arriba se quita.
    diametro = diametro_de_columna(cfg)
    alto_max = _maximo(ALTO_MIN, _minimo(ALTO_MAX, RAZON_ALTO_MAX * diametro))
    quitadas = 0
    while len(cfg.capas) > 1:
        calculadas = crear_capas_manuales(cfg)
        ultima = calculadas[-1]
        if ultima.y + ultima.d / 2 <= alto_max + 1e-9:
            break
        cfg.capas.pop()
        quitadas += 1
    if quitadas:
        plural = "s" if quitadas > 1 else ""
        cambios.append(
            f"Una columna de {int(_redondear(diametro * 100))} cm de diámetro no pasa de "
            f"{_coma(alto_max, 2)} m: se quitaron {quitadas} capa{plural} de arriba."
        )
    # Cantidad de globos.
    while len(cfg.capas) > 1 and sum(len(k.colores) for k in cfg.capas) > MAX_GLOBOS:
        cfg.capas.pop()
    return cambios


def sanear(entrada: Config) -> tuple[Config, list[str]]:
    """Corrige cualquier diseño imposible y dice qué ajustó. Nunca lanza."""
    cfg = _copia(entrada)
    c = cfg.columna
    g = cfg.globo
    r = cfg.remate
    cambios: list[str] = []

    g.inflado = _acotar(g.inflado, 0.8, 1.1)
    g.tamano = _acotar(g.tamano, 1, 1.4)
    g.compresion = _acotar(g.compresion, 0.7, 1)
    g.variacion_tam = _acotar(g.variacion_tam, 0, 0.3)
    g.variacion_tono = _acotar(g.variacion_tono, 0, 0.25)
    g.desorden = _acotar(g.desorden, 0, 0.4)
    g.brillo = _acotar(g.brillo, 0, 1)
    g.sombra = _acotar(g.sombra, 0, 0.5)
    g.contorno = _acotar(g.contorno, 0, 3)
    g.profundidad = _acotar(g.profundidad, 0, 1)
    g.semilla = _minimo(99999, _maximo(1, _redondear(g.semilla)))

    c.globos_capa = _redondear(_acotar(c.globos_capa, GLOBOS_CAPA_MIN, GLOBOS_CAPA_MAX))
    if c.abajo not in TAMANOS_GLOBO:
        c.abajo = 12
    if c.arriba not in TAMANOS_GLOBO:
        c.arriba = c.abajo

    cfg.modo = "capas" if cfg.modo == "capas" else "altura"

    # Afinado: los globos de arriba no pueden ser mucho más chicos (ni más grandes) que los de abajo.
    razon = diametro_m(c.arriba, 1) / diametro_m(c.abajo, 1)
    if razon < RAZON_AFINADO_MIN or razon > RAZON_AFINADO_MAX:
        antes = c.arriba
        for t in tamanos_entre(c.abajo, c.arriba):
            rz = diametro_m(t, 1) / diametro_m(c.abajo, 1)
            if RAZON_AFINADO_MIN <= rz <= RAZON_AFINADO_MAX:
                c.arriba = t
        cambios.append(
            f"De R{c.abajo} a R{antes} el cambio de tamaño es demasiado brusco: los globos de "
            f"arriba pasaron a R{c.arriba}."
        )

    # Colores: de 1 a 8, y los que el patrón necesita como mínimo.
    cfg.colores = cfg.colores[:8]
    if not cfg.colores:
        cfg.colores = list(COLORES_INICIALES)
    patron = PATRONES[cfg.patron]
    if cfg.modo != "capas" and len(cfg.colores) < patron.min_colores:
        extra = ["#ffffff", "#f59e0b", "#22c55e", "#ef4444"]
        while len(cfg.colores) < patron.min_colores:
            cfg.colores.append(extra[len(cfg.colores) % len(extra)])
        cambios.append(
            f"El patrón {patron.nombre} necesita al menos {patron.min_colores} colores: se "
            f"añadieron los que faltaban."
        )

    # Opciones del patrón dentro de sus rangos.
    for pid in PATRON_IDS:
        for ctl in PATRONES[pid].controles:
            valor = cfg.opciones[pid].get(ctl.clave)
            cfg.opciones[pid][ctl.clave] = (
                _acotar(cast(float, valor), ctl.minimo, ctl.maximo)
                if _es_finito(valor)
                else ctl.defecto
            )
    # Las secuencias que dan la vuelta no pueden tener más bandas que globos por capa.
    for pid in ("espiral", "rayas", "zigzag"):
        nc = _minimo(len(cfg.colores), c.globos_capa)
        max_vueltas = _maximo(1, _piso(c.globos_capa / nc))
        vueltas = cfg.opciones[pid]["vueltas"]
        if vueltas > max_vueltas and pid == cfg.patron and cfg.modo != "capas":
            cambios.append(
                f"Con {_numero(c.globos_capa)} globos por capa y {_numero(nc)} colores solo caben "
                f"{_numero(max_vueltas)} repeticiones alrededor."
            )
        cfg.opciones[pid]["vueltas"] = _minimo(vueltas, max_vueltas)

    # Alto según el diámetro. (Por capas, el alto sale de las capas: se revisa más abajo.)
    por_capas = cfg.modo == "capas"
    lim = limites(cfg)
    if not por_capas:
        alto = _acotar(
            _redondear(c.alto_m * 20) / 20, lim.alto_min, _maximo(lim.alto_min, lim.alto_max)
        )
        if abs(alto - c.alto_m) > 0.026:
            cambios.append(
                f"El alto se ajustó a {_coma(alto, 2)} m: con una columna de "
                f"{int(_redondear(lim.diametro * 100))} cm de diámetro, fuera de "
                f"{_coma(lim.alto_min, 2)}–{_coma(lim.alto_max, 2)} m no parece una columna."
            )
        c.alto_m = alto

        total = len(crear_capas(cfg)) * c.globos_capa
        if total > MAX_GLOBOS:
            cambios.append(
                f"Con ese tamaño y alto harían falta {_numero(total)} globos: es demasiado. "
                f"Bajaron los globos por capa."
            )
            while (
                len(crear_capas(cfg)) * c.globos_capa > MAX_GLOBOS
                and c.globos_capa > GLOBOS_CAPA_MIN
            ):
                c.globos_capa -= 1
    else:
        cambios.extend(_sanear_capas(cfg))
        lim = limites(cfg)

    # Remate según el diámetro de la columna.
    lim = limites(cfg)
    if r.tipo not in TIPOS_REMATE:
        r.tipo = "ninguno"
    if r.tamano not in TAMANOS_GLOBO:
        r.tamano = 24
    r.cantidad = _redondear(_acotar(r.cantidad, 3, 5))
    if r.tipo == "globo" and not lim.remates_globo[r.tamano]:
        otro = _mas_cercano(lim.remates_globo, lim.diametro, g.inflado, 1.3)
        if otro is not None:
            cambios.append(
                f"Un globo de R{r.tamano} no queda bien sobre una columna de "
                f"{int(_redondear(lim.diametro * 100))} cm: se cambió a R{otro}."
            )
            r.tamano = otro
        else:
            cambios.append(
                "Ningún globo grande queda bien sobre esta columna: el remate pasó a racimo."
            )
            r.tipo = "racimo"
    if r.tipo == "racimo" and not lim.remates_racimo[r.tamano]:
        otro = _mas_cercano(lim.remates_racimo, lim.diametro, g.inflado, 0.55)
        elegido = otro if otro is not None else c.arriba
        cambios.append(
            f"Los globos del racimo se cambiaron a R{elegido} para que el remate no sea más "
            f"ancho que la columna."
        )
        r.tamano = elegido
    if r.tipo in ("estrella", "corazon"):
        foil = _acotar(
            _redondear(r.foil_m * 20) / 20, lim.foil_min, _maximo(lim.foil_min, lim.foil_max)
        )
        if abs(foil - r.foil_m) > 0.026:
            cambios.append(
                f"El remate foil se ajustó a {_coma(foil, 2)} m para que guarde proporción con "
                f"la columna."
            )
        r.foil_m = foil

    cfg.real.desperdicio = _acotar(cfg.real.desperdicio, 0, 0.3)
    cfg.real.precio = _maximo(0, cfg.real.precio)
    cfg.real.cantidad = _redondear(_acotar(cfg.real.cantidad, 1, 20))

    return cfg, cambios


def config_inicial() -> Config:
    return Config(
        modo="altura",
        capas=[],
        patron="espiral",
        columna=Columna(),
        globo=Globo(),
        remate=Remate(),
        real=Real(),
        colores=list(COLORES_INICIALES),
        opciones=opciones_iniciales(),
    )


# ---------------------------------------------------------------------------
# Entrada de fuera (``normalizarConfig``)
# ---------------------------------------------------------------------------


def _num(valor: object, respaldo: float) -> float:
    return float(cast(float, valor)) if _es_finito(valor) else respaldo


def _obj(valor: object) -> Mapping[str, object]:
    return valor if isinstance(valor, Mapping) else {}


def _bool(valor: object, respaldo: bool) -> bool:
    """Solo un booleano de verdad cuenta: un ``"si"`` no es ``True``, como en el motor."""
    return valor if isinstance(valor, bool) else respaldo


def _tamano(valor: object, respaldo: TamanoGlobo) -> TamanoGlobo:
    return cast(TamanoGlobo, valor) if valor in TAMANOS_GLOBO else respaldo


def es_hex(valor: object) -> bool:
    if not isinstance(valor, str) or len(valor) != 7 or not valor.startswith("#"):
        return False
    return all(c in "0123456789abcdefABCDEF" for c in valor[1:])


def normalizar_color(valor: object, respaldo: str) -> str:
    """El color en minúsculas, o el respaldo si no es un ``#rrggbb``.

    Una referencia del catálogo (``sx:041``) no llega hasta aquí: la resuelve la tabla de Sempertex
    antes, igual que en el motor resolverla es cosa del catálogo y no del dibujo.
    """
    return cast(str, valor).lower() if es_hex(valor) else respaldo


def normalizar_config(entrada: object) -> Config:
    """El diseño válido, sin más. Nunca lanza."""
    cfg, _cambios = normalizar_config_con_cambios(entrada)
    return cfg


def normalizar_config_con_cambios(entrada: object) -> tuple[Config, list[str]]:
    """Convierte cualquier cosa que llegue de fuera en un diseño válido, y dice qué ajustó.

    Los avisos son los de la **primera** pasada de ``sanear``, que es la única que ajusta algo:
    ``sanear`` es idempotente, así que volver a sanear un diseño ya saneado no avisa de nada. Quien
    tenga que mostrarle al decorador lo que se le cambió necesita estos, no los de una segunda vuelta.
    """
    base = config_inicial()
    e = _obj(entrada)
    col = _obj(e.get("columna"))
    glo = _obj(e.get("globo"))
    rem = _obj(e.get("remate"))
    real = _obj(e.get("real"))
    ops = _obj(e.get("opciones"))

    opciones = opciones_iniciales()
    for pid in PATRON_IDS:
        propias = _obj(ops.get(pid))
        for clave in list(opciones[pid].keys()):
            opciones[pid][clave] = _num(propias.get(clave), opciones[pid][clave])

    capas: list[CapaColumna] = []
    crudas = e.get("capas")
    if isinstance(crudas, list):
        for cruda in crudas[:MAX_CAPAS]:
            o = _obj(cruda)
            crudos_capa = o.get("colores")
            if isinstance(crudos_capa, list):
                colores_capa = [int(_num(v, 0)) for v in crudos_capa[:6]]
            else:
                colores_capa = [0, 1, 0, 1]
            capas.append(CapaColumna(tamano=_tamano(o.get("tamano"), 12), colores=colores_capa))

    crudos = e.get("colores")
    if isinstance(crudos, list):
        # El respaldo alterna entre los dos colores de partida, como en el motor.
        colores = [
            normalizar_color(h, COLORES_INICIALES[i % len(COLORES_INICIALES)])
            for i, h in enumerate(crudos)
        ]
    else:
        colores = list(base.colores)

    cfg = Config(
        modo="capas" if e.get("modo") == "capas" else "altura",
        capas=capas,
        patron=cast(str, e.get("patron")) if e.get("patron") in PATRON_IDS else base.patron,
        columna=Columna(
            alto_m=_num(col.get("altoM", col.get("alto_m")), base.columna.alto_m),
            globos_capa=_num(
                col.get("globosCapa", col.get("globos_capa")), base.columna.globos_capa
            ),
            abajo=_tamano(col.get("abajo"), base.columna.abajo),
            arriba=_tamano(col.get("arriba"), base.columna.arriba),
            escalonado=_bool(col.get("escalonado"), base.columna.escalonado),
            base=_bool(col.get("base"), base.columna.base),
            persona=_bool(col.get("persona"), base.columna.persona),
        ),
        globo=Globo(
            inflado=_num(glo.get("inflado"), base.globo.inflado),
            tamano=_num(glo.get("tamano"), base.globo.tamano),
            compresion=_num(glo.get("compresion"), base.globo.compresion),
            variacion_tam=_num(
                glo.get("variacionTam", glo.get("variacion_tam")), base.globo.variacion_tam
            ),
            variacion_tono=_num(
                glo.get("variacionTono", glo.get("variacion_tono")), base.globo.variacion_tono
            ),
            desorden=_num(glo.get("desorden"), base.globo.desorden),
            brillo=_num(glo.get("brillo"), base.globo.brillo),
            sombra=_num(glo.get("sombra"), base.globo.sombra),
            contorno=_num(glo.get("contorno"), base.globo.contorno),
            profundidad=_num(glo.get("profundidad"), base.globo.profundidad),
            semilla=_num(glo.get("semilla"), base.globo.semilla),
        ),
        remate=Remate(
            tipo=cast(str, rem.get("tipo"))
            if rem.get("tipo") in TIPOS_REMATE
            else base.remate.tipo,
            tamano=_tamano(rem.get("tamano"), base.remate.tamano),
            cantidad=_num(rem.get("cantidad"), base.remate.cantidad),
            foil_m=_num(rem.get("foilM", rem.get("foil_m")), base.remate.foil_m),
            color=str(rem.get("color")) if isinstance(rem.get("color"), str) else base.remate.color,
        ),
        real=Real(
            desperdicio=_num(real.get("desperdicio"), base.real.desperdicio),
            precio=_num(real.get("precio"), base.real.precio),
            cantidad=_num(real.get("cantidad"), base.real.cantidad),
        ),
        colores=colores,
        opciones=opciones,
    )
    return sanear(cfg)
