"""Registro en JSON del ai-api (app/registro.py): contexto por petición, llamadas a modelos, redacción.

Sin red ni proveedores: los clientes de Gemini son dobles con la misma forma (`aio.models.*`).
"""

import asyncio
import base64
import hashlib
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from app import registro  # noqa: E402
from app.main import Settings, create_app  # noqa: E402
from app.registro import (  # noqa: E402
    auditar_llamada,
    cliente_auditado,
    configurar_registro,
    es_clave_secreta,
    fijar_contexto,
    redactar,
    restaurar_contexto,
    sanear_id,
    version_codigo,
)

SECRETO = "valor-secreto-del-entorno-48151623"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _lineas(capsys: pytest.CaptureFixture[str]) -> list[dict[str, object]]:
    salida = capsys.readouterr().out
    lineas: list[dict[str, object]] = []
    for linea in salida.splitlines():
        if linea.startswith("{"):
            lineas.append(json.loads(linea))
    return lineas


@pytest.fixture(autouse=True)
def _registro_configurado(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PRUEBA_REGISTRO_API_KEY", SECRETO)
    registro._secretos_cache.clear()
    registro._vistos.clear()
    configurar_registro()


def test_sanear_id_y_claves_secretas() -> None:
    assert sanear_id("../../etc/passwd x") == "etc-passwd-x"
    assert sanear_id("guiada-20261006-201500-abc123") == "guiada-20261006-201500-abc123"
    assert sanear_id("   ") is None
    assert sanear_id(None) is None
    assert sanear_id("a" * 100) == "a" * 64
    assert (
        es_clave_secreta("x-fal-key")
        and es_clave_secreta("api_key")
        and es_clave_secreta("approval_token")
    )
    assert not es_clave_secreta("prompt_token_count") and not es_clave_secreta("max_output_tokens")


def test_redaccion_oculta_secretos_y_resume_imagenes() -> None:
    datos = redactar(
        {
            "api_key": "abc",
            "texto": f"usa {SECRETO} y Bearer abcdef1234567890abcdef y AIza{'x' * 35}",
            "url": "https://u:clave@host/ruta?key=123&otro=1",
            "foto": "data:image/png;base64," + base64.b64encode(PNG).decode(),
            "bytes": PNG,
            "tokens": {"prompt_token_count": 12},
        }
    )
    assert isinstance(datos, dict)
    assert datos["api_key"] == "[oculto]"
    assert SECRETO not in json.dumps(datos)
    assert "abcdef1234567890abcdef" not in json.dumps(datos)
    assert "AIza" not in json.dumps(datos)
    assert "clave@" not in str(datos["url"]) and "key=[oculto]" in str(datos["url"])
    huella = hashlib.sha256(PNG).hexdigest()
    assert datos["foto"] == {"imagen": huella, "bytes": len(PNG), "mime": "image/png"}
    assert datos["bytes"] == {"imagen": huella, "bytes": len(PNG)}
    assert datos["tokens"] == {"prompt_token_count": 12}


def test_peticion_lleva_request_id_conversacion_ruta_estado_y_ms(
    capsys: pytest.CaptureFixture[str],
) -> None:
    cliente = TestClient(create_app(Settings(environment="test", hmac_secret="t" * 32)))
    capsys.readouterr()
    respuesta = cliente.get(
        "/no-existe",
        headers={
            "x-request-id": "11111111-2222-3333-4444-555555555555",
            "x-conversacion-id": "guiada-prueba/../x",
        },
    )
    assert respuesta.status_code == 404
    cliente.get("/healthz")
    lineas = [linea for linea in _lineas(capsys) if linea.get("evento") == "peticion.fin"]
    assert len(lineas) == 1, "healthz no se registra"
    linea = lineas[0]
    assert linea["servicio"] == "ai-api"
    assert linea["request_id"] == "11111111-2222-3333-4444-555555555555"
    assert linea["conversacion_id"] == "guiada-prueba-x"
    assert linea["ruta"] == "/no-existe"
    assert linea["estado"] == 404 and linea["nivel"] == "warn"
    assert isinstance(linea["ms"], int)
    assert linea["version"] == version_codigo()


class _Modelos:
    def __init__(self) -> None:
        self.llamadas: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> object:
        self.llamadas.append(kwargs)
        if kwargs.get("model") == "falla":
            raise RuntimeError("el proveedor falló")
        parte = SimpleNamespace(text='{"ok": true}', thought=False, function_call=None)
        candidato = SimpleNamespace(
            content=SimpleNamespace(parts=[parte]), finish_reason=SimpleNamespace(value="STOP")
        )
        uso = SimpleNamespace(prompt_token_count=10, candidates_token_count=4, total_token_count=14)
        return SimpleNamespace(candidates=[candidato], usage_metadata=uso, prompt_feedback=None)

    async def generate_content_stream(self, **kwargs: object) -> object:
        async def flujo():  # type: ignore[no-untyped-def]
            for trozo in ("Hola", " mundo"):
                parte = SimpleNamespace(text=trozo, thought=False, function_call=None)
                yield SimpleNamespace(
                    candidates=[
                        SimpleNamespace(content=SimpleNamespace(parts=[parte]), finish_reason=None)
                    ]
                )
            llamada = SimpleNamespace(name="buscar", args={"q": "rosa"})
            parte = SimpleNamespace(text=None, thought=False, function_call=llamada)
            yield SimpleNamespace(
                candidates=[
                    SimpleNamespace(
                        content=SimpleNamespace(parts=[parte]),
                        finish_reason=SimpleNamespace(value="STOP"),
                    )
                ],
                usage_metadata=SimpleNamespace(prompt_token_count=3, candidates_token_count=2),
            )

        return flujo()

    async def embed_content(self, **kwargs: object) -> object:
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.1, 0.2, 0.3])])


def _cliente() -> tuple[object, _Modelos]:
    modelos = _Modelos()
    return SimpleNamespace(aio=SimpleNamespace(models=modelos), otro="intacto"), modelos


def test_llamada_modelo_con_prompt_completo_foto_como_hash_y_contexto(
    capsys: pytest.CaptureFixture[str],
) -> None:
    crudo, modelos = _cliente()
    cliente = cliente_auditado(crudo, "lectura_patron_referencia")
    assert cliente.otro == "intacto"  # type: ignore[attr-defined]
    sistema = "Eres el lector de patrones. " * 50
    contenidos = [
        {
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": "image/png", "data": PNG}},
                {"text": "Lee la foto"},
            ],
        }
    ]
    tokens = fijar_contexto(
        request_id="r-1", conversacion_id="guiada-abc", ruta="/internal/v1/ia/patron-referencia"
    )
    try:
        for _ in range(2):
            respuesta = asyncio.run(
                cliente.aio.models.generate_content(  # type: ignore[attr-defined]
                    model="gemini-x",
                    contents=contenidos,
                    config={
                        "system_instruction": sistema,
                        "temperature": 0,
                        "response_schema": {"type": "object"},
                    },
                )
            )
            assert respuesta.candidates[0].content.parts[0].text == '{"ok": true}'
    finally:
        restaurar_contexto(tokens)
    assert len(modelos.llamadas) == 2 and modelos.llamadas[0]["contents"] is contenidos
    lineas = [linea for linea in _lineas(capsys) if linea.get("evento") == "llamada_modelo"]
    assert len(lineas) == 2
    primera, segunda = lineas
    assert primera["conversacion_id"] == "guiada-abc" and primera["request_id"] == "r-1"
    datos = primera["datos"]
    assert isinstance(datos, dict)
    assert datos["proposito"] == "lectura_patron_referencia" and datos["modelo"] == "gemini-x"
    assert datos["sistema"]["valor"] == sistema  # completo la primera vez
    assert (
        datos["respuesta"]["texto"] == '{"ok": true}' and datos["respuesta"]["motivo_fin"] == "STOP"
    )
    assert datos["tokens"] == {"entrada": 10, "salida": 4, "total": 14}
    assert datos["config"] == {"temperature": 0}
    foto = datos["contenidos"][0]["parts"][0]["inline_data"]["data"]
    assert foto == {"imagen": hashlib.sha256(PNG).hexdigest(), "bytes": len(PNG)}
    assert isinstance(primera["ms"], int)
    segundo = segunda["datos"]
    assert (
        isinstance(segundo, dict)
        and "ref" in segundo["sistema"]
        and "valor" not in segundo["sistema"]
    )


def test_error_del_proveedor_se_registra_con_traceback_y_se_relanza(
    capsys: pytest.CaptureFixture[str],
) -> None:
    crudo, _ = _cliente()
    cliente = cliente_auditado(crudo, "parser_intencion")
    with pytest.raises(RuntimeError, match="el proveedor falló"):
        asyncio.run(
            cliente.aio.models.generate_content(model="falla", contents="hola", config=None)
        )  # type: ignore[attr-defined]
    linea = [linea for linea in _lineas(capsys) if linea.get("evento") == "llamada_modelo"][0]
    assert linea["nivel"] == "warn"
    assert linea["error"]["tipo"] == "RuntimeError" and "Traceback" in linea["error"]["traceback"]


def test_flujo_auditado_acumula_texto_llamadas_y_cierra(capsys: pytest.CaptureFixture[str]) -> None:
    crudo, _ = _cliente()
    cliente = cliente_auditado(crudo, "chat_turno")

    async def consumir() -> list[object]:
        flujo = await cliente.aio.models.generate_content_stream(
            model="m", contents=[], config=None
        )  # type: ignore[attr-defined]
        trozos = [trozo async for trozo in flujo]
        await flujo.aclose()
        return trozos

    assert len(asyncio.run(consumir())) == 3
    linea = [linea for linea in _lineas(capsys) if linea.get("evento") == "llamada_modelo"][0]
    respuesta = linea["datos"]["respuesta"]
    assert respuesta["texto"] == "Hola mundo"
    assert respuesta["llamadas"] == [{"nombre": "buscar", "argumentos": {"q": "rosa"}}]
    assert linea["datos"]["tokens"] == {"entrada": 3, "salida": 2}


def test_flujo_cortado_por_el_consumidor_queda_como_interrumpido(
    capsys: pytest.CaptureFixture[str],
) -> None:
    crudo, _ = _cliente()
    cliente = cliente_auditado(crudo, "chat_turno")

    async def cortar() -> None:
        flujo = await cliente.aio.models.generate_content_stream(
            model="m", contents=[], config=None
        )  # type: ignore[attr-defined]
        async for _ in flujo:
            break
        await flujo.aclose()

    asyncio.run(cortar())
    linea = [linea for linea in _lineas(capsys) if linea.get("evento") == "llamada_modelo"][0]
    assert linea["datos"]["interrumpida"] is True and linea["datos"]["respuesta"]["texto"] == "Hola"


def test_embedding_y_auditar_llamada_sin_secretos(capsys: pytest.CaptureFixture[str]) -> None:
    crudo, _ = _cliente()
    cliente = cliente_auditado(crudo, "embedding_catalogo")
    asyncio.run(
        cliente.aio.models.embed_content(model="emb", contents=["a", "b", "c", "d"], config=None)
    )  # type: ignore[attr-defined]

    async def generar() -> dict[str, object]:
        return {
            "image_base64": base64.b64encode(PNG).decode(),
            "mime": "image/png",
            "x_fal_key": SECRETO,
        }

    asyncio.run(
        auditar_llamada(
            proposito="imagen_flux",
            proveedor="fal",
            peticion={
                "prompt": f"balloons {SECRETO}",
                "referencias": ["data:image/png;base64," + base64.b64encode(PNG).decode()],
            },
            ejecutar=generar,
            resumir=lambda resultado: resultado,
        )
    )
    salida = _lineas(capsys)
    embed, flux = [linea for linea in salida if linea.get("evento") == "llamada_modelo"]
    assert embed["datos"]["contenidos"]["n"] == 4 and embed["datos"]["respuesta"] == {
        "vectores": 1,
        "dimensiones": 3,
    }
    assert flux["datos"]["respuesta"]["image_base64"]["imagen"] == hashlib.sha256(PNG).hexdigest()
    assert flux["datos"]["respuesta"]["x_fal_key"] == "[oculto]"
    assert SECRETO not in json.dumps(salida)


def test_logs_existentes_de_la_app_salen_en_json(capsys: pytest.CaptureFixture[str]) -> None:
    logging.getLogger("decoracion.ai_api").warning("aviso %s", "uno", extra={"request_id": "r-9"})
    linea = _lineas(capsys)[-1]
    assert (
        linea["evento"] == "aviso uno" and linea["nivel"] == "warn" and linea["request_id"] == "r-9"
    )


def test_sin_archivo_en_pruebas() -> None:
    assert registro.carpeta_archivo() is None
