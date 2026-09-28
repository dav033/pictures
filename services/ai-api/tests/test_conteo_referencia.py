"""Conteo de globos de cada pieza en la foto de referencia (ADR-0031, E1)."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import time
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main as main_module
from app.amaterasu import conteo_referencia
from app.amaterasu.conteo_referencia import (
    CLASES_TAMANO,
    CONTEO_REFERENCIA_RESULT_VERSION,
    MAX_GLOBOS_EXACTO,
    PROMPT_VERSION,
    REFERENCIAS_ESCALA,
    RESPONSE_SCHEMA,
    SYSTEM_INSTRUCTION,
    ConteoReferenciaError,
    ConteoReferenciaRequest,
    cumple_contrato,
    leer_conteos_referencia,
    validar_lecturas,
)
from app.amaterasu.estructuras import DEFINICIONES
from app.amaterasu.turno import DEFAULT_MODEL
from app.generated_models import ReferenceBlueprint
from app.main import Settings, build_signature, create_app

TINY_PNG_BASE64 = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
        "de0000000c4944415478da6360000002000155bce9a70000000049454e44ae42"
        "6082"
    )
).decode("ascii")
SECRET = "c" * 32
PATH = "/internal/v1/ia/conteo-referencia"
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-0000-0000-000000000000",
    "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 15000,
    "body_sha256": "a" * 64,
    "scopes": ["ia.conteo_referencia"],
}


@pytest.fixture(autouse=True)
def _clave(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "clave-de-prueba")


def _operation() -> dict[str, object]:
    return {
        "schema_version": "conteo-referencia.v1",
        "imagen": {"mime_type": "image/png", "data_base64": TINY_PNG_BASE64},
        "elementos": [
            {
                "element_id": "REF_01_E01",
                "tipo": "kit",
                "estructura_oficial": "bouquet",
                "bbox": {"x": 0.3, "y": 0.2, "width": 0.3, "height": 0.6},
            },
            {"element_id": "REF_01_E02", "tipo": "columna", "piezas": 2},
            {"element_id": "REF_01_E03", "tipo": "kit"},
        ],
    }


def _payload(**cambios: object) -> ConteoReferenciaRequest:
    return ConteoReferenciaRequest.model_validate({"context": CONTEXTO, **_operation(), **cambios})


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
        prompt_token_count=1100,
        candidates_token_count=140,
        thoughts_token_count=0,
        cached_content_token_count=0,
        tool_use_prompt_token_count=None,
        total_token_count=1240,
    )
    return SimpleNamespace(
        text=texto, candidates=[candidate], usage_metadata=usage, prompt_feedback=None
    )


def _run(client: object) -> dict[str, object]:
    return asyncio.run(leer_conteos_referencia(_payload(), client_factory=lambda _k: client))


# --- Registro y prompt --------------------------------------------------------


def test_cada_tipo_del_registro_dice_como_contarse_y_el_prompt_lo_nombra() -> None:
    for d in DEFINICIONES:
        assert d.como_contar.strip(), d.clave
        assert not d.como_contar.endswith("."), "reglas_de_conteo pone el punto final"
        assert f"- {d.clave}: {d.como_contar}." in SYSTEM_INSTRUCTION
    assert {d.clave for d in DEFINICIONES} >= {
        "arco",
        "semiarco",
        "columna",
        "guirnalda",
        "pared",
        "centro_mesa",
        "techo_globos",
        "bouquet",
        "figura",
    }


def test_la_version_del_prompt_de_conteo_esta_fijada() -> None:
    # Cambiar el texto, el registro (orden o `como_contar`), las clases del
    # contrato o el esquema de salida cambia este valor a propósito: se fija a
    # mano y el commit dice por qué.
    assert (
        PROMPT_VERSION
        == "conteo-referencia.v1:"
        + hashlib.sha256(
            (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA)).encode("utf-8")
        ).hexdigest()[:16]
    )
    # 1b1d24d3…: las clases de tamaño con la escala del bouquet (revisión 1/11).
    assert PROMPT_VERSION == "conteo-referencia.v1:1b1d24d385008090"


def test_el_prompt_no_trae_cifras_del_plan() -> None:
    # Los globos por metro o por densidad son de plan.py: la lectura mide la
    # foto, no repite el modelo del plan (ADR-0031).
    texto = SYSTEM_INSTRUCTION.lower()
    assert "per meter" not in texto and "per metre" not in texto
    assert not re.search(r"\b\d+(\.\d+)?\s*(m|cm|meters?)\b", texto)
    assert f"at most {MAX_GLOBOS_EXACTO} visible balloons" in SYSTEM_INSTRUCTION


def test_el_esquema_de_salida_lo_acepta_gemini_y_ordena_el_razonamiento() -> None:
    assert "maxItems" not in json.dumps(RESPONSE_SCHEMA)
    items = RESPONSE_SCHEMA["properties"]["lecturas"]["items"]  # type: ignore[index]
    orden = list(items["properties"])
    assert orden.index("globos_visibles") < orden.index("racimos") < orden.index("estimado_total")
    assert orden[-1] == "confianza"


def test_clases_y_referencias_salen_del_contrato() -> None:
    assert CLASES_TAMANO == ("chico", "mediano", "grande", "gigante")
    assert REFERENCIAS_ESCALA == ("persona", "puerta", "mesa")


# --- Validación de la salida del proveedor -----------------------------------


def _lectura_densa(**cambios: object) -> dict[str, object]:
    return {
        "element_id": "REF_01_E02",
        "globos_visibles": 58,
        "exacto": False,
        "racimos": 24,
        "globos_por_racimo": 4,
        "estimado_total": 96,
        "por_tamano": [
            {"clase": "mediano", "proporcion": 0.5},
            {"clase": "Chico", "proporcion": 0.3},
            {"clase": "grande", "proporcion": 0.1},
        ],
        "largo_relativo": {"referencia": "persona", "veces": 0.4567},
        "alto_relativo": {"referencia": "puerta", "veces": 1.2},
        "confianza": 1.4,
        **cambios,
    }


def test_valida_y_normaliza_una_lectura_densa() -> None:
    [lectura] = validar_lecturas({"lecturas": [_lectura_densa()]}, ["REF_01_E02"]) or []
    assert lectura == {
        "element_id": "REF_01_E02",
        "globos_visibles": 58,
        "exacto": False,
        "estimado_total": 96,
        "racimos": 24,
        "globos_por_racimo": 4,
        # Suman 0,9: se aceptan y se normalizan a 1, en el orden de las clases.
        "por_tamano": [
            {"clase": "chico", "proporcion": 0.333},
            {"clase": "mediano", "proporcion": 0.556},
            {"clase": "grande", "proporcion": 0.111},
        ],
        "largo_relativo": {"referencia": "persona", "veces": 0.46},
        "alto_relativo": {"referencia": "puerta", "veces": 1.2},
        "confianza": 1.0,
    }
    assert cumple_contrato(lectura)


def test_exacto_solo_en_piezas_chicas_y_sin_estimado() -> None:
    grande = _lectura_densa(exacto=True)
    chica = _lectura_densa(
        element_id="REF_01_E01", globos_visibles=5, exacto=True, estimado_total=12
    )
    vacia = _lectura_densa(element_id="REF_01_E03", globos_visibles=0, exacto=True)
    lecturas = validar_lecturas(
        {"lecturas": [grande, chica, vacia]}, ["REF_01_E01", "REF_01_E02", "REF_01_E03"]
    )
    assert lecturas is not None
    por_id = {lectura["element_id"]: lectura for lectura in lecturas}
    assert por_id["REF_01_E02"]["exacto"] is False, "58 visibles nunca es una cuenta exacta"
    assert por_id["REF_01_E02"]["estimado_total"] == 96
    assert por_id["REF_01_E01"]["exacto"] is True
    assert por_id["REF_01_E01"]["estimado_total"] is None, "con cuenta exacta no hay estimado"
    assert por_id["REF_01_E03"]["exacto"] is False, "cero globos visibles no es una cuenta"
    assert MAX_GLOBOS_EXACTO == 40


def test_los_campos_incoherentes_quedan_vacios_sin_inventar() -> None:
    casos: list[tuple[dict[str, object], str, object]] = [
        (_lectura_densa(estimado_total=30), "estimado_total", None),
        (_lectura_densa(racimos=0), "racimos", None),
        (_lectura_densa(racimos=3000), "racimos", None),
        (_lectura_densa(globos_por_racimo=9), "globos_por_racimo", None),
        (_lectura_densa(globos_por_racimo=True), "globos_por_racimo", None),
        (
            _lectura_densa(por_tamano=[{"clase": "mediano", "proporcion": 0.5}]),
            "por_tamano",
            [],
        ),
        (
            _lectura_densa(
                por_tamano=[
                    {"clase": "mediano", "proporcion": 0.5},
                    {"clase": "mediano", "proporcion": 0.5},
                ]
            ),
            "por_tamano",
            [],
        ),
        (
            _lectura_densa(por_tamano=[{"clase": "enorme", "proporcion": 1}]),
            "por_tamano",
            [],
        ),
        (_lectura_densa(por_tamano="mediano"), "por_tamano", []),
        (
            _lectura_densa(largo_relativo={"referencia": "silla", "veces": 2}),
            "largo_relativo",
            None,
        ),
        (
            _lectura_densa(largo_relativo={"referencia": "persona", "veces": 0}),
            "largo_relativo",
            None,
        ),
        (
            _lectura_densa(alto_relativo={"referencia": "puerta", "veces": 80}),
            "alto_relativo",
            None,
        ),
    ]
    for item, campo, esperado in casos:
        [lectura] = validar_lecturas({"lecturas": [item]}, ["REF_01_E02"]) or [{}]
        assert lectura[campo] == esperado, (campo, item[campo])
        assert cumple_contrato(lectura)


def test_se_descartan_lecturas_sin_cuenta_o_de_elementos_no_pedidos() -> None:
    lecturas = validar_lecturas(
        {
            "lecturas": [
                _lectura_densa(element_id="REF_09_E09"),
                _lectura_densa(globos_visibles="muchos"),
                _lectura_densa(globos_visibles=-1),
                _lectura_densa(confianza=True),
                _lectura_densa(confianza=float("nan")),
                "no es un objeto",
                _lectura_densa(),
                _lectura_densa(globos_visibles=10),
            ]
        },
        ["REF_01_E02"],
    )
    assert lecturas is not None
    assert [(lectura["element_id"], lectura["globos_visibles"]) for lectura in lecturas] == [
        ("REF_01_E02", 58)
    ], "solo la primera lectura válida de un elemento pedido"
    assert validar_lecturas({"otra": []}, ["REF_01_E02"]) is None
    assert validar_lecturas({"lecturas": []}, ["REF_01_E02"]) == []


def test_una_lectura_fuera_de_contrato_se_descarta_y_se_registra(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(conteo_referencia, "cumple_contrato", lambda _lectura: False)
    with caplog.at_level(logging.WARNING, logger="app.amaterasu.conteo_referencia"):
        assert validar_lecturas({"lecturas": [_lectura_densa()]}, ["REF_01_E02"]) == []
    assert "REF_01_E02" in caplog.text
    assert not cumple_contrato({**_lectura_densa(), "exacto": "no"})


def test_una_lectura_valida_cabe_en_el_blueprint_del_contrato() -> None:
    [lectura] = validar_lecturas({"lecturas": [_lectura_densa()]}, ["REF_01_E02"]) or []
    conteo = {clave: valor for clave, valor in lectura.items() if clave != "element_id"}
    blueprint = {
        "schema_version": "2.0",
        "source_images": [{"image_id": "REF_01", "approved_roles": ["composition_reference"]}],
        "elements": [
            {
                "element_id": "REF_01_E02",
                "source_image_id": "REF_01",
                "name": "columna",
                "category": "balloon_structure",
                "scene_role": "midground",
                "detection_confidence": 0.9,
                "visible_evidence": "columna",
                "reference_bbox": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.8},
                "depth_layer": 1,
                "include_policy": "include",
                "approved": True,
                "source_type": "reference_only",
                "quantity": {"mode": "exact", "min": 1, "max": 1},
                "appearance": {
                    "observed_colors": ["white"],
                    "resolved_colors": [],
                    "color_policy": "match_reference",
                    "material": "latex",
                    "shape": "tall column",
                    "composition": "mixed",
                    "conteo": conteo,
                },
                "relationships": [],
                "uncertainties": [],
            }
        ],
        "composition": {
            "focal_point": "columna",
            "density": "moderate",
            "symmetry": "unknown",
            "negative_space": [],
        },
        "palette": {"observed": ["white"], "priority": ["white"]},
        "unresolved_decisions": [],
    }
    ReferenceBlueprint.model_validate(blueprint)


# --- Petición y llamada --------------------------------------------------------


def test_la_peticion_rechaza_ids_repetidos_y_piezas_fuera_de_rango() -> None:
    elemento = {"element_id": "A", "tipo": "columna"}
    with pytest.raises(ValidationError):
        _payload(elementos=[elemento, elemento])
    with pytest.raises(ValidationError):
        _payload(elementos=[{**elemento, "piezas": 0}])
    with pytest.raises(ValidationError):
        _payload(elementos=[{**elemento, "color": "rojo"}])
    with pytest.raises(ValidationError):
        _payload(elementos=[{"element_id": f"E{i}", "tipo": "kit"} for i in range(13)])


def test_cuenta_con_el_proveedor_falso_y_arma_el_mensaje_desde_el_registro() -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "globos_visibles": 5,
                    "exacto": True,
                    "por_tamano": [{"clase": "mediano", "proporcion": 1}],
                    "confianza": 0.9,
                },
                _lectura_densa(),
            ]
        }
    )
    client = _FakeClient(_respuesta(texto))
    resultado = _run(client)
    assert resultado["operation_schema_version"] == CONTEO_REFERENCIA_RESULT_VERSION
    assert resultado["modelo"] == DEFAULT_MODEL
    assert resultado["prompt_version"] == PROMPT_VERSION
    assert resultado["usage"] == {
        "prompt_token_count": 1100,
        "candidates_token_count": 140,
        "thoughts_token_count": 0,
        "cached_content_token_count": 0,
        "total_token_count": 1240,
    }
    assert resultado["lecturas"] == [
        {
            "element_id": "REF_01_E01",
            "globos_visibles": 5,
            "exacto": True,
            "estimado_total": None,
            "racimos": None,
            "globos_por_racimo": None,
            "por_tamano": [{"clase": "mediano", "proporcion": 1.0}],
            "largo_relativo": None,
            "alto_relativo": None,
            "confianza": 0.9,
        },
        validar_lecturas({"lecturas": [_lectura_densa()]}, ["REF_01_E02"])[0],  # type: ignore[index]
    ]
    [llamada] = client.aio.models.calls
    config = llamada["config"]
    assert config.system_instruction == SYSTEM_INSTRUCTION  # type: ignore[attr-defined]
    assert config.temperature == 0  # type: ignore[attr-defined]
    mensaje = llamada["contents"][0].parts[1].text  # type: ignore[index]
    datos = json.loads(mensaje.split("<ELEMENTS>")[1].split("</ELEMENTS>")[0])
    assert datos == [
        # Un bouquet es un `kit`: el registro lo describe por su estructura oficial.
        {
            "element_id": "REF_01_E01",
            "tipo": "bouquet",
            "bbox": {"x": 0.3, "y": 0.2, "width": 0.3, "height": 0.6},
        },
        # "2 columnas": se cuenta una.
        {"element_id": "REF_01_E02", "tipo": "columna", "piezas": 2},
        # Un kit sin estructura oficial no está en el registro: regla genérica.
        {"element_id": "REF_01_E03", "tipo": "kit"},
    ]


def test_sin_forma_de_nivel_superior_es_salida_invalida() -> None:
    with pytest.raises(ConteoReferenciaError) as error:
        _run(_FakeClient(_respuesta('{"otra": []}')))
    assert error.value.code == "conteo_referencia_invalid_output"


def test_respuesta_vacia_es_error_con_prefijo_propio() -> None:
    with pytest.raises(ConteoReferenciaError) as error:
        _run(_FakeClient(_respuesta(None)))
    assert error.value.code == "conteo_referencia_empty_response"
    assert error.value.provider_detail == "finish_reason=STOP"


def test_sin_clave_del_proveedor_no_llama(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    client = _FakeClient(_respuesta("{}"))
    with pytest.raises(ConteoReferenciaError) as error:
        _run(client)
    assert error.value.code == "conteo_referencia_unavailable"
    assert error.value.status_code == 503
    assert client.aio.models.calls == []


# --- Ruta HTTP -----------------------------------------------------------------


def _signed(scopes: list[str], *, nonce: str) -> tuple[bytes, dict[str, str]]:
    operation = _operation()
    context = {
        **CONTEXTO,
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


async def _stub(payload: ConteoReferenciaRequest) -> dict[str, object]:
    return {
        "payload": {
            "operation_schema_version": CONTEO_REFERENCIA_RESULT_VERSION,
            "lecturas": [],
            "modelo": DEFAULT_MODEL,
            "prompt_version": PROMPT_VERSION,
            "usage": {"prompt_token_count": len(payload.elementos)},
        }
    }


def test_la_ruta_exige_su_propio_scope() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET), conteo_referencia_handler=_stub
        )
    )
    body, headers = _signed(["ia.conteo_referencia"], nonce="00000000-0000-4000-8000-0000000000d1")
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["payload"]["usage"] == {"prompt_token_count": 3}
    body, headers = _signed(["ia.bouquet_referencia"], nonce="00000000-0000-4000-8000-0000000000d2")
    assert client.post(PATH, content=body, headers=headers).status_code == 403


def test_la_ruta_traduce_los_errores_de_dominio(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _falla(_payload: ConteoReferenciaRequest) -> dict[str, object]:
        raise ConteoReferenciaError("conteo_referencia_provider_error", 502)

    monkeypatch.setattr(main_module, "leer_conteos_referencia", _falla)
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body, headers = _signed(["ia.conteo_referencia"], nonce="00000000-0000-4000-8000-0000000000d3")
    response = client.post(PATH, content=body, headers=headers)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "conteo_referencia_provider_error"
