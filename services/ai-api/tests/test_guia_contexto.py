"""Lo que la resolución ya sabe de cada pieza, en la guía de escena (``mezclas[]`` de ``plan-guia-escena.v1``).

- **Qué globo es cada material**: la leyenda del armado resuelto o las líneas del catálogo dicen si es látex,
  foil o burbuja y de cuántas pulgadas. Un corazón metalizado de 18" se dibuja foil de 18", no látex R-12; la
  figura es de foil por el tipo de su material, no por su nombre; y los tamaños del látex son los de la
  ``mezcla_real``.
- **Dónde queda**: un bouquet de helio se publica ``flotante`` con la altura de su globo más bajo sobre el piso
  (la del diseñador del clasificador); el de base de aire o a ras del suelo, ``piso``.
- **La forma de la figura** sin silueta conocida sigue la proporción de la caja de la foto.
- **La pared no densa** que compra globos link se dibuja en malla de links.
- **El gancho** sigue aceptando módulos de dos parámetros, y el contrato admite los campos nuevos.
"""

from __future__ import annotations

import types
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest

import app.guia_piezas as paquete
from app.arco.tipos import INFLADO_PULG
from app.dibujo_estructura import globos_de as globos_del_dibujo
from app.guia_escena import (
    PlanGuiaEscenaRequest,
    contexto_de_pieza,
    guia_escena,
    hex_del_material,
    pieza_de_guia,
)
from app.guia_piezas import ContextoPieza, MaterialGuia, PiezaDePlugin, pieza_de_plugin
from app.guia_piezas.figura import globos_de as globos_de_figura
from tests.guirnalda_datos import material
from tests.test_plan_armado import _bouquet, _plan, _resolve

R12_M = INFLADO_PULG[12] * 0.0254 / 2
#: El corazón foil de 18" del diseñador del ramo: 46 cm de alto y 1,08 de ancho por alto (``motor.py``).
CORAZON_18_M = 0.46 * 1.08 / 2
CONTEXTO_HTTP: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000c00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "body_sha256": "a" * 64,
    "scopes": ["plan.guia_escena"],
}


def _linea(
    product_id: str,
    titulo: str,
    *,
    color: str,
    forma: str | None,
    diam: float | None,
    codigo: str | None,
    variant_id: str | None = None,
) -> dict[str, object]:
    return {
        "product_id": product_id,
        "variant_id": variant_id or f"var-{product_id}",
        "titulo": titulo,
        "color": color,
        "tamano_codigo": codigo,
        "diam_pulg": diam,
        "forma": forma,
        "acabado": None,
    }


def _datos(
    resuelto: Mapping[str, object], **extra: object
) -> tuple[dict[str, Any], dict[str, Any]]:
    """La estructura del plan resuelto y su entrada de ``mezclas[]`` como la arma TypeScript."""
    estructura = cast(dict[str, Any], cast(dict[str, Any], resuelto["plan"])["estructuras"][0])
    resuelta = cast(list[dict[str, Any]], resuelto["estructuras"])[0]
    lineas = [
        {
            clave: linea[clave]
            for clave in (
                "product_id",
                "variant_id",
                "titulo",
                "color",
                "tamano_codigo",
                "diam_pulg",
                "forma",
                "acabado",
            )
        }
        for linea in resuelta["lineas"]
    ]
    return estructura, {
        "estructura_id": estructura["estructura_id"],
        "mezcla_real": resuelta["mezcla_real"],
        "lineas": lineas,
        **extra,
    }


def _radios_por_color(pieza: Mapping[str, object]) -> dict[str, set[float]]:
    radios: dict[str, set[float]] = {}
    for disco in cast(list[dict[str, Any]], pieza["discos"]):
        radios.setdefault(disco["hex"], set()).add(disco["r_m"])
    return radios


# --- Qué globo es cada material -------------------------------------------------------------------


@pytest.mark.anyio
async def test_el_corazon_metalizado_de_18_sin_armado_se_dibuja_foil_de_18() -> None:
    estructura, datos = _datos(await _resolve(_plan(_bouquet())))
    assert estructura.get("armado_bouquet") is None
    tonos = [hex_del_material(m) for m in estructura["materiales"]]

    sin_contexto = pieza_de_guia(estructura, datos["mezcla_real"])
    con_contexto = pieza_de_guia(estructura, datos["mezcla_real"], datos)
    assert not isinstance(sin_contexto, str) and not isinstance(con_contexto, str)

    # Sin lo que sabe la resolución, todo es un látex R-12 (lo de siempre).
    assert all(
        r == pytest.approx(R12_M, abs=1e-4) for r in _radios_por_color(sin_contexto)[tonos[2]]
    )
    # Con las líneas resueltas, el corazón es el foil de 18" del diseñador y el látex sigue en R-12.
    radios = _radios_por_color(con_contexto)
    assert [round(r, 3) for r in radios[tonos[2]]] == [round(CORAZON_18_M, 3)]
    assert all(r == pytest.approx(R12_M, abs=1e-4) for r in radios[tonos[0]] | radios[tonos[1]])
    assert Counter(d["hex"] for d in cast(list[dict[str, Any]], con_contexto["discos"])) == {
        tonos[0]: 3,
        tonos[1]: 3,
        tonos[2]: 1,
    }


@pytest.mark.anyio
async def test_la_leyenda_del_armado_resuelto_manda_sobre_las_lineas() -> None:
    resuelto = await _resolve(_plan(_bouquet()), completar_armados=True)
    leyenda = cast(list[dict[str, Any]], resuelto["armados_bouquet"])[0]["leyenda"]
    estructura, datos = _datos(resuelto, leyenda=leyenda)

    # La leyenda de la resolución dice exactamente lo que el catálogo sabía de cada material.
    contexto = contexto_de_pieza(estructura, datos)
    assert [m.tipo if m else None for m in contexto.materiales] == ["latex", "latex", "metalizado"]
    assert contexto.materiales[2] == MaterialGuia("metalizado", 18.0, "corazon", None)

    # Y si la leyenda dice otra cosa que las líneas, manda la leyenda.
    otra = [dict(e) for e in leyenda]
    for entrada in otra:
        if entrada["material"] == 2:
            entrada.update(tipo_globo="metalizado", tamano_pulg=36)
    reescrito = contexto_de_pieza(estructura, {**datos, "leyenda": otra})
    assert reescrito.materiales[2] is not None and reescrito.materiales[2].tamano_pulg == 36

    pieza = pieza_de_guia(estructura, datos["mezcla_real"], {**datos, "leyenda": otra})
    assert not isinstance(pieza, str)
    tono_foil = hex_del_material(estructura["materiales"][2])
    assert [round(r, 4) for r in _radios_por_color(pieza)[tono_foil]] == [round(36 * 0.0254 / 2, 4)]


def _figura(nombre: str, **extra: object) -> dict[str, object]:
    return {
        "estructura_id": "EST_04_FIGURA",
        "nombre": nombre,
        "tipo": "kit",
        "estructura_oficial": "figura",
        "rol_escena": "focal",
        "ubicacion": "piso_frontal",
        "medidas": {"alto_m": 1.2},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [material("rosado", 0.75, principal=True), material("blanco", 0.25)],
        "porque": "Figura de prueba.",
        "unidades_declaradas": 40,
        **extra,
    }


ROSA, BLANCO, DORADO = "#ff3d8b", "#ffffff", "#d4af37"


def test_la_figura_es_de_foil_por_el_tipo_de_su_material_no_por_el_nombre() -> None:
    # Un osito: un foil dorado de 34" (un globo) y látex rosado y blanco. Nada en el nombre dice foil.
    estructura = _figura(
        "Osito",
        materiales=[
            material("dorado", 0.025, principal=True),
            material("rosado", 0.725),
            material("blanco", 0.25),
        ],
    )
    lineas = [
        _linea(
            "prod-dorado",
            "Globo Metalizado Osito Dorado",
            color="dorado",
            forma=None,
            diam=None,
            codigo="34 IN",
        ),
        _linea(
            "prod-rosado",
            "Globo látex rosado R-12",
            color="rosado",
            forma="redondo",
            diam=12,
            codigo="R-12",
        ),
    ]
    colores = [DORADO, ROSA, BLANCO]
    sin = globos_de_figura(estructura, colores)
    con = globos_de_figura(estructura, colores, contexto_de_pieza(estructura, {"lineas": lineas}))
    assert sin is not None and con is not None
    # Sin contexto: un óvalo de látex, ningún globo grande.
    assert max(r for _x, _y, r, _t in sin) < 0.2
    # Con contexto: la figura es el foil dorado, de su tamaño de etiqueta (34" = 0,86 m de alto), y el látex
    # va a sus pies en R-12.
    grandes = [g for g in con if g[2] > 0.3]
    assert len(grandes) == 1 and grandes[0][3] == DORADO
    assert grandes[0][2] == pytest.approx(34 * 0.0254 / 2)
    assert all(r == pytest.approx(R12_M) for _x, _y, r, t in con if t != DORADO)
    assert Counter(t for *_xyr, t in con) == Counter(t for *_xyr, t in sin)


def test_los_tamanos_de_la_figura_son_los_de_la_mezcla_real() -> None:
    estructura = _figura("Osito")  # Declara ``clasica`` (R-12)…
    mezcla_real = [{"diam_pulg": 5, "forma": "redondo", "unidades": 40, "pct": 100}]
    globos = globos_de_figura(
        estructura, [ROSA, BLANCO], ContextoPieza(mezcla_real=tuple(mezcla_real))
    )
    assert globos is not None
    # … pero lo que se compra es R-5, y así se dibuja.
    assert {round(r, 6) for _x, _y, r, _t in globos} == {round(INFLADO_PULG[5] * 0.0254 / 2, 6)}
    # Un foil de la mezcla (sin forma y del tamaño de un foil de la pieza) no se toma por látex.
    contexto = ContextoPieza(
        mezcla_real=(
            {"diam_pulg": 18, "forma": None, "unidades": 1, "pct": 5},
            {"diam_pulg": 9, "forma": "redondo", "unidades": 19, "pct": 95},
        ),
        materiales=(MaterialGuia("metalizado", 18.0), None),
    )
    assert contexto.tamanos_latex((5, 9, 12, 18, 24, 36)) == ((9, 19.0),)


# --- Dónde queda: el bouquet de helio flota ------------------------------------------------------------


@pytest.mark.anyio
async def test_el_bouquet_de_helio_flota_a_la_altura_de_sus_cintas() -> None:
    estructura, datos = _datos(await _resolve(_plan(_bouquet())))
    pieza = pieza_de_guia(estructura, datos["mezcla_real"], datos)
    assert not isinstance(pieza, str)
    # El ramo clásico del clasificador cuelga de cintas de 1,1 m sobre una pesa (``formas.ts``, ``motor.ts``).
    assert pieza["anclaje"] == "flotante"
    assert 1.0 < cast(float, pieza["elevacion_m"]) < 1.6
    # El marco local sigue siendo el de siempre: los discos empiezan en 0.
    assert min(
        d["y_m"] - d["r_m"] for d in cast(list[dict[str, Any]], pieza["discos"])
    ) == pytest.approx(0, abs=1e-3)


@pytest.mark.anyio
async def test_el_armado_de_helio_flota_sobre_su_pesa_y_el_de_aire_queda_en_el_piso() -> None:
    resuelto = await _resolve(_plan(_bouquet()), completar_armados=True)
    estructura, datos = _datos(resuelto)
    armado = cast(dict[str, Any], estructura["armado_bouquet"])
    assert armado["variante"] != "base_aire"
    pieza = pieza_de_guia(estructura, datos["mezcla_real"], datos)
    assert not isinstance(pieza, str) and pieza["anclaje"] == "flotante"
    # La pesa y 0,35 m de cinta (``armado.ts``): el globo más bajo queda por encima.
    assert cast(float, pieza["elevacion_m"]) >= 0.35

    de_aire = {**estructura, "armado_bouquet": {**armado, "variante": "base_aire"}}
    en_piso = pieza_de_guia(de_aire, datos["mezcla_real"], datos)
    assert not isinstance(en_piso, str)
    assert en_piso["anclaje"] == "piso" and "elevacion_m" not in en_piso


def test_el_ramo_a_ras_del_suelo_es_de_piso() -> None:
    from app.guia_piezas.bouquet import pieza_de

    ramo = {**_bouquet(), "forma": "piso"}  # La forma del ramo, como la lee ``RAMO_FORMA``.
    pieza = pieza_de(ramo, ["#ff0000", "#00ff00", "#0000ff"])
    assert pieza is not None and pieza.anclaje == "piso" and pieza.elevacion_m is None


# --- La forma de la figura sigue a la foto --------------------------------------------------------------


def _proporcion(globos: Sequence[tuple[float, float, float, str]]) -> float:
    ancho = max(x + r for x, _y, r, _t in globos) - min(x - r for x, _y, r, _t in globos)
    alto = max(y + r for _x, y, r, _t in globos) - min(y - r for _x, y, r, _t in globos)
    return alto / ancho


def test_la_figura_sin_silueta_toma_la_proporcion_de_su_caja_en_la_foto() -> None:
    estructura = _figura("Jirafa", unidades_declaradas=120)
    colores = [ROSA, BLANCO]
    alta = globos_de_figura(estructura, colores, ContextoPieza(aspecto_caja=3.0))
    ancha = globos_de_figura(estructura, colores, ContextoPieza(aspecto_caja=0.45))
    de_siempre = globos_de_figura(estructura, colores)
    assert alta is not None and ancha is not None and de_siempre is not None
    assert _proporcion(alta) > 2.2, "una jirafa alta sale alta"
    assert _proporcion(ancha) < 0.7, "una figura ancha sale ancha"
    assert 1.1 < _proporcion(de_siempre) < 1.7, "sin foto, el óvalo vertical de siempre"
    # Los mismos globos, solo en otra forma.
    assert Counter(t for *_xyr, t in alta) == Counter(t for *_xyr, t in de_siempre)
    # Una caja absurda (20:1) se acota: sigue siendo una figura, no una línea.
    assert (
        _proporcion(
            cast(list[Any], globos_de_figura(estructura, colores, ContextoPieza(aspecto_caja=20)))
        )
        < 4.5
    )


# --- La pared no densa que compra links --------------------------------------------------------------


def _pared(forma: str | None = None) -> dict[str, object]:
    pieza: dict[str, object] = {
        "estructura_id": "EST_PARED",
        "nombre": "Pared",
        "tipo": "pared",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 2.4, "alto_m": 2.2},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("rosado", 0.5, principal=True), material("blanco", 0.5)],
        "porque": "Pieza de prueba.",
        "estructura_oficial": "pared_no_densa",
    }
    if forma is not None:
        pieza["forma"] = forma
    return pieza


MEZCLA_PARED = ({"diam_pulg": 12, "forma": "redondo", "unidades": 80, "pct": 100.0},)
LINKS = [
    _linea("prod-rosado", "Globo Link rosado", color="rosado", forma="link", diam=12, codigo="L-12")
]
REDONDOS = [
    _linea(
        "prod-rosado", "Globo látex rosado", color="rosado", forma="redondo", diam=12, codigo="R-12"
    )
]


def _cuantos(pieza: dict[str, object] | str) -> int:
    assert not isinstance(pieza, str)
    return len(cast(list[object], pieza["discos"]))


def test_la_pared_no_densa_que_compra_links_se_dibuja_en_malla_de_links() -> None:
    malla = globos_del_dibujo(_pared("malla-links"), MEZCLA_PARED)
    cuadriculada = globos_del_dibujo(_pared(), MEZCLA_PARED)
    assert malla is not None and cuadriculada is not None and len(malla) != len(cuadriculada)

    con_links = pieza_de_guia(_pared(), MEZCLA_PARED, {"lineas": LINKS})
    assert _cuantos(con_links) == len(malla)
    # Sin links comprados (o sin líneas), la de siempre: cuadriculada.
    assert _cuantos(pieza_de_guia(_pared(), MEZCLA_PARED, {"lineas": REDONDOS})) == len(
        cuadriculada
    )
    assert _cuantos(pieza_de_guia(_pared(), MEZCLA_PARED)) == len(cuadriculada)
    # Una forma elegida manda.
    elegida = globos_del_dibujo(_pared("rombos"), MEZCLA_PARED)
    assert elegida is not None
    assert _cuantos(pieza_de_guia(_pared("rombos"), MEZCLA_PARED, {"lineas": LINKS})) == len(
        elegida
    )


# --- El gancho y el contrato ---------------------------------------------------------------------------


def test_un_modulo_de_dos_parametros_sigue_funcionando(monkeypatch: pytest.MonkeyPatch) -> None:
    recibidos: list[int] = []

    def antiguo(
        estructura: Mapping[str, object], colores: Sequence[str]
    ) -> list[tuple[float, float, float, str]]:
        recibidos.append(len(colores))
        return [(0.0, 0.2, 0.2, colores[0])]

    def nuevo(
        estructura: Mapping[str, object],
        colores: Sequence[str],
        contexto: ContextoPieza | None = None,
    ) -> PiezaDePlugin:
        assert contexto is not None and contexto.aspecto_caja == 2.0
        return PiezaDePlugin([(0.0, 1.0, 0.2, colores[0])], anclaje="flotante", elevacion_m=0.8)

    modulo_antiguo = types.ModuleType("antiguo")
    modulo_antiguo.globos_de = antiguo  # type: ignore[attr-defined]
    monkeypatch.setattr(paquete, "_modulos", lambda: [modulo_antiguo])
    pieza = pieza_de_plugin({}, ["#123456"], ContextoPieza(aspecto_caja=2.0))
    assert pieza == PiezaDePlugin([(0.0, 0.2, 0.2, "#123456")]) and recibidos == [1]

    modulo_nuevo = types.ModuleType("nuevo")
    modulo_nuevo.pieza_de = nuevo  # type: ignore[attr-defined]
    monkeypatch.setattr(paquete, "_modulos", lambda: [modulo_nuevo])
    assert pieza_de_plugin({}, ["#123456"], ContextoPieza(aspecto_caja=2.0)) == PiezaDePlugin(
        [(0.0, 1.0, 0.2, "#123456")], anclaje="flotante", elevacion_m=0.8
    )


@pytest.mark.anyio
async def test_el_contrato_admite_los_datos_nuevos_y_la_respuesta_lleva_el_anclaje() -> None:
    resuelto = await _resolve(_plan(_bouquet()), completar_armados=True)
    leyenda = [
        {k: e[k] for k in ("material", "tipo_globo", "tamano_pulg", "digito")}
        for e in cast(list[dict[str, Any]], resuelto["armados_bouquet"])[0]["leyenda"]
    ]
    estructura, datos = _datos(resuelto, leyenda=leyenda, aspecto_caja=1.6)
    cuerpo = {
        "context": CONTEXTO_HTTP,
        "schema_version": "plan-guia-escena.v1",
        "plan": resuelto["plan"],
        "mezclas": [datos],
    }
    resultado = guia_escena(PlanGuiaEscenaRequest.model_validate(cuerpo))
    pieza = cast(list[dict[str, Any]], resultado["piezas"])[0]
    assert pieza["estructura_id"] == estructura["estructura_id"]
    assert pieza["anclaje"] == "flotante" and pieza["elevacion_m"] > 0

    for malo in (
        {**datos, "leyenda": [{**leyenda[0], "tipo_globo": "papel"}]},
        {**datos, "aspecto_caja": 0},
        {**datos, "lineas": [{**datos["lineas"][0], "unidades": 3}]},
    ):
        with pytest.raises(ValueError):
            PlanGuiaEscenaRequest.model_validate({**cuerpo, "mezclas": [malo]})
