import argparse
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database")
    parser.add_argument("--directory")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--role", default="scene")
    parser.add_argument("--per-sheet", type=int, default=30)
    args = parser.parse_args()

    if args.directory:
        image_paths = sorted(path for path in Path(args.directory).iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        records = []
        for index, image_path in enumerate(image_paths):
            with Image.open(image_path) as source:
                width, height = source.size
            records.append({
                "selectionId": f"legacy-{index + 1:03d}",
                "theme": "legacy-scene",
                "title": image_path.stem,
                "width": width,
                "height": height,
                "qualityStatus": "approved",
                "localImage": str(image_path),
                "imageRole": args.role,
            })
    elif args.database:
        database = json.loads(Path(args.database).read_text(encoding="utf-8"))
        records = [item for item in database["products"] if item.get("imageRole") == args.role]
    else:
        parser.error("Use --database or --directory")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    columns = 5
    tile_width, image_height, label_height = 240, 210, 92
    rows = (args.per_sheet + columns - 1) // columns
    font = ImageFont.load_default(size=14)

    for start in range(0, len(records), args.per_sheet):
        page = records[start:start + args.per_sheet]
        sheet = Image.new("RGB", (columns * tile_width, rows * (image_height + label_height)), "white")
        draw = ImageDraw.Draw(sheet)
        for offset, record in enumerate(page):
            row, column = divmod(offset, columns)
            x, y = column * tile_width, row * (image_height + label_height)
            image_path = Path(record["localImage"])
            with Image.open(image_path) as source:
                preview = ImageOps.contain(source.convert("RGB"), (tile_width - 12, image_height - 12))
            px = x + (tile_width - preview.width) // 2
            py = y + (image_height - preview.height) // 2
            sheet.paste(preview, (px, py))
            draw.rectangle((x, y, x + tile_width - 1, y + image_height + label_height - 1), outline="#888888")
            label = f"{record['selectionId']} | {record['theme']}\n{record['title']}\n{record['width']}x{record['height']} | {record['qualityStatus']}"
            wrapped = "\n".join(textwrap.fill(line, width=31) for line in label.splitlines())
            draw.multiline_text((x + 7, y + image_height + 5), wrapped, fill="black", font=font, spacing=3)

        number = start // args.per_sheet + 1
        output = output_dir / f"contact-sheet-{args.role}-{number:02d}.jpg"
        sheet.save(output, quality=90, optimize=True)
        print(output.resolve())


if __name__ == "__main__":
    main()
