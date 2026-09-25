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
    # Metalizado en el título, pero no es un globo (catálogo real, 2026-09-25).
    assert clasificar(5, _globo("B2b Cartel Letras Metalizado Corazones — PAQUETE X 1")) is None


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


# --- Segunda entrega: opciones del editor y frases del prompt de imagen -------------


def test_la_compra_dice_que_estilos_y_disposiciones_admite() -> None:
    from app.armado_bouquet import disposiciones_admitidas, variantes_admitidas

    helio = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()], [3, 3, 1])
    assert variantes_admitidas(helio) == ["base_aire", "helio_apilado", "helio_escalonado"]
    assert disposiciones_admitidas(helio) == []
    aire = _estructura([_latex(12, "blanco"), _latex(5, "rosado")], [8, 3])
    assert variantes_admitidas(aire) == ["base_aire"]
    dos_digitos = _estructura([_latex(12, "blanco"), _numero("2"), _numero("5")], [4, 1, 1])
    assert disposiciones_admitidas(dos_digitos) == ["centro", "lados", "arriba", "abajo"]
    impar = _estructura([_latex(12, "blanco"), _numero("2"), _numero("5")], [5, 1, 1])
    assert disposiciones_admitidas(impar) == ["centro", "arriba", "abajo"]
    assert variantes_admitidas(_estructura([_latex(12, "blanco"), _globo("Vela")], [6, 1])) == []


def test_el_decorador_elige_estilo_y_disposicion_en_el_editor() -> None:
    globos = [_latex(12, "blanco"), _numero("2"), _numero("5")]
    escalonado = sugerir_armado(_estructura(globos, [4, 1, 1]), variante="helio_escalonado")
    assert escalonado is not None and escalonado["variante"] == "helio_escalonado"
    lados = sugerir_armado(_estructura(globos, [4, 1, 1]), disposicion="lados")
    assert lados is not None and lados["numero"] == {"digitos": [1, 2], "disposicion": "lados"}
    # Lo que eligió manda sobre la foto.
    foto = {"variante": "helio_apilado", "niveles": [], "confianza": 0.9}
    aire = sugerir_armado(_estructura(globos, [4, 1, 1]), foto, variante="base_aire")
    assert aire is not None and aire["variante"] == "base_aire"


def test_una_eleccion_que_la_compra_no_admite_se_rechaza() -> None:
    aire = _estructura([_latex(12, "blanco"), _latex(5, "rosado")], [8, 3])
    with pytest.raises(ArmadoInvalido) as helio:
        sugerir_armado(aire, variante="helio_apilado")
    assert helio.value.motivo == "variante_no_admitida"
    impar = _estructura([_latex(12, "blanco"), _numero("2"), _numero("5")], [5, 1, 1])
    with pytest.raises(ArmadoInvalido) as lados:
        sugerir_armado(impar, disposicion="lados")
    assert lados.value.motivo == "disposicion_no_admitida"


def test_las_frases_del_prompt_describen_el_armado_en_ingles() -> None:
    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()], [3, 3, 1])
    armado = sugerir_armado(estructura)
    assert armado is not None
    resuelto = armado_resuelto(estructura, armado)
    gemini = str(resuelto["prompt_gemini"])
    lora = str(resuelto["prompt_lora"])
    assert gemini.startswith("BOUQUET ASSEMBLY — a helium balloon bouquet")
    assert "stacked in layers" in gemini and "Topper: gold foil heart." in gemini
    assert 'white 12" latex balloons' in gemini and "level 1 (layer)" in gemini
    assert lora == (
        "a helium balloon bouquet stacked in level layers of white and pink balloons"
        " topped by gold foil heart"
    )


def test_la_frase_lora_deletrea_los_numeros_y_es_ascii() -> None:
    estructura = _estructura([_latex(12, "blanco"), _numero("2"), _numero("5")], [4, 1, 1])
    armado = sugerir_armado(estructura, disposicion="lados")
    assert armado is not None
    resuelto = armado_resuelto(estructura, armado)
    lora = str(resuelto["prompt_lora"])
    gemini = str(resuelto["prompt_gemini"])
    assert lora.isascii() and not any(c.isdigit() for c in lora)
    assert "foil number two balloon" in lora and "foil number five balloon" in lora
    assert lora.endswith("one on each side")
    assert 'foil number "2" balloon' in gemini and "Build two matching bouquets" in gemini
    assert "one on each side, each with its own bouquet" in gemini


# --- La foto manda sobre la compra (2026-09-25) ------------------------------------


def test_la_foto_dicta_cantidad_colores_y_armado() -> None:
    from app.armado_bouquet import compra_desde_lectura

    # El modelo compró 15 globos en tres colores; la foto tiene 2 dorados, 1 negro y el "80".
    globos = [
        _latex(12, "negro"),
        _latex(12, "dorado"),
        _latex(12, "violeta"),
        _numero("8"),
        _numero("0"),
    ]
    estructura = _estructura(globos, [5, 5, 3, 1, 1])
    lectura = {
        "variante": "helio_escalonado",
        "niveles": [{"unidad": "suelto", "colores": ["dorado", "dorado", "negro"]}],
        "numeros": [
            {"digito": "8", "clase_tamano": "grande"},
            {"digito": "0", "clase_tamano": "grande"},
        ],
        "disposicion": "centro",
        "confianza": 0.85,
    }
    compra = compra_desde_lectura(estructura, lectura)
    assert compra is not None
    assert compra.cantidades == (1, 2, 0, 1, 1) and compra.total == 5
    assert compra.armado["variante"] == "helio_escalonado"
    assert compra.armado["niveles"] == [
        {"rol": "alrededor", "unidad": "suelto", "cantidad": 2, "posiciones": [1]},
        {"rol": "alrededor", "unidad": "suelto", "cantidad": 1, "posiciones": [0]},
    ]
    assert compra.armado["numero"] == {"digitos": [3, 4], "disposicion": "centro"}


def test_la_foto_no_manda_si_lee_algo_que_no_se_compra() -> None:
    from app.armado_bouquet import compra_desde_lectura

    estructura = _estructura([_latex(12, "blanco"), _latex(12, "rosado"), _corazon_18()], [3, 3, 1])
    base = {
        "variante": "helio_apilado",
        "niveles": [{"unidad": "trio", "colores": ["blanco", "rosado", "blanco"]}],
        "confianza": 0.9,
    }
    assert compra_desde_lectura(estructura, base) is not None
    # Un color que el plan no lleva, un dígito sin globo número, un remate de otra clase, o poca confianza.
    assert (
        compra_desde_lectura(
            estructura,
            {**base, "niveles": [{"unidad": "trio", "colores": ["verde", "rosado", "blanco"]}]},
        )
        is None
    )
    assert (
        compra_desde_lectura(
            estructura, {**base, "numeros": [{"digito": "5", "clase_tamano": "grande"}]}
        )
        is None
    )
    assert compra_desde_lectura(estructura, {**base, "remate": {"clase": "burbuja"}}) is None
    assert compra_desde_lectura(estructura, {**base, "confianza": 0.3}) is None
    con_remate = compra_desde_lectura(
        estructura, {**base, "remate": {"clase": "metalizado", "color": "dorado"}}
    )
    assert (
        con_remate is not None
        and con_remate.armado["remate"] == [2]
        and con_remate.cantidades == (2, 1, 1)
    )


def test_la_foto_con_latex_chico_baja_a_base_de_aire() -> None:
    from app.armado_bouquet import compra_desde_lectura

    estructura = _estructura([_latex(5, "blanco"), _latex(12, "rosado")], [8, 3])
    lectura = {
        "variante": "helio_apilado",
        "niveles": [{"unidad": "cuarteto", "colores": ["blanco", "rosado", "blanco", "rosado"]}],
        "confianza": 0.9,
    }
    compra = compra_desde_lectura(estructura, lectura)
    assert compra is not None and compra.armado["variante"] == "base_aire"
    assert compra.armado["niveles"][0]["rol"] == "base"  # type: ignore[index]


def test_los_numeros_abajo_van_de_pie_y_no_flotan() -> None:
    estructura = _estructura([_latex(12, "blanco"), _numero("8"), _numero("0")], [3, 1, 1])
    abajo = sugerir_armado(estructura, disposicion="abajo")
    assert abajo is not None and abajo["numero"] == {"digitos": [1, 2], "disposicion": "abajo"}
    resuelto = armado_resuelto(estructura, abajo)
    pesa = next(i for i in resuelto["insumos"] if i["insumo"] == "pesa")  # type: ignore[union-attr]
    cintas = next(i for i in resuelto["insumos"] if i["insumo"] == "cinta")  # type: ignore[union-attr]
    # Solo los tres látex de 12" flotan (3 × 12 g); los números quedan de pie en la base.
    assert "36 g" in pesa["detalle"] and cintas["cantidad"] == 3
    assert "de pie en la base" in " ".join(resuelto["pasos"])  # type: ignore[arg-type]
    assert "standing at the base" in str(resuelto["prompt_gemini"])
    assert str(resuelto["prompt_lora"]).endswith("standing at the base")
