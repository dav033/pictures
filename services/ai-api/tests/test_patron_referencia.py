import asyncio
import base64
import hashlib
import json
import time
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.amaterasu.patron_referencia import (
    MODOS,
    PALETA,
    PATRON_REFERENCIA_RESULT_VERSION,
    PROMPT_VERSION,
    RESPONSE_SCHEMA,
    SYSTEM_INSTRUCTION,
    PatronReferenciaError,
    PatronReferenciaRequest,
    detectar_patrones_referencia,
    validar_pistas,
)
from app.amaterasu.turno import DEFAULT_MODEL
from app.generated_models import contract_schema
from app import main as main_module
from app.main import MAX_BODY_BYTES, Settings, build_signature, create_app

TINY_PNG_BASE64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da6360000002000155bce9a70000000049454e44ae42"
    "6082"
)).decode("ascii")
SECRET = "t" * 32
PATH = "/internal/v1/ia/patron-referencia"


def _operation(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "schema_version": "patron-referencia.v1",
        "imagen": {"mime_type": "image/png", "data_base64": TINY_PNG_BASE64},
        "elementos": [
            {
                "element_id": "REF_01_E01",
                "tipo": "columna",
                "bbox": {"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.7},
                "colores_observados": ["white", "black", "blue"],
            },
            {"element_id": "REF_01_E02", "tipo": "arco", "colores_observados": ["dorado"]},
        ],
    }
    body.update(overrides)
    return body


def _request_dict(**overrides: object) -> dict[str, object]:
    return {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-0000-0000-000000000000",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 15000,
            "body_sha256": "a" * 64,
            "scopes": ["ia.patron_referencia"],
        },
        **_operation(**overrides),
    }


def _payload(**overrides: object) -> PatronReferenciaRequest:
    return PatronReferenciaRequest.model_validate(_request_dict(**overrides))


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


def _fake_response(text: str | None, *, finish_reason: object = "STOP", block_reason: object = None) -> object:
    candidate = SimpleNamespace(content=SimpleNamespace(parts=[]), finish_reason=finish_reason)
    usage = SimpleNamespace(
        prompt_token_count=1200,
        candidates_token_count=80,
        thoughts_token_count=0,
        cached_content_token_count=0,
        tool_use_prompt_token_count=None,
        total_token_count=1280,
    )
    feedback = SimpleNamespace(block_reason=block_reason) if block_reason else None
    return SimpleNamespace(text=text, candidates=[candidate], usage_metadata=usage, prompt_feedback=feedback)


def _run(payload: PatronReferenciaRequest, client: object) -> dict[str, object]:
    return asyncio.run(detectar_patrones_referencia(payload, client_factory=lambda _api_key: client))


# --- Prompt and response schema -------------------------------------------


def test_palette_comes_from_the_plan_contract_without_multicolor() -> None:
    contrato = list(contract_schema("PlanDecoracion")["x-paleta-colores"])
    assert list(PALETA) == [color for color in contrato if color != "multicolor"]
    assert "rosado" in PALETA and "dorado" in PALETA
    # Aliases of the LoRA color table ("gris", "azul rey") are not catalog colors.
    assert "gris" not in PALETA and "azul rey" not in PALETA


def test_prompt_names_every_palette_color_and_every_mode() -> None:
    for color in PALETA:
        assert color in SYSTEM_INSTRUCTION
    for modo in (*MODOS, "ninguno"):
        assert f'"{modo}"' in SYSTEM_INSTRUCTION
    # The decorator's own words for each pattern, not only the identifiers.
    for oficio in ("quartets", "salvavidas", "ombré", "confetti", "daisy", "checkerboard", "zigzag"):
        assert oficio in SYSTEM_INSTRUCTION


def test_response_schema_restricts_colors_and_modes() -> None:
    item = RESPONSE_SCHEMA["properties"]["pistas"]["items"]  # type: ignore[index]
    assert item["properties"]["colores"]["items"]["enum"] == list(PALETA)
    assert item["properties"]["modo"]["enum"] == [*MODOS, "ninguno"]
    assert PROMPT_VERSION.startswith("patron-referencia.v1:")


# --- Request model -----------------------------------------------------------


def test_request_rejects_duplicate_element_ids() -> None:
    elemento = _operation()["elementos"][0]  # type: ignore[index]
    with pytest.raises(ValueError, match="unique"):
        _payload(elementos=[elemento, elemento])


def test_request_bounds_the_element_list() -> None:
    elemento = _operation()["elementos"][0]  # type: ignore[index]
    with pytest.raises(ValueError):
        _payload(elementos=[])
    with pytest.raises(ValueError):
        _payload(elementos=[{**elemento, "element_id": f"E{i}"} for i in range(13)])


def test_request_rejects_unsupported_image_type_and_blank_ids() -> None:
    with pytest.raises(ValueError):
        _payload(imagen={"mime_type": "image/gif", "data_base64": TINY_PNG_BASE64})
    with pytest.raises(ValueError):
        _payload(elementos=[{"element_id": "  ", "tipo": "columna", "colores_observados": []}])


# --- Provider call -------------------------------------------------------------


def test_fails_closed_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(PatronReferenciaError) as excinfo:
        asyncio.run(detectar_patrones_referencia(_payload()))
    assert (excinfo.value.code, excinfo.value.status_code) == ("patron_referencia_unavailable", 503)


def test_rejects_invalid_base64_before_calling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = _FakeClient(_fake_response("{}"))
    with pytest.raises(PatronReferenciaError) as excinfo:
        _run(_payload(imagen={"mime_type": "image/png", "data_base64": "no-es-base64!!"}), client)
    assert (excinfo.value.code, excinfo.value.status_code) == ("patron_referencia_invalid_image", 422)
    assert client.aio.models.calls == []


def test_sends_image_elements_prompt_and_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    respuesta = {
        "pistas": [
            {
                "element_id": "REF_01_E01",
                "modo": "espiral",
                "colores": ["blanco", "negro", "blanco", "azul"],
                "globos_por_racimo": 4,
                "confianza": 0.82,
            },
            {"element_id": "REF_01_E02", "modo": "ninguno", "colores": [], "confianza": 0.3},
        ]
    }
    client = _FakeClient(_fake_response(json.dumps(respuesta)))

    result = _run(_payload(), client)

    assert result == {
        "operation_schema_version": PATRON_REFERENCIA_RESULT_VERSION,
        "pistas": [
            {
                "element_id": "REF_01_E01",
                "modo": "espiral",
                "colores": ["blanco", "negro", "blanco", "azul"],
                "globos_por_racimo": 4,
                "confianza": 0.82,
            },
            {"element_id": "REF_01_E02", "modo": "ninguno", "colores": [], "confianza": 0.3},
        ],
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": {
            "prompt_token_count": 1200,
            "candidates_token_count": 80,
            "thoughts_token_count": 0,
            "cached_content_token_count": 0,
            "total_token_count": 1280,
        },
    }
    call = client.aio.models.calls[0]
    assert call["model"] == DEFAULT_MODEL
    config = call["config"]
    assert config.system_instruction == SYSTEM_INSTRUCTION  # type: ignore[attr-defined]
    assert config.response_mime_type == "application/json"  # type: ignore[attr-defined]
    assert config.temperature == 0  # type: ignore[attr-defined]
    parts = call["contents"][0].parts  # type: ignore[index]
    assert parts[0].inline_data.data == base64.b64decode(TINY_PNG_BASE64)
    assert parts[0].inline_data.mime_type == "image/png"
    mensaje = parts[1].text
    assert '"element_id": "REF_01_E01"' in mensaje and '"tipo": "arco"' in mensaje
    assert '"bbox": {"x": 0.1' in mensaje


def test_wraps_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class _RaisingModels:
        async def generate_content(self, **_kwargs: object) -> object:
            raise RuntimeError("boom")

    client = SimpleNamespace(aio=SimpleNamespace(models=_RaisingModels()))
    with pytest.raises(PatronReferenciaError) as excinfo:
        _run(_payload(), client)
    assert (excinfo.value.code, excinfo.value.status_code) == ("patron_referencia_provider_error", 502)


def test_empty_answer_is_an_error_with_the_provider_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    blocked = SimpleNamespace(value="SAFETY")
    with pytest.raises(PatronReferenciaError) as excinfo:
        _run(_payload(), _FakeClient(_fake_response("", finish_reason=None, block_reason=blocked)))
    assert excinfo.value.code == "patron_referencia_empty_response"
    assert excinfo.value.provider_detail == "block_reason=SAFETY"


@pytest.mark.parametrize("texto", ['{"pistas": [', '["no es un objeto"]', '{"otra_cosa": []}'])
def test_malformed_answer_is_invalid_output(monkeypatch: pytest.MonkeyPatch, texto: str) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    with pytest.raises(PatronReferenciaError) as excinfo:
        _run(_payload(), _FakeClient(_fake_response(texto)))
    assert (excinfo.value.code, excinfo.value.status_code) == ("patron_referencia_invalid_output", 502)


# --- Provider output validation -----------------------------------------------


def test_drops_unrequested_duplicate_and_unknown_mode_hints() -> None:
    elementos = _payload().elementos
    pistas = validar_pistas(
        {
            "pistas": [
                {"element_id": "REF_09_E01", "modo": "espiral", "colores": ["rojo"], "confianza": 1},
                {"element_id": "REF_01_E01", "modo": "arcoiris", "colores": ["rojo"], "confianza": 1},
                {"element_id": "REF_01_E01", "modo": "anillos", "colores": ["rojo", "blanco"], "confianza": 0.7},
                {"element_id": "REF_01_E01", "modo": "bloques", "colores": ["azul", "blanco"], "confianza": 0.9},
                {"element_id": "REF_01_E02", "modo": "degradado", "colores": ["rojo", "blanco"], "confianza": True},
                "no es un objeto",
            ]
        },
        elementos,
    )
    # The unknown mode does not burn the element: its next valid hint is used.
    assert pistas == [
        {"element_id": "REF_01_E01", "modo": "anillos", "colores": ["rojo", "blanco"], "confianza": 0.7},
    ]


def test_keeps_only_palette_colors_with_their_aligned_weights() -> None:
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E01",
                    "modo": "Bloques",
                    "colores": ["ROSADO", "gris", "Café", "multicolor", " dorado "],
                    "pesos": [50, 10, 30.4, 5, 250],
                    "confianza": 0.9,
                }
            ]
        },
        _payload().elementos,
    )
    assert pista == {
        "element_id": "REF_01_E01",
        "modo": "bloques",
        "colores": ["rosado", "cafe", "dorado"],
        "pesos": [50, 30, 100],
        "confianza": 0.9,
    }


def test_clamps_numbers_and_drops_misaligned_weights() -> None:
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E01",
                    "modo": "aleatorio",
                    "colores": ["rojo", "blanco"],
                    "pesos": [70],
                    "globos_por_racimo": 11,
                    "confianza": 1.7,
                }
            ]
        },
        _payload().elementos,
    )
    assert pista == {
        "element_id": "REF_01_E01",
        "modo": "aleatorio",
        "colores": ["rojo", "blanco"],
        "globos_por_racimo": 8,
        "confianza": 1.0,
    }


def test_hint_without_catalog_colors_becomes_ninguno() -> None:
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E02",
                    "modo": "espiral",
                    "colores": ["gris", "marfil"],
                    "globos_por_racimo": 4,
                    "confianza": 0.8,
                }
            ]
        },
        _payload().elementos,
    )
    assert pista == {"element_id": "REF_01_E02", "modo": "ninguno", "colores": [], "confianza": 0.8}


def test_top_level_shape_is_required() -> None:
    for raw in (None, [], {"pistas": "x"}):
        with pytest.raises(PatronReferenciaError) as excinfo:
            validar_pistas(raw, _payload().elementos)
        assert excinfo.value.code == "patron_referencia_invalid_output"


# --- HTTP boundary -------------------------------------------------------------


def _signed(scopes: list[str], *, image_chars: int = 0, nonce: str) -> tuple[bytes, dict[str, str]]:
    operation = _operation()
    if image_chars:
        # Valid base64 padding for the size check; the stub handler never decodes it.
        operation["imagen"] = {"mime_type": "image/png", "data_base64": "A" * image_chars}
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


async def _stub_handler(payload: PatronReferenciaRequest) -> dict[str, object]:
    return {
        "payload": {
            "operation_schema_version": PATRON_REFERENCIA_RESULT_VERSION,
            "pistas": [],
            "modelo": DEFAULT_MODEL,
            "prompt_version": PROMPT_VERSION,
            "usage": {"prompt_token_count": len(payload.elementos)},
        }
    }


def test_route_requires_its_own_scope_and_accepts_a_photo_above_64kb() -> None:
    client = TestClient(
        create_app(Settings(environment="test", hmac_secret=SECRET), patron_referencia_handler=_stub_handler)
    )
    body, headers = _signed(
        ["ia.patron_referencia"],
        image_chars=MAX_BODY_BYTES * 2,
        nonce="00000000-0000-4000-8000-0000000000b1",
    )
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["payload"]["usage"] == {"prompt_token_count": 2}

    body, headers = _signed(["ia.reference_turn"], nonce="00000000-0000-4000-8000-0000000000b2")
    assert client.post(PATH, content=body, headers=headers).status_code == 403


def test_route_maps_domain_errors_with_the_provider_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise(_payload: PatronReferenciaRequest) -> dict[str, object]:
        raise PatronReferenciaError("patron_referencia_empty_response", 502, "finish_reason=MAX_TOKENS")

    # The default handler: the provider call is the only thing replaced.
    monkeypatch.setattr(main_module, "detectar_patrones_referencia", _raise)
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body, headers = _signed(["ia.patron_referencia"], nonce="00000000-0000-4000-8000-0000000000b3")
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "patron_referencia_empty_response"
    assert detail["provider_detail"] == "finish_reason=MAX_TOKENS"


def test_provider_schema_has_no_max_items() -> None:
    """gemini-3.6-flash answers 400 INVALID_ARGUMENT to a response_schema with
    `maxItems` (measured 2026-09-24); the caps live in `validar_pistas`."""

    def claves(nodo: object) -> set[str]:
        if isinstance(nodo, dict):
            return set(nodo) | {clave for valor in nodo.values() for clave in claves(valor)}
        if isinstance(nodo, list):
            return {clave for valor in nodo for clave in claves(valor)}
        return set()

    assert "maxItems" not in claves(RESPONSE_SCHEMA)
