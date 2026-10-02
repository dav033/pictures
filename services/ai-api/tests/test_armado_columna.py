"""Paridad del motor de columna con ``clasificador-decoraciones``, su fuente de verdad.

Los vectores de ``contracts/domain/v1/golden/columna/vectores-columna.json`` los genera el **otro** repo
(``scripts/migracion/vectores-columna.ts``) con el motor de TypeScript. Son un oráculo congelado, como los de
``plan-resolution``: no se regeneran para que una prueba pase, porque entonces la prueba aceptaría cualquier
comportamiento. Si un vector deja de cuadrar, o el puerto se desvió (se arregla aquí) o el criterio cambió
allá (se cambia allá y se vuelven a generar, diciendo por qué).

Qué se compara, por caso:

- la **huella** de todos los globos (posición, radio, profundidad, color del patrón, tono, tamaño, capa y
  puesto), que es lo que delata cualquier desvío por pequeño que sea;
- el detalle globo por globo en los 44 casos con nombre, que es con lo que se depura;
- las capas, los totales, el conteo por color y tamaño, el remate, los avisos, las medidas y la compra;
- que ``sanear`` es **idempotente**: volver a sanear un diseño ya saneado no cambia nada ni avisa de nada;
- que ``normalizar_config`` llega al mismo diseño saneado partiendo de la misma entrada cruda.
"""

from __future__ import annotations

import json
import math
from hashlib import sha256
from pathlib import Path
from typing import Any, Mapping

import pytest

# `_redondear` es del puente entre lenguajes, no de la puerta: se toma de donde vive.
from app.columna.js import _redondear
from app.armado_columna import (
    PATRON_IDS,
    ArmadoInvalido,
    EstructuraColumna,
    PATRONES,
    CapaColumna,
    Columna,
    Config,
    Globo,
    Real,
    Remate,
    Resultado,
    calcular_compra,
    calcular_medidas,
    capas_de,
    crear_capas,
    generar,
    normalizar_config,
    armado_resuelto,
    opciones_admitidas,
    opciones_iniciales,
    sanear,
    validar,
)

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "columna"
    / "vectores-columna.json"
)

VECTORES: list[Mapping[str, Any]] = json.loads(GOLDEN.read_text(encoding="utf-8"))["vectores"]
POR_NOMBRE = {v["nombre"]: v for v in VECTORES}


# ---------------------------------------------------------------------------
# Lectura de un vector
# ---------------------------------------------------------------------------


def _config(crudo: Mapping[str, Any]) -> Config:
    """El diseño del vector, tal cual: ya viene saneado, así que no se vuelve a sanear."""
    col = crudo["columna"]
    glo = crudo["globo"]
    rem = crudo["remate"]
    real = crudo["real"]
    opciones = opciones_iniciales()
    for pid in PATRON_IDS:
        for clave, valor in crudo["opciones"].get(pid, {}).items():
            opciones[pid][clave] = valor
    return Config(
        modo=crudo["modo"],
        capas=[CapaColumna(tamano=k["tamano"], colores=list(k["colores"])) for k in crudo["capas"]],
        patron=crudo["patron"],
        columna=Columna(
            alto_m=col["altoM"],
            globos_capa=col["globosCapa"],
            abajo=col["abajo"],
            arriba=col["arriba"],
            escalonado=col["escalonado"],
            base=col["base"],
            persona=col["persona"],
        ),
        globo=Globo(
            inflado=glo["inflado"],
            tamano=glo["tamano"],
            compresion=glo["compresion"],
            variacion_tam=glo["variacionTam"],
            variacion_tono=glo["variacionTono"],
            desorden=glo["desorden"],
            brillo=glo["brillo"],
            sombra=glo["sombra"],
            contorno=glo["contorno"],
            profundidad=glo["profundidad"],
            semilla=glo["semilla"],
        ),
        remate=Remate(
            tipo=rem["tipo"],
            tamano=rem["tamano"],
            cantidad=rem["cantidad"],
            foil_m=rem["foilM"],
            color=rem["color"],
        ),
        real=Real(
            desperdicio=real["desperdicio"], precio=real["precio"], cantidad=real["cantidad"]
        ),
        colores=list(crudo["colores"]),
        opciones=opciones,
    )


def _a_dict(cfg: Config) -> dict[str, Any]:
    """El diseño con la misma forma con la que lo escribe el motor, para comparar sin traducir a mano."""
    return {
        "modo": cfg.modo,
        "capas": [{"tamano": k.tamano, "colores": list(k.colores)} for k in cfg.capas],
        "patron": cfg.patron,
        "columna": {
            "altoM": cfg.columna.alto_m,
            "globosCapa": cfg.columna.globos_capa,
            "abajo": cfg.columna.abajo,
            "arriba": cfg.columna.arriba,
            "escalonado": cfg.columna.escalonado,
            "base": cfg.columna.base,
            "persona": cfg.columna.persona,
        },
        "globo": {
            "inflado": cfg.globo.inflado,
            "tamano": cfg.globo.tamano,
            "compresion": cfg.globo.compresion,
            "variacionTam": cfg.globo.variacion_tam,
            "variacionTono": cfg.globo.variacion_tono,
            "desorden": cfg.globo.desorden,
            "brillo": cfg.globo.brillo,
            "sombra": cfg.globo.sombra,
            "contorno": cfg.globo.contorno,
            "profundidad": cfg.globo.profundidad,
            "semilla": cfg.globo.semilla,
        },
        "remate": {
            "tipo": cfg.remate.tipo,
            "tamano": cfg.remate.tamano,
            "cantidad": cfg.remate.cantidad,
            "foilM": cfg.remate.foil_m,
            "color": cfg.remate.color,
        },
        "real": {
            "desperdicio": cfg.real.desperdicio,
            "precio": cfg.real.precio,
            "cantidad": cfg.real.cantidad,
        },
        "colores": list(cfg.colores),
        "opciones": {pid: dict(cfg.opciones[pid]) for pid in PATRON_IDS},
    }


# ---------------------------------------------------------------------------
# Comparación
# ---------------------------------------------------------------------------


def _r9(valor: float) -> float:
    """El mismo redondeo del generador de vectores: nueve decimales."""
    return _redondear(valor * 1e9) / 1e9


def _nueve(valor: float) -> str:
    """``toFixed(9)``: el formato con el que se arma la huella en los dos lenguajes."""
    if valor == 0:
        return "0.000000000"
    return f"{valor:.9f}"


def _huella(res: Resultado) -> str:
    lineas = [
        ",".join(
            [
                _nueve(b.x),
                _nueve(b.y),
                _nueve(b.z),
                _nueve(b.r),
                _nueve(b.prof),
                b.base,
                b.color,
                str(b.nominal),
                str(b.capa),
                str(b.k),
            ]
        )
        for b in res.globos
    ]
    return sha256(";".join(lineas).encode("utf-8")).hexdigest()


def _iguales(a: object, b: object, ruta: str = "") -> list[str]:
    """Diferencias entre dos valores, con tolerancia solo en los números (``1e-9``, como los vectores)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return [] if a == b else [f"{ruta}: {a!r} != {b!r}"]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(float(a)) and math.isnan(float(b)):
            return []
        return [] if abs(float(a) - float(b)) <= 1e-9 else [f"{ruta}: {a!r} != {b!r}"]
    if isinstance(a, Mapping) and isinstance(b, Mapping):
        fallos = []
        for clave in sorted(set(a) | set(b)):
            if clave not in a or clave not in b:
                fallos.append(f"{ruta}.{clave}: solo en uno ({clave in a} / {clave in b})")
            else:
                fallos.extend(_iguales(a[clave], b[clave], f"{ruta}.{clave}"))
        return fallos
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return [f"{ruta}: largos {len(a)} != {len(b)}"]
        fallos = []
        for i, (x, y) in enumerate(zip(a, b)):
            fallos.extend(_iguales(x, y, f"{ruta}[{i}]"))
        return fallos
    return [] if a == b else [f"{ruta}: {a!r} != {b!r}"]


NOMBRES = [v["nombre"] for v in VECTORES]


@pytest.fixture(scope="module")
def _hay_vectores() -> None:
    assert VECTORES, "no hay vectores: hay que generarlos desde clasificador-decoraciones"


def test_los_vectores_estan_completos(_hay_vectores: None) -> None:
    """Los vectores cubren los nueve patrones, los cinco remates, los dos modos y la basura."""
    for pid in PATRON_IDS:
        assert f"patron-{pid}" in POR_NOMBRE
    for tipo in ("ninguno", "globo", "racimo", "estrella", "corazon"):
        assert f"remate-{tipo}" in POR_NOMBRE
    for nombre in ("capas-a-mano", "capas-desde-altura", "capas-salto-brusco"):
        assert nombre in POR_NOMBRE
    for nombre in ("basura-vacia", "basura-nula", "basura-texto", "basura-mezclada", "basura-colores"):
        assert nombre in POR_NOMBRE
    assert any(v["cfg"]["modo"] == "capas" for v in VECTORES)
    # Los casos al azar van solo por huella; los que tienen nombre llevan el detalle de cada globo.
    con_detalle = sum(1 for v in VECTORES if v["globos"] is not None)
    assert con_detalle >= 45
    assert len(VECTORES) >= con_detalle + 90


@pytest.mark.parametrize("nombre", NOMBRES)
def test_la_huella_de_los_globos_cuadra(nombre: str) -> None:
    """Dónde va cada globo y de qué color es, en un solo número: es la prueba del 1 a 1."""
    vector = POR_NOMBRE[nombre]
    res = generar(_config(vector["cfg"]))
    assert _huella(res) == vector["huella"]


@pytest.mark.parametrize("nombre", NOMBRES)
def test_capas_totales_conteo_y_remate(nombre: str) -> None:
    vector = POR_NOMBRE[nombre]
    cfg = _config(vector["cfg"])
    res = generar(cfg)

    capas = [
        {"y": _r9(k.y), "d": _r9(k.d), "nominal": k.nominal, "rho": _r9(k.rho), "n": k.n}
        for k in capas_de(cfg)
    ]
    fallos = _iguales(capas, vector["capas"], "capas")

    if vector["capasPorAltura"] is not None:
        por_altura = [
            {"y": _r9(k.y), "d": _r9(k.d), "nominal": k.nominal, "rho": _r9(k.rho), "n": k.n}
            for k in crear_capas(cfg)
        ]
        fallos += _iguales(por_altura, vector["capasPorAltura"], "capasPorAltura")

    fallos += _iguales(
        {
            "capas": res.capas,
            "globos": len(res.globos),
            "altoCuerpoM": _r9(res.alto_cuerpo_m),
            "altoTotalM": _r9(res.alto_total_m),
            "diametroM": _r9(res.diametro_m),
            "rematAltoM": _r9(res.remate_alto_m),
        },
        vector["totales"],
        "totales",
    )
    fallos += _iguales(res.conteo, vector["conteo"], "conteo")
    fallos += _iguales(
        {str(t): n for t, n in res.por_tamano.items()}, vector["porTamano"], "porTamano"
    )
    esperado_remate = dict(vector["remate"])
    obtenido_remate: dict[str, Any] = {
        "descripcion": res.remate.descripcion,
        "globos": res.remate.globos,
    }
    if "foil" in esperado_remate:
        obtenido_remate["foil"] = res.remate.foil
    fallos += _iguales(obtenido_remate, esperado_remate, "remate")
    fallos += _iguales(res.avisos, vector["avisos"], "avisos")
    assert not fallos, "\n".join(fallos[:12])


@pytest.mark.parametrize("nombre", NOMBRES)
def test_medidas_y_compra(nombre: str) -> None:
    vector = POR_NOMBRE[nombre]
    cfg = _config(vector["cfg"])
    res = generar(cfg)
    medidas = calcular_medidas(res, cfg)
    compra = calcular_compra(res, cfg)

    fallos = _iguales(
        {
            "altoCuerpoM": _r9(medidas.alto_cuerpo_m),
            "altoTotalM": _r9(medidas.alto_total_m),
            "diametroCm": _r9(medidas.diametro_cm),
            "capas": medidas.capas,
            "globos": medidas.globos,
            "globosPorMetro": _r9(medidas.globos_por_metro),
            "formulaClasica": _r9(medidas.formula_clasica),
            "diametrosCm": {str(t): _r9(v) for t, v in medidas.diametros_cm.items()},
        },
        vector["medidas"],
        "medidas",
    )
    fallos += _iguales(
        {
            "filas": [
                {
                    "color": f.color,
                    "porTamano": {str(t): n for t, n in f.por_tamano.items()},
                    "cantidad": f.cantidad,
                    "comprar": f.comprar,
                    "remate": f.remate,
                }
                for f in compra.filas
            ],
            "tamanos": compra.tamanos,
            "total": compra.total,
            "foil": compra.foil,
            "veces": compra.veces,
        },
        vector["compra"],
        "compra",
    )
    assert not fallos, "\n".join(fallos[:12])


@pytest.mark.parametrize(
    "nombre", [v["nombre"] for v in VECTORES if v["globos"] is not None]
)
def test_el_detalle_de_cada_globo(nombre: str) -> None:
    """Globo por globo en los casos con nombre: es lo que dice *dónde* se desvió el puerto."""
    vector = POR_NOMBRE[nombre]
    res = generar(_config(vector["cfg"]))
    obtenidos = [
        [_r9(b.x), _r9(b.y), _r9(b.z), _r9(b.r), b.base, b.nominal, b.capa, b.k, _r9(b.prof)]
        for b in res.globos
    ]
    fallos = _iguales(obtenidos, vector["globos"], "globos")
    fallos += _iguales([b.color for b in res.globos], vector["tonos"], "tonos")
    assert not fallos, "\n".join(fallos[:12])


@pytest.mark.parametrize("nombre", NOMBRES)
def test_sanear_es_idempotente(nombre: str) -> None:
    """Un diseño ya saneado no vuelve a cambiar ni vuelve a avisar."""
    vector = POR_NOMBRE[nombre]
    cfg = _config(vector["cfg"])
    saneada, cambios = sanear(cfg)
    assert cambios == vector["cambiosAlSanearDeNuevo"]
    assert not _iguales(_a_dict(saneada), vector["cfg"], "cfg")


def _lleva_referencia_de_catalogo(entrada: object) -> bool:
    """Una entrada con un ``sx:041``: su color lo resuelve el catálogo antes de llegar al motor."""
    return "sx:" in json.dumps(entrada)


@pytest.mark.parametrize(
    "nombre", [v["nombre"] for v in VECTORES if not _lleva_referencia_de_catalogo(v["entrada"])]
)
def test_normalizar_llega_al_mismo_diseno(nombre: str) -> None:
    """Desde la misma entrada cruda —incluida la basura— se llega al mismo diseño saneado."""
    vector = POR_NOMBRE[nombre]
    assert not _iguales(_a_dict(normalizar_config(vector["entrada"])), vector["cfg"], "cfg")


def test_los_patrones_declaran_los_colores_que_necesitan() -> None:
    """Lo que el motor exige de cada patrón, que es de donde sale un aviso de `sanear`."""
    minimos = {pid: PATRONES[pid].min_colores for pid in PATRON_IDS}
    assert minimos == {
        "solido": 1,
        "apilado": 2,
        "espiral": 2,
        "rayas": 2,
        "zigzag": 2,
        "diamante": 2,
        "punteado": 2,
        "ombre": 3,
        "aleatorio": 2,
    }


# ---------------------------------------------------------------------------
# La puerta: validar un armado y resolverlo
# ---------------------------------------------------------------------------


def _armado(**cambios: Any) -> dict[str, Any]:
    """Un armado equivalente al diseño inicial del motor (espiral azul y blanco, remate R24)."""
    armado: dict[str, Any] = {
        "version": "armado-columna.v1",
        "origen": "decorador",
        "modo": "altura",
        "patron": "espiral",
        "opciones": {"vueltas": 2, "inclinacion": 1},
        "cuerpo": {
            "alto_m": 1.6,
            "globos_capa": 4,
            "abajo": 12,
            "arriba": 12,
            "escalonado": True,
            "base": True,
        },
        "inflado": {
            "inflado": 1,
            "tamano": 1.14,
            "compresion": 0.8,
            "variacion_tam": 0,
            "variacion_tono": 0.03,
            "desorden": 0,
            "semilla": 7,
        },
        "remate": {"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 1},
        "capas": [],
        "materiales": [0, 1],
    }
    armado.update(cambios)
    return armado


COLUMNA = EstructuraColumna(es_columna=True, materiales=["#1d4ed8", "#ffffff"])


def test_resolver_un_armado_da_la_misma_columna_que_el_motor() -> None:
    """El armado del plan y el diseño del motor son la misma columna, globo por globo."""
    vector = POR_NOMBRE["inicial"]
    resuelto = armado_resuelto(COLUMNA, _armado())

    assert resuelto["version"] == "armado-columna.v1"
    assert resuelto["capas"] == vector["totales"]["capas"]
    assert len(resuelto["globos"]) == vector["totales"]["globos"]
    assert _r9(resuelto["alto_cuerpo_m"]) == vector["totales"]["altoCuerpoM"]
    assert _r9(resuelto["alto_total_m"]) == vector["totales"]["altoTotalM"]
    assert _r9(resuelto["diametro_m"]) == vector["totales"]["diametroM"]

    # Cada globo, en el mismo sitio y con el material que corresponde a su color del vector.
    por_color = {"#1d4ed8": 0, "#ffffff": 1}
    fallos: list[str] = []
    for globo, esperado in zip(resuelto["globos"], vector["globos"]):
        fallos += _iguales(
            [
                _r9(globo["x"]),
                _r9(globo["y"]),
                _r9(globo["z"]),
                _r9(globo["r"]),
                globo["material"],
                globo["tamano"],
                globo["capa"],
                globo["puesto"],
                _r9(globo["prof"]),
            ],
            [*esperado[:4], por_color[esperado[4]], *esperado[5:]],
            f"globo[{globo['capa']}:{globo['puesto']}]",
        )
    assert not fallos, "\n".join(fallos[:12])

    # El conteo sale por material, no por tono, y el remate con el suyo.
    assert resuelto["conteo"] == [
        {"material": 0, "tamano": 12, "cantidad": 14},
        {"material": 1, "tamano": 12, "cantidad": 14},
    ]
    assert resuelto["remate"] == {
        "descripcion": "Globo de R24",
        "globos": [{"material": 1, "tamano": 24, "cantidad": 1}],
    }
    assert resuelto["avisos"] == []


def test_dos_materiales_del_mismo_tono_no_se_confunden() -> None:
    """Dos colores iguales en la estructura siguen siendo dos materiales distintos."""
    estructura = EstructuraColumna(es_columna=True, materiales=["#ffffff", "#ffffff", "#ffffff"])
    resuelto = armado_resuelto(estructura, _armado(materiales=[2, 0]))
    usados = {g["material"] for g in resuelto["globos"]}
    assert usados == {0, 2}


def test_el_armado_por_capas_se_resuelve_capa_a_capa() -> None:
    resuelto = armado_resuelto(
        COLUMNA,
        _armado(
            modo="capas",
            capas=[
                {"tamano": 18, "materiales": [0, 1, 0, 1]},
                {"tamano": 12, "materiales": [1, 0, 1]},
            ],
        ),
    )
    assert resuelto["capas"] == 2
    primera = [g for g in resuelto["globos"] if g["capa"] == 0]
    segunda = [g for g in resuelto["globos"] if g["capa"] == 1]
    assert len(primera) == 4
    assert len(segunda) == 3
    assert {g["tamano"] for g in primera} == {18}
    assert sorted((g["puesto"], g["material"]) for g in primera) == [(0, 0), (1, 1), (2, 0), (3, 1)]


def test_el_alto_pedido_es_el_pedido_no_el_exacto() -> None:
    """El motor se queda con las capas cuyo alto real queda más cerca del pedido, y puede pasarse.

    Con 6 m pedidos el cuerpo sale en 6,027: es la regla del motor (``crear_capas``), no un defecto.
    Un globo de R12 mide 26,7 cm y las capas no se parten.
    """
    resuelto = armado_resuelto(COLUMNA, _armado(cuerpo={**_armado()["cuerpo"], "alto_m": 6}))
    assert resuelto["avisos"] == []
    assert abs(resuelto["alto_cuerpo_m"] - 6) < 0.8 * 0.267


def test_los_avisos_del_motor_llegan_al_resuelto() -> None:
    """Un alto que no se sostiene se ajusta y se dice, no se acepta en silencio."""
    resuelto = armado_resuelto(COLUMNA, _armado(cuerpo={**_armado()["cuerpo"], "alto_m": 0.2}))
    assert resuelto["avisos"], "un alto de 20 cm con 60 cm de diámetro tiene que avisar"
    assert "El alto se ajustó" in resuelto["avisos"][0]
    assert resuelto["alto_cuerpo_m"] >= 1


def test_un_remate_que_no_cabe_se_cambia_y_se_dice() -> None:
    """Un globo de R5 sobre una columna de 60 cm no es un remate: el motor lo sube y avisa."""
    resuelto = armado_resuelto(
        COLUMNA, _armado(remate={**_armado()["remate"], "tamano": 5})
    )
    assert any("no queda bien sobre una columna" in a for a in resuelto["avisos"])
    assert resuelto["remate"]["globos"][0]["tamano"] > 5


@pytest.mark.parametrize(
    ("cambios", "motivo"),
    [
        ({"version": "armado-columna.v2"}, "version_desconocida"),
        ({"modo": "libre"}, "modo_invalido"),
        ({"patron": "mosaico"}, "patron_invalido"),
        ({"materiales": []}, "sin_materiales"),
        ({"materiales": [0, 1, 2, 3, 4, 5, 6, 7, 8]}, "demasiados_materiales"),
        ({"materiales": [0, 9]}, "material_fuera_de_rango"),
        ({"modo": "capas", "capas": []}, "capas_faltantes"),
        ({"modo": "capas", "capas": [{"tamano": 12, "materiales": [5]}]}, "material_fuera_de_rango"),
        ({"modo": "capas", "capas": [{"tamano": 12, "materiales": []}]}, "capa_sin_colores"),
        ({"remate": {"tipo": "sombrero", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 0}}, "remate_invalido"),
        ({"cuerpo": None}, "forma_invalida"),
    ],
)
def test_un_armado_imposible_se_rechaza_con_su_motivo(
    cambios: dict[str, Any], motivo: str
) -> None:
    with pytest.raises(ArmadoInvalido) as fallo:
        validar(COLUMNA, _armado(**cambios))
    assert fallo.value.motivo == motivo


def test_solo_una_columna_se_arma_asi() -> None:
    otra = EstructuraColumna(es_columna=False, materiales=["#ffffff"])
    with pytest.raises(ArmadoInvalido) as fallo:
        validar(otra, _armado(materiales=[0]))
    assert fallo.value.motivo == "no_es_columna"


def test_las_opciones_salen_del_motor() -> None:
    """Lo que el editor puede ofrecer lo dice el motor, no una lista escrita en la interfaz."""
    opciones = opciones_admitidas()
    assert [p["id"] for p in opciones["patrones"]] == list(PATRON_IDS)
    espiral = next(p for p in opciones["patrones"] if p["id"] == "espiral")
    assert {c["clave"] for c in espiral["controles"]} == {"vueltas", "inclinacion"}
    assert opciones["remates"] == ["ninguno", "globo", "racimo", "estrella", "corazon"]
    assert opciones["globos_capa"] == {"min": 3, "max": 6}
