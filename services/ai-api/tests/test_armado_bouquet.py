"""Armado de bouquets por niveles (ADR-0030)."""

from __future__ import annotations

import pytest

from app.armado_bouquet import (
    ArmadoInvalido,
    EstructuraBouquet,
    GloboCatalogo,
    armado_resuelto,
    clasificar,
    sugerir_armado,
    validar,
)


def _globo(
    titulo: str,
    *,
    forma: str | None = None,
    diam: float | None = None,
    codigo: str | None = None,
    color: str | None = None,
) -> GloboCatalogo:
    return GloboCatalogo(
        product_id=f"P-{titulo}",
        variant_id=f"V-{titulo}",
        titulo=titulo,
        forma=forma,
        diam_pulg=diam,
        codigo_tamano=codigo,
        color=color,
        acabado=None,
    )


def _latex(diam: float, color: str) -> GloboCatalogo:
    return _globo(
        f"Globo R-{int(diam)} {color}",
        forma="redondo",
        diam=diam,
        codigo=f"R-{int(diam)}",
        color=color,
    )


def _corazon_18() -> GloboCatalogo:
    return _globo("B2b Globo Metalizado Corazon Dorado Mate — 18 IN / PAQUETE X 1", color="dorado")


def _numero(digito: str, pulgadas: int = 34) -> GloboCatalogo:
    return _globo(
        f"B2b Globo Metalizado Numero {digito} Dorado Mate — {pulgadas} IN / PAQUETE X 1",
        color="dorado",
    )


def _estructura(
    globos: list[GloboCatalogo],
    cantidades: list[int],
    *,
    repeticiones: int = 1,
    es_bouquet: bool = True,
) -> EstructuraBouquet:
    materiales = tuple(clasificar(i, globo) for i, globo in enumerate(globos))
    return EstructuraBouquet(
        estructura_id="EST_01_BOUQUET",
        es_bouquet=es_bouquet,
        repeticiones=repeticiones,
        materiales=materiales,
        cantidades=tuple(cantidades),
    )


def test_clasifica_cada_globo_por_forma_y_titulo() -> None:
    latex = clasificar(0, _latex(12, "blanco"))
    numero = clasificar(1, _numero("5"))
    burbuja = clasificar(2, _globo("B2b - Globos Burbuja Pre-Estirado — 24 IN"))
    foil = clasificar(3, _corazon_18())
    assert latex is not None and latex.tipo == "latex" and latex.tamano_pulg == 12
    assert numero is not None and (numero.tipo, numero.digito, numero.tamano_pulg) == (
        "numero",
        "5",
        34,
    )
    assert burbuja is not None and burbuja.tipo == "burbuja"
    assert foil is not None and (foil.tipo, foil.tamano_pulg) == ("metalizado", 18)
    assert clasificar(4, _globo("Vela chispitas")) is None


def _conteo_de(estructura: EstructuraBouquet, armado: dict[str, object]) -> None:
    # Validar exige que el armado use exactamente lo que el plan compra.
    validar(estructura, armado)


def test_receta_helio_apilado_con_seis_latex_y_remate() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()], [3, 3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    assert armado["variante"] == "helio_apilado"
    assert armado["origen"] == "sugerido"
    assert all(nivel["unidad"] == "trio" for nivel in armado["niveles"])  # type: ignore[index, union-attr]
    assert armado["remate"] == [2]
    _conteo_de(estructura, armado)


def test_receta_helio_escalonado_alrededor_de_un_centro() -> None:
    estrella = _globo("B2b Globo Metalizado Estrella Dorado Mate — 36 IN", color="dorado")
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), estrella], [2, 2, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None and armado["variante"] == "helio_escalonado"
    assert {nivel["rol"] for nivel in armado["niveles"]} == {"alrededor"}  # type: ignore[union-attr]


def test_latex_chico_obliga_a_base_de_aire() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(5, "rosado"), _corazon_18()], [8, 3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None and armado["variante"] == "base_aire"
    niveles = armado["niveles"]
    assert [n["rol"] for n in niveles if n["unidad"] == "cuarteto"] == ["base"]  # type: ignore[union-attr]
    assert any(n["rol"] == "acento" and n["posiciones"] == [1] for n in niveles)  # type: ignore[union-attr]


def test_la_foto_no_puede_pedir_helio_con_latex_chico() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(5, "rosado")], [8, 3])
    lectura = {"variante": "helio_escalonado", "niveles": [], "confianza": 0.9}
    armado = sugerir_armado(estructura, lectura)
    assert armado is not None and armado["variante"] == "base_aire"


def test_numero_de_dos_digitos_al_centro_y_a_los_lados() -> None:
    globos = [_latex(12, "blanco"), _numero("2"), _numero("5")]
    centro = sugerir_armado(_estructura(globos, [5, 1, 1]))
    assert centro is not None and centro["numero"] == {"digitos": [1, 2], "disposicion": "centro"}
    lados = sugerir_armado(
        _estructura(globos, [4, 1, 1]),
        {"variante": "helio_escalonado", "niveles": [], "disposicion": "lados", "confianza": 0.8},
    )
    assert lados is not None and lados["numero"] == {"digitos": [1, 2], "disposicion": "lados"}
    # Cinco látex no se reparten en dos grupos iguales: queda al centro.
    impar = sugerir_armado(
        _estructura(globos, [5, 1, 1]),
        {"variante": "helio_escalonado", "niveles": [], "disposicion": "lados", "confianza": 0.8},
    )
    assert impar is not None and impar["numero"]["disposicion"] == "centro"  # type: ignore[index]


def test_numero_chico_va_con_aire() -> None:
    armado = sugerir_armado(_estructura([_latex(12, "blanco"), _numero("7", 16)], [4, 1]))
    assert armado is not None and armado["variante"] == "base_aire"


def test_lectura_con_poca_confianza_no_decide() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado")], [3, 3])
    armado = sugerir_armado(
        estructura, {"variante": "helio_escalonado", "niveles": [], "confianza": 0.3}
    )
    assert (
        armado is not None
        and armado["origen"] == "sugerido"
        and armado["variante"] == "helio_apilado"
    )


def test_la_foto_ordena_los_colores() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado")], [3, 3])
    lectura = {
        "variante": "helio_apilado",
        "niveles": [{"unidad": "trio", "colores": ["rosado", "blanco"]}],
        "confianza": 0.9,
    }
    armado = sugerir_armado(estructura, lectura)
    assert armado is not None and armado["origen"] == "referencia"
    assert armado["niveles"][0]["posiciones"][0] == 1  # type: ignore[index]


def test_sin_armado_si_las_repeticiones_no_reparten_la_compra() -> None:
    assert sugerir_armado(_estructura([_latex(12, "blanco")], [7], repeticiones=2)) is None


def test_sin_armado_si_un_material_no_se_puede_clasificar() -> None:
    assert sugerir_armado(_estructura([_latex(12, "blanco"), _globo("Vela")], [6, 1])) is None


@pytest.mark.parametrize(
    ("cambio", "motivo"),
    [
        ({"es_bouquet": False}, "no_es_bouquet"),
        ({"cantidades": [4, 3, 1]}, "unidades_no_coinciden"),
    ],
)
def test_validar_rechaza_lo_que_no_corresponde(cambio: dict[str, object], motivo: str) -> None:
    globos = [_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()]
    base = _estructura(globos, [3, 3, 1])
    armado = sugerir_armado(base)
    assert armado is not None
    estructura = _estructura(
        globos,
        list(cambio.get("cantidades", [3, 3, 1])),  # type: ignore[call-overload]
        es_bouquet=bool(cambio.get("es_bouquet", True)),
    )
    with pytest.raises(ArmadoInvalido) as error:
        validar(estructura, armado)
    assert error.value.motivo == motivo


def test_validar_exige_los_globos_de_cada_unidad() -> None:
    estructura = _estructura([_latex(12, "blanco")], [4])
    armado = {
        "version": "armado-bouquet.v1",
        "origen": "decorador",
        "variante": "base_aire",
        "niveles": [{"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0]}],
    }
    with pytest.raises(ArmadoInvalido) as error:
        validar(estructura, armado)
    assert error.value.motivo == "posiciones_no_coinciden_con_unidad"


def test_validar_rechaza_helio_con_latex_chico() -> None:
    estructura = _estructura([_latex(5, "blanco")], [3])
    armado = {
        "version": "armado-bouquet.v1",
        "origen": "decorador",
        "variante": "helio_escalonado",
        "niveles": [{"rol": "alrededor", "unidad": "suelto", "cantidad": 3, "posiciones": [0]}],
    }
    with pytest.raises(ArmadoInvalido) as error:
        validar(estructura, armado)
    assert error.value.motivo == "latex_pequeno_con_helio"


def test_resuelto_con_codigos_pesa_y_duracion() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()], [3, 3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    resuelto = armado_resuelto(estructura, armado)
    codigos = [entrada["codigo"] for entrada in resuelto["leyenda"]]  # type: ignore[union-attr]
    assert codigos == [1, 2, 3]
    pesa = next(i for i in resuelto["insumos"] if i["insumo"] == "pesa")  # type: ignore[union-attr]
    # 6 látex de 12" × 12 g + un metalizado estándar 8 g (tabla del distribuidor).
    assert "80 g" in pesa["detalle"] and pesa["estimado"] is False
    assert resuelto["duracion_estimada"] == {"horas_min": 18, "horas_max": 24}
    assert resuelto["avisos"] == []  # siete globos: impar
    assert resuelto["nombre"] == "Bouquet de helio apilado"


def test_resuelto_avisa_par_y_peso_estimado_del_34() -> None:
    estructura = _estructura([_latex(12, "blanco"), _numero("5")], [3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    resuelto = armado_resuelto(estructura, armado)
    avisos = " ".join(resuelto["avisos"])  # type: ignore[arg-type]
    assert "impar" in avisos and "estimados" in avisos
    numero = next(e for e in resuelto["leyenda"] if e["tipo_globo"] == "numero")  # type: ignore[union-attr]
    assert numero["digito"] == "5" and 'Número "5"' in numero["descripcion"]


def test_base_de_aire_pide_varillas_y_base_sin_helio() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(5, "rosado"), _corazon_18()], [8, 3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    resuelto = armado_resuelto(estructura, armado)
    insumos = {i["insumo"] for i in resuelto["insumos"]}  # type: ignore[union-attr]
    assert insumos == {"varilla", "base"}
    assert resuelto["duracion_estimada"] is None


def test_cada_codigo_distingue_valor_del_numero() -> None:
    estructura = _estructura([_latex(12, "blanco"), _numero("2"), _numero("5")], [5, 1, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    leyenda = armado_resuelto(estructura, armado)["leyenda"]
    digitos = {e["digito"]: e["codigo"] for e in leyenda if e["tipo_globo"] == "numero"}  # type: ignore[union-attr]
    assert set(digitos) == {"2", "5"} and digitos["2"] != digitos["5"]
