/**
 * De dónde sale `DELTA_E_CLASIFICACION`.
 *
 * El radio de clasificación decide qué píxeles cuentan como un color del
 * catálogo. Elegirlo a ojo tiene dos formas de salir mal y las dos son
 * silenciosas: muy estrecho y casi todo queda sin clasificar (la medida no dice
 * nada), muy ancho y el césped se vuelve verde de catálogo y la madera café (la
 * medida miente). Este script imprime el reparto real sobre las fotos de
 * referencia para cada radio candidato, que es lo único que permite decidir.
 *
 *   npx tsx --conditions=react-server scripts/calibrar-dominancia.ts
 *
 * Sin red, sin proveedor, sin coste.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { labDeRgb, LAB_COLORES } from "../src/lib/rag/catalog/similitud-color";

const FOTOS = ["ejemplo-01", "ejemplo-02", "ejemplo-06", "ejemplo-07"];
const EXTERNAS = process.argv.slice(2);
const RADIOS = [15, 20, 25, 30, 35, 40, 45];
const TABLA = Object.entries(LAB_COLORES);

function clasificar(rojo: number, verde: number, azul: number, radio: number): string | undefined {
  const lab = labDeRgb(rojo, verde, azul);
  let mejor: string | undefined;
  let mejorDistancia = radio;
  for (const [color, candidato] of TABLA) {
    const distancia = Math.hypot(lab[0] - candidato[0], lab[1] - candidato[1], lab[2] - candidato[2]);
    if (distancia < mejorDistancia || (distancia === mejorDistancia && mejor !== undefined && color < mejor)) {
      mejorDistancia = distancia;
      mejor = color;
    }
  }
  return mejor;
}

async function main(): Promise<void> {
  // La distancia mínima entre dos colores de la paleta acota por arriba
  // cualquier radio razonable: por encima de ella, dos colores del catálogo se
  // disputan los mismos píxeles.
  let parMasCercano = { par: "", distancia: Infinity };
  for (let i = 0; i < TABLA.length; i += 1) {
    for (let j = i + 1; j < TABLA.length; j += 1) {
      const [unoNombre, uno] = TABLA[i]!;
      const [otroNombre, otro] = TABLA[j]!;
      const distancia = Math.hypot(uno[0] - otro[0], uno[1] - otro[1], uno[2] - otro[2]);
      if (distancia < parMasCercano.distancia) parMasCercano = { par: `${unoNombre}/${otroNombre}`, distancia };
    }
  }
  console.log(`par más cercano de la paleta: ${parMasCercano.par} a ΔE ${parMasCercano.distancia.toFixed(1)}\n`);

  for (const foto of [...FOTOS, ...EXTERNAS]) {
    const ruta = foto.includes("/") || foto.includes("\\") ? foto : path.join("public", "referencias-ejemplo", `${foto}.jpg`);
    const { data, info } = await sharp(await readFile(ruta))
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    console.log(`${foto} (${info.width}x${info.height})`);
    for (const radio of RADIOS) {
      const conteo = new Map<string, number>();
      let medidos = 0;
      let sinClasificar = 0;
      const paso = Math.max(1, Math.ceil(Math.sqrt((info.width * info.height) / 20_000)));
      for (let y = 0; y < info.height; y += paso) {
        for (let x = 0; x < info.width; x += paso) {
          const base = (y * info.width + x) * 3;
          const color = clasificar(data[base]!, data[base + 1]!, data[base + 2]!, radio);
          medidos += 1;
          if (!color) {
            sinClasificar += 1;
            continue;
          }
          conteo.set(color, (conteo.get(color) ?? 0) + 1);
        }
      }
      const top = [...conteo.entries()]
        .sort((uno, otro) => otro[1] - uno[1])
        .slice(0, 4)
        .map(([color, veces]) => `${color} ${((veces / medidos) * 100).toFixed(0)}%`)
        .join("  ");
      console.log(`  ΔE<${String(radio).padStart(2)}  sin clasificar ${((sinClasificar / medidos) * 100).toFixed(0).padStart(3)}%   ${top}`);
    }
    console.log("");
  }
}

void main();
