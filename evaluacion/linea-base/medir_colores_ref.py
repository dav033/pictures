"""Mide colores dominantes de las referencias (k-means en Lab, numpy). Solo lectura de las crops."""
import numpy as np, json
from PIL import Image
def srgb2lab(rgb):
    c = rgb/255.0
    c = np.where(c>0.04045, ((c+0.055)/1.055)**2.4, c/12.92)
    M = np.array([[0.4124564,0.3575761,0.1804375],[0.2126729,0.7151522,0.0721750],[0.0193339,0.1191920,0.9503041]])
    xyz = c@M.T/np.array([0.95047,1.0,1.08883])
    f = np.where(xyz>0.008856, np.cbrt(xyz), 7.787*xyz+16/116)
    return np.stack([116*f[:,1]-16, 500*(f[:,0]-f[:,1]), 200*(f[:,1]-f[:,2])],1)
regions = {
 1:[(12,97,178,417)], 2:[(8,0,330,424),(430,0,621,424)], 3:[(138,0,314,378)], 4:[(138,110,255,345)],
 5:[(47,316,190,449),(194,334,260,449)], 6:[(150,0,719,395)], 7:[(0,0,192,473),(189,0,359,226)], 8:[(0,0,320,480)],
}
out={}
rng=np.random.default_rng(0)
for n,regs in regions.items():
    im=np.array(Image.open(f"case-00{n}-ref.png").convert("RGB"))
    px=np.concatenate([im[y0:y1,x0:x1].reshape(-1,3) for x0,y0,x1,y1 in regs]).astype(float)
    lab=srgb2lab(px); k=9
    cen=lab[rng.choice(len(lab),k,replace=False)]
    for _ in range(25):
        d=((lab[:,None,:]-cen[None])**2).sum(2); a=d.argmin(1)
        for j in range(k):
            if (a==j).any(): cen[j]=lab[a==j].mean(0)
    res=[]
    for j in range(k):
        m=a==j
        if m.sum()==0: continue
        rgb=np.median(px[m],0).astype(int)
        res.append(("#%02X%02X%02X"%tuple(rgb), round(m.mean(),3)))
    res.sort(key=lambda t:-t[1]); out[n]=res
    print(n,res)
json.dump(out,open("colores-medidos-kmeans.json","w"))
