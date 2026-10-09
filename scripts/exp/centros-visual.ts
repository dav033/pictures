/**
 * Comprobación visual SIN coste de los centros de mesa y del techo por zona (REQ-008): arma con las herramientas (sin Gemini) un salón
 * con 6 mesas redondas con sillas, un centro en cada una y festones sobre la pista de baile, y lo captura con la cámara sin cabeza.
 *
 *   npx next dev -p 3023 -H 127.0.0.1     # en otra terminal (solo mientras se captura)
 *   npx tsx scripts/exp/centros-visual.ts http://127.0.0.1:3023 <carpeta>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import type { Encuadre } from "../../src/lib/globos3d/encuadre-foto";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { abrirCapturador } from "./lib-captura-sin-cabeza";

const URL_BASE = process.argv[2] ?? "http://127.0.0.1:3023";
const CARPETA = process.argv[3] ?? "centros";

function paso(escena: Escena, herramienta: string, args: Record<string, unknown>): Escena {
  const r = aplicarHerramienta(escena, herramienta, args);
  if (!r.ok) throw new Error(`${herramienta}: ${r.error}`);
  console.log(`${herramienta}: ${r.resumen.slice(0, 160)}`);
  return r.escena;
}

export function armarSalonDePrueba(): Escena {
  let e: Escena = { sala: { ...SALA_INICIAL, anchoCm: 1000, fondoCm: 900, altoCm: 340, ambiente: { piso: "madera", luces: true } }, nodos: [] };
  // Dos filas de tres mesas redondas con sus sillas, al fondo; la pista de baile al frente.
  [-330, 0, 330].forEach((x, i) => { e = paso(e, "agregar_mobiliario", { id: "mesa_redonda_sillas", x_cm: x, z_cm: -250 }); e = paso(e, "agregar_mobiliario", { id: "mesa_redonda_sillas", x_cm: x + (i - 1) * 0, z_cm: 20 }); });
  e = paso(e, "agregar_mobiliario", { id: "alfombra_redonda", ancho_cm: 300, x_cm: 0, z_cm: 290, colores: ["#2b2b2b"] });
  e = paso(e, "decorar_mesas", { disenos: [{ tipo: "ramo_helio", colores: ["blanco", "dorado", "rosa"], alto_cm: 90 }, { tipo: "columna", colores: ["rosa", "blanco"], alto_cm: 55 }] });
  e = paso(e, "techo_por_zona", { tipo: "festones", zona: { x_cm: 0, z_cm: 285, ancho_cm: 420, fondo_cm: 280 }, colores: ["blanco", "rosa", "dorado"], densidad: "media" });
  return e;
}

async function main() {
  mkdirSync(CARPETA, { recursive: true });
  const escena = armarSalonDePrueba();
  writeFileSync(join(CARPETA, "escena.json"), JSON.stringify(escena));
  const capturador = await abrirCapturador(URL_BASE);
  try {
    const vistas: Array<[string, Encuadre]> = [
      ["general", { aspecto: 1.4, altoCm: 1100, centroYCm: 120, camaraYCm: 330 }],
      ["mesas", { aspecto: 1.4, altoCm: 520, centroYCm: 90, camaraYCm: 250 }],
      ["techo", { aspecto: 1.4, altoCm: 900, centroYCm: 200, camaraYCm: 140 }],
    ];
    for (const [nombre, encuadre] of vistas) {
      const foto = await capturador.capturar(escena, encuadre);
      writeFileSync(join(CARPETA, `${nombre}.${foto.mime.includes("png") ? "png" : "jpg"}`), Buffer.from(foto.base64, "base64"));
      console.log(`captura ${nombre} (${foto.mime}, ${Math.round(foto.base64.length * 0.75 / 1024)} KB)`);
    }
  } finally {
    await capturador.cerrar();
  }
}

if (process.argv[1]?.endsWith("centros-visual.ts")) main().catch((error) => { console.error(error); process.exit(1); });
