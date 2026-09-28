"""Regresiones de la revisión adversaria de feat/guirnaldas (lectura del bouquet, ADR-0030).

Cada prueba lleva el id del hallazgo (scratchpad/revision/hallazgos.json) y
falla contra el código anterior al arreglo.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.amaterasu.bouquet_referencia import SYSTEM_INSTRUCTION, BouquetReferenciaError
from app.amaterasu.patron_referencia import PALETA


# --- 7: con números a los lados, los niveles son los de UN grupo -------------------------------


def test_7_el_prompt_dice_que_con_lados_se_describe_un_solo_grupo() -> None:
    # total_leido duplica niveles y remate con "lados" (armado_bouquet._grupos_leidos):
    # si el modelo contara los dos grupos, la compra se duplicaría (34 en vez de 18).
    assert 'When the numbers are on the sides (disposicion "lados")' in SYSTEM_INSTRUCTION
    assert "describe ONE of them" in SYSTEM_INSTRUCTION


def test_7_la_convencion_de_un_grupo_da_la_cuenta_de_la_foto() -> None:
    from app.amaterasu.estructuras import bouquet

    # Un "1" y un "5" a los lados, cada uno con 2 cuartetos: 16 látex + 2 números = 18.
    [lectura] = bouquet.validar_lecturas(
        {
            "lecturas": [
                {
                    "element_id": "E1",
                    "variante": "base_aire",
                    "niveles": [
                        {
                            "unidad": "cuarteto",
                            "colores": ["blanco", "rosado", "blanco", "rosado"],
                            "cantidad": 2,
                        }
                    ],
                    "numeros": [
                        {"digito": "1", "clase_tamano": "grande"},
                        {"digito": "5", "clase_tamano": "grande"},
                    ],
                    "disposicion": "lados",
                    "confianza": 0.9,
                }
            ]
        },
        ["E1"],
        PALETA,
    ) or [{}]
    assert lectura["total_globos"] == 18


# --- 8: la lectura del bouquet v2 tiene tope de salida de sobra y un corte se ve --------------


def test_8_el_tope_de_salida_del_bouquet_alcanza_para_la_lectura_v2() -> None:
    from app.amaterasu import bouquet_referencia, conteo_referencia

    assert bouquet_referencia.MAX_OUTPUT_TOKENS >= conteo_referencia.MAX_OUTPUT_TOKENS


class _Respuesta:
    def __init__(self, texto: str, finish_reason: str) -> None:
        self.text = texto
        self.candidates = [SimpleNamespace(finish_reason=finish_reason, content=None)]
        self.usage_metadata = None
        self.prompt_feedback = None


class _Cliente:
    def __init__(self, respuesta: object) -> None:
        async def generate_content(**_kwargs: object) -> object:
            return respuesta

        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))


def test_8_un_json_cortado_por_el_tope_lleva_el_motivo_del_proveedor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.amaterasu.vision_estructurada import leer_foto

    monkeypatch.setenv("GEMINI_API_KEY", "clave-de-prueba")
    cliente = _Cliente(_Respuesta('{"lecturas": [{"element_id": "E1", "varian', "MAX_TOKENS"))
    with pytest.raises(BouquetReferenciaError) as error:
        asyncio.run(
            leer_foto(
                mime_type="image/png",
                data_base64="aGVsbG8=",
                mensaje="x",
                system_instruction="s",
                response_schema={"type": "object"},
                max_output_tokens=10,
                prefijo="bouquet_referencia",
                error=BouquetReferenciaError,
                client_factory=lambda _k: cliente,
            )
        )
    assert error.value.code == "bouquet_referencia_invalid_output"
    # Antes: sin provider_detail, el corte por MAX_TOKENS no se veía en el log de Next.
    assert error.value.provider_detail == "finish_reason=MAX_TOKENS"
