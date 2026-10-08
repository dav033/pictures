"""Insumos de los embeddings de la biblioteca: fichas, renders, fotos (URL o archivo) e imagen preparada."""

from __future__ import annotations

import hashlib
import io
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx

LADO_MAXIMO_PX = 1024
ETIQUETA_REDUCCION = f"max{LADO_MAXIMO_PX}"
MAXIMO_DESCARGA_BYTES = 15 * 1024 * 1024
TIMEOUT_DESCARGA_S = 20.0
CLAVES_RUTA_RENDER = ("png", "path", "ruta", "archivo", "file", "render")
RE_FOTO_DUENO = re.compile(r"foto\s+(\d+)\s+del\s+lote", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Ficha:
    id: str
    hash: str
    texto: str
    tipo: str
    fuente_tipo: str
    titulo: str
    foto: str | None


@dataclass(frozen=True, slots=True)
class FotoRef:
    """De dónde sale la foto: ``url`` (hay que descargarla) o ``archivo`` (ya está en disco)."""

    clase: str
    valor: str


def sha256_texto(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def leer_fichas(ruta: Path) -> list[Ficha]:
    fichas: list[Ficha] = []
    with ruta.open(encoding="utf-8") as archivo:
        for linea in archivo:
            if not linea.strip():
                continue
            registro = json.loads(linea)
            fuente = registro.get("fuente") or {}
            fichas.append(
                Ficha(
                    id=registro["id"], hash=registro.get("hash", ""), texto=registro["ficha"],
                    tipo=registro.get("tipo", ""), fuente_tipo=fuente.get("tipo", ""),
                    titulo=fuente.get("titulo") or "", foto=fuente.get("foto") or None,
                )
            )
    return fichas


def leer_manifest_renders(ruta: Path) -> dict[str, Path]:
    """``{id: ruta del PNG}``; las rutas relativas cuelgan de la carpeta del manifest. Sin manifest, vacío."""
    if not ruta.exists():
        return {}
    bruto = json.loads(ruta.read_text(encoding="utf-8"))
    if isinstance(bruto, dict) and isinstance(bruto.get("renders"), dict | list):
        bruto = bruto["renders"]
    pares: Iterator[tuple[str, object]]
    if isinstance(bruto, dict):
        pares = iter(bruto.items())
    elif isinstance(bruto, list):
        pares = ((str(e.get("id")), e) for e in bruto if isinstance(e, dict) and e.get("id"))
    else:
        return {}
    renders: dict[str, Path] = {}
    for id_item, valor in pares:
        texto = valor if isinstance(valor, str) else _ruta_en_objeto(valor)
        if texto:
            destino = Path(texto)
            renders[id_item] = destino if destino.is_absolute() else ruta.parent / destino
    return renders


def _ruta_en_objeto(valor: object) -> str | None:
    if not isinstance(valor, dict):
        return None
    for clave in CLAVES_RUTA_RENDER:
        candidato = valor.get(clave)
        if isinstance(candidato, str) and candidato:
            return candidato
    return None


def numero_foto_dueno(ficha: Ficha) -> int | None:
    """Solo la escena de referencia (``referencia:x``, sin ``~``) lleva la foto del lote; sus piezas derivadas no."""
    if ficha.fuente_tipo != "referencia-dueno" or "~" in ficha.id:
        return None
    encontrado = RE_FOTO_DUENO.search(ficha.titulo)
    return int(encontrado.group(1)) if encontrado else None


def resolver_foto(ficha: Ficha, fotos_dir: Path | None) -> FotoRef | None:
    if ficha.foto:
        if ficha.foto.lower().startswith(("http://", "https://")):
            return FotoRef("url", ficha.foto)
        destino = Path(ficha.foto)
        candidatos = [destino] if destino.is_absolute() else []
        if fotos_dir is not None and not destino.is_absolute():
            candidatos.append(fotos_dir / destino)
        candidatos.append(destino)
        for candidato in candidatos:
            if candidato.is_file():
                return FotoRef("archivo", str(candidato))
        return None
    numero = numero_foto_dueno(ficha)
    if numero is not None and fotos_dir is not None:
        for candidato in sorted(fotos_dir.glob(f"{numero:02d}-*")):
            if candidato.is_file():
                return FotoRef("archivo", str(candidato))
    return None


def hash_entrada_imagen(origen: str) -> str:
    """``origen`` es ``url:<url>`` o ``sha:<sha256 de los bytes>``; incluye la reducción para invalidar si cambia."""
    return sha256_texto(f"{ETIQUETA_REDUCCION}|{origen}")


def hash_entrada_archivo(ruta: Path) -> str:
    return hash_entrada_imagen("sha:" + hashlib.sha256(ruta.read_bytes()).hexdigest())


def hash_entrada_url(url: str) -> str:
    return hash_entrada_imagen("url:" + url)


def hash_entrada_texto(texto: str, tarea: str) -> str:
    return sha256_texto(f"{tarea}|{texto}")


def preparar_imagen(datos: bytes, lado_maximo: int = LADO_MAXIMO_PX) -> tuple[bytes, str]:
    """RGB sobre blanco, lado mayor ≤ ``lado_maximo`` px, JPEG (más liviano y sin transparencias)."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(datos)) as original:
        imagen = ImageOps.exif_transpose(original)
        if imagen.mode in ("RGBA", "LA", "P"):
            rgba = imagen.convert("RGBA")
            fondo = Image.new("RGB", rgba.size, (255, 255, 255))
            fondo.paste(rgba, mask=rgba.split()[3])
            imagen = fondo
        else:
            imagen = imagen.convert("RGB")
        imagen.thumbnail((lado_maximo, lado_maximo), Image.Resampling.LANCZOS)
        salida = io.BytesIO()
        imagen.save(salida, format="JPEG", quality=90)
    return salida.getvalue(), "image/jpeg"


async def descargar_foto(url: str, carpeta_cache: Path, cliente: httpx.AsyncClient) -> bytes:
    """Descarga con timeout y tope de tamaño; guarda el original para no repetirla en una corrida siguiente."""
    destino = carpeta_cache / (hashlib.sha256(url.encode("utf-8")).hexdigest()[:24] + ".img")
    if destino.exists():
        return destino.read_bytes()
    datos = bytearray()
    async with cliente.stream("GET", url, timeout=TIMEOUT_DESCARGA_S, follow_redirects=True) as respuesta:
        respuesta.raise_for_status()
        async for trozo in respuesta.aiter_bytes():
            datos.extend(trozo)
            if len(datos) > MAXIMO_DESCARGA_BYTES:
                raise ValueError(f"FOTO_DEMASIADO_GRANDE: {url}")
    carpeta_cache.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(bytes(datos))
    return bytes(datos)
