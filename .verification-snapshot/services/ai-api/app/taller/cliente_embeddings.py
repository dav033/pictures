"""Cliente de embeddings de la biblioteca: UNA entrada por llamada, con reintentos y espera creciente.

``gemini-embedding-2`` agrega en UN solo vector todo lo que llegue en una misma llamada (varias imágenes o partes).
Por eso cada texto y cada imagen va en su propia llamada con exactamente un ``Content`` de una sola parte; el
invariante vive en ``peticion_texto`` / ``peticion_imagen`` y tiene prueba.
"""

from __future__ import annotations

import asyncio
import math
import random
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any, Protocol, TypeVar

from app.watatsumi.catalog_embeddings import (
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_EMBEDDING_MODEL,
    EMBEDDING_TASK_TYPE,
    QUERY_EMBEDDING_TASK_TYPE,
    is_retryable_provider_error,
    validate_embedding_batch,
)

MODELO = DEFAULT_EMBEDDING_MODEL
DIMENSIONES = DEFAULT_EMBEDDING_DIMENSIONS
T = TypeVar("T")


class ClienteEmbeddings(Protocol):
    async def embeber_texto(
        self, texto: str, tarea: str = EMBEDDING_TASK_TYPE
    ) -> Sequence[float]: ...

    async def embeber_imagen(self, datos: bytes, mime: str) -> Sequence[float]: ...


def peticion_texto(texto: str, tarea: str = EMBEDDING_TASK_TYPE) -> dict[str, Any]:
    if tarea not in (EMBEDDING_TASK_TYPE, QUERY_EMBEDDING_TASK_TYPE):
        raise ValueError("EMBEDDING_TASK_TYPE_INVALID")
    return {
        "model": MODELO,
        "contents": [{"parts": [{"text": texto}]}],
        "config": {"task_type": tarea, "output_dimensionality": DIMENSIONES},
    }


def peticion_imagen(datos: bytes, mime: str) -> dict[str, Any]:
    # Sin task_type: con embedding-2 no cambia el vector y para imágenes no aplica.
    return {
        "model": MODELO,
        "contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": datos}}]}],
        "config": {"output_dimensionality": DIMENSIONES},
    }


def normalizar(vector: Sequence[float]) -> tuple[float, ...]:
    (valido,) = validate_embedding_batch((vector,), expected_count=1, dimensions=DIMENSIONES)
    norma = math.sqrt(sum(v * v for v in valido))
    if norma == 0:
        raise ValueError("EMBEDDING_NORMA_CERO")
    return tuple(v / norma for v in valido)


async def con_reintentos(
    operacion: Callable[[], Awaitable[T]],
    intentos: int = 5,
    espera_base: float = 1.0,
    espera_maxima: float = 30.0,
    dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    """Reintenta solo 429/408/5xx y errores de red; un 400/401/403 no se reintenta nunca."""
    for intento in range(intentos):
        try:
            return await operacion()
        except Exception as error:
            if intento == intentos - 1 or not is_retryable_provider_error(error):
                raise
            espera = min(espera_maxima, espera_base * 2**intento)
            await dormir(espera * (0.5 + random.random() / 2))
    raise RuntimeError("unreachable")


class ClienteGemini:
    """``google-genai`` asíncrono con auditoría (``app.registro``); la importación es perezosa."""

    def __init__(self, api_key: str, cliente: object | None = None) -> None:
        if not api_key.strip() and cliente is None:
            raise ValueError("GEMINI_API_KEY_REQUIRED")
        self._api_key = api_key
        self._cliente = cliente

    def _obtener(self) -> Any:
        if self._cliente is None:
            from google import genai

            from app.registro import cliente_auditado

            self._cliente = cliente_auditado(
                genai.Client(api_key=self._api_key), "embedding_biblioteca"
            )
        return self._cliente

    async def _llamar(self, peticion: Mapping[str, Any]) -> tuple[float, ...]:
        async def una_vez() -> tuple[float, ...]:
            respuesta = await self._obtener().aio.models.embed_content(**peticion)
            embeddings = getattr(respuesta, "embeddings", None)
            if not embeddings or len(embeddings) != 1:
                raise RuntimeError("EMBEDDING_PROVIDER_EMPTY_RESPONSE")
            return normalizar(tuple(float(v) for v in (embeddings[0].values or ())))

        return await con_reintentos(una_vez)

    async def embeber_texto(self, texto: str, tarea: str = EMBEDDING_TASK_TYPE) -> Sequence[float]:
        return await self._llamar(peticion_texto(texto, tarea))

    async def embeber_imagen(self, datos: bytes, mime: str) -> Sequence[float]:
        return await self._llamar(peticion_imagen(datos, mime))
