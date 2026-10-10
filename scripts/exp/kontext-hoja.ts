/**
 * Hoja de comparación del experimento de color: la captura de partida y cada variante lado a lado, con su título, su ΔE medio y el de cada
 * color de la paleta, y una franja con los colores pedidos. Se arma con `sharp` (SVG para los rótulos), sin red.
 */
import { existsSync } from "node:fs";
import sharp, { type OverlayOptions } from "sharp";

export type PanelHoja = { archivo: string; titulo: string; lineas: string[] };
export type MuestraColor = { nombre: string; hex: string };

const LADO = 512;
const ALTO_ROTULO = 230;
const ALTO_MUESTRAS = 64;
const MARGEN = 12;

const escapar = (texto: string) => texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function rotuloSvg(panel: PanelHoja): Buffer {
  const lineas = panel.lineas.map((l, i) => `<text x="10" y="${60 + i * 20}" font-size="15" fill="#333">${escapar(l)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LADO}" height="${ALTO_ROTULO}"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="32" font-size="24" font-weight="bold" fill="#111" font-family="sans-serif">${escapar(panel.titulo)}</text><g font-family="sans-serif">${lineas}</g></svg>`);
}

function muestrasSvg(muestras: readonly MuestraColor[], ancho: number): Buffer {
  const celda = Math.floor((ancho - 2 * MARGEN) / Math.max(1, muestras.length));
  const cajas = muestras.map((m, i) => `<rect x="${MARGEN + i * celda}" y="8" width="44" height="44" fill="${m.hex}" stroke="#999"/><text x="${MARGEN + i * celda + 54}" y="26" font-size="16" fill="#111" font-family="sans-serif">${escapar(m.nombre)}</text><text x="${MARGEN + i * celda + 54}" y="46" font-size="16" fill="#555" font-family="sans-serif">${m.hex}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${ALTO_MUESTRAS}"><rect width="100%" height="100%" fill="#fff"/>${cajas}</svg>`);
}

/** Escribe la hoja en `salida` (PNG). Los paneles cuyo archivo no existe se omiten. Devuelve cuántos paneles quedaron. */
export async function crearHoja(paneles: readonly PanelHoja[], muestras: readonly MuestraColor[], salida: string): Promise<number> {
  const presentes = paneles.filter((p) => existsSync(p.archivo));
  if (!presentes.length) throw new Error("No hay ninguna imagen para la hoja.");
  const ancho = presentes.length * LADO;
  const alto = ALTO_MUESTRAS + LADO + ALTO_ROTULO;
  const capas: OverlayOptions[] = [{ input: muestrasSvg(muestras, ancho), left: 0, top: 0 }];
  for (const [i, panel] of presentes.entries()) {
    const imagen = await sharp(panel.archivo).resize(LADO, LADO, { fit: "fill" }).png().toBuffer();
    capas.push({ input: imagen, left: i * LADO, top: ALTO_MUESTRAS });
    capas.push({ input: rotuloSvg(panel), left: i * LADO, top: ALTO_MUESTRAS + LADO });
  }
  await sharp({ create: { width: ancho, height: alto, channels: 3, background: "#ffffff" } }).composite(capas).png().toFile(salida);
  return presentes.length;
}
