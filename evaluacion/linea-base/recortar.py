from PIL import Image
import glob, os
# Carpeta de capturas de images-judge: primer argumento o EVAL_IMAGES_JUDGE (nunca una ruta fija).
import sys
base = sys.argv[1] if len(sys.argv) > 1 else os.environ["EVAL_IMAGES_JUDGE"]
cuts = {
 1: ("155934", (377,110,697,590)),
 2: ("160123", (152,46,872,526)),
 3: ("160223", (339,87,659,567)),
 4: ("160435", (355,30,675,510)),
 5: ("160706", (328,9,648,489)),
 6: ("161047", (241,58,961,538)),
 7: ("161444", (396,57,756,537)),
 8: ("162048", (415,120,735,600)),
}
for n,(ts,box) in cuts.items():
    f = glob.glob(os.path.join(base,str(n),f"*{ts}.png"))[0]
    Image.open(f).convert("RGB").crop(box).save(f"case-00{n}-ref.png")
    print(n, box)
