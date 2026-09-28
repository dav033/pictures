"""Lectura de las guirnaldas en la foto (ADR-0032, E4): prompt, validación y ruta."""

import asyncio
import base64
import hashlib
import json
import time
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main as main_module
from app.amaterasu import conteo_referencia, patron_referencia
from app.amaterasu.estructuras import definicion, guirnalda
from app.amaterasu.guirnalda_referencia import (
    GUIRNALDA_REFERENCIA_RESULT_VERSION,
    PROMPT_VERSION,
    RESPONSE_SCHEMA,
    SYSTEM_INSTRUCTION,
    GuirnaldaReferenciaError,
    GuirnaldaReferenciaRequest,
    cumple_contrato,
    leer_guirnaldas_referencia,
)
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
SECRET = "q" * 32
PATH = "/internal/v1/ia/guirnalda-referencia"


@pytest.fixture(autouse=True)
def _clave(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "clave-de-prueba")


def _operation() -> dict[str, object]:
    return {
        "schema_version": "guirnalda-referencia.v1",
        "imagen": {"mime_type": "image/png", "data_base64": TINY_PNG_BASE64},
        "elementos": [
            {
                "element_id": "REF_01_E01",
                "bbox": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.3},
                "colores_observados": ["pink", "white"],
            }
        ],
        "otras": [{"element_id": "REF_01_E02", "tipo": "arco"}],
    }


def _payload(**cambios: object) -> GuirnaldaReferenciaRequest:
    return GuirnaldaReferenciaRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-0000-0000-000000000000",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 15000,
                "body_sha256": "a" * 64,
                "scopes": ["ia.guirnalda_referencia"],
            },
            **_operation(),
            **cambios,
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
    return asyncio.run(leer_guirnaldas_referencia(_payload(), client_factory=lambda _k: client))


def test_la_definicion_del_registro_no_cambia() -> None:
    registrado = definicion("guirnalda")
    assert registrado is not None
    assert registrado.inicio_de_pieza == "the left end of a garland"
    # La lectura de la guirnalda no toca las versiones de las otras lecturas.
    assert patron_referencia.PROMPT_VERSION == "patron-referencia.v1:0d8c93d34d672014"
    assert conteo_referencia.PROMPT_VERSION.startswith("conteo-referencia.v1:")


def test_el_prompt_nombra_soportes_formas_unidades_y_la_paleta() -> None:
    for palabra in ("sobre_estructura", "arco_caido", "u_invertida", "cuarteto", "cada_n"):
        assert palabra in SYSTEM_INSTRUCTION
    assert all(color in SYSTEM_INSTRUCTION for color in PALETA)
    assert "confianza 0" in SYSTEM_INSTRUCTION, "un arco de pie no es una guirnalda"
    esquema = json.dumps(RESPONSE_SCHEMA)
    assert "maxItems" not in esquema and "nullable" not in esquema
    assert "caida" not in esquema, "la lectura no mide metros"
    assert PROMPT_VERSION.startswith("guirnalda-referencia.v1:")


def test_lee_y_valida_la_respuesta() -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "soporte": "sobre_estructura",
                    "anfitriona_element_id": "REF_01_E02",
                    "forma": "Curva",
                    "puntos_de_anclaje": 9,
                    "racimos_visibles": 14,
                    "unidad_racimo": "cuarteto",
                    "colores_por_racimo": ["rosado", "Blanco", "magenta neón", "rosado"],
                    "relleno": {"color": "blanco", "proporcion": 0.8},
                    "remates": [
                        {"clase": "metalizado", "color": "dorado", "posicion": "centro"},
                        {"clase": "latex", "posicion": "cada_n"},
                        {"clase": "estrella", "posicion": "centro"},
                    ],
                    "confianza": 1.3,
                },
                {"element_id": "REF_99_E99", "soporte": "pared", "forma": "recta", "confianza": 1},
            ]
        }
    )
    client = _FakeClient(_respuesta(texto))
    resultado = _run(client)
    assert resultado["operation_schema_version"] == GUIRNALDA_REFERENCIA_RESULT_VERSION
    assert resultado["modelo"] == DEFAULT_MODEL
    [lectura] = resultado["lecturas"]  # type: ignore[misc]
    assert lectura == {
        "element_id": "REF_01_E01",
        "soporte": "sobre_estructura",
        "anfitriona_element_id": "REF_01_E02",
        "forma": "curva",
        # 9 anclajes está fuera de rango: se omite, no se recorta.
        "racimos_visibles": 14,
        "unidad_racimo": "cuarteto",
        "colores_por_racimo": ["rosado", "blanco", "rosado"],
        "relleno": {"color": "blanco", "proporcion": 0.5},
        "remates": [
            {"clase": "metalizado", "color": "dorado", "posicion": "centro"},
            {"clase": "latex", "posicion": "cada_n"},
        ],
        "confianza": 1.0,
    }
    config = client.aio.models.calls[0]["config"]
    assert config.system_instruction == SYSTEM_INSTRUCTION  # type: ignore[attr-defined]
    assert config.temperature == 0  # type: ignore[attr-defined]
    mensaje = client.aio.models.calls[0]["contents"][0].parts[1].text  # type: ignore[index]
    assert '"element_id": "REF_01_E01"' in mensaje and "<OTHER_PIECES>" in mensaje


def test_validar_descarta_lo_desconocido_y_la_anfitriona_ajena() -> None:
    lecturas = guirnalda.validar_lecturas(
        {
            "lecturas": [
                {"element_id": "A", "soporte": "techo", "forma": "recta", "confianza": 0.9},
                {
                    "element_id": "A",
                    "soporte": "sobre_estructura",
                    "anfitriona_element_id": "A",
                    "forma": "recta",
                    "racimos_visibles": -3,
                    "confianza": 0.7,
                },
                {"element_id": "A", "soporte": "pared", "forma": "recta", "confianza": 0.2},
            ]
        },
        ["A"],
        PALETA,
        ["B"],
    )
    assert lecturas == [
        {
            "element_id": "A",
            "soporte": "sobre_estructura",
            "forma": "recta",
            "racimos_visibles": 0,
            "colores_por_racimo": [],
            "relleno": None,
            "remates": [],
            "confianza": 0.7,
        }
    ]
    assert all(cumple_contrato(lectura) for lectura in lecturas)


def test_sin_forma_de_nivel_superior_o_vacia_es_error_con_prefijo_propio() -> None:
    with pytest.raises(GuirnaldaReferenciaError) as error:
        _run(_FakeClient(_respuesta('{"otra": []}')))
    assert error.value.code == "guirnalda_referencia_invalid_output"
    with pytest.raises(GuirnaldaReferenciaError) as error:
        _run(_FakeClient(_respuesta(None)))
    assert error.value.code == "guirnalda_referencia_empty_response"


def test_los_ids_no_se_repiten_entre_guirnaldas_y_otras_piezas() -> None:
    with pytest.raises(ValidationError):
        _payload(otras=[{"element_id": "REF_01_E01", "tipo": "arco"}])


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


async def _stub(payload: GuirnaldaReferenciaRequest) -> dict[str, object]:
    return {
        "payload": {
            "operation_schema_version": GUIRNALDA_REFERENCIA_RESULT_VERSION,
            "lecturas": [],
            "modelo": DEFAULT_MODEL,
            "prompt_version": PROMPT_VERSION,
            "usage": {"prompt_token_count": len(payload.elementos) + len(payload.otras)},
        }
    }


def test_la_ruta_exige_su_propio_scope() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET), guirnalda_referencia_handler=_stub
        )
    )
    body, headers = _signed(
        ["ia.guirnalda_referencia"], nonce="00000000-0000-4000-8000-0000000000e1"
    )
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["payload"]["usage"] == {"prompt_token_count": 2}
    body, headers = _signed(["ia.bouquet_referencia"], nonce="00000000-0000-4000-8000-0000000000e2")
    assert client.post(PATH, content=body, headers=headers).status_code == 403


def test_la_ruta_traduce_los_errores_de_dominio(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _falla(_payload: GuirnaldaReferenciaRequest) -> dict[str, object]:
        raise GuirnaldaReferenciaError("guirnalda_referencia_provider_error", 502)

    monkeypatch.setattr(main_module, "leer_guirnaldas_referencia", _falla)
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body, headers = _signed(
        ["ia.guirnalda_referencia"], nonce="00000000-0000-4000-8000-0000000000e3"
    )
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "guirnalda_referencia_provider_error"
