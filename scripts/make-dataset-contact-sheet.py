from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "sanitized" / "sempertex-v01"
OUTPUT = ROOT / "data" / "review" / "sempertex-v01-contact-sheet.jpg"
THUMBNAIL = (360, 260)
LABEL_HEIGHT = 48
COLUMNS = 4


def main() -> None:
    images = sorted(SOURCE.glob("*.png"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    rows = (len(images) + COLUMNS - 1) // COLUMNS
    sheet = Image.new("RGB", (COLUMNS * THUMBNAIL[0], rows * (THUMBNAIL[1] + LABEL_HEIGHT)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, path in enumerate(images):
        with Image.open(path) as opened:
            image = ImageOps.contain(opened.convert("RGB"), THUMBNAIL)
            x = (index % COLUMNS) * THUMBNAIL[0]
            y = (index // COLUMNS) * (THUMBNAIL[1] + LABEL_HEIGHT)
            tile = Image.new("RGB", THUMBNAIL, "#eeeeee")
            tile.paste(image, ((THUMBNAIL[0] - image.width) // 2, (THUMBNAIL[1] - image.height) // 2))
            sheet.paste(tile, (x, y))
            draw.text((x + 8, y + THUMBNAIL[1] + 8), f"{index + 1:02d}  {path.stem}", fill="black", font=font)
    sheet.save(OUTPUT, format="JPEG", quality=90, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
