"""Lectura del armado de los bouquets en la foto (ADR-0030)."""

import asyncio
import base64
import hashlib
import json
import time
from types import SimpleNamespace
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
    assert PROMPT_VERSION.startswith("bouquet-referencia.v1:")


def test_lee_y_valida_la_respuesta() -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "variante": "helio_apilado",
                    "niveles": [
                        {"unidad": "trio", "colores": ["blanco", "Rosado", "magenta neón"]},
                        {"unidad": "cuarteto", "colores": ["morado inexistente"]},
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
        "niveles": [{"unidad": "trio", "colores": ["blanco", "rosado"]}],
        "confianza": 1.0,
        "remate": {"clase": "metalizado", "color": "dorado"},
        "numeros": [{"digito": "5", "clase_tamano": "grande"}],
        "disposicion": "centro",
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
        {"element_id": "A", "variante": "base_aire", "niveles": [], "confianza": 0.9}
    ]


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
