/**
 * Prueba «dorada» del motor de escenas: `armarEscena` sobre TODAS las escenas y conjuntos de la biblioteca de fábrica y los presets
 * debe dar, nodo por nodo, la misma caja y las mismas cantidades que la foto guardada en `dorado/armado-escena.json`. Si un cambio
 * del motor (orientación, `sobre`, anclas, techo…) mueve algo que no debía, esta prueba lo dice con el nodo y cuánto cambió.
 * Sin coste: ninguna IA ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-armado-escena-dorado.ts
 *   ... test-armado-escena-dorado.ts --escribir     (solo cuando el cambio de forma es lo que se quería: se revisa el diff del JSON)
 *
 * La foto se sacó del motor de la rama principal (251c58bd) y no debe cambiar por funciones nuevas que son opcionales.
 * Re-escrita una vez (2026-10-09) por las pasadas de proporciones de la lectura de fotos de main (compilar-lectura: puntas, montones al pie,
 * fondos en el piso, apoyo del racimo, colgado delante): cambiaron 15 nodos de 11 escenas «referencia:…», los mismos con y sin las ramas del salón.
 * Re-escrita otra vez (2026-10-09, foto del cumpleaños): un telón colgado de la pared (la cortina) cuenta como fondo de lo que cuelga delante: el letrero de
 * «referencia:dino-jungla-mesa», que estaba pegado a la cortina de luces (mismo plano, tapado), pasa 4 cm adelante (z −250…−248 → −246…−244). Es el único nodo que cambió.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import { ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";

/** [min x, y, z, max x, y, z (cm, a 0,1), globos, tubos, sólidos, copias]. */
type Foto = readonly [number, number, number, number, number, number, number, number, number, number];
type Fotos = Record<string, Record<string, Foto>>;

const RUTA = new URL("./dorado/armado-escena.json", import.meta.url);
const TOLERANCIA_CM = 0.11;
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;

function escenas(): Array<[string, Escena]> {
  const salida: Array<[string, Escena]> = [];
  for (const item of BIBLIOTECA_FABRICA) if (item.contenido.tipo === "escena" || item.contenido.tipo === "conjunto") salida.push([item.id, escenaDeItem(item)]);
  for (const p of ESCENAS_PREDEFINIDAS) salida.push([`preset:${p.id}`, p.escena]);
  return salida;
}

function fotografiar(): Fotos {
  const fotos: Fotos = {};
  for (const [id, escena] of escenas()) {
    const armada = armarEscena(escena);
    fotos[id] = Object.fromEntries(armada.porNodo.map((n) => [n.id, [r1(n.caja.min.x), r1(n.caja.min.y), r1(n.caja.min.z), r1(n.caja.max.x), r1(n.caja.max.y), r1(n.caja.max.z), n.globos.length, n.tubos.length, n.solidos.length, n.copias] as const]));
  }
  return fotos;
}

if (process.argv.includes("--escribir")) {
  const fotos = fotografiar();
  writeFileSync(RUTA, `{\n${Object.entries(fotos).map(([id, nodos]) => `${JSON.stringify(id)}: ${JSON.stringify(nodos)}`).join(",\n")}\n}\n`);
  console.log(`escrita la foto de ${Object.keys(fotos).length} escenas en ${RUTA.pathname}`);
} else {
  const guardada = JSON.parse(readFileSync(RUTA, "utf8")) as Fotos;
  const actual = fotografiar();
  const diferencias: string[] = [];
  for (const id of new Set([...Object.keys(guardada), ...Object.keys(actual)])) {
    const antes = guardada[id], ahora = actual[id];
    if (!antes || !ahora) { diferencias.push(`${id}: ${antes ? "ya no está" : "es nueva (¿--escribir?)"}`); continue; }
    for (const nodo of new Set([...Object.keys(antes), ...Object.keys(ahora)])) {
      const a = antes[nodo], b = ahora[nodo];
      if (!a || !b) { diferencias.push(`${id}/${nodo}: ${a ? "ya no está" : "es nuevo"}`); continue; }
      const mayor = Math.max(...a.slice(0, 6).map((v, i) => Math.abs(v - b[i]!)));
      if (mayor > TOLERANCIA_CM || a.slice(6).some((v, i) => v !== b[6 + i])) diferencias.push(`${id}/${nodo}: caja ${a.slice(0, 6).join(",")} → ${b.slice(0, 6).join(",")} (hasta ${mayor.toFixed(1)} cm), cantidades ${a.slice(6).join("/")} → ${b.slice(6).join("/")}`);
    }
  }
  console.log(`escenas: ${Object.keys(actual).length}; nodos: ${Object.values(actual).reduce((s, n) => s + Object.keys(n).length, 0)}; diferencias: ${diferencias.length}`);
  assert.equal(diferencias.length, 0, `el motor de escenas cambió la forma de ${diferencias.length} nodos de la biblioteca o los presets:\n${diferencias.slice(0, 15).join("\n")}`);
}
