"""Lectura de las guirnaldas en la foto (ADR-0032, E4): prompt, validación y ruta."""

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
    # El valor lo movió ADR-0036 (el modo `zonas` en el prompt del patrón), no esta lectura.
    assert patron_referencia.PROMPT_VERSION == "patron-referencia.v1:5cbba9bd04d02884"
    assert conteo_referencia.PROMPT_VERSION.startswith("conteo-referencia.v1:")


def test_el_prompt_nombra_soportes_formas_unidades_y_la_paleta() -> None:
    for palabra in ("sobre_estructura", "arco_caido", "u_invertida", "cuarteto", "cada_n"):
        assert palabra in SYSTEM_INSTRUCTION
    assert all(color in SYSTEM_INSTRUCTION for color in PALETA)
    assert "confianza 0" in SYSTEM_INSTRUCTION, "un arco de pie no es una guirnalda"
    esquema = json.dumps(RESPONSE_SCHEMA)
    assert "maxItems" not in esquema and "nullable" not in esquema
    assert "caida_m" not in esquema and "desnivel_m" not in esquema, "la lectura no mide metros"


def test_la_forma_se_pide_como_tres_puntos_de_la_imagen() -> None:
    # ADR-0032, decisión 29: el modelo ubica la línea central; Python calcula la geometría.
    for texto in (
        "linea_central: where the garland runs in the photo, as three points",
        "Each point is a position in the WHOLE image, never in meters",
        "x goes from 0 at the left edge of the image to 1 at its right edge",
        "y from 0 at the top edge to 1 at the bottom edge",
        "extremo_izquierdo: the center of the garland's band at its left end",
        "extremo_derecho: the center of the garland's band at its right end",
        "punto_medio: go halfway between the two ends horizontally",
        "Omit linea_central when you cannot see both ends of the garland.",
    ):
        assert texto in SYSTEM_INSTRUCTION
    # Ni la v2 ni la v3: el modelo ya no juzga el sentido, la flecha ni el desnivel.
    viejas = {"caida_relativa", "sentido_curva", "flecha_relativa", "desnivel_relativo"}
    assert not any(pregunta in SYSTEM_INSTRUCTION for pregunta in viejas)
    propiedades = RESPONSE_SCHEMA["properties"]["lecturas"]["items"]["properties"]  # type: ignore[index]
    assert not viejas & set(propiedades)
    fraccion = {"type": "number", "minimum": 0, "maximum": 1}
    punto = {"type": "object", "properties": {"x": fraccion, "y": fraccion}, "required": ["x", "y"]}
    assert propiedades["linea_central"] == {
        "type": "object",
        "properties": {
            "extremo_izquierdo": punto,
            "punto_medio": punto,
            "extremo_derecho": punto,
        },
        "required": ["extremo_izquierdo", "punto_medio", "extremo_derecho"],
    }
    requeridos = RESPONSE_SCHEMA["properties"]["lecturas"]["items"]["required"]  # type: ignore[index]
    assert "linea_central" not in requeridos, "el modelo la omite cuando no ve los extremos"
    # La versión del prompt cambia con el prompt y el esquema: fijada aquí a propósito.
    assert PROMPT_VERSION == "guirnalda-referencia.v4:d4b1aa13cddf1478"


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
        # Sin curvatura ni desnivel en la respuesta: null, no se inventan.
        "sentido_curva": None,
        "flecha_relativa": None,
        "desnivel_relativo": None,
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
            "sentido_curva": None,
            "flecha_relativa": None,
            "desnivel_relativo": None,
            "colores_por_racimo": [],
            "relleno": None,
            "remates": [],
            "confianza": 0.7,
        }
    ]
    assert all(cumple_contrato(lectura) for lectura in lecturas)


Punto = tuple[float, float]
_CUADRADA = (1000, 1000)


def _linea(izquierdo: Punto, medio: Punto, derecho: Punto) -> dict[str, object]:
    nombres = ("extremo_izquierdo", "punto_medio", "extremo_derecho")
    return {n: {"x": x, "y": y} for n, (x, y) in zip(nombres, (izquierdo, medio, derecho))}


def _con_medio(medio: dict[str, object]) -> dict[str, object]:
    return {**_linea((0.1, 0.3), (0.5, 0.2), (0.9, 0.4)), "punto_medio": medio}


def _con_geometria(
    linea: object = None, tamano: tuple[int, int] | None = _CUADRADA, **campos: object
) -> dict[str, object]:
    [lectura] = cast(
        list[dict[str, object]],
        guirnalda.validar_lecturas(
            {
                "lecturas": [
                    {
                        "element_id": "A",
                        "soporte": "pared",
                        "forma": "curva",
                        "confianza": 0.8,
                        **({} if linea is None else {"linea_central": linea}),
                        **campos,
                    }
                ]
            },
            ["A"],
            PALETA,
            tamano_imagen=tamano,
        ),
    )
    return lectura


def _geometria(lectura: dict[str, object]) -> tuple[object, object, object]:
    return (lectura["sentido_curva"], lectura["flecha_relativa"], lectura["desnivel_relativo"])


@pytest.mark.parametrize(
    ("linea", "tamano", "esperado"),
    [
        # La guirnalda de la foto del usuario (decisiones 28 y 29): alta a la izquierda, con el
        # centro por encima de la recta entre sus extremos y el extremo derecho más bajo. Foto
        # vertical (270 x 480): la recta pasa por y = 0,345 en x = 0,5 y el medio va en 0,25.
        (_linea((0.05, 0.24), (0.5, 0.25), (0.95, 0.45)), (270, 480), ("arriba", 0.188, -0.415)),
        # Una U colgada entre dos anclajes a la misma altura.
        (_linea((0.1, 0.3), (0.5, 0.5), (0.9, 0.3)), _CUADRADA, ("abajo", 0.25, 0.0)),
        # Colgada y con el extremo derecho más alto: el sentido se juzga contra la recta inclinada.
        (_linea((0.1, 0.4), (0.5, 0.45), (0.9, 0.2)), _CUADRADA, ("abajo", 0.188, 0.25)),
        # Una recta inclinada: sin curva (flecha 0, sin sentido) y con su desnivel.
        (_linea((0.1, 0.2), (0.5, 0.3), (0.9, 0.4)), _CUADRADA, (None, 0.0, -0.25)),
        # Por debajo de 0,03 del largo sigue siendo recta.
        (_linea((0.1, 0.3), (0.5, 0.32), (0.9, 0.3)), _CUADRADA, (None, 0.0, 0.0)),
        # Una U invertida alta: la flecha sale de rango (sin sentido), el desnivel queda.
        (_linea((0.3, 0.9), (0.5, 0.1), (0.7, 0.9)), _CUADRADA, (None, None, 0.0)),
    ],
)
def test_la_geometria_se_calcula_desde_los_tres_puntos(
    linea: dict[str, object], tamano: tuple[int, int], esperado: tuple[object, object, object]
) -> None:
    lectura = _con_geometria(linea, tamano)
    assert _geometria(lectura) == esperado
    assert "linea_central" not in lectura, "los puntos no salen: el contrato no cambia"
    assert cumple_contrato(lectura), "lo que sale cabe en el contrato exportado"


def test_el_aspecto_de_la_imagen_cuenta() -> None:
    # Los mismos puntos normalizados en una foto cuadrada y en una vertical del doble de alto:
    # la vertical tiene el doble de pendiente y de flecha; la apaisada, la mitad.
    linea = _linea((0.1, 0.3), (0.5, 0.25), (0.9, 0.4))
    assert _geometria(_con_geometria(linea, _CUADRADA)) == ("arriba", 0.125, -0.125)
    assert _geometria(_con_geometria(linea, (1000, 2000))) == ("arriba", 0.25, -0.25)
    assert _geometria(_con_geometria(linea, (2000, 1000))) == ("arriba", 0.062, -0.062)


@pytest.mark.parametrize(
    ("linea", "tamano"),
    [
        (None, _CUADRADA),  # sin linea_central
        (_linea((0.1, 0.3), (0.5, 0.2), (0.9, 0.4)), None),  # sin tamaño de la imagen
        (_linea((0.9, 0.3), (0.5, 0.2), (0.1, 0.4)), _CUADRADA),  # extremos al revés
        (_linea((0.5, 0.3), (0.51, 0.2), (0.52, 0.4)), _CUADRADA),  # extremos casi juntos
        (_linea((0.1, 0.3), (0.85, 0.2), (0.9, 0.4)), _CUADRADA),  # el medio no es el medio
        (_linea((0.1, 0.3), (0.5, 1.2), (0.9, 0.4)), _CUADRADA),  # fuera de 0..1
        (_linea((-0.1, 0.3), (0.5, 0.2), (0.9, 0.4)), _CUADRADA),
        (
            {"extremo_izquierdo": {"x": 0.1, "y": 0.3}, "extremo_derecho": {"x": 0.9, "y": 0.4}},
            _CUADRADA,
        ),
        (_con_medio({"x": "0.5", "y": 0.2}), _CUADRADA),
        (_con_medio({"x": True, "y": 0.2}), _CUADRADA),
        (_con_medio({"x": float("nan"), "y": 0.2}), _CUADRADA),
        (_con_medio({"x": 0.5}), _CUADRADA),
        ([0.1, 0.3, 0.5, 0.2, 0.9, 0.4], _CUADRADA),
    ],
)
def test_puntos_invalidos_dan_null_y_nunca_un_sentido(
    linea: object, tamano: tuple[int, int] | None
) -> None:
    lectura = _con_geometria(linea, tamano)
    assert _geometria(lectura) == (None, None, None)
    assert cumple_contrato(lectura)


def test_la_v4_no_lee_la_geometria_que_el_modelo_diga_por_su_cuenta() -> None:
    # Ni la caida_relativa de la v2 ni el sentido, la flecha o el desnivel de la v3.
    lectura = _con_geometria(
        None,
        caida_relativa=0.3,
        sentido_curva="abajo",
        flecha_relativa=0.15,
        desnivel_relativo=-0.2,
    )
    assert _geometria(lectura) == (None, None, None)
    assert "caida_relativa" not in lectura


def test_el_contrato_rechaza_metros_y_rangos_fuera_del_zod() -> None:
    base = _con_geometria(_linea((0.1, 0.3), (0.5, 0.2), (0.9, 0.4)))
    assert _geometria(base) == ("arriba", 0.188, -0.125)
    assert cumple_contrato(base)
    assert not cumple_contrato({**base, "flecha_relativa": 0.7})
    assert not cumple_contrato({**base, "sentido_curva": "lados"})
    assert not cumple_contrato({**base, "desnivel_relativo": -0.61})
    assert not cumple_contrato({**base, "caida_m": 0.4}), "una lectura no lleva metros"
    assert not cumple_contrato({**base, "arqueo_m": 0.4}), "una lectura no lleva metros"
    assert not cumple_contrato({**base, "linea_central": {}}), "los puntos no viajan"
    geometria = ("sentido_curva", "flecha_relativa", "desnivel_relativo")
    sin_campos = {k: v for k, v in base.items() if k not in geometria}
    assert cumple_contrato(sin_campos), (
        "una lectura guardada antes de la decisión 27 sigue valiendo"
    )
    v2 = {**sin_campos, "caida_relativa": 0.1, "desnivel_relativo": -0.2}
    assert cumple_contrato(v2), "una lectura guardada con la v2 (decisión 27) sigue valiendo"
    assert not cumple_contrato({**v2, "caida_relativa": 0.7})
    v3 = {
        **sin_campos,
        "sentido_curva": "abajo",
        "flecha_relativa": 0.15,
        "desnivel_relativo": -0.2,
    }
    assert cumple_contrato(v3), "una lectura guardada con la v3 (decisión 28) sigue valiendo"


def _png_de(ancho: int, alto: int) -> str:
    """Solo la firma y el IHDR: la lectura no decodifica la foto, lee su cabecera."""
    ihdr = b"\x00\x00\x00\rIHDR" + ancho.to_bytes(4, "big") + alto.to_bytes(4, "big")
    return base64.b64encode(b"\x89PNG\r\n\x1a\n" + ihdr + b"\x08\x02\x00\x00\x00").decode()


def test_la_lectura_usa_el_tamano_de_la_foto_recibida() -> None:
    texto = json.dumps(
        {
            "lecturas": [
                {
                    "element_id": "REF_01_E01",
                    "soporte": "pared",
                    "forma": "curva",
                    "linea_central": _linea((0.05, 0.24), (0.5, 0.25), (0.95, 0.45)),
                    "racimos_visibles": 12,
                    "colores_por_racimo": ["rosado"],
                    "remates": [],
                    "confianza": 0.9,
                }
            ]
        }
    )
    vertical = _payload(imagen={"mime_type": "image/png", "data_base64": _png_de(270, 480)})
    resultado = asyncio.run(
        leer_guirnaldas_referencia(
            vertical, client_factory=lambda _k: _FakeClient(_respuesta(texto))
        )
    )
    [lectura] = cast(list[dict[str, object]], resultado["lecturas"])
    assert _geometria(lectura) == ("arriba", 0.188, -0.415)
    # La foto de 1 x 1 de las demás pruebas es cuadrada: la misma respuesta, otra pendiente.
    [lectura] = cast(list[dict[str, object]], _run(_FakeClient(_respuesta(texto)))["lecturas"])
    assert _geometria(lectura) == ("arriba", 0.106, -0.233)


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
