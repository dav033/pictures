/**
 * Hoja de contactos del mobiliario: cada mueble del catálogo solo, en el piso, capturado con la misma cámara de foto del
 * taller (sin coste: no llama a la IA). Deja un PNG por mueble y `indice.json` con id, nombre y medidas.
 *   npx tsx --conditions=react-server scripts/exp/hoja-mobiliario.ts --salida <dir> [--url http://127.0.0.1:3020]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Escena } from "../../src/lib/globos3d/escena";
import { CATALOGO_MOBILIARIO } from "../../src/lib/globos3d/mobiliario-catalogo";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { abrirCapturador } from "./lib-captura-sin-cabeza";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const salida = arg("--salida") ?? "data/exp/hoja-mobiliario";
  const url = arg("--url") ?? "http://127.0.0.1:3020";
  mkdirSync(salida, { recursive: true });
  const capturador = await abrirCapturador(url);
  const indice: { id: string; nombre: string; grupo: string; medidas: string; archivo: string }[] = [];
  try {
    for (const m of CATALOGO_MOBILIARIO) {
      const pieza = piezaDeMueble(m);
      const caja = armarPieza(pieza).caja;
      const ancho = caja.max.x - caja.min.x, alto = caja.max.y - caja.min.y;
      const escena: Escena = {
        sala: { anchoCm: 600, fondoCm: 500, altoCm: 300, tonos: { piso: "#d9d2c5", paredes: "#efebe4", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } },
        nodos: [{ id: m.id, nombre: m.nombre, pieza, colocacion: m.lugar === "pared" ? { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: m.alturaParedCm ?? 60 } : { en: "piso", xCm: 0, zCm: -170, giroGrados: 0 } }],
      };
      // El cuadro (cuadrado) abarca la medida mayor del mueble con aire; lo de pared, centrado en su altura.
      const altoCm = Math.max(70, Math.max(alto, ancho) * 1.3 + 15);
      const base = m.lugar === "pared" ? (m.alturaParedCm ?? 60) : 0;
      const centroYCm = Math.round(Math.max(base + alto / 2, altoCm / 2 - 10));
      const archivo = `${m.id}.png`;
      const c = await capturador.capturar(escena, { aspecto: 1, altoCm, centroYCm, camaraYCm: centroYCm + Math.round(altoCm * 0.25) });
      writeFileSync(path.join(salida, archivo), Buffer.from(c.base64, "base64"));
      indice.push({ id: m.id, nombre: m.nombre, grupo: m.grupo, medidas: `${Math.round(ancho)} × ${Math.round(caja.max.z - caja.min.z)} × ${Math.round(alto)} cm`, archivo });
      console.log(`${m.id} ok`);
    }
  } finally {
    await capturador.cerrar();
  }
  writeFileSync(path.join(salida, "indice.json"), JSON.stringify(indice, null, 1));
}
void main();
