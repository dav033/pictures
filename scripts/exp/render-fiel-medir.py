"""
Medidas del experimento «render fiel» (sin coste, sin red): compara cada foto de FLUX con la captura del taller 3D.

- IoU de la silueta de los globos: máscara por segmentación simple (los globos de la escena son de colores
  saturados; paredes, piso y sombras no), limpiada con apertura/cierre y sin manchas pequeñas.
- Conteo de objetos grandes: componentes conexas de la máscara (≥ 0,5 % de la imagen) en la captura y en la foto,
  y cuántos de la foto no tocan nada de la captura («añadidos», lo inventado).
- Diferencia de color por pieza: ΔE76 medio (CIELAB) entre la captura y la foto dentro de cada objeto grande de la
  captura, solo donde ambas máscaras dicen «globo».
- Hoja comparativa: la captura y cada variante con sus números, y las máscaras.

Uso: python scripts/exp/render-fiel-medir.py <carpeta>
     python scripts/exp/render-fiel-medir.py --canny <entrada.png> <salida.png>   (control de la variante d)
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ANCHO, ALTO = 1536, 1024
MIN_OBJETO = 0.005


def canny(entrada: str, salida: str) -> None:
    gris = cv2.cvtColor(cv2.imread(entrada), cv2.COLOR_BGR2GRAY)
    bordes = cv2.Canny(cv2.GaussianBlur(gris, (3, 3), 0), 60, 140)
    cv2.imwrite(salida, cv2.cvtColor(bordes, cv2.COLOR_GRAY2BGR))


def leer(ruta: Path) -> np.ndarray:
    return cv2.resize(cv2.imread(str(ruta)), (ANCHO, ALTO), interpolation=cv2.INTER_AREA)


def mascara(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m = ((hsv[..., 1] > 72) & (hsv[..., 2] > 35)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    limpia = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 0.0015 * ANCHO * ALTO:
            limpia[etiquetas == i] = 1
    return limpia


def paleta(bgr: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Los 6 colores principales de la decoración de la captura (CIELAB, luz a la mitad)."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32) * np.array([100 / 255, 1, 1], np.float32)
    muestras = lab[m > 0] * np.array([0.5, 1, 1], np.float32)
    muestras = muestras[np.random.default_rng(1).choice(len(muestras), size=min(20000, len(muestras)), replace=False)]
    _, _, centros = cv2.kmeans(muestras, 6, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    return centros


def mascara_foto(bgr: np.ndarray, m_ref: np.ndarray, colores_ref: np.ndarray) -> np.ndarray:
    """
    La máscara de globos de una foto: lo que no se parece al fondo de ESA foto. El fondo se aprende (k-medias en
    CIELAB, 8 grupos) de lo que en la captura queda lejos de la decoración; así una pared cálida o un piso de madera
    no cuentan como globo, y lo que FLUX añada en zonas vacías sí (no se parece a la pared ni al piso). La luz pesa
    la mitad (las sombras no son globos). Los grupos del color de algún globo de la captura no cuentan como fondo
    (si FLUX movió o añadió decoración en una zona vacía, esa zona no enseña que eso es «pared»).
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32) * np.array([100 / 255, 1, 1], np.float32)
    lejos = cv2.dilate(m_ref, np.ones((41, 41), np.uint8)) == 0
    muestras = lab[lejos]
    rng = np.random.default_rng(0)
    muestras = muestras[rng.choice(len(muestras), size=min(30000, len(muestras)), replace=False)]
    peso = np.array([0.5, 1, 1], np.float32)
    criterio = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, _, centros = cv2.kmeans(muestras * peso, 8, None, criterio, 3, cv2.KMEANS_PP_CENTERS)
    # Un grupo «de fondo» con el color de un globo de la captura es decoración que FLUX movió o añadió: fuera.
    cerca = np.min(np.linalg.norm(centros[:, None, :] - colores_ref[None, :, :], axis=2), axis=1)
    if (cerca >= 12).any():
        centros = centros[cerca >= 12]
    plano = (lab * peso).reshape(-1, 3)
    distancia = np.min(np.linalg.norm(plano[:, None, :] - centros[None, :, :], axis=2), axis=1).reshape(ALTO, ANCHO)
    m = (distancia > 16).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    limpia = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 0.0015 * ANCHO * ALTO:
            limpia[etiquetas == i] = 1
    return limpia


def objetos(m: np.ndarray) -> list[np.ndarray]:
    unida = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats(unida, 8)
    return [(etiquetas == i) & (m > 0) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= MIN_OBJETO * ANCHO * ALTO]


def medir(ref: np.ndarray, m_ref: np.ndarray, obj_ref: list[np.ndarray], foto: np.ndarray) -> dict:
    m = mascara_foto(foto, m_ref, paleta(ref, m_ref))
    inter = np.logical_and(m, m_ref).sum()
    union = np.logical_or(m, m_ref).sum()
    obj = objetos(m)
    cerca = cv2.dilate(m_ref, np.ones((25, 25), np.uint8)) > 0
    anadidos = sum(1 for o in obj if (o & cerca).sum() < 0.3 * o.sum())
    lab_ref = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab = cv2.cvtColor(foto, cv2.COLOR_BGR2LAB).astype(np.float32)
    # OpenCV guarda L en 0..255: a escala CIELAB (L 0..100, a y b con 128 de centro).
    escala = np.array([100 / 255, 1, 1], np.float32)
    delta = []
    for o in obj_ref:
        zona = o & (m > 0)
        if zona.sum() < 200:
            zona = o
        delta.append(float(np.linalg.norm((lab_ref[zona].mean(0) - lab[zona].mean(0)) * escala)))
    return {"iou": round(float(inter / union), 3), "objetos": len(obj), "anadidos": anadidos, "deltaE": round(float(np.mean(delta)), 1), "deltaE_por_pieza": [round(d, 1) for d in delta], "mascara": m}


def hoja(carpeta: Path, ref: np.ndarray, m_ref: np.ndarray, filas: list[tuple[str, str, list[tuple[str, np.ndarray, dict]]]], costos: dict) -> None:
    tw, th, pie = 480, 320, 56
    columnas = 3
    lienzo = Image.new("RGB", (tw * columnas, (th + pie) * (len(filas) + 1) + 40), "white")
    dibujo = ImageDraw.Draw(lienzo)
    try:
        letra = ImageFont.truetype("arial.ttf", 15)
        titulo = ImageFont.truetype("arialbd.ttf", 18)
    except OSError:
        letra = titulo = ImageFont.load_default()
    dibujo.text((10, 10), "Render fiel — captura del taller 3D contra cada variante (2 semillas). IoU de silueta · objetos grandes (+añadidos) · ΔE medio por pieza", fill="black", font=titulo)

    def poner(img_bgr: np.ndarray, x: int, y: int, texto: str, m: np.ndarray | None = None) -> None:
        rgb = cv2.cvtColor(cv2.resize(img_bgr, (tw, th), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        if m is not None:
            borde = cv2.resize(m, (tw, th), interpolation=cv2.INTER_NEAREST)
            contorno = borde - cv2.erode(borde, np.ones((3, 3), np.uint8))
            rgb[contorno > 0] = (255, 0, 255)
        lienzo.paste(Image.fromarray(rgb), (x, y))
        dibujo.text((x + 6, y + th + 4), texto, fill="black", font=letra)

    y = 40
    poner(ref, 0, y, "Captura 3D (referencia)")
    poner(ref, tw, y, f"Silueta de referencia ({len(objetos(m_ref))} objetos grandes)", m_ref)
    y += th + pie
    for vid, nombre, fotos in filas:
        dibujo.text((10, y - 2), "", fill="black")
        for i, (semilla, foto, r) in enumerate(fotos[:columnas]):
            poner(foto, i * tw, y, f"{vid}) {nombre[:46]} · {semilla}\nIoU {r['iou']:.3f} · objetos {r['objetos']} (+{r['anadidos']}) · ΔE {r['deltaE']} · US${costos.get(vid, 0):.3f}", r["mascara"])
        y += th + pie
    lienzo.save(carpeta / "hoja-comparativa.png")


NOMBRES = {
    "a": "FLUX.2 /edit (línea base)",
    "b": "FLUX.1 dev i2i strength 0,35",
    "c": "FLUX.1 dev i2i strength 0,55",
    "d": "FLUX.1 dev + ControlNet canny+depth, str. 0,7",
    "e": "FLUX.1 dev + ControlNet canny+depth, str. 0,9",
}


def main(carpeta: Path) -> None:
    ref = leer(carpeta / "captura-3d.jpg")
    m_ref = mascara(ref)
    obj_ref = objetos(m_ref)
    gasto = json.loads((carpeta / "gasto.json").read_text(encoding="utf-8")) if (carpeta / "gasto.json").exists() else {"llamadas": []}
    costos = {ll["variante"]: ll["costo"] for ll in gasto["llamadas"]}
    salida = {"referencia": {"objetos": len(obj_ref)}, "variantes": {}}
    filas = []
    for vid in "abcde":
        fotos = []
        for ruta in sorted(carpeta.glob(f"{vid}-s*.png")):
            foto = leer(ruta)
            r = medir(ref, m_ref, obj_ref, foto)
            fotos.append((ruta.stem.split("-")[1], foto, r))
            salida["variantes"].setdefault(vid, {"nombre": NOMBRES.get(vid, vid), "costo": costos.get(vid), "semillas": {}})["semillas"][ruta.stem] = {k: v for k, v in r.items() if k != "mascara"}
        if fotos:
            v = salida["variantes"][vid]
            s = list(v["semillas"].values())
            v["media"] = {"iou": round(float(np.mean([x["iou"] for x in s])), 3), "objetos": float(np.mean([x["objetos"] for x in s])), "anadidos": float(np.mean([x["anadidos"] for x in s])), "deltaE": round(float(np.mean([x["deltaE"] for x in s])), 1)}
            filas.append((vid, NOMBRES.get(vid, vid), fotos))
    (carpeta / "medidas.json").write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
    hoja(carpeta, ref, m_ref, filas, costos)
    print(f"referencia: {len(obj_ref)} objetos grandes")
    for vid, v in salida["variantes"].items():
        print(vid, v["nombre"], v["media"], "US$", v["costo"])


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--canny":
        canny(sys.argv[2], sys.argv[3])
    else:
        main(Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Users/davidt/Downloads/pictures-workspace/render-fiel"))
