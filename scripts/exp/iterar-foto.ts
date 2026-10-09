/**
 * Iterar la fidelidad de **una** foto (REQ-001): la lee Gemini con `leerFotoConIA` (la misma lectura que usa la barra de
 * la IA con `modelar_desde_foto`), la compila con `compilarLectura` y la captura con la cámara de la foto en un servidor
 * de desarrollo PROPIO (`/3d/captura`). Escribe la lectura, la escena, la captura y un informe de tamaños por pieza
 * (globos por formato, alto y ancho en cm), que es lo que se compara con la foto.
 *
 * La foto vive fuera del repo (datos de clientes). Pagado solo con `--pagar` (una lectura ≈ US$0,01–0,03; tope por
 * ejecución `--tope-usd`, por defecto 0,10). Con `--reusar <lectura.json>` no paga: recompila y recaptura (para probar
 * cambios del compilador o de los generadores con la misma lectura).
 *
 *   npx tsx --conditions=react-server scripts/exp/iterar-foto.ts --foto <ruta> --salida <dir> [--pagar] [--reusar <lectura.json>] [--url http://127.0.0.1:3016]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ajustarLectura } from "../../src/lib/globos3d/ajustar-lectura";
import { detectarGlobos } from "../../src/lib/globos3d/detectar-globos-ia";
import { medirConDetecciones, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { leerFotoConIA } from "../../src/lib/globos3d/leer-foto-ia";
import { LecturaFotoSchema, type LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { conContexto } from "../../src/lib/registro/servidor";
import { normalizarFoto } from "../../src/lib/taller/normalizar-foto";
import { abrirCapturador } from "./lib-captura-sin-cabeza";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const foto = arg("--foto");
const salida = path.resolve(arg("--salida") ?? "data/exp/iterar-foto");
const reusar = arg("--reusar");
const pagar = process.argv.includes("--pagar");
const tope = Math.min(0.2, Number(arg("--tope-usd") ?? 0.1));
const url = arg("--url") ?? "http://127.0.0.1:3016";

async function main() {
  if (!foto) throw new Error("Falta --foto <ruta>");
  mkdirSync(salida, { recursive: true });
  let lectura: LecturaFoto;
  let coste = 0;
  if (reusar) {
    const ajuste = ajustarLectura(LecturaFotoSchema.parse(JSON.parse(readFileSync(reusar, "utf8"))));
    lectura = ajuste.lectura;
    for (const n of ajuste.notas) console.log(`ajuste: ${n}`);
  } else {
    if (!pagar) throw new Error(`Sin --pagar no se llama a la IA (tope ${tope} USD). Usa --reusar para recompilar gratis.`);
    const normal = await normalizarFoto(readFileSync(foto));
    const fotoNormal = { bytes: normal, mime: "image/jpeg" };
    // Lo mismo que `modelarDesdeFoto`: la lectura y la detección en paralelo (aquí por separado, para guardar las dos).
    const [leida, deteccion] = await conContexto({ conversacion: `exp-iterar-foto-${path.basename(salida)}`, vista: "3d" }, () => Promise.all([
      leerFotoConIA(fotoNormal, { superficie: "exp:iterar-foto" }),
      process.argv.includes("--sin-deteccion") ? Promise.resolve(null) : detectarGlobos(fotoNormal, { superficie: "exp:iterar-foto" }),
    ]));
    coste = leida.costeEstimadoUsd + (deteccion?.costeEstimadoUsd ?? 0);
    if (deteccion) {
      writeFileSync(path.join(salida, "detecciones.json"), JSON.stringify(deteccion.globos));
      console.log(`detección: ${deteccion.globos.length} globos (${deteccion.fallidos} trozos fallidos), ${deteccion.costeEstimadoUsd} USD`);
    }
    if (coste > tope) console.warn(`OJO: la lectura costó ${coste} USD, más que el tope ${tope}.`);
    lectura = leida.lectura;
    writeFileSync(path.join(salida, "lectura.json"), JSON.stringify(lectura, null, 2));
  }

  const detecciones = arg("--detecciones") ?? (existsSync(path.join(salida, "detecciones.json")) && !reusar ? path.join(salida, "detecciones.json") : undefined);
  if (detecciones) {
    const medida = medirConDetecciones(lectura, JSON.parse(readFileSync(detecciones, "utf8")) as GloboDetectado[]);
    lectura = medida.lectura;
    for (const n of medida.notas) console.log(`medición: ${n}`);
    writeFileSync(path.join(salida, "lectura-medida.json"), JSON.stringify(lectura, null, 2));
  }
  const { escena, notas, omitidas } = compilarLectura(lectura);
  writeFileSync(path.join(salida, "escena.json"), JSON.stringify(escena, null, 2));
  const informe: string[] = [`resumen: ${lectura.resumen}`, `escala: ${lectura.escala.altoImagenCm} cm (${lectura.escala.referencia}) · aspecto ${lectura.aspecto} · pisoY ${lectura.pisoY}`, `sala: ${escena.sala.anchoCm}×${escena.sala.altoCm} cm`, ""];
  let total = 0;
  for (const p of lectura.piezas) informe.push(`leída ${p.tipo}: ${JSON.stringify(p).slice(0, 400)}`);
  informe.push("");
  for (const n of escena.nodos) {
    const a = armarPieza(n.pieza);
    const porFormato = new Map<string, number>();
    for (const g of a.globos) porFormato.set(g.formatoId, (porFormato.get(g.formatoId) ?? 0) + 1);
    total += a.globos.length;
    const w = Math.round(a.caja.max.x - a.caja.min.x), h = Math.round(a.caja.max.y - a.caja.min.y), d = Math.round(a.caja.max.z - a.caja.min.z);
    informe.push(`${n.id} (${n.pieza.tipo}) ${a.globos.length} globos [${[...porFormato].map(([f, c]) => `${f}:${c}`).join(" ")}] caja ${w}×${h}×${d} cm · ${JSON.stringify(n.colocacion)}`);
  }
  informe.push(`TOTAL ${total} globos`, "", "notas:", ...notas.map((x) => `- ${x}`), "omitidas:", ...omitidas.map((x) => `- ${x}`), `coste ${coste.toFixed(4)} USD`);
  writeFileSync(path.join(salida, "informe.txt"), informe.join("\n"));
  console.log(informe.join("\n"));

  const capturador = await abrirCapturador(url);
  try {
    const captura = await capturador.capturar(escena, encuadreDeLectura(lectura));
    writeFileSync(path.join(salida, "captura.png"), Buffer.from(captura.base64, "base64"));
  } finally {
    await capturador.cerrar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
