"""Lectura del armado de los bouquets en la foto (ADR-0030)."""

import asyncio
import base64
import hashlib
import json
import time
from types import SimpleNamespace
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.amaterasu.bouquet_referencia import (
    BOUQUET_REFERENCIA_RESULT_VERSION,
    PROMPT_VERSION,
    RESPONSE_SCHEMA,
    SYSTEM_INSTRUCTION,
    BouquetReferenciaError,
    BouquetReferenciaRequest,
    leer_armados_referencia,
)
from app.amaterasu.estructuras import bouquet, definicion
from app.amaterasu.patron_referencia import PALETA
from app.amaterasu.turno import DEFAULT_MODEL
from app.main import Settings, build_signature, create_app

TINY_PNG_BASE64 = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
        "de0000000c4944415478da6360000002000155bce9a70000000049454e44ae42"
        "6082"
    )
).decode("ascii")
SECRET = "b" * 32
PATH = "/internal/v1/ia/bouquet-referencia"


@pytest.fixture(autouse=True)
def _clave(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "clave-de-prueba")


def _operation() -> dict[str, object]:
    return {
        "schema_version": "bouquet-referencia.v1",
        "imagen": {"mime_type": "image/png", "data_base64": TINY_PNG_BASE64},
        "elementos": [
            {
                "element_id": "REF_01_E01",
                "bbox": {"x": 0.3, "y": 0.2, "width": 0.3, "height": 0.6},
                "colores_observados": ["white", "gold"],
            }
        ],
    }


def _payload() -> BouquetReferenciaRequest:
    return BouquetReferenciaRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-0000-0000-000000000000",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 15000,
                "body_sha256": "a" * 64,
                "scopes": ["ia.bouquet_referencia"],
            },
            **_operation(),
        }
    )


class _FakeModels:
    def __init__(self, response: object) -> None:
        self._response = response
        self.calls: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return self._response


class _FakeClient:
    def __init__(self, response: object) -> None:
        self.aio = SimpleNamespace(models=_FakeModels(response))


def _respuesta(texto: str | None) -> object:
    candidate = SimpleNamespace(content=SimpleNamespace(parts=[]), finish_reason="STOP")
    usage = SimpleNamespace(
        prompt_token_count=900,
        candidates_token_count=60,
        thoughts_token_count=0,
        cached_content_token_count=0,
        tool_use_prompt_token_count=None,
        total_token_count=960,
    )
    return SimpleNamespace(
        text=texto, candidates=[candidate], usage_metadata=usage, prompt_feedback=None
    )


def _run(client: object) -> dict[str, object]:
    return asyncio.run(leer_armados_referencia(_payload(), client_factory=lambda _k: client))


def test_el_bouquet_esta_en_el_registro_sin_frase_de_patron() -> None:
    registrado = definicion("bouquet")
    assert registrado is not None and registrado.inicio_de_pieza is None


def test_el_prompt_nombra_variantes_unidades_y_la_paleta() -> None:
    for palabra in ("base_aire", "helio_apilado", "helio_escalonado", "cuarteto", "burbuja"):
        assert palabra in SYSTEM_INSTRUCTION
    assert all(color in SYSTEM_INSTRUCTION for color in PALETA)
    assert "maxItems" not in json.dumps(RESPONSE_SCHEMA)


def test_la_version_del_prompt_esta_fijada() -> None:
    # v2 (2026-09-28): cantidad y clase de tamaño por nivel. Un cambio al prompt
    # o al esquema cambia este hash: se sube la versión a propósito, no se
    # regenera para que pase (invalida la caché de lecturas y la comparación).
    assert PROMPT_VERSION == "bouquet-referencia.v2:eda6064d204b746a"


def test_el_prompt_pide_cuantas_unidades_forman_cada_nivel_y_su_tamano() -> None:
    assert "ONE unit" in SYSTEM_INSTRUCTION
    assert "cantidad = how many identical units form that level" in SYSTEM_INSTRUCTION
    assert "hidden behind it by symmetry" in SYSTEM_INSTRUCTION
    for clase in ('"chico"', '"mediano"', '"grande"', '"gigante"'):
        assert clase in SYSTEM_INSTRUCTION
    lecturas = RESPONSE_SCHEMA["properties"]["lecturas"]  # type: ignore[index]
    nivel = lecturas["items"]["properties"]["niveles"]["items"]
    assert nivel["required"] == ["unidad", "colores", "cantidad"]
    assert nivel["properties"]["cantidad"] == {"type": "integer", "minimum": 1, "maximum": 24}
    assert nivel["properties"]["clase_tamano"]["enum"] == ["chico", "mediano", "grande", "gigante"]


def test_lee_y_valida_la_respuesta() -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "variante": "helio_apilado",
                    "niveles": [
                        {
                            "unidad": "trio",
                            "colores": ["blanco", "Rosado", "magenta neón"],
                            "cantidad": 3,
                            "clase_tamano": "Mediano",
                        },
                        {"unidad": "cuarteto", "colores": ["morado inexistente"], "cantidad": 2},
                    ],
                    "remate": {"clase": "metalizado", "color": "dorado"},
                    "numeros": [{"digito": "5", "clase_tamano": "grande"}, {"digito": "x"}],
                    "disposicion": "centro",
                    "confianza": 1.4,
                },
                {
                    "element_id": "REF_99_E99",
                    "variante": "base_aire",
                    "niveles": [],
                    "confianza": 1,
                },
            ]
        }
    )
    client = _FakeClient(_respuesta(texto))
    resultado = _run(client)
    assert resultado["operation_schema_version"] == BOUQUET_REFERENCIA_RESULT_VERSION
    assert resultado["modelo"] == DEFAULT_MODEL
    [lectura] = resultado["lecturas"]  # type: ignore[misc]
    assert lectura == {
        "element_id": "REF_01_E01",
        "variante": "helio_apilado",
        # Colores fuera de la paleta fuera; un nivel sin colores fuera.
        "niveles": [
            {
                "unidad": "trio",
                "colores": ["blanco", "rosado"],
                "cantidad": 3,
                "clase_tamano": "mediano",
            }
        ],
        "confianza": 1.0,
        "remate": {"clase": "metalizado", "color": "dorado"},
        "numeros": [{"digito": "5", "clase_tamano": "grande"}],
        "disposicion": "centro",
        # 3 tríos + remate + el 5: la cuenta es de armado_bouquet.total_leido.
        "total_globos": 11,
        # Nada se quita en silencio.
        "avisos": [
            "confianza 1.4 fuera de 0-1; quedó en 1",
            "nivel 1: 1 color fuera de la paleta; se descartaron",
            "nivel 1: trio con 2 de 3 colores",
            "nivel 2: 1 color fuera de la paleta; se descartaron",
            "nivel 2: sin colores de la paleta; se descartó",
            "números: 1 globo con dígito o tamaño inválido; se descartaron",
        ],
    }
    config = client.aio.models.calls[0]["config"]
    assert config.system_instruction == SYSTEM_INSTRUCTION  # type: ignore[attr-defined]
    assert config.temperature == 0  # type: ignore[attr-defined]
    mensaje = client.aio.models.calls[0]["contents"][0].parts[1].text  # type: ignore[index]
    assert '"element_id": "REF_01_E01"' in mensaje


def test_sin_forma_de_nivel_superior_es_salida_invalida() -> None:
    with pytest.raises(BouquetReferenciaError) as error:
        _run(_FakeClient(_respuesta('{"otra": []}')))
    assert error.value.code == "bouquet_referencia_invalid_output"


def test_respuesta_vacia_es_error_con_prefijo_propio() -> None:
    with pytest.raises(BouquetReferenciaError) as error:
        _run(_FakeClient(_respuesta(None)))
    assert error.value.code == "bouquet_referencia_empty_response"


def test_validar_descarta_variantes_y_elementos_desconocidos() -> None:
    lecturas = bouquet.validar_lecturas(
        {
            "lecturas": [
                {"element_id": "A", "variante": "flotante", "niveles": [], "confianza": 0.9},
                {"element_id": "A", "variante": "base_aire", "niveles": [], "confianza": 0.9},
                {"element_id": "A", "variante": "base_aire", "niveles": [], "confianza": 0.2},
            ]
        },
        ["A"],
        PALETA,
    )
    assert lecturas == [
        {
            "element_id": "A",
            "variante": "base_aire",
            "niveles": [],
            "confianza": 0.9,
            "total_globos": 0,
        }
    ]
    validadas = bouquet.validar_lecturas_con_descartes(
        {
            "lecturas": [
                {"element_id": "A", "variante": "flotante", "niveles": [], "confianza": 0.9},
                {"element_id": "B", "variante": "base_aire", "niveles": [], "confianza": 0.9},
                "no es un objeto",
            ]
        },
        ["A", "C"],
        PALETA,
    )
    assert validadas is not None and validadas.lecturas == []
    # Lo que se descarta entero no desaparece: va al log con correlación.
    assert validadas.descartes == [
        "A: variante desconocida",
        "B: no se pidió",
        "una entrada que no es un objeto",
        "A: el proveedor no devolvió lectura",
        "C: el proveedor no devolvió lectura",
    ]


def _una(item: dict[str, object]) -> dict[str, object]:
    lecturas = bouquet.validar_lecturas(
        {"lecturas": [{"element_id": "A", "confianza": 0.8, "variante": "base_aire", **item}]},
        ["A"],
        PALETA,
    )
    assert lecturas is not None and len(lecturas) == 1
    return lecturas[0]


def test_la_cantidad_de_cada_nivel_se_acota_con_aviso() -> None:
    cuarteto = ["dorado", "negro", "dorado", "negro"]
    lectura = _una(
        {
            "niveles": [
                {"unidad": "cuarteto", "colores": cuarteto, "cantidad": 40},
                {"unidad": "cuarteto", "colores": cuarteto, "cantidad": 0},
                {"unidad": "cuarteto", "colores": cuarteto, "cantidad": 2.5},
                {"unidad": "cuarteto", "colores": cuarteto, "cantidad": 4.0},
                {"unidad": "cuarteto", "colores": cuarteto, "clase_tamano": "xl"},
            ]
        }
    )
    niveles = cast(list[dict[str, object]], lectura["niveles"])
    assert [n["cantidad"] for n in niveles] == [24, 1, 1, 4, 1]
    assert "clase_tamano" not in niveles[4]
    assert lectura["avisos"] == [
        "nivel 1: cantidad 40 fuera de 1-24; quedó en 24",
        "nivel 2: cantidad 0 fuera de 1-24; quedó en 1",
        "nivel 3: cantidad no entera; vale 1",
        "nivel 5: sin cantidad; vale 1",
        "nivel 5: clase de tamaño desconocida; se omitió",
    ]
    assert lectura["total_globos"] == 4 * (24 + 1 + 1 + 4 + 1)


def test_los_recortes_de_colores_niveles_y_numeros_son_avisos() -> None:
    sexteto = ["dorado", "negro", "blanco", "dorado", "negro", "blanco"]
    lectura = _una(
        {
            "niveles": [{"unidad": "sexteto", "colores": sexteto, "cantidad": 1}] * 9
            + [{"unidad": "suelto", "colores": ["dorado", "negro"] * 5, "cantidad": 1}],
            "numeros": [{"digito": str(d), "clase_tamano": "grande"} for d in range(5)],
            "disposicion": "a un lado",
            "remate": {"clase": "metalizado", "color": "arcoíris"},
        }
    )
    assert len(cast(list[object], lectura["niveles"])) == 8
    assert len(cast(list[object], lectura["numeros"])) == 3
    assert lectura["remate"] == {"clase": "metalizado"}
    assert "disposicion" not in lectura
    assert lectura["avisos"] == [
        "nivel 10: 10 colores para suelto; se conservaron 6",
        "se leyeron 10 niveles; se conservaron los primeros 8",
        "remate: color fuera de la paleta; se omitió el color",
        "números: se leyeron 5; se conservaron 3",
        "disposición desconocida; se omitió",
    ]
    assert lectura["total_globos"] == 8 * 6 + 1 + 3


def test_una_lectura_limpia_no_lleva_avisos() -> None:
    lectura = _una(
        {
            "niveles": [
                {
                    "unidad": "cuarteto",
                    "colores": ["dorado", "negro", "dorado", "negro"],
                    "cantidad": 4,
                    "clase_tamano": "grande",
                }
            ],
        }
    )
    assert "avisos" not in lectura
    assert lectura["total_globos"] == 16


def test_el_ajuste_de_la_lectura_queda_en_el_log_con_correlacion(
    caplog: pytest.LogCaptureFixture,
) -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "variante": "base_aire",
                    "niveles": [{"unidad": "cuarteto", "colores": ["dorado"] * 4, "cantidad": 99}],
                    "confianza": 0.8,
                },
                {"element_id": "REF_09_E09", "variante": "base_aire", "confianza": 0.8},
            ]
        }
    )
    with caplog.at_level("WARNING", logger="decoracion.ai_api.bouquet_referencia"):
        resultado = _run(_FakeClient(_respuesta(texto)))
    [registro] = [r for r in caplog.records if r.message == "bouquet reading adjusted"]
    assert getattr(registro, "correlation_id") == "ffffffff-ffff-ffff-ffff-ffffffffffff"
    assert getattr(registro, "descartes") == ["REF_09_E09: no se pidió"]
    assert getattr(registro, "avisos") == {
        "REF_01_E01": ["nivel 1: cantidad 99 fuera de 1-24; quedó en 24"]
    }
    [lectura] = cast(list[dict[str, object]], resultado["lecturas"])
    assert lectura["total_globos"] == 96


def _signed(scopes: list[str], *, nonce: str) -> tuple[bytes, dict[str, str]]:
    operation = _operation()
    context = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-0000-0000-000000000000",
        "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 1000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes,
    }
    body = json.dumps({"context": context, **operation}, separators=(",", ":")).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": ",".join(scopes),
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=PATH,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=scopes,
            body=body,
        ),
    }
    return body, headers


async def _stub(payload: BouquetReferenciaRequest) -> dict[str, object]:
    return {
        "payload": {
            "operation_schema_version": BOUQUET_REFERENCIA_RESULT_VERSION,
            "lecturas": [],
            "modelo": DEFAULT_MODEL,
            "prompt_version": PROMPT_VERSION,
            "usage": {"prompt_token_count": len(payload.elementos)},
        }
    }


def test_la_ruta_exige_su_propio_scope() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET), bouquet_referencia_handler=_stub
        )
    )
    body, headers = _signed(["ia.bouquet_referencia"], nonce="00000000-0000-4000-8000-0000000000c1")
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["payload"]["usage"] == {"prompt_token_count": 1}
    body, headers = _signed(["ia.patron_referencia"], nonce="00000000-0000-4000-8000-0000000000c2")
    assert client.post(PATH, content=body, headers=headers).status_code == 403


def test_la_ruta_traduce_los_errores_de_dominio(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _falla(_payload: BouquetReferenciaRequest) -> dict[str, object]:
        raise BouquetReferenciaError("bouquet_referencia_provider_error", 502)

    monkeypatch.setattr(main_module, "leer_armados_referencia", _falla)
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body, headers = _signed(["ia.bouquet_referencia"], nonce="00000000-0000-4000-8000-0000000000c3")
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "bouquet_referencia_provider_error"
