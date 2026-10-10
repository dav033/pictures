import asyncio
import hashlib
import json
import random
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app.taller.cache_vectores import CacheVectores
from app.taller.cliente_embeddings import (
    DIMENSIONES,
    MODELO,
    ClienteGemini,
    con_reintentos,
    peticion_imagen,
    peticion_texto,
)
from app.taller.costo_embeddings import Presupuesto, RegistroGasto, tokens_estimados
from app.taller.embeber_biblioteca import ejecutar_plan, main
from app.taller.insumos_biblioteca import (
    Ficha,
    leer_manifest_renders,
    numero_foto_dueno,
    preparar_imagen,
    resolver_foto,
)
from app.taller.plan_embeddings import construir_plan


def vector_falso(semilla: str) -> list[float]:
    azar = random.Random(hashlib.sha256(semilla.encode()).hexdigest())
    return [azar.uniform(-1, 1) for _ in range(DIMENSIONES)]


class ClienteFalso:
    def __init__(self) -> None:
        self.textos: list[str] = []
        self.imagenes: list[bytes] = []

    @property
    def llamadas(self) -> int:
        return len(self.textos) + len(self.imagenes)

    async def embeber_texto(self, texto: str, tarea: str = "RETRIEVAL_DOCUMENT") -> list[float]:
        self.textos.append(texto)
        return vector_falso(texto)

    async def embeber_imagen(self, datos: bytes, mime: str) -> list[float]:
        assert mime == "image/jpeg"
        self.imagenes.append(datos)
        return vector_falso(hashlib.sha256(datos).hexdigest())


def escribir_fichas(ruta: Path, registros: list[dict[str, object]]) -> None:
    ruta.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in registros), encoding="utf-8"
    )


def registro(
    id: str, ficha: str, foto: str | None = None, tipo: str = "idea-sempertex", titulo: str = "t"
) -> dict[str, object]:
    return {
        "id": id,
        "tipo": "decoracion",
        "hash": "h-" + id,
        "ficha": ficha,
        "fuente": {"tipo": tipo, "titulo": titulo, "url": None, "foto": foto},
    }


def png(
    ruta: Path, tamano: tuple[int, int] = (64, 48), color: tuple[int, int, int] = (200, 30, 30)
) -> Path:
    Image.new("RGB", tamano, color).save(ruta, format="PNG")
    return ruta


@pytest.fixture
def espacio(tmp_path: Path) -> dict[str, Path]:
    renders = tmp_path / "renders"
    renders.mkdir()
    png(renders / "a.png", color=(10, 20, 30))
    png(renders / "b.png", color=(30, 20, 10))
    (renders / "manifest.json").write_text(
        json.dumps({"a": "a.png", "b": {"png": "b.png"}}), encoding="utf-8"
    )
    fotos = tmp_path / "fotos"
    fotos.mkdir()
    png(fotos / "01-abc.jpg", color=(1, 2, 3))
    escribir_fichas(
        tmp_path / "fichas.jsonl",
        [
            registro("a", "Arco organico rosa y dorado " * 4, foto="https://ejemplo.test/a.jpg"),
            registro("b", "Columna blanca con globos plateados", foto=None),
            registro(
                "referencia:x",
                "Guirnalda de referencia",
                tipo="referencia-dueno",
                titulo="Referencias del dueño — foto 1 del lote 1",
            ),
            registro(
                "referencia:x~guirnalda",
                "Pieza derivada",
                tipo="referencia-dueno",
                titulo="Referencias del dueño — foto 1 del lote 1",
            ),
        ],
    )
    return {
        "raiz": tmp_path,
        "fichas": tmp_path / "fichas.jsonl",
        "manifest": renders / "manifest.json",
        "cache": tmp_path / "emb",
        "gasto": tmp_path / "gasto.jsonl",
        "fotos": fotos,
    }


def argumentos(e: dict[str, Path], *extra: str) -> list[str]:
    return [
        "--fichas",
        str(e["fichas"]),
        "--manifest-renders",
        str(e["manifest"]),
        "--salida",
        str(e["cache"]),
        "--gasto-log",
        str(e["gasto"]),
        "--fotos-dir",
        str(e["fotos"]),
        *extra,
    ]


# --- caché ------------------------------------------------------------------------------------------------------


def test_cache_acierta_solo_con_el_mismo_hash_modelo_y_dims(tmp_path: Path) -> None:
    cache = CacheVectores(tmp_path)
    cache.agregar("a", "texto", MODELO, 768, "h1", vector_falso("a"))

    assert cache.acierto("a", "texto", MODELO, 768, "h1")
    assert not cache.acierto("a", "texto", MODELO, 768, "h2")
    assert not cache.acierto("a", "texto", "otro-modelo", 768, "h1")
    assert not cache.acierto("a", "texto", MODELO, 1536, "h1")
    assert not cache.acierto("a", "imagen_foto", MODELO, 768, "h1")


def test_cache_persiste_y_la_ultima_linea_gana(tmp_path: Path) -> None:
    primero = CacheVectores(tmp_path)
    primero.agregar("a", "texto", MODELO, 768, "h1", [0.5] * 768)
    primero.agregar("a", "texto", MODELO, 768, "h2", [0.25] * 768)
    primero.agregar("b", "texto", "otro", 4, "h9", [1.0, 2.0, 3.0, 4.0])

    recargado = CacheVectores(tmp_path)
    assert not recargado.acierto("a", "texto", MODELO, 768, "h1")
    assert recargado.acierto("a", "texto", MODELO, 768, "h2")
    entrada = next(recargado.entradas(MODELO, 768))
    assert recargado.leer(entrada)[0] == pytest.approx(0.25)
    otro = next(recargado.entradas("otro", 4))
    assert recargado.leer(otro) == (1.0, 2.0, 3.0, 4.0)


def test_cache_ignora_una_linea_cortada_y_un_vector_incompleto(tmp_path: Path) -> None:
    cache = CacheVectores(tmp_path)
    cache.agregar("a", "texto", MODELO, 768, "h1", [0.1] * 768)
    with (tmp_path / "indice.jsonl").open("a", encoding="utf-8") as archivo:
        archivo.write('{"id": "b", "modalidad": "texto", "mod')
        archivo.write(
            "\n"
            + json.dumps(
                {
                    "id": "c",
                    "modalidad": "texto",
                    "modelo": MODELO,
                    "dims": 768,
                    "hash_entrada": "h",
                    "offset": 10_000_000,
                }
            )
            + "\n"
        )

    recargado = CacheVectores(tmp_path)
    assert len(recargado) == 1
    assert recargado.acierto("a", "texto", MODELO, 768, "h1")


def test_cache_rechaza_un_vector_con_otras_dimensiones(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="DIMS"):
        CacheVectores(tmp_path).agregar("a", "texto", MODELO, 768, "h", [0.1, 0.2])


# --- plan y corrida seca --------------------------------------------------------------------------------------------


def test_dry_run_no_llama_a_nadie_ni_escribe_nada(
    espacio: dict[str, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    cliente = ClienteFalso()

    codigo = main(argumentos(espacio), cliente=cliente)

    salida = capsys.readouterr().out
    assert codigo == 0
    assert cliente.llamadas == 0
    assert not espacio["cache"].exists()
    assert not espacio["gasto"].exists()
    assert "texto" in salida and "imagen_render" in salida and "USD est." in salida
    assert "url_sin_--descargar = 1" in salida
    assert "--descargar se sumarían 1 llamadas" in salida


def test_dry_run_tambien_es_el_modo_si_se_pide_explicito(espacio: dict[str, Path]) -> None:
    cliente = ClienteFalso()
    assert main(argumentos(espacio, "--dry-run", "--tope-usd", "5"), cliente=cliente) == 0
    assert cliente.llamadas == 0


def test_plan_distingue_cache_pendientes_y_omitidos(espacio: dict[str, Path]) -> None:
    from app.taller.insumos_biblioteca import leer_fichas

    fichas = leer_fichas(espacio["fichas"])
    renders = leer_manifest_renders(espacio["manifest"])
    cache = CacheVectores(espacio["cache"])
    plan = construir_plan(fichas, renders, cache, MODELO, DIMENSIONES, fotos_dir=espacio["fotos"])

    assert plan.por_modalidad["texto"].total == 4
    assert len(plan.por_modalidad["texto"].pendientes) == 4
    assert len(plan.por_modalidad["imagen_render"].pendientes) == 2
    assert plan.por_modalidad["imagen_render"].omitidos["sin_render_en_manifest"] == 2
    fotos = plan.por_modalidad["imagen_foto"]
    assert [t.id for t in fotos.pendientes] == ["referencia:x"]
    assert fotos.omitidos["url_sin_--descargar"] == 1 and fotos.omitidos["sin_foto"] == 2

    descargando = construir_plan(
        fichas, renders, cache, MODELO, DIMENSIONES, fotos_dir=espacio["fotos"], descargar=True
    )
    assert len(descargando.por_modalidad["imagen_foto"].pendientes) == 2


def test_segunda_corrida_no_repite_llamadas_y_un_cambio_de_ficha_solo_reembebe_esa(
    espacio: dict[str, Path],
) -> None:
    cliente = ClienteFalso()
    base = argumentos(espacio, "--ejecutar", "--tope-usd", "1")

    assert main(base, cliente=cliente) == 0
    primeras = cliente.llamadas
    assert primeras == 4 + 2 + 1  # 4 fichas, 2 renders, 1 foto local del dueño (la URL se omite)
    assert main(base, cliente=cliente) == 0
    assert cliente.llamadas == primeras

    registros = [
        json.loads(fila) for fila in espacio["fichas"].read_text(encoding="utf-8").splitlines()
    ]
    registros[1]["ficha"] += " ahora con dorado"
    escribir_fichas(espacio["fichas"], registros)
    assert main(base, cliente=cliente) == 0
    assert cliente.llamadas == primeras + 1
    assert cliente.textos[-1].endswith("ahora con dorado")


# --- tope de gasto ---------------------------------------------------------------------------------------------------


def test_corrida_real_sin_tope_se_rechaza_antes_de_llamar(espacio: dict[str, Path]) -> None:
    cliente = ClienteFalso()
    assert main(argumentos(espacio, "--ejecutar"), cliente=cliente) == 2
    assert cliente.llamadas == 0


def test_corrida_cuyo_costo_estimado_pasa_el_tope_se_rechaza_sin_llamar(
    espacio: dict[str, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    cliente = ClienteFalso()

    codigo = main(argumentos(espacio, "--ejecutar", "--tope-usd", "0.0001"), cliente=cliente)

    assert codigo == 3
    assert cliente.llamadas == 0
    assert "Rechazado" in capsys.readouterr().err
    assert not espacio["cache"].exists()


def test_el_gasto_corriente_detiene_la_corrida_en_el_tope(
    espacio: dict[str, Path], tmp_path: Path
) -> None:
    from app.taller.insumos_biblioteca import leer_fichas

    fichas = leer_fichas(espacio["fichas"])
    renders = leer_manifest_renders(espacio["manifest"])
    cache = CacheVectores(espacio["cache"])
    plan = construir_plan(fichas, renders, cache, MODELO, DIMENSIONES, ["imagen_render"])
    cliente = ClienteFalso()
    presupuesto = Presupuesto(tope_usd=0.00012)  # alcanza para una sola imagen

    resultado = asyncio.run(
        ejecutar_plan(
            plan,
            cliente,
            cache,
            presupuesto,
            RegistroGasto(espacio["gasto"], "run", MODELO),
            concurrencia=3,
        )
    )

    assert cliente.llamadas == 1
    assert resultado.detenida_por_tope
    assert presupuesto.gastado_usd <= 0.00012 + 1e-12


def test_presupuesto_reserva_confirma_y_libera() -> None:
    presupuesto = Presupuesto(tope_usd=1.0)
    assert presupuesto.reservar(0.6)
    assert not presupuesto.reservar(0.5)
    presupuesto.liberar(0.6)
    assert presupuesto.reservar(0.9)
    presupuesto.confirmar(0.9)
    assert presupuesto.gastado_usd == pytest.approx(0.9)
    with pytest.raises(ValueError):
        Presupuesto(tope_usd=0)


def test_un_fallo_no_cobra_ni_detiene_las_demas_y_queda_registrado(
    espacio: dict[str, Path],
) -> None:
    class Falla(ClienteFalso):
        async def embeber_texto(self, texto: str, tarea: str = "RETRIEVAL_DOCUMENT") -> list[float]:
            if texto.startswith("Pieza"):
                raise RuntimeError("boom")
            return await super().embeber_texto(texto, tarea)

    codigo = main(
        argumentos(espacio, "--ejecutar", "--tope-usd", "1", "--modalidades", "texto"),
        cliente=Falla(),
    )

    assert codigo == 1
    fallos = [
        json.loads(fila)
        for fila in (espacio["cache"] / "fallos.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [f["id"] for f in fallos] == ["referencia:x~guirnalda"]
    gasto = [json.loads(fila) for fila in espacio["gasto"].read_text(encoding="utf-8").splitlines()]
    assert gasto[0]["unidades"] == sum(
        tokens_estimados(t)
        for t in [
            "Arco organico rosa y dorado " * 4,
            "Columna blanca con globos plateados",
            "Guirnalda de referencia",
        ]
    )


def test_el_registro_de_gasto_tiene_los_campos_del_libro(espacio: dict[str, Path]) -> None:
    assert (
        main(
            argumentos(espacio, "--ejecutar", "--tope-usd", "1", "--modalidades", "imagen_render"),
            cliente=ClienteFalso(),
        )
        == 0
    )

    (linea,) = [
        json.loads(fila) for fila in espacio["gasto"].read_text(encoding="utf-8").splitlines()
    ]
    assert set(linea) == {
        "ts",
        "modelo",
        "modalidad",
        "unidades",
        "unidad",
        "usd_estimado",
        "run_id",
    }
    assert linea["modelo"] == MODELO and linea["modalidad"] == "imagen_render"
    assert linea["unidades"] == 2 and linea["usd_estimado"] == pytest.approx(0.00024)
    assert linea["run_id"].startswith("emb-")


# --- una entrada por llamada ------------------------------------------------------------------------------------------


def test_cada_imagen_va_en_su_propia_llamada(espacio: dict[str, Path]) -> None:
    cliente = ClienteFalso()
    assert (
        main(
            argumentos(
                espacio,
                "--ejecutar",
                "--tope-usd",
                "1",
                "--modalidades",
                "imagen_render,imagen_foto",
            ),
            cliente=cliente,
        )
        == 0
    )
    assert len(cliente.imagenes) == 3 and cliente.textos == []


def test_las_peticiones_a_gemini_llevan_un_solo_content_con_una_sola_parte() -> None:
    texto = peticion_texto("hola", "RETRIEVAL_QUERY")
    imagen = peticion_imagen(b"\xff\xd8datos", "image/jpeg")

    for peticion in (texto, imagen):
        assert peticion["model"] == "gemini-embedding-2"
        assert len(peticion["contents"]) == 1
        assert len(peticion["contents"][0]["parts"]) == 1
        assert peticion["config"]["output_dimensionality"] == 768
    assert texto["config"]["task_type"] == "RETRIEVAL_QUERY"
    assert "task_type" not in imagen["config"]
    with pytest.raises(ValueError):
        peticion_texto("x", "CLASSIFICATION")


def test_cliente_gemini_envia_una_entrada_por_llamada_y_normaliza() -> None:
    enviadas: list[dict[str, object]] = []

    class Modelos:
        async def embed_content(self, **peticion: object) -> SimpleNamespace:
            enviadas.append(peticion)
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[3.0] + [0.0] * 767)])

    falso = SimpleNamespace(aio=SimpleNamespace(models=Modelos()))
    cliente = ClienteGemini("", cliente=falso)

    vector = asyncio.run(cliente.embeber_imagen(b"jpg", "image/jpeg"))
    asyncio.run(cliente.embeber_texto("ficha"))

    assert vector[0] == pytest.approx(1.0) and len(vector) == 768
    assert len(enviadas) == 2
    assert all(len(p["contents"]) == 1 and len(p["contents"][0]["parts"]) == 1 for p in enviadas)  # type: ignore[index, arg-type]


def test_cliente_gemini_exige_llave_si_no_hay_cliente() -> None:
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        ClienteGemini("  ")


# --- reintentos -------------------------------------------------------------------------------------------------------


def test_reintenta_429_y_5xx_pero_no_un_400() -> None:
    class Error(Exception):
        def __init__(self, code: int) -> None:
            self.code = code

    esperas: list[float] = []

    async def dormir(segundos: float) -> None:
        esperas.append(segundos)

    intentos = {"n": 0}

    async def inestable() -> str:
        intentos["n"] += 1
        if intentos["n"] < 3:
            raise Error(429 if intentos["n"] == 1 else 503)
        return "ok"

    assert asyncio.run(con_reintentos(inestable, dormir=dormir)) == "ok"
    assert intentos["n"] == 3 and len(esperas) == 2 and esperas[1] > esperas[0] * 0.5

    async def invalido() -> str:
        intentos["n"] += 1
        raise Error(400)

    intentos["n"] = 0
    with pytest.raises(Error):
        asyncio.run(con_reintentos(invalido, dormir=dormir))
    assert intentos["n"] == 1

    async def siempre_cae() -> str:
        intentos["n"] += 1
        raise Error(500)

    intentos["n"] = 0
    with pytest.raises(Error):
        asyncio.run(con_reintentos(siempre_cae, intentos=3, dormir=dormir))
    assert intentos["n"] == 3


# --- insumos ----------------------------------------------------------------------------------------------------------


def test_preparar_imagen_reduce_a_1024_y_deja_jpeg_rgb(tmp_path: Path) -> None:
    grande = png(tmp_path / "grande.png", (3000, 2000))
    datos, mime = preparar_imagen(grande.read_bytes())

    with Image.open(__import__("io").BytesIO(datos)) as resultado:
        assert mime == "image/jpeg" and resultado.format == "JPEG" and resultado.mode == "RGB"
        assert max(resultado.size) == 1024 and resultado.size == (1024, 683)


def test_preparar_imagen_no_agranda_y_pone_blanco_bajo_la_transparencia(tmp_path: Path) -> None:
    transparente = tmp_path / "t.png"
    Image.new("RGBA", (100, 50), (0, 0, 0, 0)).save(transparente)

    datos, _ = preparar_imagen(transparente.read_bytes())

    with Image.open(__import__("io").BytesIO(datos)) as resultado:
        assert resultado.size == (100, 50)
        assert min(resultado.getpixel((5, 5))) > 240


def test_foto_del_dueno_se_busca_por_numero_y_las_derivadas_no_tienen(
    espacio: dict[str, Path],
) -> None:
    escena = Ficha(
        "referencia:x",
        "h",
        "t",
        "escena",
        "referencia-dueno",
        "Referencias del dueño — foto 1 del lote 1",
        None,
    )
    derivada = Ficha(
        "referencia:x~g", "h", "t", "estructura", "referencia-dueno", escena.titulo, None
    )

    assert numero_foto_dueno(escena) == 1 and numero_foto_dueno(derivada) is None
    foto = resolver_foto(escena, espacio["fotos"])
    assert foto is not None and foto.clase == "archivo" and Path(foto.valor).name == "01-abc.jpg"
    assert resolver_foto(escena, None) is None
    assert resolver_foto(derivada, espacio["fotos"]) is None


def test_foto_url_local_relativa_y_faltante() -> None:
    url = Ficha("a", "h", "t", "x", "idea", "t", "https://x.test/a.jpg")
    faltante = Ficha("b", "h", "t", "x", "idea", "t", "no-existe.jpg")
    assert resolver_foto(url, None) == resolver_foto(url, Path("."))
    assert resolver_foto(url, None).clase == "url"  # type: ignore[union-attr]
    assert resolver_foto(faltante, None) is None


def test_manifest_de_renders_acepta_dict_lista_y_rutas_relativas(tmp_path: Path) -> None:
    (tmp_path / "m1.json").write_text(
        json.dumps({"a": "x/a.png", "b": {"path": "b.png"}, "c": {"otra": 1}}), encoding="utf-8"
    )
    (tmp_path / "m2.json").write_text(
        json.dumps({"renders": [{"id": "z", "png": "z.png"}]}), encoding="utf-8"
    )

    assert leer_manifest_renders(tmp_path / "m1.json") == {
        "a": tmp_path / "x" / "a.png",
        "b": tmp_path / "b.png",
    }
    assert leer_manifest_renders(tmp_path / "m2.json") == {"z": tmp_path / "z.png"}
    assert leer_manifest_renders(tmp_path / "no-existe.json") == {}
