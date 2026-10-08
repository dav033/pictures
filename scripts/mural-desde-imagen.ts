/**
 * Convierte una imagen de referencia (una foto local de un mural, una bandera, un logo) en la matriz de un mural
 * pixelado (`src/lib/globos3d/murales.ts`): cada celda toma el color oficial Sempertex más cercano que se fabrica en el
 * formato pedido, con un máximo de colores. Imprime la matriz como TypeScript, para pegarla en el código (la imagen no
 * entra al repo). Local y sin coste: no llama a ninguna IA ni a la red.
 *
 * Uso:
 *   npx tsx scripts/mural-desde-imagen.ts <imagen> --columnas 25 --filas 17 --formato LOL-12 --max-colores 3
 *     [--codigos 041,021,032] [--fondo #ffffff] [--tolerancia 12] [--recorte x,y,ancho,alto] [--disposicion malla]
 *     [--ver]   (además dibuja la matriz con los colores en la consola)
 */
import sharp from "sharp";
import { DISPOSICIONES_MURAL, matrizComoCodigo, matrizDesdeImagen, type DisposicionMural } from "../src/lib/globos3d/murales";
import { referenciaPorCodigo } from "../src/lib/plan/referencia-sempertex";

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function numero(nombre: string, porDefecto?: number): number {
  const v = argumento(nombre);
  if (v === undefined) {
    if (porDefecto === undefined) throw new Error(`Falta --${nombre}.`);
    return porDefecto;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${nombre} no es un número: ${v}`);
  return n;
}

async function main() {
  const ruta = process.argv[2];
  if (!ruta || ruta.startsWith("--")) {
    console.error("Uso: npx tsx scripts/mural-desde-imagen.ts <imagen> --columnas N --filas N --formato R-12 --max-colores N [--codigos a,b] [--fondo #ffffff] [--recorte x,y,w,h] [--disposicion tablero] [--ver]");
    process.exit(2);
  }
  const disposicion = argumento("disposicion") as DisposicionMural | undefined;
  if (disposicion && !DISPOSICIONES_MURAL.some((d) => d.id === disposicion)) throw new Error(`Disposición desconocida: ${disposicion}`);
  const recorte = argumento("recorte")?.split(",").map(Number);
  const { data, info } = await sharp(ruta).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const matriz = matrizDesdeImagen({ ancho: info.width, alto: info.height, datos: data }, {
    columnas: numero("columnas"), filas: numero("filas"), formatoId: argumento("formato") ?? "R-12", maxColores: numero("max-colores", 6),
    codigos: argumento("codigos")?.split(",").map((c) => c.trim()).filter(Boolean),
    fondo: argumento("fondo") ? { hex: argumento("fondo")!, toleranciaDeltaE: numero("tolerancia", 12) } : null,
    recorte: recorte && recorte.length === 4 ? { x: recorte[0]!, y: recorte[1]!, ancho: recorte[2]!, alto: recorte[3]! } : null,
    ...(disposicion ? { disposicion } : {}),
  });
  console.log(matrizComoCodigo(matriz));
  console.log(`// ${matriz.colores.map((c, i) => `${"abcdefghijklmnopqrstuvwxyz0123456789"[i]} = ${c} ${referenciaPorCodigo(c)?.nombreCompleto ?? ""}`).join(" · ")}`);
  if (process.argv.includes("--ver")) {
    for (const fila of matriz.filas) {
      console.log(fila.split("").map((s) => {
        const c = matriz.colores["abcdefghijklmnopqrstuvwxyz0123456789".indexOf(s)];
        const hex = c ? referenciaPorCodigo(c)?.hexGlobo ?? "#888888" : null;
        if (!hex) return "  ";
        const n = Number.parseInt(hex.slice(1), 16);
        return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m  \x1b[0m`;
      }).join(""));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
