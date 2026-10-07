"""Registro del servicio ai-api: una línea JSON por evento, para auditar y depurar.

Qué deja (todo a stdout, una línea por evento; en local además a
``data/registros/python/ai-api-AAAA-MM-DD.jsonl`` del repositorio):

* ``peticion.fin``: cada petición (salvo /healthz y /readyz) con ``request_id``,
  ``conversacion_id`` (cabecera ``x-conversacion-id`` que manda Next), ruta,
  método, estado y ms. Si la petición revienta, ``peticion.error`` con el
  traceback.
* ``llamada_modelo``: cada llamada que el propio Python hace a un modelo
  (Gemini: lectura de la foto, patrón, conteo, bouquet, guirnalda, análisis,
  intención, Happie, chat en streaming, embeddings; el cross-encoder del
  rerank; fal/FLUX) con el modelo, el prompt de sistema y los contenidos
  COMPLETOS (las imágenes como sha256 de sus bytes), la configuración, la
  respuesta (texto, llamadas a herramientas, motivo de fin), los tokens, ms y
  el error con su traceback. El prompt de sistema y el esquema de respuesta van
  completos la primera vez por conversación y después como ``{sha256, ref}``.
* Todo lo que la app ya registraba con ``logging`` (``decoracion.*``), en JSON.

Cada línea: ``{ts, nivel, servicio:"ai-api", version, evento, request_id,
conversacion_id, ruta, ms?, estado?, datos?, error?}``. Sin secretos: las claves
con nombre de secreto, los valores de secretos del entorno, ``Bearer``/``Key``,
llaves de Google/fal y credenciales en URLs se tapan con ``[oculto]``. Es código
determinista: no usa IA ni gasta tokens. Nunca lanza: si algo falla al
registrar, se pierde esa línea y nada más.

Variables (opcionales): ``AI_API_REGISTRO_DIR`` (carpeta del archivo; ``0``
lo apaga), ``AI_API_REGISTRO_NIVEL`` (info), ``REGISTRO_VERSION`` /
``GIT_COMMIT_SHA`` (commit; si no, ``version_codigo.json`` o ``.git``).
"""

from __future__ import annotations

import base64
import binascii
import contextvars
import hashlib
import json
import logging
import math
import os
import re
import sys
import threading
import time
import traceback
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, TypeVar, cast

CABECERA_SOLICITUD = "x-request-id"
CABECERA_CONVERSACION = "x-conversacion-id"
SERVICIO = "ai-api"
RUTAS_SILENCIOSAS = frozenset({"/healthz", "/readyz"})
MARCA_OCULTO = "[oculto]"
LIMITE_CADENA = 20_000
LIMITE_CADENA_MODELO = 200_000
MAX_LINEA = 2_000_000

_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "registro_request_id", default=None
)
_conversacion_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "registro_conversacion_id", default=None
)
_ruta: contextvars.ContextVar[str | None] = contextvars.ContextVar("registro_ruta", default=None)

logger = logging.getLogger("decoracion.registro")
T = TypeVar("T")

# ── Contexto ──────────────────────────────────────────────────────────────────────────────────────

_RE_NO_PERMITIDO = re.compile(r"[^a-zA-Z0-9_-]+")


def sanear_id(valor: object) -> str | None:
    """[a-zA-Z0-9_-], máximo 64 (la misma regla que `sanearIdConversacion` en Next)."""
    if not isinstance(valor, str):
        return None
    limpio = _RE_NO_PERMITIDO.sub("-", valor.strip()).strip("-")[:64]
    return limpio or None


def contexto_actual() -> dict[str, str | None]:
    return {
        "request_id": _request_id.get(),
        "conversacion_id": _conversacion_id.get(),
        "ruta": _ruta.get(),
    }


def fijar_contexto(
    *, request_id: str | None, conversacion_id: str | None, ruta: str | None
) -> list[contextvars.Token[str | None]]:
    return [
        _request_id.set(request_id),
        _conversacion_id.set(conversacion_id),
        _ruta.set(ruta),
    ]


def restaurar_contexto(tokens: list[contextvars.Token[str | None]]) -> None:
    for variable, token in zip((_request_id, _conversacion_id, _ruta), tokens, strict=False):
        try:
            variable.reset(token)
        except ValueError:
            pass


# ── Versión del código ────────────────────────────────────────────────────────────────────────────

_RE_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
_version_cache: dict[str, object] = {}


def _version_desde_git(desde: Path) -> str | None:
    actual = desde
    for _ in range(6):
        git = actual / ".git"
        try:
            if git.is_file():
                enlace = re.search(r"^gitdir:\s*(.+)$", git.read_text("utf-8"), re.M)
                git = (actual / enlace.group(1).strip()) if enlace else git
            if git.is_dir():
                cabeza = (git / "HEAD").read_text("utf-8").strip()
                if _RE_SHA.match(cabeza):
                    return f"{cabeza[:12].lower()}+local"
                referencia = cabeza.removeprefix("ref:").strip()
                comun = git
                if (git / "commondir").exists():
                    comun = (git / (git / "commondir").read_text("utf-8").strip()).resolve()
                for base in (git, comun):
                    archivo = base / referencia
                    if archivo.exists():
                        valor = archivo.read_text("utf-8").strip()
                        if _RE_SHA.match(valor):
                            return f"{valor[:12].lower()}+local"
                    empaquetadas = base / "packed-refs"
                    if empaquetadas.exists():
                        for linea in empaquetadas.read_text("utf-8").splitlines():
                            if linea.endswith(f" {referencia}") and _RE_SHA.match(linea[:40]):
                                return f"{linea[:12].lower()}+local"
                return None
        except OSError:
            return None
        if actual.parent == actual:
            break
        actual = actual.parent
    return None


def version_codigo() -> str:
    """Commit del código (12 caracteres; «+local» en desarrollo) o «desconocida». Cacheada por proceso."""
    cacheada = _version_cache.get("valor")
    if isinstance(cacheada, str):
        return cacheada
    valor = "desconocida"
    try:
        for nombre in ("REGISTRO_VERSION", "GIT_COMMIT_SHA", "GIT_SHA", "SOURCE_COMMIT", "COMMIT_SHA"):
            entorno = (os.getenv(nombre) or "").strip()
            if entorno:
                valor = entorno[:12].lower() if _RE_SHA.match(entorno) else entorno[:40]
                break
        else:
            archivo = Path(__file__).with_name("version_codigo.json")
            commit = ""
            if archivo.exists():
                datos = json.loads(archivo.read_text("utf-8"))
                commit = str(datos.get("commit", "")) if isinstance(datos, dict) else ""
            if _RE_SHA.match(commit):
                valor = commit[:12].lower()
            else:
                valor = _version_desde_git(Path(__file__).resolve().parent) or "desconocida"
    except Exception:
        valor = "desconocida"
    _version_cache["valor"] = valor
    return valor


# ── Redacción ─────────────────────────────────────────────────────────────────────────────────────

_EXACTAS = {"key", "pwd", "pass", "auth", "sig", "falkey", "xfalkey", "xapikey", "otp"}
_CONTIENE = (
    "apikey",
    "secret",
    "password",
    "passwd",
    "contrasena",
    "llave",
    "privatekey",
    "credential",
    "authorization",
    "cookie",
    "signature",
)


def _normalizar_clave(clave: str) -> str:
    return re.sub(r"[^a-z0-9]", "", clave.lower())


def es_clave_secreta(clave: str) -> bool:
    """`approval_token`, `x-fal-key` o `api_key` sí; `prompt_token_count` o `max_output_tokens` no."""
    normal = _normalizar_clave(clave)
    if not normal:
        return False
    if normal in _EXACTAS or any(parte in normal for parte in _CONTIENE):
        return True
    return normal.endswith("token")


_secretos_cache: dict[str, object] = {}


def _secretos_entorno() -> list[str]:
    ahora = time.monotonic()
    leido = _secretos_cache.get("leido")
    valores = _secretos_cache.get("valores")
    if isinstance(leido, float) and isinstance(valores, list) and ahora - leido < 60:
        return valores
    nuevos = sorted(
        (
            valor
            for nombre, valor in os.environ.items()
            if valor
            and len(valor) >= 8
            and es_clave_secreta(nombre)
            and not re.fullmatch(r"true|false|\d+", valor, re.I)
        ),
        key=len,
        reverse=True,
    )
    _secretos_cache["leido"] = ahora
    _secretos_cache["valores"] = nuevos
    return nuevos


_PATRONES_SECRETOS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\b(Bearer|Key|Basic|Token)\s+(?=[A-Za-z0-9._~+/=:-]*\d)[A-Za-z0-9._~+/=:-]{16,}"),
        rf"\1 {MARCA_OCULTO}",
    ),
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), MARCA_OCULTO),
    (re.compile(r"\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}"), MARCA_OCULTO),
    (
        re.compile(
            r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{24,}\b", re.I
        ),
        MARCA_OCULTO,
    ),
    (re.compile(r"\b([a-z][a-z0-9+.-]*://)([^\s:@/]+):([^\s@/]+)@", re.I), rf"\1\2:{MARCA_OCULTO}@"),
    (
        re.compile(
            r"([?&](?:key|api_key|apikey|api-key|token|access_token|auth|sig|signature|secret|password)=)[^&#\s\"'<>]*",
            re.I,
        ),
        rf"\1{MARCA_OCULTO}",
    ),
)
_RE_DATA_URL = re.compile(r"^data:([\w.+-]+/[\w.+-]+)(?:;[\w.+-]+=[\w.+-]+)*;base64,(.*)$", re.S)
_RE_DATA_URL_EN_TEXTO = re.compile(r"data:([\w.+-]+/[\w.+-]+);base64,([A-Za-z0-9+/=_-]{64,})")
_RE_BASE64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$|^[A-Za-z0-9_-]+={0,2}$")


def huella_bytes(datos: bytes) -> dict[str, object]:
    return {"imagen": hashlib.sha256(datos).hexdigest(), "bytes": len(datos)}


def _huella_base64(texto: str) -> dict[str, object]:
    """sha256 de los bytes decodificados (coincide con `sha256sum` del archivo y con la huella de Next)."""
    try:
        limpio = re.sub(r"\s", "", texto)
        relleno = limpio + "=" * (-len(limpio) % 4)
        urlsafe = "-" in limpio or "_" in limpio
        datos = base64.urlsafe_b64decode(relleno) if urlsafe else base64.b64decode(relleno)
        return huella_bytes(datos)
    except (binascii.Error, ValueError):
        return {"imagen": hashlib.sha256(texto.encode()).hexdigest(), "bytes": len(texto) * 3 // 4}


def sanear_texto(texto: str) -> str:
    salida = texto
    try:
        if "base64," in salida:
            salida = _RE_DATA_URL_EN_TEXTO.sub(
                lambda m: f"[data-url {m.group(1)} sha256={_huella_base64(m.group(2))['imagen']}]",
                salida,
            )
        for valor in _secretos_entorno():
            if valor in salida:
                salida = salida.replace(valor, MARCA_OCULTO)
        for patron, reemplazo in _PATRONES_SECRETOS:
            salida = patron.sub(reemplazo, salida)
    except Exception:
        return "[texto no saneable]"
    return salida


def _recortar(texto: str, limite: int) -> str:
    if len(texto) <= limite:
        return texto
    return f"{texto[:limite]}…[recortado: {len(texto) - limite} caracteres más]"


def _redactar_cadena(texto: str, limite: int, clave: str = "") -> object:
    normal = _normalizar_clave(clave)
    if ("base64" in normal or "b64" in normal) and len(texto) >= 64 and _RE_BASE64.match(texto):
        return _huella_base64(texto)
    coincidencia = _RE_DATA_URL.match(texto[:200]) if texto.startswith("data:") else None
    if coincidencia:
        completa = _RE_DATA_URL.match(texto)
        datos = completa.group(2) if completa else ""
        return {**_huella_base64(datos), "mime": coincidencia.group(1)}
    if len(texto) >= 512 and _RE_BASE64.match(texto):
        return _huella_base64(texto)
    return _recortar(sanear_texto(texto), limite)


def redactar(valor: object, limite: int = LIMITE_CADENA, profundidad: int = 0, clave: str = "") -> object:
    """Copia JSON-segura y redactada de cualquier valor (incluidos modelos pydantic del SDK). Nunca lanza."""
    try:
        if valor is None or isinstance(valor, bool | int):
            return valor
        if isinstance(valor, float):
            return valor if math.isfinite(valor) else str(valor)
        if isinstance(valor, str):
            return _redactar_cadena(valor, limite, clave)
        if isinstance(valor, bytes | bytearray | memoryview):
            return huella_bytes(bytes(valor))
        if isinstance(valor, Enum):
            return redactar(valor.value, limite, profundidad + 1)
        if profundidad >= 32:
            return "[profundidad máxima]"
        if isinstance(valor, Mapping):
            salida: dict[str, object] = {}
            for indice, (clave, interno) in enumerate(valor.items()):
                if indice >= 1_000:
                    salida["…"] = f"{len(valor) - indice} claves más"
                    break
                nombre = str(clave)
                if interno is None:
                    continue
                salida[nombre] = (
                    MARCA_OCULTO
                    if es_clave_secreta(nombre) and interno not in ("", None)
                    else redactar(interno, limite, profundidad + 1, nombre)
                )
            return salida
        if isinstance(valor, list | tuple | set | frozenset):
            elementos = list(valor)
            lista = [redactar(item, limite, profundidad + 1) for item in elementos[:2_000]]
            if len(elementos) > 2_000:
                lista.append(f"…[{len(elementos) - 2_000} elementos más]")
            return lista
        volcar = getattr(valor, "model_dump", None)
        if callable(volcar):
            return redactar(volcar(exclude_none=True), limite, profundidad + 1)
        if isinstance(valor, BaseException):
            return {"tipo": type(valor).__name__, "mensaje": sanear_texto(str(valor))[:4_000]}
        atributos = getattr(valor, "__dict__", None)
        if isinstance(atributos, dict):
            publicos = {clave: interno for clave, interno in atributos.items() if not clave.startswith("_")}
            redactado = redactar(publicos, limite, profundidad + 1)
            return {"tipo": type(valor).__name__, **(redactado if isinstance(redactado, dict) else {"valor": redactado})}
        return _recortar(sanear_texto(str(valor)), 500)
    except Exception:
        return "[valor no redactable]"


def serializar_error(error: BaseException) -> dict[str, object]:
    try:
        pila = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        return {
            "tipo": type(error).__name__,
            "mensaje": sanear_texto(str(error))[:4_000],
            "traceback": sanear_texto(pila)[-12_000:],
            **({"causa": serializar_error(error.__cause__)} if error.__cause__ else {}),
        }
    except Exception:
        return {"tipo": type(error).__name__, "mensaje": "[error no serializable]"}


# ── Formato y destinos ────────────────────────────────────────────────────────────────────────────

_ATRIBUTOS_ESTANDAR = set(vars(logging.makeLogRecord({}))) | {"message", "asctime", "taskName"}


class FormateadorJson(logging.Formatter):
    """Una línea JSON por registro con el contexto de la petición (request_id, conversacion_id, ruta)."""

    def format(self, record: logging.LogRecord) -> str:
        try:
            extra = {
                clave: valor
                for clave, valor in vars(record).items()
                if clave not in _ATRIBUTOS_ESTANDAR and not clave.startswith("_")
            }
            limite = int(extra.pop("limite_cadena", LIMITE_CADENA))
            contexto = contexto_actual()
            evento = extra.pop("evento", None) or record.getMessage()
            linea: dict[str, object] = {
                "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(
                    timespec="milliseconds"
                ).replace("+00:00", "Z"),
                "nivel": {"WARNING": "warn", "CRITICAL": "error"}.get(record.levelname, record.levelname.lower()),
                "servicio": SERVICIO,
                "version": version_codigo(),
                "evento": _recortar(sanear_texto(str(evento)), 2_000),
                "request_id": contexto["request_id"] or extra.pop("request_id", None),
                "conversacion_id": contexto["conversacion_id"] or extra.pop("conversacion_id", None),
                "ruta": contexto["ruta"] or extra.pop("ruta", None),
            }
            for clave in ("ms", "estado", "metodo"):
                if clave in extra:
                    linea[clave] = extra.pop(clave)
            extra.pop("request_id", None)
            extra.pop("conversacion_id", None)
            extra.pop("ruta", None)
            datos = extra.pop("datos", None)
            if extra:
                datos = {**(datos if isinstance(datos, dict) else {"datos": datos} if datos else {}), **extra}
            if datos is not None:
                linea["datos"] = redactar(datos, limite)
            if record.exc_info and record.exc_info[1] is not None:
                linea["error"] = serializar_error(record.exc_info[1])
            texto = json.dumps(linea, ensure_ascii=False, default=str)
            if len(texto) > MAX_LINEA and "datos" in linea:
                linea["datos"] = redactar(datos, 2_000)
                texto = json.dumps(linea, ensure_ascii=False, default=str)
            return texto
        except Exception:
            return json.dumps(
                {"servicio": SERVICIO, "nivel": "error", "evento": "registro.linea_no_serializable"}
            )


class SalidaEstandar(logging.Handler):
    """Escribe en el `sys.stdout` del momento (pytest y uvicorn lo sustituyen)."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            sys.stdout.write(self.format(record) + "\n")
            sys.stdout.flush()
        except Exception:
            pass


class ArchivoDiario(logging.Handler):
    """`<carpeta>/ai-api-AAAA-MM-DD.jsonl` (fecha UTC), una línea por registro. Si falla, se apaga."""

    def __init__(self, carpeta: Path) -> None:
        super().__init__()
        self.carpeta = carpeta
        self._candado = threading.Lock()
        self._apagado = False

    def emit(self, record: logging.LogRecord) -> None:
        if self._apagado:
            return
        try:
            linea = self.format(record)
            fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            with self._candado:
                self.carpeta.mkdir(parents=True, exist_ok=True)
                with (self.carpeta / f"ai-api-{fecha}.jsonl").open("a", encoding="utf-8") as archivo:
                    archivo.write(linea + "\n")
        except Exception:
            self._apagado = True


def carpeta_archivo() -> Path | None:
    """`AI_API_REGISTRO_DIR`; si no, en el repositorio local `data/registros/python`. En pruebas, ninguna."""
    elegida = (os.getenv("AI_API_REGISTRO_DIR") or "").strip()
    if elegida == "0":
        return None
    if elegida:
        return Path(elegida)
    if "pytest" in sys.modules or Path("/.dockerenv").exists():
        return None
    raiz = Path(__file__).resolve().parents[3]
    registros = raiz / "data" / "registros"
    return registros / "python" if registros.is_dir() else None


def configurar_registro() -> None:
    """Idempotente: el árbol `decoracion.*` escribe JSON a stdout (y al archivo local)."""
    raiz = logging.getLogger("decoracion")
    if getattr(raiz, "_registro_configurado", False):
        return
    nivel = (os.getenv("AI_API_REGISTRO_NIVEL") or "INFO").upper()
    raiz.setLevel(getattr(logging, nivel, logging.INFO))
    formato = FormateadorJson()
    salida = SalidaEstandar()
    salida.setFormatter(formato)
    raiz.addHandler(salida)
    carpeta = carpeta_archivo()
    if carpeta is not None:
        archivo = ArchivoDiario(carpeta)
        archivo.setFormatter(formato)
        raiz.addHandler(archivo)
    raiz._registro_configurado = True  # type: ignore[attr-defined]


def registrar_evento(
    evento: str,
    *,
    nivel: int = logging.INFO,
    datos: object = None,
    error: BaseException | None = None,
    limite_cadena: int = LIMITE_CADENA,
    **campos: object,
) -> None:
    try:
        logger.log(
            nivel,
            evento,
            exc_info=(type(error), error, error.__traceback__) if error is not None else None,
            extra={"evento": evento, "datos": datos, "limite_cadena": limite_cadena, **campos},
        )
    except Exception:
        pass


# ── Middleware de FastAPI ─────────────────────────────────────────────────────────────────────────


def instalar_registro(application: Any) -> None:
    """Middleware más externo: contexto por petición (x-request-id, x-conversacion-id) y `peticion.fin`."""
    configurar_registro()

    @application.middleware("http")
    async def registro_peticion(request: Any, call_next: Callable[[Any], Awaitable[Any]]) -> Any:
        ruta = request.url.path
        if ruta in RUTAS_SILENCIOSAS:
            return await call_next(request)
        request_id = sanear_id(request.headers.get(CABECERA_SOLICITUD)) or str(uuid.uuid4())
        conversacion = sanear_id(request.headers.get(CABECERA_CONVERSACION))
        tokens = fijar_contexto(request_id=request_id, conversacion_id=conversacion, ruta=ruta)
        inicio = time.perf_counter()
        try:
            respuesta = await call_next(request)
        except Exception as error:
            registrar_evento(
                "peticion.error",
                nivel=logging.ERROR,
                error=error,
                metodo=request.method,
                ms=round((time.perf_counter() - inicio) * 1000),
            )
            restaurar_contexto(tokens)
            raise
        estado = int(getattr(respuesta, "status_code", 0))
        registrar_evento(
            "peticion.fin",
            nivel=logging.ERROR if estado >= 500 else logging.WARNING if estado >= 400 else logging.INFO,
            metodo=request.method,
            estado=estado,
            ms=round((time.perf_counter() - inicio) * 1000),
        )
        restaurar_contexto(tokens)
        return respuesta


# ── Llamadas a modelos ────────────────────────────────────────────────────────────────────────────

_vistos: OrderedDict[str, None] = OrderedDict()
_candado_vistos = threading.Lock()


def _ya_visto(tipo: str, huella: str) -> bool:
    """`True` si esa huella ya se registró completa en esta conversación (si no, la marca)."""
    clave = f"{_conversacion_id.get() or _request_id.get() or '-'}:{tipo}:{huella}"
    with _candado_vistos:
        if clave in _vistos:
            return True
        _vistos[clave] = None
        while len(_vistos) > 5_000:
            _vistos.popitem(last=False)
    return False


def _completo_o_ref(tipo: str, valor: object) -> object:
    redactado = redactar(valor, LIMITE_CADENA_MODELO)
    serializado = json.dumps(redactado, ensure_ascii=False, sort_keys=True, default=str)
    huella = hashlib.sha256(serializado.encode("utf-8")).hexdigest()[:16]
    if _ya_visto(tipo, huella):
        return {"ref": huella, "caracteres": len(serializado)}
    return {"sha256": huella, "caracteres": len(serializado), "valor": redactado}


def _enum(valor: object) -> str | None:
    if valor is None:
        return None
    interno = getattr(valor, "value", valor)
    return str(interno) if interno else None


def _tokens(uso: object) -> dict[str, int] | None:
    if uso is None:
        return None
    campos = {
        "entrada": getattr(uso, "prompt_token_count", None),
        "salida": getattr(uso, "candidates_token_count", None),
        "pensamiento": getattr(uso, "thoughts_token_count", None),
        "cacheados": getattr(uso, "cached_content_token_count", None),
        "herramientas": getattr(uso, "tool_use_prompt_token_count", None),
        "total": getattr(uso, "total_token_count", None),
    }
    contados = {clave: int(valor) for clave, valor in campos.items() if isinstance(valor, int)}
    return contados or None


def _respuesta_gemini(respuesta: object) -> dict[str, object]:
    """Texto (sin pensamiento), llamadas a funciones, motivos y tokens, sin tocar el getter `.text`."""
    candidatos = getattr(respuesta, "candidates", None) or []
    primero = candidatos[0] if candidatos else None
    partes = getattr(getattr(primero, "content", None), "parts", None) or []
    texto = ""
    llamadas: list[dict[str, object]] = []
    for parte in partes:
        llamada = getattr(parte, "function_call", None)
        if llamada is not None and getattr(llamada, "name", None):
            llamadas.append({"nombre": llamada.name, "argumentos": getattr(llamada, "args", None)})
        elif isinstance(getattr(parte, "text", None), str) and not getattr(parte, "thought", False):
            texto += parte.text
    feedback = getattr(respuesta, "prompt_feedback", None)
    return {
        "texto": texto,
        **({"llamadas": llamadas} if llamadas else {}),
        **({"motivo_fin": _enum(getattr(primero, "finish_reason", None))} if primero else {}),
        **({"bloqueo": _enum(getattr(feedback, "block_reason", None))} if feedback else {}),
        **({"modelo_version": getattr(respuesta, "model_version", None)} if getattr(respuesta, "model_version", None) else {}),
    }


def _describir_peticion(kwargs: Mapping[str, object], embedding: bool) -> dict[str, object]:
    config = kwargs.get("config")
    volcado = redactar(config, LIMITE_CADENA_MODELO) if config is not None else {}
    config_dict = dict(volcado) if isinstance(volcado, dict) else {"config": volcado}
    sistema = config_dict.pop("system_instruction", None)
    esquema = config_dict.pop("response_schema", None) or config_dict.pop("response_json_schema", None)
    herramientas = config_dict.pop("tools", None)
    contenidos: object = kwargs.get("contents")
    if embedding and isinstance(contenidos, list | tuple):
        textos = list(contenidos)
        contenidos = {"n": len(textos), "muestra": redactar(textos[:3], 2_000)}
    else:
        contenidos = redactar(contenidos, LIMITE_CADENA_MODELO)
    return {
        "modelo": kwargs.get("model"),
        **({"sistema": _completo_o_ref("sistema", sistema)} if sistema is not None else {}),
        "contenidos": contenidos,
        **({"esquema_respuesta": _completo_o_ref("esquema", esquema)} if esquema is not None else {}),
        **({"herramientas": _completo_o_ref("herramientas", herramientas)} if herramientas is not None else {}),
        "config": config_dict,
    }


def registrar_llamada_modelo(
    *,
    proposito: str,
    proveedor: str,
    peticion: Mapping[str, object],
    respuesta: Mapping[str, object] | None,
    tokens: Mapping[str, int] | None,
    inicio: float,
    error: BaseException | None = None,
    interrumpida: bool = False,
) -> None:
    ms = round((time.perf_counter() - inicio) * 1000)
    registrar_evento(
        "llamada_modelo",
        nivel=logging.WARNING if error is not None or interrumpida else logging.INFO,
        error=error,
        limite_cadena=LIMITE_CADENA_MODELO,
        ms=ms,
        datos={
            "proposito": proposito,
            "proveedor": proveedor,
            **peticion,
            **({"respuesta": respuesta} if respuesta is not None else {}),
            **({"tokens": tokens} if tokens else {}),
            **({"interrumpida": True} if interrumpida else {}),
        },
    )


class _ModelosAuditados:
    def __init__(self, modelos: Any, proposito: str) -> None:
        self._modelos = modelos
        self._proposito = proposito

    def __getattr__(self, nombre: str) -> Any:
        valor = getattr(self._modelos, nombre)
        if nombre == "generate_content":
            return self._generar(valor)
        if nombre == "generate_content_stream":
            return self._flujo(valor)
        if nombre == "embed_content":
            return self._embeber(valor)
        return valor

    def _generar(self, original: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        async def generar(*args: Any, **kwargs: Any) -> Any:
            inicio = time.perf_counter()
            peticion = _describir_peticion(kwargs, embedding=False)
            try:
                respuesta = await original(*args, **kwargs)
            except BaseException as error:
                registrar_llamada_modelo(
                    proposito=self._proposito, proveedor="gemini", peticion=peticion,
                    respuesta=None, tokens=None, inicio=inicio, error=error,
                )
                raise
            registrar_llamada_modelo(
                proposito=self._proposito, proveedor="gemini", peticion=peticion,
                respuesta=_respuesta_gemini(respuesta),
                tokens=_tokens(getattr(respuesta, "usage_metadata", None)), inicio=inicio,
            )
            return respuesta

        return generar

    def _embeber(self, original: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        async def embeber(*args: Any, **kwargs: Any) -> Any:
            inicio = time.perf_counter()
            peticion = _describir_peticion(kwargs, embedding=True)
            try:
                respuesta = await original(*args, **kwargs)
            except BaseException as error:
                registrar_llamada_modelo(
                    proposito=self._proposito, proveedor="gemini", peticion=peticion,
                    respuesta=None, tokens=None, inicio=inicio, error=error,
                )
                raise
            vectores = getattr(respuesta, "embeddings", None) or []
            primero = getattr(vectores[0], "values", None) if vectores else None
            registrar_llamada_modelo(
                proposito=self._proposito, proveedor="gemini", peticion=peticion,
                respuesta={"vectores": len(vectores), "dimensiones": len(primero or [])},
                tokens=None, inicio=inicio,
            )
            return respuesta

        return embeber

    def _flujo(self, original: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        proposito = self._proposito

        async def abrir(*args: Any, **kwargs: Any) -> Any:
            inicio = time.perf_counter()
            peticion = _describir_peticion(kwargs, embedding=False)
            try:
                flujo = await original(*args, **kwargs)
            except BaseException as error:
                registrar_llamada_modelo(
                    proposito=proposito, proveedor="gemini", peticion=peticion,
                    respuesta=None, tokens=None, inicio=inicio, error=error,
                )
                raise
            if not hasattr(flujo, "__aiter__"):
                registrar_llamada_modelo(
                    proposito=proposito, proveedor="gemini", peticion=peticion,
                    respuesta={"texto": "[respuesta no iterable]"}, tokens=None, inicio=inicio,
                )
                return flujo
            return _flujo_auditado(flujo, proposito, peticion, inicio)

        return abrir


async def _flujo_auditado(
    flujo: Any, proposito: str, peticion: Mapping[str, object], inicio: float
) -> AsyncIterator[Any]:
    texto = ""
    llamadas: list[object] = []
    ultimo: dict[str, object] = {}
    tokens: dict[str, int] | None = None
    registrado = False
    try:
        async for fragmento in flujo:
            parcial = _respuesta_gemini(fragmento)
            texto += str(parcial.get("texto") or "")
            llamadas.extend(parcial.get("llamadas") or [])  # type: ignore[arg-type]
            ultimo = parcial
            tokens = _tokens(getattr(fragmento, "usage_metadata", None)) or tokens
            yield fragmento
        registrado = True
        registrar_llamada_modelo(
            proposito=proposito, proveedor="gemini", peticion=peticion,
            respuesta={**ultimo, "texto": texto, **({"llamadas": llamadas} if llamadas else {})},
            tokens=tokens, inicio=inicio,
        )
    except BaseException as error:
        if not registrado:
            registrado = True
            registrar_llamada_modelo(
                proposito=proposito, proveedor="gemini", peticion=peticion,
                respuesta={"texto": texto, **({"llamadas": llamadas} if llamadas else {})},
                tokens=tokens, inicio=inicio, error=error if isinstance(error, Exception) else None,
                interrumpida=True,
            )
        raise
    finally:
        if not registrado:
            registrar_llamada_modelo(
                proposito=proposito, proveedor="gemini", peticion=peticion,
                respuesta={"texto": texto}, tokens=tokens, inicio=inicio, interrumpida=True,
            )
        # Cerrar el flujo del SDK cierra la respuesta HTTP del proveedor (lo que hacía el llamante).
        cerrar = getattr(flujo, "aclose", None)
        if callable(cerrar):
            try:
                await cerrar()
            except Exception:
                pass


class _AioAuditado:
    def __init__(self, aio: Any, proposito: str) -> None:
        self._aio = aio
        self._proposito = proposito

    @property
    def models(self) -> _ModelosAuditados:
        return _ModelosAuditados(self._aio.models, self._proposito)

    def __getattr__(self, nombre: str) -> Any:
        return getattr(self._aio, nombre)


class ClienteAuditado:
    """Envuelve un `google.genai.Client` (o el doble de una prueba): `aio.models.generate_content`,
    `generate_content_stream` y `embed_content` dejan `llamada_modelo`; todo lo demás pasa intacto y
    lo devuelto y lo lanzado es exactamente lo del cliente."""

    def __init__(self, cliente: Any, proposito: str) -> None:
        self._cliente = cliente
        self._proposito = proposito

    @property
    def aio(self) -> _AioAuditado:
        return _AioAuditado(self._cliente.aio, self._proposito)

    def __getattr__(self, nombre: str) -> Any:
        return getattr(self._cliente, nombre)


def cliente_auditado(cliente: T, proposito: str) -> T:
    if isinstance(cliente, ClienteAuditado):
        return cast(T, cliente)
    return cast(T, ClienteAuditado(cliente, proposito))


async def auditar_llamada(
    *,
    proposito: str,
    proveedor: str,
    peticion: Mapping[str, object],
    ejecutar: Callable[[], Awaitable[T]],
    resumir: Callable[[T], Mapping[str, object]] | None = None,
) -> T:
    """Para lo que no es un cliente de Gemini (fal/FLUX, el cross-encoder): una línea con petición y resultado."""
    inicio = time.perf_counter()
    descripcion = {clave: redactar(valor, LIMITE_CADENA_MODELO) for clave, valor in peticion.items()}
    try:
        resultado = await ejecutar()
    except BaseException as error:
        registrar_llamada_modelo(
            proposito=proposito, proveedor=proveedor, peticion=descripcion, respuesta=None,
            tokens=None, inicio=inicio, error=error,
        )
        raise
    try:
        resumen: Mapping[str, object] = resumir(resultado) if resumir else {"resultado": resultado}
    except Exception:
        resumen = {"resultado": "[no se pudo resumir]"}
    registrar_llamada_modelo(
        proposito=proposito, proveedor=proveedor, peticion=descripcion,
        respuesta=dict(resumen), tokens=None, inicio=inicio,
    )
    return resultado


__all__ = [
    "CABECERA_CONVERSACION",
    "CABECERA_SOLICITUD",
    "ClienteAuditado",
    "FormateadorJson",
    "auditar_llamada",
    "cliente_auditado",
    "configurar_registro",
    "contexto_actual",
    "es_clave_secreta",
    "instalar_registro",
    "redactar",
    "registrar_evento",
    "registrar_llamada_modelo",
    "sanear_id",
    "sanear_texto",
    "version_codigo",
]
