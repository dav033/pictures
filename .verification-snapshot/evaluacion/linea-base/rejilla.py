from PIL import Image, ImageDraw
import sys
# Carpeta de trabajo: primer argumento o la actual (nunca una ruta fija).
import os
S = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
def g(n):
    im=Image.open(f"case-00{n}-ref.png").convert("RGB"); z=2
    im=im.resize((im.width*z,im.height*z),Image.LANCZOS); d=ImageDraw.Draw(im)
    for x in range(0,im.width//z,40):
        d.line([(x*z,0),(x*z,im.height)],fill=(255,255,0),width=1); d.text((x*z+2,2),str(x),fill=(255,255,0))
    for y in range(0,im.height//z,40):
        d.line([(0,y*z),(im.width,y*z)],fill=(0,255,255),width=1); d.text((2,y*z+2),str(y),fill=(0,255,255))
    return im
for a,b in [(1,3),(4,5),(7,8),(2,6)]:
    A,B=g(a),g(b); c=Image.new("RGB",(A.width+B.width+6,max(A.height,B.height)))
    c.paste(A,(0,0)); c.paste(B,(A.width+6,0)); c.save(f"{S}\g{a}{b}.png")
