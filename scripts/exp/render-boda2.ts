/**
 * Experimento PAGADO «render de la boda», ronda 2 (2026-10-09): la ronda 1 (`render-boda.ts`) dio que FLUX.1 imagen-a-imagen conserva todo pero NO es una
 * foto (sigue siendo el render 3D) y que FLUX.2 `/edit` es foto real pero reencuadra, borra o escribe mal el rótulo («Boda Kat»). Aquí, con la misma
 * captura (`captura-3d-escena.jpg` y `descripcion.txt`):
 *   g) FLUX.2 `/edit` con la captura como `render_3d_base` (un plano en 3D que se convierte en foto, no «resultado previo») y `promptFotoDeLayout`;
 *   k) FLUX.1 Kontext pro, con la misma instrucción;
 *   m) FLUX.1 Kontext max, con la misma instrucción;
 *   x) una variante de tamaño o proporción de una de ellas (`--x g|k|m --tam 1344x896 --aspecto 16:9`).
 * Tope DURO: US$0,40 en esta ronda (`ronda2Total` de gasto.json; `total` suma las dos). Lo que ya está en la carpeta no se vuelve a pedir.
 *
 * Uso (FAL_KEY se lee de .env.local del repo principal; nunca se imprime):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/render-boda2.ts <carpeta> [--solo g,k] [--semillas 11,22] [--seco] [--x k --tam WxH --aspecto A:B]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

for (const archivo of [".env.local", ".env", "C:/Users/davidt/Downloads/pictures-workspace/demo-decoracion/.env.local"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const CARPETA = process.argv[2];
if (!CARPETA) throw new Error("Falta la carpeta (la de captura-3d-escena.jpg y descripcion.txt).");
const TOPE_RONDA2_USD = 0.4;

type Modelo = "g" | "k" | "m";
const COSTO: Readonly<Record<Modelo, number>> = { g: 0.048, k: 0.04, m: 0.08 };
const NOMBRE: Readonly<Record<Modelo, string>> = { g: "FLUX.2 /edit, captura como render 3D a convertir", k: "FLUX.1 Kontext pro", m: "FLUX.1 Kontext max" };

type Gasto = { total: number; ronda2Total?: number; llamadas: Array<{ archivo: string; variante: string; semilla: number; costo: number; ms: number; cuando: string; ronda?: number }> };

async function main() {
  const args = process.argv.slice(3);
  const seco = args.includes("--seco");
  const valor = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const solo = valor("--solo") ? new Set(valor("--solo")!.split(",")) : null;
  const semillas = valor("--semillas") ? valor("--semillas")!.split(",").map(Number) : [11, 22];
  const x = valor("--x") as Modelo | undefined;
  const tam = valor("--tam")?.split("x").map(Number);
  const aspectoPedido = valor("--aspecto");
  const { decidir, conContexto } = await import("../../src/lib/registro/servidor");
  const { generarConSempertexFlux, generarConFluxKontext, costeKontext } = await import("../../src/lib/ia/kagutsuchi/flux");
  const { promptFotoDeLayout } = await import("../../src/lib/globos3d/render-ia");

  const captura = readFileSync(join(CARPETA, "captura-3d-escena.jpg"));
  const descripcion = readFileSync(join(CARPETA, "descripcion.txt"), "utf8");
  const meta = await sharp(captura).metadata();
  const razon = (meta.width ?? 3) / (meta.height ?? 2);
  const aspecto = razon < 0.8 ? "2:3" : razon > 1.25 ? "3:2" : "1:1";
  const prompt = promptFotoDeLayout(descripcion);
  writeFileSync(join(CARPETA, "prompt-ronda2.txt"), `${prompt.length} caracteres\n${prompt}\n`);
  if (costeKontext("pro") !== COSTO.k || costeKontext("max") !== COSTO.m) throw new Error("Las tarifas de Kontext cambiaron: revisa COSTO.");

  const rutaGasto = join(CARPETA, "gasto.json");
  const gasto: Gasto = existsSync(rutaGasto) ? JSON.parse(readFileSync(rutaGasto, "utf8")) as Gasto : { total: 0, llamadas: [] };
  gasto.ronda2Total ??= 0;
  const guardar = () => writeFileSync(rutaGasto, JSON.stringify(gasto, null, 2));

  const trabajos = x
    ? [{ id: "x", modelo: x, semilla: semillas[0] ?? 11 }]
    : (["g", "k", "m"] as const).filter((m) => !solo || solo.has(m)).flatMap((modelo) => semillas.map((semilla) => ({ id: modelo as string, modelo: modelo as Modelo, semilla })));

  await conContexto({ conversacion: "exp-render-boda" }, async () => {
    for (const t of trabajos) {
      const archivo = `${t.id}-s${t.semilla}.png`;
      const costo = COSTO[t.modelo];
      if (existsSync(join(CARPETA, archivo))) { console.log(`${archivo}: ya está (no se vuelve a pagar)`); continue; }
      if ((gasto.ronda2Total ?? 0) + costo > TOPE_RONDA2_USD + 1e-9) { console.log(`${archivo}: NO se pide — pasaría el tope de la ronda 2 (${(gasto.ronda2Total ?? 0).toFixed(3)} + ${costo.toFixed(3)} > ${TOPE_RONDA2_USD})`); continue; }
      if (seco) { console.log(`${archivo}: pediría ${NOMBRE[t.modelo]} por ~US$${costo.toFixed(3)}`); continue; }
      decidir("exp:render_boda2_llamada", `variante ${t.id} (${NOMBRE[t.modelo]}), semilla ${t.semilla}`, { variante: t.id, semilla: t.semilla, costoPrevisto: costo, gastoRonda2Previo: gasto.ronda2Total, tope: TOPE_RONDA2_USD });
      const t0 = Date.now();
      try {
        let base64 = captura.toString("base64"), mime = "image/jpeg", ancho = meta.width ?? 1536, alto = meta.height ?? 1024;
        if (t.id === "x" && tam?.length === 2) {
          const b = await sharp(captura).resize(tam[0]!, tam[1]!, { fit: "fill" }).png().toBuffer();
          base64 = b.toString("base64"); mime = "image/png"; ancho = tam[0]!; alto = tam[1]!;
        }
        const imagen = t.modelo === "g"
          ? await generarConSempertexFlux(prompt, (aspectoPedido && t.id === "x" ? aspectoPedido : aspecto) as "3:2", [], {
            loras: [], guidanceScale: 3.5, seed: t.semilla, telemetria: { superficie: "exp-render-boda" },
            imagenesEdit: [{ id: "captura-3d", descripcion: "Plano 3D del taller que se convierte en foto", base64, mime, role: "render_3d_base", priority: 1, allowed_use: "plano 3D: cámara y objetos que se conservan" }],
          })
          : await generarConFluxKontext(prompt, { imagen: { base64, mime, ancho, alto }, variante: t.modelo === "k" ? "pro" : "max", seed: t.semilla, ...(aspectoPedido && t.id === "x" ? { aspecto: aspectoPedido } : {}), telemetria: { superficie: "exp-render-boda" } });
        writeFileSync(join(CARPETA, archivo), Buffer.from(imagen.base64, "base64"));
        gasto.ronda2Total = Math.round(((gasto.ronda2Total ?? 0) + costo) * 1000) / 1000;
        gasto.total = Math.round((gasto.total + costo) * 1000) / 1000;
        gasto.llamadas.push({ archivo, variante: t.id, semilla: t.semilla, costo, ms: Date.now() - t0, cuando: new Date().toISOString(), ronda: 2 });
        guardar();
        console.log(`${archivo}: ok en ${Math.round((Date.now() - t0) / 1000)} s · ronda 2: ${gasto.ronda2Total.toFixed(3)} de ${TOPE_RONDA2_USD} USD`);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        decidir("exp:render_boda2_error", `variante ${t.id} semilla ${t.semilla} falló`, { mensaje: mensaje.slice(0, 300) });
        // Si fal llegó a aceptar el pedido se cuenta como cobrado (por si acaso): solo el rechazo al enviar no cuesta.
        if (!/rechazó la solicitud/.test(mensaje)) {
          gasto.ronda2Total = Math.round(((gasto.ronda2Total ?? 0) + costo) * 1000) / 1000;
          gasto.total = Math.round((gasto.total + costo) * 1000) / 1000;
          gasto.llamadas.push({ archivo: `${archivo} (error)`, variante: t.id, semilla: t.semilla, costo, ms: Date.now() - t0, cuando: new Date().toISOString(), ronda: 2 });
          guardar();
        }
        console.log(`${archivo}: ERROR ${mensaje.slice(0, 300)}`);
      }
    }
  });
  console.log(`Ronda 2: US$${(gasto.ronda2Total ?? 0).toFixed(3)} de ${TOPE_RONDA2_USD} · total del experimento US$${gasto.total.toFixed(3)}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
