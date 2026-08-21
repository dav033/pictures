"""
Filtra tags_unicos.txt para quedarse solo con tags 'temáticos' útiles para que
el LLM navegue el catálogo: excluye lo que ya cubren otros filtros (colores,
ocasiones, tamaños/formas) y ruido operativo/logístico de Shopify.
"""

import re
from pathlib import Path

TAGS_PATH = Path(__file__).resolve().parent / "tags_unicos.txt"
SALIDA_PATH = Path(__file__).resolve().parent / "tags_tematicos.txt"

# Claves de DICCIONARIO_COLOR en derivar.ts — ya cubiertas por el filtro `colores`.
COLORES = {
    "DORADO", "DORADO ROSA", "PLATEADO", "ROJO", "ROJOS", "AZUL", "AZULES",
    "ROSADO", "ROSADOS", "ROSA", "VERDE", "VERDES", "BLANCO", "BLANCOS",
    "NEGRO", "NEGROS", "MORADO", "NARANJA", "AMARILLO", "FUCSIA", "PLATA",
    "TRANSPARENTE", "MULTICOLOR", "SURTIDO",
}

# Claves de MAPA_OCASION en derivar.ts — ya cubiertas por el filtro `ocasiones`.
OCASIONES = {
    "CUMPLEAÑOS", "BIRTHDAY", "SAN VALENTIN", "SAN VALENTÍN", "AMOR Y AMISTAD",
    "VALENTINE'S DAY", "DIA DE LA MADRE", "DÍA DE LA MADRE", "MOTHER'S DAY",
    "DIA DEL HOMBRE", "DIA DEL PADRE", "FATHER'S DAY", "DIA DE LA MUJER",
    "WOMEN'S DAY", "NAVIDAD", "CHRISTMAS", "HALLOWEEN", "GRADUACION",
    "GRADUACIÓN", "XV AÑOS", "QUINCE AÑOS", "FIFTEEN YEARS", "BODA", "WEDDING",
    "BABY SHOWER",
}

# Ruido operativo/logístico/marketing de Shopify, sin valor de navegación para el cliente.
RUIDO = {
    "B2C", "B2B", "INT", "DTO CLUB FIESTA", "MERCADOLIBRE", "KIT MERCADOLIBRE",
    "VARIANTSML", "VARIANTSPRICE", "WORLDCOLOR", "BADGE_NUEVO", "NUEVO",
    "OFERTA", "DESTACADO", "LIQUIDACION", "LIQUIDACIÓN", "OXO",
}

# Formas/tamaños ya cubiertos por decodificarTamano()/`formas`/`tamanos` — código
# real (R-12) o variantes sueltas de ese mismo código (r12, bomba r12, r18 -*).
PATRON_TAMANO_O_FORMA = re.compile(
    r"^(R-?\d+(\s.*)?|C-\d+|LOL-\d+|T\d\d?|\d+\s*IN|\d+\s*X\s*\d+\s*CM|BOMBA\s*R\d+|R\d+(\s.*)?)$",
    re.IGNORECASE,
)


def es_ruido(tag: str) -> bool:
    t = tag.strip().upper()
    if t in COLORES or t in OCASIONES or t in RUIDO:
        return True
    if PATRON_TAMANO_O_FORMA.match(t):
        return True
    if len(t) <= 2:
        return True
    return False


def main() -> None:
    lineas = TAGS_PATH.read_text(encoding="utf-8").splitlines()
    tags = [l for l in lineas if l.strip() and not l.startswith("Total")]

    tematicos = sorted({t for t in tags if not es_ruido(t)}, key=str.upper)

    SALIDA_PATH.write_text("\n".join(tematicos) + f"\n\nTotal tags temáticos: {len(tematicos)}\n", encoding="utf-8")
    print(f"Escrito en {SALIDA_PATH} — {len(tematicos)} tags temáticos de {len(tags)} originales.")


if __name__ == "__main__":
    main()
