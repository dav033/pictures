"""Modo «por capas» de las estructuras orgánicas.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/capas.ts``.

Una capa de trabajo es lo que hace un decorador al armar: «la base son R18 verde oscuro», «el relleno, R5
crema», «los acentos, R9 cromado dorado». El motor no cambia: ``efectiva`` convierte las capas en la mezcla de
tamaños y la lista de colores que él ya entiende.

**La guirnalda nunca entra por aquí**: su ``ConfigGuir`` no tiene ``modo`` ni ``capas``, así que ``efectiva``
devuelve el diseño tal cual. Se migra igual porque el motor compartido la llama en cada entrada y porque el
arco y la columna sí la usan.
"""

from __future__ import annotations

from typing import Any, TypeVar

from app.motores.js import _es_finito, _maximo, _minimo, _redondear
from app.organico.tipos import TAMANOS_GLOBO, CapaOrg, diametro_m

MAX_CAPAS_ORG = 20

T = TypeVar("T", bound=dict[str, Any])


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def efectiva(cfg: T) -> T:
    """El diseño tal como lo ve el motor.

    Por mezcla es el mismo objeto; por capas, la mezcla de tamaños pasa a ser la suma de lo que aporta cada
    capa y cada capa pasa a ser un color de la lista, con su tamaño en ``tamanoDe`` para que cada tamaño se
    coloree solo con los colores de sus capas.
    """
    capas: list[CapaOrg] = cfg.get("capas") or []
    if cfg.get("modo") != "capas" or not capas:
        return cfg
    mezcla: dict[int, float] = {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0}
    for c in capas:
        mezcla[c["tamano"]] += c["peso"]
    paleta = cfg["colores"]["lista"]
    lista = []
    for c in capas:
        col = paleta[((c["color"] % len(paleta)) + len(paleta)) % len(paleta)] if paleta else paleta[0]
        lista.append({"hex": col["hex"], "acabado": col["acabado"], "peso": c["peso"], "rol": c["rol"]})
    salida = dict(cfg)
    salida["tamanos"] = {**cfg["tamanos"], "mezcla": mezcla}
    salida["colores"] = {**cfg["colores"], "lista": lista, "tamanoDe": [c["tamano"] for c in capas]}
    return salida  # type: ignore[return-value]


def capas_desde_mezcla(cfg: dict[str, Any]) -> list[CapaOrg]:
    """Pasa un diseño por mezcla a capas: una por cada combinación de tamaño y color que pese lo bastante."""
    mezcla = cfg["tamanos"]["mezcla"]
    paleta = cfg["colores"]["lista"][:8]
    tamanos = [t for t in TAMANOS_GLOBO if mezcla[t] > 0]
    total_t = sum(mezcla[t] for t in tamanos) or 1
    total_c = sum(c["peso"] for c in paleta) or 1
    combos: list[dict[str, Any]] = []
    for t in sorted(tamanos, reverse=True):
        for i, c in enumerate(paleta):
            combos.append({"tamano": t, "color": i, "w": (mezcla[t] / total_t) * (c["peso"] / total_c) * 100})
    combos = [c for c in combos if c["w"] >= 1.5]
    if len(combos) > MAX_CAPAS_ORG:
        combos = sorted(combos, key=lambda c: -c["w"])[:MAX_CAPAS_ORG]
        combos = sorted(combos, key=lambda c: (-c["tamano"], c["color"]))
    if not combos:
        combos = [{"tamano": tamanos[0] if tamanos else 12, "color": 0, "w": 100}]
    total = sum(c["w"] for c in combos) or 1
    return [
        {
            "tamano": c["tamano"],
            "color": c["color"],
            "peso": _maximo(1, _redondear((c["w"] / total) * 100)),
            "rol": "acento" if paleta[c["color"]]["rol"] == "acento" else "base",
        }
        for c in combos
    ]


def sanear_capas_org(cfg: dict[str, Any], permitidos: dict[int, bool]) -> list[str]:
    """Reglas del modo por capas. Corrige ``cfg`` en su lugar y devuelve lo que ajustó."""
    cambios: list[str] = []
    cfg["modo"] = "capas" if cfg.get("modo") == "capas" else "mezcla"
    nc = int(_maximo(1, _minimo(8, len(cfg["colores"]["lista"]))))
    capas: list[CapaOrg] = [
        {
            "tamano": c["tamano"] if c["tamano"] in TAMANOS_GLOBO else 12,
            "color": int((_redondear(c["color"] if _es_finito(c["color"]) else 0) % nc + nc) % nc),
            "peso": _redondear(_acotar(c["peso"] if _es_finito(c["peso"]) else 20, 1, 100)),
            "rol": "acento" if c["rol"] == "acento" else "base",
        }
        for c in (cfg.get("capas") or [])[:MAX_CAPAS_ORG]
    ]
    if cfg["modo"] == "capas":
        if not capas:
            capas = capas_desde_mezcla(cfg)
            cambios.append("Sin capas no hay diseño: se partió de la mezcla de tamaños y colores.")
        caben = [t for t in TAMANOS_GLOBO if permitidos[t]]
        validos = caben if caben else [12]
        ajustadas: list[CapaOrg] = []
        for i, c in enumerate(capas):
            if permitidos[c["tamano"]] or not caben:
                ajustadas.append(c)
                continue
            nuevo = validos[0]
            for t in validos:
                if abs(diametro_m(t, 1) - diametro_m(c["tamano"], 1)) < abs(diametro_m(nuevo, 1) - diametro_m(c["tamano"], 1)):
                    nuevo = t
            cambios.append(f"La capa {i + 1} (R{c['tamano']}) no cabe en ese grosor: pasó a R{nuevo}.")
            ajustadas.append({**c, "tamano": nuevo})
        capas = ajustadas
    cfg["capas"] = capas
    return cambios


def leer_capas(entrada: object) -> dict[str, Any]:
    """Lee ``modo`` y ``capas`` de un diseño que llega de fuera (enlace, almacenamiento). Nunca lanza."""
    e: dict[str, Any] = entrada if isinstance(entrada, dict) else {}
    crudas = e.get("capas")
    capas: list[CapaOrg] = []
    if isinstance(crudas, list):
        for cruda in crudas[:MAX_CAPAS_ORG]:
            o: dict[str, Any] = cruda if isinstance(cruda, dict) else {}
            capas.append(
                {
                    "tamano": next((t for t in TAMANOS_GLOBO if t == o.get("tamano")), 12),
                    "color": o["color"] if _es_finito(o.get("color")) else 0,
                    "peso": o["peso"] if _es_finito(o.get("peso")) else 20,
                    "rol": "acento" if o.get("rol") == "acento" else "base",
                }
            )
    return {"modo": "capas" if e.get("modo") == "capas" else "mezcla", "capas": capas}


def aportes(capas: list[CapaOrg]) -> list[float]:
    """Lo que aporta cada capa, en % de los globos."""
    total = sum(c["peso"] for c in capas) or 1
    return [_redondear((c["peso"] / total) * 100) for c in capas]
