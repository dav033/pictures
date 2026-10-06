const sharp = require(require("node:path").resolve(__dirname, "../../node_modules/sharp"));
const fs = require("fs");
// Fotos y resultados: fuera del repositorio (ver evaluacion/rutas.ts).
const IC = (process.env.EVAL_DATOS || require("node:path").resolve(__dirname, "../../../informes-calidad")).replace(/\\/g, "/");
const OUT = process.argv[2];
const casos = [];
for (let c = 1; c <= 8; c++) casos.push({ id: `00${c}`, ref: `${IC}/linea-base/sin-etiquetas/case-00${c}-ref.png`, gen: [1,2,3].map(k => `${IC}/validacion-fase4/estable-3x/caso-${c}/corrida-${k}/imagen-flux/final.png`) });
for (let c = 1; c <= 5; c++) casos.push({ id: `F7-${c}`, ref: `${IC}/validacion-fase7/entradas/case-00${c}-ref.png`, gen: [1,2,3].map(k => `${IC}/validacion-fase4/estable-3x-f7/caso-${c}/corrida-${k}/imagen-flux/final.png`) });
(async () => {
  const H = 300, filas = [];
  for (const c of casos) {
    const celdas = [];
    for (const [i, f] of [c.ref, ...c.gen].entries()) {
      if (!fs.existsSync(f)) { celdas.push(null); continue; }
      const nombre = `${c.id}-${i === 0 ? "foto" : "flux" + i}.jpg`;
      await sharp(f).rotate().resize({ height: 420 }).jpeg({ quality: 78 }).toFile(`${OUT}/img/${nombre}`);
      celdas.push(await sharp(f).rotate().resize({ height: H, width: 400, fit: "contain", background: "#fff" }).png().toBuffer());
    }
    const comp = celdas.map((b, i) => b ? { input: b, left: i * 410, top: 0 } : null).filter(Boolean);
    filas.push(await sharp({ create: { width: 4 * 410, height: H, channels: 3, background: "#ffffff" } }).composite(comp).png().toBuffer());
  }
  for (let g = 0; g < filas.length; g += 5) {
    const grupo = filas.slice(g, g + 5);
    await sharp({ create: { width: 4 * 410, height: grupo.length * (H + 10), channels: 3, background: "#888" } })
      .composite(grupo.map((b, i) => ({ input: b, left: 0, top: i * (H + 10) }))).jpeg({ quality: 70 }).toFile(`${OUT}/hoja-${g / 5 + 1}.jpg`);
  }
  console.log("ok");
})();
