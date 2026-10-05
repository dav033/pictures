"""El patrón que la foto leyó, puesto en el motor (ADR-0039).

Lo que se prueba aquí es la **traducción** y la receta que la usa: que un apilado de anillos leído en la foto
salga apilado y no en la espiral con la que arranca el diseñador, que un color que no es de la pieza tumbe la
lectura con su aviso en vez de armar otra cosa, y que la lectura no se cuele por delante de un armado que el
modelo propuso y se sostiene. Cómo coloca los globos cada patrón es de ``tests/test_arco.py`` y
``tests/test_armado_columna.py``, contra sus vectores de oro.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

from app.armado_estructura import (
    ArmadoEstructuraRequest,
    OMOIKANE_ARMADO_SCOPE,
    PiezaArmado,
    resolver_armado_estructura,
)
from app.patron_de_la_foto import mezcla_del_motor, patron_del_motor
from app.patron_color import CONFIANZA_MINIMA_PISTA, MaterialPatron

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000b0",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffffe",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": "0" * 64,
}


def _materiales(*colores: str | None) -> list[MaterialPatron]:
    return [
        MaterialPatron(color=color, acabado=None, participacion=1 / max(1, len(colores)))
        for color in colores
    ]


def _pista(modo: str, colores: Sequence[str], **extra: object) -> dict[str, object]:
    return {
        "referencia_element_id": "el-1",
        "modo": modo,
        "colores": list(colores),
        "confianza": 0.9,
        **extra,
    }


def _estructura(
    tipo: str, colores: Sequence[str], *, elemento: str | None = "el-1", **extra: object
) -> dict[str, object]:
    return {
        "estructura_id": "e-1",
        "nombre": "Pieza",
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3.2, "alto_m": 2.3, "largo_m": 4.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": f"prod-{indice}",
                "participacion": round(1 / len(colores), 4),
                "rol_material": "principal" if indice == 0 else "secundario",
                "color": color,
            }
            for indice, color in enumerate(colores)
        ],
        "porque": "Prueba.",
        **({"referencia_element_id": elemento} if elemento else {}),
        **extra,
    }


def _plan(*estructuras: Mapping[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0",
        "concepto": {"titulo": "Prueba", "descripcion": "Prueba.", "paleta": ["rosado"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [dict(estructura) for estructura in estructuras],
    }


def _completar(
    estructuras: Sequence[Mapping[str, object]],
    pistas: Sequence[Mapping[str, object]] = (),
    armados: Sequence[Mapping[str, object]] | None = None,
    remates: Sequence[Mapping[str, object]] = (),
) -> list[dict[str, Any]]:
    peticion = ArmadoEstructuraRequest(
        context=cast(Any, CONTEXTO),
        schema_version="omoikane-armado-estructura.v1",
        accion="completar",
        plan=_plan(*estructuras),
        **cast(Any, {"pistas": list(pistas)} if pistas else {}),
        **cast(Any, {"armados": list(armados)} if armados else {}),
        **cast(Any, {"remates": list(remates)} if remates else {}),
    )
    salida = resolver_armado_estructura(peticion)
    return cast("list[dict[str, Any]]", salida["armados"])


# --- La traducción -------------------------------------------------------------------


def test_anillos_en_una_columna_se_apilan() -> None:
    """Lo que motivó todo: una columna de anillos salía en espiral porque la receta contaba colores."""
    avisos: list[str] = []
    leido = patron_del_motor(
        "columna", _pista("anillos", ["blanco", "dorado"]), _materiales("blanco", "dorado"), avisos
    )
    assert leido is not None
    assert leido.patron == "apilado"
    # Un racimo por color: es el `largo: 1` con el que `patron_color` arma la misma lectura.
    assert leido.opciones == {"grosor": 1.0}
    assert leido.materiales == (0, 1)
    assert avisos == []


def test_anillos_en_un_arco_son_tramos_a_lo_largo() -> None:
    avisos: list[str] = []
    leido = patron_del_motor(
        "arco", _pista("anillos", ["blanco", "dorado"]), _materiales("blanco", "dorado"), avisos
    )
    assert leido is not None
    assert leido.patron == "bloques"
    assert leido.opciones == {"largo": 1.0}


def test_la_espiral_de_la_foto_es_la_espiral_del_motor() -> None:
    for tipo in ("arco", "columna"):
        leido = patron_del_motor(
            tipo, _pista("espiral", ["rojo", "blanco"]), _materiales("rojo", "blanco"), []
        )
        assert leido is not None and leido.patron == "espiral"


def test_el_orden_de_la_foto_es_el_orden_del_patron() -> None:
    """El primer color de la lectura es el dominante, y es el que manda en el patrón del motor."""
    leido = patron_del_motor(
        "columna",
        _pista("anillos", ["dorado", "blanco"]),
        _materiales("blanco", "dorado"),
        [],
    )
    assert leido is not None and leido.materiales == (1, 0)


def test_un_degradado_de_dos_colores_no_puede_ser_ombre() -> None:
    """El ombré pide tres tonos en los dos motores: con dos cae a la segunda preferencia, no se inventa uno."""
    columna = patron_del_motor(
        "columna", _pista("degradado", ["rosado", "blanco"]), _materiales("rosado", "blanco"), []
    )
    arco = patron_del_motor(
        "arco", _pista("degradado", ["rosado", "blanco"]), _materiales("rosado", "blanco"), []
    )
    assert columna is not None and columna.patron == "apilado"
    assert arco is not None and arco.patron == "bloques"


def test_un_degradado_de_tres_colores_es_ombre() -> None:
    materiales = _materiales("rosado", "blanco", "dorado")
    for tipo in ("arco", "columna"):
        leido = patron_del_motor(
            tipo, _pista("degradado", ["rosado", "blanco", "dorado"]), materiales, []
        )
        assert leido is not None and leido.patron == "ombre"


def test_una_flor_sin_los_cuatro_colores_del_floral_queda_punteada() -> None:
    """El floral del arco lleva cuatro colores y la lectura de una flor nombra tres."""
    tres = patron_del_motor(
        "arco",
        _pista("flor", ["verde", "blanco", "dorado"]),
        _materiales("verde", "blanco", "dorado"),
        [],
    )
    cuatro = patron_del_motor(
        "arco",
        _pista("flor", ["verde", "blanco", "dorado", "rosado"]),
        _materiales("verde", "blanco", "dorado", "rosado"),
        [],
    )
    assert tres is not None and tres.patron == "punteado"
    assert cuatro is not None and cuatro.patron == "floral"
    # La separación entre flores es la misma que usa la lectura de `patron_color`.
    assert cuatro.opciones["sepFilas"] == 3.0


def test_la_columna_no_tiene_floral() -> None:
    leido = patron_del_motor(
        "columna",
        _pista("flor", ["verde", "blanco", "dorado", "rosado"]),
        _materiales("verde", "blanco", "dorado", "rosado"),
        [],
    )
    assert leido is not None and leido.patron == "punteado"


def test_las_manchas_de_zonas_cuentan_como_colores() -> None:
    """Una mancha agrupada es un tramo de color, y su color puede no estar en `colores`."""
    pista = _pista(
        "zonas",
        ["blanco"],
        zonas=[{"color": "dorado", "ancla": "superior_centro", "extension": 30}],
    )
    leido = patron_del_motor("columna", pista, _materiales("blanco", "dorado"), [])
    assert leido is not None and leido.patron == "apilado" and leido.materiales == (0, 1)


def test_un_color_que_no_es_de_la_pieza_tumba_la_lectura_con_aviso() -> None:
    """Mismo corte que `patron_desde_pista`: armar con los que casaron sería armar otra pieza."""
    avisos: list[str] = []
    leido = patron_del_motor(
        "columna",
        _pista("anillos", ["blanco", "burdeos"]),
        _materiales("blanco", "dorado"),
        avisos,
    )
    assert leido is None
    assert len(avisos) == 1 and "no es de esta pieza" in avisos[0]


def test_una_confianza_baja_no_se_usa_y_no_avisa() -> None:
    avisos: list[str] = []
    leido = patron_del_motor(
        "columna",
        _pista("anillos", ["blanco", "dorado"], confianza=CONFIANZA_MINIMA_PISTA - 0.01),
        _materiales("blanco", "dorado"),
        avisos,
    )
    assert leido is None and avisos == []


def test_una_pieza_sin_color_declarado_no_resuelve_la_lectura() -> None:
    avisos: list[str] = []
    assert (
        patron_del_motor(
            "columna", _pista("anillos", ["blanco", "dorado"]), _materiales(None, None), avisos
        )
        is None
    )
    assert len(avisos) == 1


def test_la_guirnalda_del_motor_no_tiene_patron_que_elegir() -> None:
    avisos: list[str] = []
    assert (
        patron_del_motor("guirnalda", _pista("anillos", ["blanco"]), _materiales("blanco"), avisos)
        is None
    )
    assert avisos == []


def test_los_globos_de_un_racimo_leidos_viajan_al_motor() -> None:
    leido = patron_del_motor(
        "columna",
        _pista("anillos", ["blanco", "dorado"], globos_por_racimo=3),
        _materiales("blanco", "dorado"),
        [],
    )
    assert leido is not None and leido.globos_por_racimo == 3


# --- La receta que la usa -------------------------------------------------------------


def test_la_receta_arma_la_columna_como_la_foto_la_leyo() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"])],
    )
    assert completado["origen"] == "referencia"
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["patron"] == "apilado"
    assert armado["origen"] == "referencia"
    assert armado["opciones"]["grosor"] == 1
    assert armado["materiales"] == [0, 1]


def test_sin_pista_la_receta_sigue_eligiendo_por_colores() -> None:
    [completado] = _completar([_estructura("columna", ["blanco", "dorado"])])
    assert completado["origen"] == "receta"
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["patron"] == "espiral"
    assert armado["origen"] == "sugerido"


def test_la_pista_de_otro_elemento_no_se_aplica() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"], elemento="el-9")],
        [_pista("anillos", ["blanco", "dorado"])],
    )
    assert completado["origen"] == "receta"


def test_una_pieza_que_no_materializa_ningun_elemento_no_tiene_pista() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"], elemento=None)],
        [_pista("anillos", ["blanco", "dorado"])],
    )
    assert completado["origen"] == "receta"


def test_el_armado_del_modelo_manda_sobre_la_lectura() -> None:
    """La lectura alimenta la receta, que es el respaldo: no se cuela por delante de lo que ya se validó."""
    armado = {
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
        "remate": {"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 0},
        "capas": [],
        "materiales": [0, 1],
    }
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"])],
        [{"estructura_id": "e-1", "tipo": "columna", "armado": armado}],
    )
    assert completado["origen"] == "modelo"
    assert cast("dict[str, Any]", completado["armado"])["patron"] == "espiral"


def test_la_lectura_del_patron_no_toca_el_remate() -> None:
    """El patrón es una cosa y el remate otra: la lectura del color no decide si la columna lleva globo.

    Se comprueba en los dos sentidos: sin lectura del remate la columna no se corona (2026-10-04, ver
    ``test_sin_lectura_del_remate_la_columna_no_se_corona``) lea o no la foto su patrón, y con un globo leído
    lo lleva igual con patrón que sin él.
    """
    for remates, tipo in (((), "ninguno"), ((_remate("globo", color="dorado"),), "globo")):
        [con_pista] = _completar(
            [_estructura("columna", ["blanco", "dorado"])],
            [_pista("anillos", ["blanco", "dorado"])],
            remates=remates,
        )
        [sin_pista] = _completar([_estructura("columna", ["blanco", "dorado"])], remates=remates)
        remate_con = cast("dict[str, Any]", con_pista["armado"])["remate"]
        remate_sin = cast("dict[str, Any]", sin_pista["armado"])["remate"]
        assert remate_con == remate_sin, tipo
        assert remate_con["tipo"] == tipo and remate_con["tamano"] == 24, tipo


def test_los_globos_por_racimo_de_la_foto_acotados_por_el_motor() -> None:
    """La columna arma capas de 3 a 6 globos: una lectura de 8 se acota con su aviso, no se rechaza."""
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"], globos_por_racimo=8)],
    )
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["cuerpo"]["globos_capa"] == 6
    [leidos] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"], globos_por_racimo=5)],
    )
    assert cast("dict[str, Any]", leidos["armado"])["cuerpo"]["globos_capa"] == 5


def test_el_arco_leido_cuenta_los_globos_de_la_banda() -> None:
    [completado] = _completar(
        [_estructura("arco", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"], globos_por_racimo=5)],
    )
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["patron"] == "bloques"
    assert armado["geometria"]["globosAncho"] == 5


# --- El eje y la simetría de la foto ---------------------------------------------------


def test_el_ombre_del_arco_degrada_por_donde_la_foto_dice() -> None:
    """El mando `modo` del ombré tiene los tres: a lo largo (0), simétrico (1) y a lo ancho (2)."""
    materiales = _materiales("rosado", "blanco", "dorado")
    tres = ["rosado", "blanco", "dorado"]
    a_lo_largo = patron_del_motor("arco", _pista("degradado", tres), materiales, [])
    a_lo_ancho = patron_del_motor(
        "arco", _pista("degradado", tres, direccion="transversal"), materiales, []
    )
    simetrico = patron_del_motor(
        "arco", _pista("degradado", tres, simetria="espejo"), materiales, []
    )
    assert a_lo_largo is not None and "modo" not in a_lo_largo.opciones
    assert a_lo_ancho is not None and a_lo_ancho.opciones["modo"] == 2.0
    # El espejo manda sobre el eje: un arco simétrico degrada desde los dos pies.
    assert simetrico is not None and simetrico.opciones["modo"] == 1.0


def test_un_arco_simetrico_se_arma_en_espejo() -> None:
    leido = patron_del_motor(
        "arco",
        _pista("anillos", ["blanco", "dorado"], simetria="espejo"),
        _materiales("blanco", "dorado"),
        [],
    )
    assert leido is not None and leido.patron == "bloques"
    assert leido.opciones["espejo"] == 1.0


def test_la_columna_no_se_arma_en_espejo_y_su_ombre_no_tiene_eje() -> None:
    """El motor de la columna no publica esos mandos: la lectura no inventa ninguno."""
    espejo = patron_del_motor(
        "columna",
        _pista("anillos", ["blanco", "dorado"], simetria="espejo"),
        _materiales("blanco", "dorado"),
        [],
    )
    assert espejo is not None and "espejo" not in espejo.opciones
    ombre = patron_del_motor(
        "columna",
        _pista("degradado", ["rosado", "blanco", "dorado"], direccion="transversal"),
        _materiales("rosado", "blanco", "dorado"),
        [],
    )
    assert ombre is not None and ombre.patron == "ombre" and "modo" not in ombre.opciones


def test_el_espejo_leido_llega_al_armado_del_arco() -> None:
    [completado] = _completar(
        [_estructura("arco", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "dorado"], simetria="espejo")],
    )
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["patron"] == "bloques" and armado["opciones"]["espejo"] == 1


# --- La guirnalda orgánica: no tiene patrón, tiene reparto -----------------------------

#: La mezcla de una guirnalda **orgánica**. La de ``_estructura`` (``clasica``) es la del armado por partes de
#: ADR-0032, que no es pieza de este motor (``armado_estructura._pieza_del_plan``) y ``completar`` no la arma.
ORGANICA = "organica_fina"


def test_la_guirnalda_reparte_como_la_foto_leyo() -> None:
    """Los tres repartos del motor dicen lo mismo que tres de los ocho modos de la foto."""
    casos = {
        "aleatorio": "azar",
        "anillos": "racimos",
        "bloques": "tramos",
        "degradado": "tramos",
        "zonas": "tramos",
    }
    for modo, reparto in casos.items():
        pista = _pista(modo, ["blanco", "dorado"])
        if modo == "zonas":
            pista["zonas"] = [{"color": "dorado", "ancla": "centro", "extension": 30}]
        [completado] = _completar(
            [_estructura("guirnalda", ["blanco", "dorado"], mezcla=ORGANICA)],
            [cast("dict[str, object]", pista)],
        )
        armado = cast("dict[str, Any]", completado["armado"])
        assert armado["colores"]["reparto"] == reparto, modo
        assert completado["origen"] == "referencia"


def test_un_modo_que_una_guirnalda_no_puede_armar_se_dice() -> None:
    """Una espiral, una flor y un damero no se arman con una guirnalda orgánica: no se fuerzan."""
    for modo in ("espiral", "flor", "damero"):
        pista = _pista(modo, ["blanco", "dorado", "rosado"])
        if modo == "espiral":
            pista["globos_por_racimo"] = 4
        [completado] = _completar(
            [_estructura("guirnalda", ["blanco", "dorado", "rosado"], mezcla=ORGANICA)],
            [cast("dict[str, object]", pista)],
        )
        assert completado["origen"] == "receta", modo
        assert any(
            "guirnalda organica no puede" in a for a in cast("list[str]", completado["avisos"])
        )


def test_la_paleta_de_la_guirnalda_sigue_el_orden_de_la_foto() -> None:
    [completado] = _completar(
        [_estructura("guirnalda", ["blanco", "dorado"], mezcla=ORGANICA)],
        [_pista("anillos", ["dorado", "blanco"])],
    )
    paleta = cast(
        "list[dict[str, Any]]", cast("dict[str, Any]", completado["armado"])["colores"]["paleta"]
    )
    assert [color["material"] for color in paleta] == [1, 0]


def test_los_pesos_de_la_guirnalda_son_del_plan_no_de_la_foto() -> None:
    """El reparto dice dónde va cada color; cuánto se compra de cada uno lo dice el plan."""
    [con_pista] = _completar(
        [_estructura("guirnalda", ["blanco", "dorado"], mezcla=ORGANICA)],
        [_pista("aleatorio", ["blanco", "dorado"], pesos=[90, 10])],
    )
    paleta = cast(
        "list[dict[str, Any]]", cast("dict[str, Any]", con_pista["armado"])["colores"]["paleta"]
    )
    # La estructura declara la mitad y la mitad (el peso del motor va en porcentaje): los 90/10 que vio la
    # foto no la mueven.
    assert {color["peso"] for color in paleta} == {50.0}


# --- El remate de la columna --------------------------------------------------------


def _remate(tipo: str, **extra: object) -> dict[str, object]:
    return {"referencia_element_id": "el-1", "tipo": tipo, **extra}


def test_una_columna_que_la_foto_ve_sin_remate_queda_sin_remate() -> None:
    """Lo que no se podía decir hasta ahora: la receta coronaba toda columna con un globo de 24\"."""
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])], remates=[_remate("ninguno")]
    )
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["remate"]["tipo"] == "ninguno"
    assert completado["origen"] == "referencia"


def test_sin_lectura_del_remate_la_columna_no_se_corona() -> None:
    """Sin lectura del remate, **sin remate** (2026-10-04; antes, decisión del 2026-10-02, el globo del motor).

    El plan no tiene campo con el que pedir el remate, y coronar una columna que nadie pidió cobraba globos
    inventados: es el criterio del clasificador (su vista previa solo corona la ficha «con-remate») y el de la
    columna orgánica (``armado_estructura._receta``, ``test_armado_semiarco_columna``). El tamaño y la
    cantidad del motor se quedan en el armado para cuando el decorador lo encienda.
    """
    [completado] = _completar([_estructura("columna", ["blanco", "dorado"])])
    remate = cast("dict[str, Any]", completado["armado"])["remate"]
    assert remate["tipo"] == "ninguno" and remate["tamano"] == 24 and remate["cantidad"] == 5
    assert completado["origen"] == "receta"


def test_el_globo_grande_leido_lleva_su_color() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        remates=[_remate("globo", color="dorado")],
    )
    remate = cast("dict[str, Any]", completado["armado"])["remate"]
    assert remate["tipo"] == "globo" and remate["material"] == 1
    # El tamaño no lo lee la foto: lo pone el motor.
    assert remate["tamano"] == 24


def test_un_remate_de_un_color_que_no_es_de_la_pieza_va_del_principal() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        remates=[_remate("globo", color="burdeos")],
    )
    armado = cast("dict[str, Any]", completado["armado"])
    assert armado["remate"]["material"] == 0
    assert any("burdeos" in aviso for aviso in cast("list[str]", completado["avisos"]))


def test_una_estrella_de_foil_leida_llega_al_armado() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])], remates=[_remate("estrella")]
    )
    assert cast("dict[str, Any]", completado["armado"])["remate"]["tipo"] == "estrella"


def test_el_remate_leido_no_depende_de_que_el_patron_se_pueda_leer() -> None:
    """Una columna cuya disposición de color no se ve puede llevar su globo igual, y al contrario."""
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"])],
        [_pista("anillos", ["blanco", "burdeos"])],
        remates=[_remate("ninguno")],
    )
    armado = cast("dict[str, Any]", completado["armado"])
    # El patrón cayó a la receta (un color que no es de la pieza) y el remate sí se leyó.
    assert armado["patron"] == "espiral"
    assert armado["remate"]["tipo"] == "ninguno"
    assert completado["origen"] == "referencia"


def test_el_remate_no_se_lee_en_un_arco() -> None:
    """El arco del motor no tiene remate; una lectura que llegara igual no cambia nada."""
    [completado] = _completar(
        [_estructura("arco", ["blanco", "dorado"])], remates=[_remate("ninguno")]
    )
    assert completado["origen"] == "receta"
    assert "remate" not in cast("dict[str, Any]", completado["armado"])


def test_el_remate_de_otro_elemento_no_se_aplica() -> None:
    [completado] = _completar(
        [_estructura("columna", ["blanco", "dorado"], elemento="el-9")],
        remates=[_remate("globo", color="dorado")],
    )
    # El globo leído es del el-1: la columna del el-9 se queda como sin lectura, sin remate.
    assert cast("dict[str, Any]", completado["armado"])["remate"]["tipo"] == "ninguno"
    assert completado["origen"] == "receta"


def test_una_pieza_sin_motor_no_entra_en_la_operacion() -> None:
    assert _completar([_estructura("pared", ["blanco", "dorado"])]) == []


def test_la_pieza_lleva_el_color_de_cada_material_al_traductor() -> None:
    """Sin el color de cada material la lectura no se puede resolver, así que la pieza lo transporta."""
    pieza = PiezaArmado(tipo="columna", colores=2, tonos=["blanco", "dorado"])
    assert pieza.tonos == ["blanco", "dorado"]


def test_los_tamanos_de_la_foto_eligen_la_mezcla() -> None:
    """La cuarta traduccion del modulo: lo que se ve en la foto -> la mezcla que se compra."""
    avisos: list[str] = []
    assert (
        mezcla_del_motor({"tamanos": "casi_todos_gigantes", "confianza": 0.9}, avisos)
        == "solo_grandes"
    )
    assert mezcla_del_motor({"tamanos": "un_solo_tamano", "confianza": 0.9}, avisos) == "clasica"
    assert avisos == []

    # Sin lectura de tamanos no se inventa ninguna: manda la mezcla que declaro el plan.
    assert mezcla_del_motor({"confianza": 0.9}, avisos) is None
    assert mezcla_del_motor(None, avisos) is None
    assert avisos == []

    # Los mismos cortes que el resto del modulo: poca confianza no se usa, y lo desconocido deja aviso.
    assert mezcla_del_motor({"tamanos": "casi_todos_gigantes", "confianza": 0.1}, avisos) is None
    assert mezcla_del_motor({"tamanos": "enormes", "confianza": 0.9}, avisos) is None
    assert len(avisos) == 2


def test_la_mezcla_de_la_foto_llega_al_plan_aunque_la_pieza_sea_de_un_color() -> None:
    """El caso que lo motivo: una columna dorada de globos casi todos gigantes.

    Una pieza de un solo color no deja ``patron_color``, asi que no deja pista de patron. Por eso los
    tamanos viajan en la suya: puestos dentro de la del patron, esta columna no habria dicho nada.
    """
    from app.plan import _complete_plan

    plan: dict[str, object] = {
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [
            {
                "estructura_id": "EST_01",
                "nombre": "Columna dorada",
                "tipo": "columna",
                "densidad": "media",
                "mezcla": "organica_gruesa",
                "referencia_element_id": "REF_01_E01",
                "repeticiones": 1,
                "medidas": {"alto_m": 2.0},
                "materiales": [{"color": "dorado", "acabado": "cromado", "participacion": 100}],
            }
        ],
    }
    tamanos = [
        {
            "referencia_element_id": "REF_01_E01",
            "tamanos": "casi_todos_gigantes",
            "confianza": 0.8,
        }
    ]
    completado = _complete_plan(plan, completar_patrones=True, pistas=[], tamanos=tamanos)
    estructura = cast(Sequence[Mapping[str, object]], completado["estructuras"])[0]
    assert estructura["mezcla"] == "solo_grandes"
    # Pisar lo declarado queda dicho, no en silencio.
    supuestos = cast(Sequence[str], completado.get("supuestos") or [])
    assert any("solo_grandes" in texto for texto in supuestos), supuestos

    # Y tambien con `completar_patrones` apagada, que es lo normal: la bandera decide si Python escribe
    # `patron_color`, no si la foto puede decir de que tamanos es la pieza. Atarlos a ella dejo la lectura
    # entera sin llegar nunca al motor, con la bandera apagada por defecto (2026-10-03).
    sin_patrones = _complete_plan(plan, completar_patrones=False, pistas=[], tamanos=tamanos)
    assert (
        cast(Sequence[Mapping[str, object]], sin_patrones["estructuras"])[0]["mezcla"]
        == "solo_grandes"
    )

    # Lo que de verdad apaga el cambio es no haber leido nada: sin pista, manda la mezcla declarada.
    intacto = _complete_plan(plan, completar_patrones=True, pistas=[], tamanos=[])
    assert (
        cast(Sequence[Mapping[str, object]], intacto["estructuras"])[0]["mezcla"]
        == "organica_gruesa"
    )
