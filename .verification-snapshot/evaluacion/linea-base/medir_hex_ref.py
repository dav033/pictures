"""Hex 'medido' de cada color de verdad: mediana de pixeles de la crop que cumplen una mascara HSV dentro de una region.
Las mascaras las eligio una persona mirando la imagen; las capturas tienen overlay violeta de la app (sesgo)."""
import numpy as np, json, colorsys
from PIL import Image
def med(n, reg, h, s, v):
    im=np.array(Image.open(f"case-00{n}-ref.png").convert("RGB")).astype(float)/255
    x0,y0,x1,y1=reg; p=im[y0:y1,x0:x1].reshape(-1,3)
    hsv=np.array([colorsys.rgb_to_hsv(*q) for q in p]); H=hsv[:,0]*360
    hm=((H>=h[0])&(H<=h[1])) if h[0]<=h[1] else ((H>=h[0])|(H<=h[1]))
    m=hm&(hsv[:,1]>=s[0])&(hsv[:,1]<=s[1])&(hsv[:,2]>=v[0])&(hsv[:,2]<=v[1])
    if m.sum()<30: return None,int(m.sum())
    c=(np.median(p[m],0)*255).astype(int); return "#%02X%02X%02X"%tuple(c), int(m.sum())
Q={
 "1 dorado cromado":(1,(12,97,178,380),(35,52),(.40,1),(.35,1)),
 "1 dorado sombra":(1,(12,97,178,380),(30,50),(.5,1),(.12,.35)),
 "2 rosa pastel":(2,(8,0,330,300),(305,345),(.10,.45),(.75,1)),
 "2 gris azulado/plata":(2,(8,100,330,380),(200,290),(.02,.14),(.55,.85)),
 "2 blanco nacar":(2,(8,0,330,300),(0,360),(0,.06),(.88,1)),
 "3 dorado champan":(3,(138,50,314,300),(35,50),(.25,.6),(.45,1)),
 "3 blanco crema":(3,(138,50,314,300),(30,55),(0,.12),(.75,1)),
 "3 rosa empolvado":(3,(138,0,314,70),(5,25),(.1,.4),(.45,.85)),
 "3 bronce moca":(3,(138,250,314,350),(15,35),(.2,.6),(.2,.55)),
 "4 coral":(4,(138,110,255,330),(0,14),(.45,1),(.55,1)),
 "4 rosa pastel":(4,(138,200,255,260),(340,360),(.2,.5),(.8,1)),
 "4 blanco":(4,(138,230,255,330),(0,360),(0,.1),(.88,1)),
 "4 malva":(4,(138,110,200,160),(250,310),(.04,.25),(.45,.85)),
 "4 plata R5":(4,(138,150,255,330),(0,360),(0,.08),(.5,.8)),
 "5 fucsia/rosa":(5,(47,316,260,449),(315,350),(.45,1),(.6,1)),
 "5 azul":(5,(47,316,260,449),(205,225),(.45,1),(.5,1)),
 "6 merlot":(6,(150,0,719,395),(330,360),(.35,1),(.2,.55)),
 "6 plata":(6,(150,0,719,200),(0,360),(0,.08),(.45,.78)),
 "6 blanco nacar":(6,(560,150,719,395),(0,360),(0,.08),(.85,1)),
 "6 rosa palido":(6,(560,150,719,395),(330,360),(.08,.3),(.85,1)),
 "7 durazno":(7,(0,100,200,473),(15,30),(.25,.6),(.8,1)),
 "7 azul polvo":(7,(0,100,200,473),(205,230),(.1,.4),(.75,1)),
 "7 dorado cromado":(7,(0,100,200,473),(35,50),(.45,1),(.4,1)),
 "7 blanco menta":(7,(0,100,200,300),(100,180),(.02,.12),(.8,1)),
 "7 cobre":(7,(150,280,260,420),(20,35),(.45,1),(.45,.8)),
 "8 amarillo":(8,(0,0,320,480),(45,58),(.7,1),(.8,1)),
 "8 naranja":(8,(0,0,320,480),(14,26),(.7,1),(.8,1)),
 "8 naranja cobrizo":(8,(0,0,320,480),(10,18),(.8,1),(.65,.85)),
 "8 durazno":(8,(0,0,320,480),(15,30),(.25,.55),(.9,1)),
 "8 verde oscuro":(8,(0,0,320,480),(140,170),(.4,1),(.2,.5)),
}
out={k:med(*v) for k,v in Q.items()}
for k,v in out.items(): print(k,v)
json.dump(out,open("hex-medidos-verdad.json","w"),indent=1)
