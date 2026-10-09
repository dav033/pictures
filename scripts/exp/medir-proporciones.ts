/**
 * Mide las proporciones de lo armado contra la foto (`lib-proporciones.ts`): proyecta con la cámara de la foto los globos y
 * los fondos de la escena que sale de compilar la lectura y los compara con los globos y fondos detectados en la foto.
 * Con `--medir` la lectura se mide primero con las detecciones (como hace `iterar-foto.ts`). Escribe un PNG con la foto, las
 * detecciones (verde), lo armado (rojo) y los fondos (azul: foto, naranja: armado) si se da `--superpuesto`. Gratis, sin IA.
 *
 *   npx tsx --conditions=react-server scripts/exp/medir-proporciones.ts --foto <ruta> --lectura <lectura.json> --detecciones <det.json> --fondos <fondos.json> [--medir] [--superpuesto <png>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "../../src/lib/globos3d/encuadre-foto";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { esTelon } from "../../src/lib/globos3d/fondos-escenografia";
import { mismaFamiliaDeFondo } from "../../src/lib/globos3d/fondos-familias";
import { centroDe } from "../../src/lib/globos3d/letras";
import { LecturaFotoSchema, type LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { globosDe } from "../../src/lib/globos3d/medir-geometria";
import { medirConDetecciones, type FondoDetectado, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { discosDeLaFoto, medirProporciones, type Caja, type Disco, type FondoMedido } from "./lib-proporciones";
import { camaraNumerica, largoEnPantalla, proyectar } from "../../src/lib/globos3d/proyeccion-foto";


/** Lo armado, en unidades de alto de la foto: sus globos como discos y los fondos como cajas. */
export function armadoEnLaFoto(lectura: LecturaFoto): { discos: Disco[]; fondos: FondoMedido[] } {
  const escena = compilarLectura(lectura).escena;
  const camara = camaraNumerica(encuadreDeLectura(lectura), escena.sala);
  const aImagen = (p: { x: number; y: number }) => ({ x: (p.x + camara.aspecto) / 2, y: (1 - p.y) / 2 });
  const armada = armarEscena(escena);
  const discos = armada.globos.flatMap((g) => {
    const p = proyectar(camara, centroDe(g));
    return p ? [{ ...aImagen(p), r: largoEnPantalla(camara, g.infladoCm / 2, p.prof) / 2 }] : [];
  });
  const fondos = armada.porNodo.flatMap((n): FondoMedido[] => {
    const pieza = escena.nodos.find((o) => o.id === n.id)?.pieza;
    if (!pieza || pieza.tipo !== "escenografia" || !pieza.mueble || !Number.isFinite(n.caja.min.x)) return [];
    const { min, max } = n.caja;
    const esquinas = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => proyectar(camara, { x, y, z })))).flatMap((p) => (p ? [aImagen(p)] : []));
    if (!esquinas.length) return [];
    return [{ id: pieza.mueble.id, caja: { x0: Math.min(...esquinas.map((e) => e.x)), x1: Math.max(...esquinas.map((e) => e.x)), y0: Math.min(...esquinas.map((e) => e.y)), y1: Math.max(...esquinas.map((e) => e.y)) } }];
  });
  return { discos, fondos };
}

export const cajaDeDeteccion = (f: FondoDetectado, aspecto: number): FondoMedido => {
  const [y0, x0, y1, x1] = f.box_2d as readonly number[];
  return { id: f.id, caja: { x0: (x0! / 1000) * aspecto, x1: (x1! / 1000) * aspecto, y0: y0! / 1000, y1: y1! / 1000 } };
};

export async function superpuesto(foto: string, aspecto: number, verdad: Disco[], armado: Disco[], fondosFoto: FondoMedido[], fondosArmados: FondoMedido[], salida: string) {
  const alto = 900, ancho = Math.round(alto * aspecto);
  const px = (n: number) => (n * alto).toFixed(1);
  const circulo = (d: Disco, color: string) => `<circle cx="${px(d.x)}" cy="${px(d.y)}" r="${px(d.r)}" fill="none" stroke="${color}" stroke-width="2"/>`;
  const rect = (c: Caja, color: string) => `<rect x="${px(c.x0)}" y="${px(c.y0)}" width="${px(c.x1 - c.x0)}" height="${px(c.y1 - c.y0)}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="8 4"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">${verdad.map((d) => circulo(d, "#16c60c")).join("")}${armado.map((d) => circulo(d, "#e81123")).join("")}${fondosFoto.map((f) => rect(f.caja, "#0078d7")).join("")}${fondosArmados.map((f) => rect(f.caja, "#ff8c00")).join("")}</svg>`;
  const fondo = await sharp(foto).rotate().resize({ width: ancho, height: alto, fit: "fill" }).png().toBuffer();
  writeFileSync(salida, await sharp(fondo).composite([{ input: Buffer.from(svg) }]).png().toBuffer());
}

/** Mide una corrida: la lectura (medida con las detecciones si `medir`) contra las detecciones de la foto; con `png` escribe el superpuesto. */
export async function medirCorrida(o: { foto: string; lectura: string; detecciones: string; fondos?: string; medir: boolean; png?: string }) {
  const leida = LecturaFotoSchema.parse(JSON.parse(readFileSync(o.lectura, "utf8")));
  const detecciones = JSON.parse(readFileSync(o.detecciones, "utf8")) as GloboDetectado[];
  const fondos = o.fondos ? JSON.parse(readFileSync(o.fondos, "utf8")) as FondoDetectado[] : [];
  const lectura = o.medir ? medirConDetecciones(leida, detecciones, fondos).lectura : leida;
  const fondosFoto = fondos.map((f) => cajaDeDeteccion(f, lectura.aspecto));
  const verdad = discosDeLaFoto(globosDe(detecciones, lectura.aspecto), fondosFoto);
  const armado = armadoEnLaFoto(lectura);
  const medidas = medirProporciones({ foto: verdad, armado: armado.discos, aspecto: lectura.aspecto, fondosFoto, fondosArmados: armado.fondos, mismoFondo: mismaFamiliaDeFondo, esTelon });
  if (o.png) await superpuesto(o.foto, lectura.aspecto, verdad, armado.discos, fondosFoto, armado.fondos, o.png);
  return medidas;
}

async function main() {
  const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const lectura = arg("--lectura"), detecciones = arg("--detecciones"), foto = arg("--foto");
  if (!lectura || !detecciones || !foto) throw new Error("Faltan --foto, --lectura y --detecciones");
  console.log(JSON.stringify(await medirCorrida({ foto, lectura, detecciones, fondos: arg("--fondos"), medir: process.argv.includes("--medir"), png: arg("--superpuesto") })));
}

if (process.argv[1]?.includes("medir-proporciones")) main().catch((e) => { console.error(e); process.exit(1); });
