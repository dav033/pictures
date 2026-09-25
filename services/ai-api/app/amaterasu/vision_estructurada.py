"""Una lectura de la foto de referencia con salida estructurada (Amaterasu).

Las lecturas que corren después del análisis (patrón de color, armado del
bouquet) hacen la misma llamada: una foto, un mensaje, su prompt y su esquema
de salida, temperatura 0 y sin razonamiento. Cada lectura es dueña de su
prompt, su esquema y su validación; aquí solo vive la llamada y sus errores,
con el prefijo de código de cada lectura (``<prefijo>_provider_error``...).

Nunca reintenta: las lecturas son opcionales y Next sigue sin ellas.
"""

from __future__ import annotations

import base64
import json
import os
from collections.abc import Callable, Mapping

from app.amaterasu.turno import (
    DEFAULT_MODEL,
    _block_reason,
    _default_client,
    _finish_reason,
    _usage_dict,
)


class LecturaFotoError(Exception):
    """Stable domain error translated by the HTTP boundary. ``provider_detail``
    carries the provider's finish/block reason when the answer was empty."""

    def __init__(
        self, code: str, status_code: int = 502, provider_detail: str | None = None
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.provider_detail = provider_detail


async def leer_foto(
    *,
    mime_type: str,
    data_base64: str,
    mensaje: str,
    system_instruction: str,
    response_schema: Mapping[str, object],
    max_output_tokens: int,
    prefijo: str,
    error: type[LecturaFotoError],
    client_factory: Callable[[str], object] | None = None,
) -> tuple[object, dict[str, int] | None]:
    """La respuesta JSON del proveedor (sin validar) y el uso que reportó."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise error(f"{prefijo}_unavailable", 503)

    try:
        # `Blob.data` wants raw bytes, not the base64 text (see turno.py).
        raw_bytes = base64.b64decode(data_base64, validate=True)
    except Exception as causa:
        raise error(f"{prefijo}_invalid_image", 422) from causa
    if not raw_bytes:
        raise error(f"{prefijo}_invalid_image", 422)

    from google.genai import types

    client: object = (client_factory or _default_client)(api_key)
    content = types.Content(
        role="user",
        parts=[
            types.Part(inline_data=types.Blob(mime_type=mime_type, data=raw_bytes)),
            types.Part(text=mensaje),
        ],
    )
    try:
        response = await client.aio.models.generate_content(  # type: ignore[attr-defined]
            model=DEFAULT_MODEL,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=dict(response_schema),
                temperature=0,
                max_output_tokens=max_output_tokens,
                # Extracción estructurada: sin razonamiento, igual que Inari y
                # Happie, para que el presupuesto de salida sea todo JSON.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as causa:
        raise error(f"{prefijo}_provider_error", 502) from causa

    text = getattr(response, "text", None)
    if not text:
        # Bloqueada o vacía: no hay nada que leer. El motivo del proveedor viaja
        # en el error para el log de Next, nunca como un éxito vacío.
        motivos = {
            "finish_reason": _finish_reason(response),
            "block_reason": _block_reason(response),
        }
        raise error(
            f"{prefijo}_empty_response",
            502,
            " ".join(f"{clave}={valor}" for clave, valor in motivos.items() if valor) or None,
        )
    try:
        raw = json.loads(str(text))
    except json.JSONDecodeError as causa:
        raise error(f"{prefijo}_invalid_output", 502) from causa
    return raw, _usage_dict(getattr(response, "usage_metadata", None))


__all__ = ["DEFAULT_MODEL", "LecturaFotoError", "leer_foto"]
