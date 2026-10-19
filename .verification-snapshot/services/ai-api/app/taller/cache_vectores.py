"""Caché incremental de vectores de la biblioteca: ``indice.jsonl`` + ``vectores.f32`` (solo anexar).

* ``vectores.f32``: float32 little-endian, un vector tras otro; ``offset`` (bytes) dice dónde empieza cada uno, así
  pueden convivir modelos con distintas dimensiones.
* ``indice.jsonl``: una línea por vector ``{id, modalidad, modelo, dims, hash_entrada, offset, ts}``. Gana la última
  línea de cada ``(id, modalidad, modelo, dims)``; hay acierto solo si su ``hash_entrada`` es el de hoy.

Sin dependencias nuevas (``array`` de la biblioteca estándar). El lector de TypeScript es
``src/lib/taller/vectores-cache.ts``.
"""

from __future__ import annotations

import json
import sys
from array import array
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

NOMBRE_INDICE = "indice.jsonl"
NOMBRE_VECTORES = "vectores.f32"
MODALIDADES = ("texto", "imagen_foto", "imagen_render")

ClaveVigente = tuple[str, str, str, int]


@dataclass(frozen=True, slots=True)
class EntradaIndice:
    id: str
    modalidad: str
    modelo: str
    dims: int
    hash_entrada: str
    offset: int

    @property
    def clave(self) -> ClaveVigente:
        return (self.id, self.modalidad, self.modelo, self.dims)


class CacheVectores:
    def __init__(self, carpeta: Path) -> None:
        self._carpeta = carpeta
        self._indice = carpeta / NOMBRE_INDICE
        self._vectores = carpeta / NOMBRE_VECTORES
        self._vigentes: dict[ClaveVigente, EntradaIndice] = {}
        self._cargar()

    def _cargar(self) -> None:
        if not self._indice.exists():
            return
        tamano = self._tamano_vectores()
        with self._indice.open(encoding="utf-8") as archivo:
            for linea in archivo:
                if not linea.strip():
                    continue
                try:
                    bruto = json.loads(linea)
                    entrada = EntradaIndice(
                        id=bruto["id"],
                        modalidad=bruto["modalidad"],
                        modelo=bruto["modelo"],
                        dims=int(bruto["dims"]),
                        hash_entrada=bruto["hash_entrada"],
                        offset=int(bruto["offset"]),
                    )
                except (ValueError, KeyError, TypeError):
                    continue  # línea truncada por una corrida cortada: se ignora
                if entrada.offset + entrada.dims * 4 <= tamano:
                    self._vigentes[entrada.clave] = entrada

    def _tamano_vectores(self) -> int:
        return self._vectores.stat().st_size if self._vectores.exists() else 0

    def __len__(self) -> int:
        return len(self._vigentes)

    def acierto(self, id: str, modalidad: str, modelo: str, dims: int, hash_entrada: str) -> bool:
        entrada = self._vigentes.get((id, modalidad, modelo, dims))
        return entrada is not None and entrada.hash_entrada == hash_entrada

    def agregar(
        self,
        id: str,
        modalidad: str,
        modelo: str,
        dims: int,
        hash_entrada: str,
        vector: Sequence[float],
    ) -> None:
        if len(vector) != dims:
            raise ValueError(f"VECTOR_DIMS_MISMATCH: esperado={dims} actual={len(vector)}")
        self._carpeta.mkdir(parents=True, exist_ok=True)
        valores = array("f", vector)
        if sys.byteorder == "big":
            valores.byteswap()
        with self._vectores.open("ab") as archivo:
            offset = archivo.tell()
            archivo.write(valores.tobytes())
        entrada = EntradaIndice(id, modalidad, modelo, dims, hash_entrada, offset)
        linea = {
            "id": id,
            "modalidad": modalidad,
            "modelo": modelo,
            "dims": dims,
            "hash_entrada": hash_entrada,
            "offset": offset,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        with self._indice.open("a", encoding="utf-8") as archivo:
            archivo.write(json.dumps(linea, ensure_ascii=False) + "\n")
        self._vigentes[entrada.clave] = entrada

    def entradas(
        self, modelo: str | None = None, dims: int | None = None
    ) -> Iterator[EntradaIndice]:
        for entrada in self._vigentes.values():
            if (modelo is None or entrada.modelo == modelo) and (
                dims is None or entrada.dims == dims
            ):
                yield entrada

    def leer(self, entrada: EntradaIndice) -> tuple[float, ...]:
        octetos = entrada.dims * 4
        with self._vectores.open("rb") as archivo:
            archivo.seek(entrada.offset)
            datos = archivo.read(octetos)
        if len(datos) != octetos:
            raise ValueError(f"VECTOR_TRUNCADO: id={entrada.id} offset={entrada.offset}")
        valores = array("f")
        valores.frombytes(datos)
        if sys.byteorder == "big":
            valores.byteswap()
        return tuple(valores)
