/**
 * Iteración 4 (revisión): contraste WCAG AA de los tokens de color de
 * src/app/globals.css en claro y oscuro. Lee los bloques `:root`,
 * `@media (prefers-color-scheme: dark)` y `:root[data-theme="dark"]`, comprueba
 * que los dos bloques oscuros sean idénticos y que cada par texto/fondo que usan
 * los componentes llegue a 4,5:1 (texto normal). Determinista, sin red.
 * Run: npx tsx scripts/test-contraste-tema.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");

function bloque(inicio: string): string {
  const desde = css.indexOf(inicio);
  assert.ok(desde >= 0, `no encontré el bloque ${inicio}`);
  const abre = css.indexOf("{", desde + inicio.length - 1);
  let profundidad = 0;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === "{") profundidad += 1;
    else if (css[i] === "}") {
      profundidad -= 1;
      if (profundidad === 0) return css.slice(abre + 1, i);
    }
  }
  throw new Error(`bloque sin cerrar: ${inicio}`);
}

function tokens(texto: string): Record<string, string> {
  return Object.fromEntries([...texto.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, nombre, valor]) => [nombre!, valor!.toLowerCase()]));
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (oscuro! + 0.05);
}

const claro = tokens(bloque(":root {"));
const oscuroSistema = tokens(bloque(':root:not([data-theme="light"]) {'));
const oscuroElegido = tokens(bloque(':root[data-theme="dark"] {'));
assert.deepEqual(oscuroSistema, oscuroElegido, "el oscuro por sistema y el oscuro elegido deben usar los mismos tokens");
console.log("[PASS] tema oscuro: mismo bloque por sistema y por elección");

/** Pares texto/fondo que aparecen en los componentes (texto normal: 4,5:1). */
const PARES: ReadonlyArray<readonly [texto: string, fondo: string]> = [
  ["texto", "fondo"], ["texto", "superficie"], ["texto", "superficie-2"],
  ["texto-suave", "fondo"], ["texto-suave", "superficie"], ["texto-suave", "superficie-suave"], ["texto-suave", "superficie-2"],
  // Metadatos (crédito de fotos, nota de la cotización) y placeholders.
  ["texto-tenue", "fondo"], ["texto-tenue", "superficie"], ["texto-tenue", "superficie-suave"],
  ["acento", "fondo"], ["acento", "superficie"], ["acento", "superficie-suave"], ["acento", "superficie-2"], ["acento", "acento-suave"],
  // Botones primarios y numeración de piezas.
  ["sobre-acento", "acento"], ["sobre-acento", "acento-hover"],
  ["exito", "superficie"], ["exito", "exito-suave"],
  ["error", "superficie"], ["error", "error-suave"],
  ["aviso", "superficie"], ["aviso", "aviso-suave"],
];

for (const [nombre, tema] of [["claro", claro], ["oscuro", oscuroElegido]] as const) {
  const fallos: string[] = [];
  for (const [texto, fondo] of PARES) {
    const colorTexto = tema[texto] ?? claro[texto];
    const colorFondo = tema[fondo] ?? claro[fondo];
    assert.ok(colorTexto && colorFondo, `faltan tokens ${texto}/${fondo}`);
    const valor = contraste(colorTexto, colorFondo);
    if (valor < 4.5) fallos.push(`${texto} sobre ${fondo}: ${valor.toFixed(2)}`);
  }
  assert.deepEqual(fallos, [], `tema ${nombre}: pares por debajo de AA`);
  console.log(`[PASS] tema ${nombre}: ${PARES.length} pares texto/fondo con contraste AA`);
}
