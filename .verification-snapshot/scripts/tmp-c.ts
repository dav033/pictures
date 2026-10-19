import { todosLosCasos } from "./lib/casos-motor-guiada";
import { armarDesdeEspec } from "../src/lib/globos3d/motor/v1";
let n=0;
for (const c of todosLosCasos()) {
  const r = armarDesdeEspec(c.espec);
  for (const p of c.espec.piezas) {
    if (r.noRepresentable.some(x=>x.piezaId===p.id)) continue;
    const presentes = new Set((r.bom.porPieza[p.id]??[]).map(l=>l.codigo));
    const perdidos = p.colores.filter(col=>!presentes.has(col.codigo));
    if (perdidos.length) { n++; console.log(c.id.slice(0,32), p.id, p.oficial, p.tamanos, "colores", p.colores.length, "perdidos", perdidos.map(x=>x.codigo+":"+x.peso).join(",")); }
  }
}
console.log("piezas con colores perdidos:", n);
