const sharp = require(require("node:path").resolve(__dirname, "../../node_modules/sharp"));
// Fotos y resultados: fuera del repositorio (ver evaluacion/rutas.ts).
const IC = (process.env.EVAL_DATOS || require("node:path").resolve(__dirname, "../../../informes-calidad")).replace(/\\/g, "/");
const [salida, ...archivos] = process.argv.slice(2);
(async () => {
  const H = 420, cel = [];
  for (const f of archivos) cel.push(await sharp(f).rotate().resize({ height: H }).png().toBuffer());
  const anchos = await Promise.all(cel.map(async b => (await sharp(b).metadata()).width));
  let x = 0; const comp = cel.map((b, i) => { const c = { input: b, left: x, top: 0 }; x += anchos[i] + 12; return c; });
  await sharp({ create: { width: x, height: H, channels: 3, background: "#fff" } }).composite(comp).jpeg({ quality: 82 }).toFile(salida);
})();
