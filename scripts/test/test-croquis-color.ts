/**
 * Mide el camino nuevo del color sobre **fotos reales**: croquis → 2 a 5 colores → referencia Sempertex.
 *
 * Las fotos son las 20 de `clasificador-decoraciones/public/ejemplos/` (dos por tipo de estructura, con el tipo
 * en el nombre del archivo) y las 10 de `public/referencias-ejemplo/`. No entran en este repo: se leen de donde
 * están, y el script no falla si no están.
 *
 * Lo que comprueba:
 *
 * 1. Que cada tipo de estructura tiene una zona de croquis con una parte de la caja razonable (ni tan chica que
 *    no queden píxeles, ni tan grande que no recorte nada).
 * 2. Que de una foto real salen entre 2 y 5 colores, deterministas (dos corridas dan lo mismo).
 * 3. Que el croquis **cambia** el resultado respecto a medir la caja entera, que es lo que se hacía antes.
 * 4. Que cada color cae en una referencia del catálogo con su Pantone, y cuántas salen ambiguas.
 *
 * Es una medición, no un umbral: imprime la tabla y solo falla en lo que es un error de programa (una zona
 * vacía, un resultado no determinista, un color fuera del catálogo).
 *
 *   npx tsx scripts/test/test-croquis-color.ts
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CLAVES_CON_FORMA, zonaDeCroquis } from "@/lib/plan/croquis-zona";
import { MAX_COLORES, paletaMedida, type Pixel } from "@/lib/plan/paleta-medida";

import { TABLA_SEMPERTEX, cruzarColor } from "@/lib/plan/referencia-sempertex";

const EJEMPLOS_DECORACIONES = "C:/New folder/clasificador-decoraciones/public/ejemplos";
const EJEMPLOS_PROPIOS = join(process.cwd(), "public", "referencias-ejemplo");

/** El tipo de estructura del plan que le corresponde al nombre de archivo de decoraciones. */
const TIPO_POR_NOMBRE: Readonly<Record<string, string>> = {
  arco: "arco",
  "arco-organico": "arco",
  columna: "columna",
  "columna-organica": "columna",
  guirnalda: "guirnalda",
  pared: "pared",
  bouquet: "kit",
  "centro-mesa": "centro_mesa",
  circulo: "aro_circular",
  "techo-globos": "techo_globos",
};

let fallos = 0;
const fallar = (mensaje: string) => {
  console.error(`  FALLO: ${mensaje}`);
  fallos++;
};

/** Los píxeles de una foto, a lo que decodifica el análisis de referencia (512 px de lado, `nearest`). */
async function pixelesDe(ruta: string): Promise<{ datos: Buffer; ancho: number; alto: number }> {
  const { data, info } = await sharp(ruta)
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { datos: data, ancho: info.width, alto: info.height };
}

/** Los píxeles que caen dentro del croquis de una caja. Sin caja, la foto entera. */
function dentroDeLaZona(
  foto: { datos: Buffer; ancho: number; alto: number },
  tipo: string,
  usarCroquis: boolean,
): Pixel[] {
  const zona = zonaDeCroquis(tipo);
  const salida: Pixel[] = [];
  for (let y = 0; y < foto.alto; y++) {
    for (let x = 0; x < foto.ancho; x++) {
      const u = (x + 0.5) / foto.ancho;
      const v = (y + 0.5) / foto.alto;
      if (usarCroquis && !zona.dentro(u, v)) continue;
      const i = (y * foto.ancho + x) * 3;
      salida.push({ r: foto.datos[i], g: foto.datos[i + 1], b: foto.datos[i + 2] });
    }
  }
  return salida;
}

async function main(): Promise<void> {
  console.log(`tabla de color: ${TABLA_SEMPERTEX.referencias.length} referencias, generada ${TABLA_SEMPERTEX.generado}\n`);

  // --- 1. La zona de cada tipo ---
  console.log("1. Zona de croquis por tipo (parte de la caja que se queda)");
  for (const clave of CLAVES_CON_FORMA) {
    const zona = zonaDeCroquis(clave);
    const parte = zona.parteDeLaCaja;
    console.log(`   ${clave.padEnd(14)} ${zona.forma.padEnd(26)} ${(parte * 100).toFixed(1)} %`);
    if (parte <= 0.02) fallar(`la zona de ${clave} se queda con el ${(parte * 100).toFixed(1)} % de la caja`);
    if (parte > 0.95 && !["pared", "backdrop", "escultura", "accesorio"].includes(clave)) {
      fallar(`la zona de ${clave} no recorta nada (${(parte * 100).toFixed(1)} %)`);
    }
  }
  const sinForma = zonaDeCroquis("tipo-que-no-existe");
  if (sinForma.forma !== "caja entera") fallar("un tipo desconocido debería caer a la caja entera");

  // --- 2 a 4. Sobre fotos reales ---
  const fotos: { nombre: string; ruta: string; tipo: string }[] = [];
  if (existsSync(EJEMPLOS_DECORACIONES)) {
    for (const archivo of readdirSync(EJEMPLOS_DECORACIONES).filter((a) => a.endsWith(".jpg"))) {
      const base = archivo.replace(/-\d+\.jpg$/, "");
      const tipo = TIPO_POR_NOMBRE[base];
      if (tipo) fotos.push({ nombre: archivo, ruta: join(EJEMPLOS_DECORACIONES, archivo), tipo });
    }
  }
  if (existsSync(EJEMPLOS_PROPIOS)) {
    for (const archivo of readdirSync(EJEMPLOS_PROPIOS).filter((a) => a.endsWith(".jpg") && !a.includes("mini"))) {
      // Las propias no dicen de qué tipo son: se miden como arco, que es la estructura más común.
      fotos.push({ nombre: archivo, ruta: join(EJEMPLOS_PROPIOS, archivo), tipo: "arco" });
    }
  }
  if (fotos.length === 0) {
    console.log("\nNo hay fotos de ejemplo a mano: solo se comprobaron las zonas.");
    process.exit(fallos === 0 ? 0 : 1);
  }

  console.log(`\n2–4. ${fotos.length} fotos reales\n`);
  console.log("   foto                          tipo         colores  parte del 1.º  referencia (ΔE)        ambigua");
  let ambiguas = 0;
  let totalColores = 0;
  let cambiaronConCroquis = 0;

  for (const foto of fotos.sort((a, b) => (a.nombre < b.nombre ? -1 : 1))) {
    const datos = await pixelesDe(foto.ruta);
    const conCroquis = dentroDeLaZona(datos, foto.tipo, true);
    const sinCroquis = dentroDeLaZona(datos, foto.tipo, false);

    const paleta = paletaMedida(conCroquis);
    const paletaCaja = paletaMedida(sinCroquis);

    // Determinismo: la misma entrada, dos veces.
    const repetida = paletaMedida(conCroquis);
    if (JSON.stringify(repetida) !== JSON.stringify(paleta)) fallar(`${foto.nombre}: la paleta no es determinista`);

    if (paleta.colores.length === 0) {
      fallar(`${foto.nombre}: la zona no dio ningún color (${conCroquis.length} píxeles)`);
      continue;
    }
    if (paleta.colores.length > MAX_COLORES) fallar(`${foto.nombre}: ${paleta.colores.length} colores, más de ${MAX_COLORES}`);
    totalColores += paleta.colores.length;

    const primeros = JSON.stringify(paleta.colores.map((c) => c.hex));
    const primerosCaja = JSON.stringify(paletaCaja.colores.map((c) => c.hex));
    if (primeros !== primerosCaja) cambiaronConCroquis++;

    const cruce = cruzarColor(paleta.colores[0].hex);
    if (cruce.candidatas.length === 0) fallar(`${foto.nombre}: el color ${paleta.colores[0].hex} no cruzó con ninguna referencia`);
    if (cruce.ambigua) ambiguas++;
    const mejor = cruce.candidatas[0];
    const etiqueta = `${mejor.codigo} ${mejor.nombre}${mejor.pms ? ` · PMS ${mejor.pms}` : ""}`;
    console.log(
      `   ${foto.nombre.padEnd(29)} ${foto.tipo.padEnd(12)} ${String(paleta.colores.length).padStart(4)}     ` +
        `${(paleta.colores[0].parte * 100).toFixed(0).padStart(6)} %   ${etiqueta.padEnd(30)} ${cruce.ambigua ? "sí" : "no"}` +
        `${cruce.neutro ? " (neutro)" : ""}`,
    );
    for (const color of paleta.colores) {
      const c = cruzarColor(color.hex);
      const candidatas = c.candidatas.map((x) => `${x.codigo} ${x.nombre} ΔE ${x.deltaE}`).join(" | ");
      console.log(`      ${color.hex} ${(color.parte * 100).toFixed(0).padStart(3)} % → ${candidatas}`);
    }
    for (const aviso of paleta.avisos) console.log(`      aviso: ${aviso}`);
  }

  console.log(`\nResumen`);
  console.log(`  colores por foto (media): ${(totalColores / fotos.length).toFixed(1)}`);
  console.log(`  fotos donde el croquis cambió la paleta: ${cambiaronConCroquis} de ${fotos.length}`);
  console.log(`  cruces ambiguos (1.ª y 2.ª a menos de ΔE 3): ${ambiguas} de ${fotos.length}`);
  if (cambiaronConCroquis === 0) fallar("el croquis no cambió ninguna paleta: entonces no está recortando nada");

  console.log(fallos === 0 ? "\nOK" : `\n${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
