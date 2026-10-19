/**
 * Prueba «dorada» del catálogo de fondos y mobiliario (REQ-013, AC-1): la escena dorada no cubre los muebles que solo están en el
 * catálogo, así que aquí cada una de las entradas de `FONDOS_CATALOGO` se arma como pieza con sus medidas y colores de partida
 * (`piezaDeEntrada` → `elementosDeEscenografia`, el camino del motor) y los dos generadores (`mesa_param`, `sillas_param`) con sus
 * valores de partida: cada tipo de mesa con su `PARTIDA_MESA` y cada tipo de silla, 8 alrededor de la mesa redonda de partida.
 * Se compara el sha256 de los sólidos con la foto de `dorado/catalogo-fondos.json` (sacada de b4433bc9 antes de los repositorios).
 * Sin coste: ninguna IA ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-dorado.ts
 *   ... test-catalogo-dorado.ts --escribir     (solo cuando el cambio de forma es lo que se quería: se revisa el diff del JSON)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { mesaDePedido, piezaDeMesa, piezaDeSillas, sillasParaMesa } from "../../src/lib/globos3d/mobiliario-conjunto";
import { TIPOS_MESA, TIPOS_SILLA } from "../../src/lib/globos3d/mobiliario-conjunto-tipos";
import { elementosDeEscenografia, piezaDeEntrada } from "../../src/lib/globos3d/mobiliario-pieza";
import type { Pieza } from "../../src/lib/globos3d/piezas";

/** [sha256 de los sólidos, cuántos sólidos]. */
type Foto = readonly [string, number];
type Fotos = Record<string, Foto>;

const RUTA = new URL("./dorado/catalogo-fondos.json", import.meta.url);
const SILLAS_DE_PARTIDA = 8;

function fotoDe(pieza: Pieza): Foto {
  if (pieza.tipo !== "escenografia") throw new Error(`pieza ${pieza.tipo}: se esperaba escenografía`);
  const elementos = elementosDeEscenografia(pieza);
  return [createHash("sha256").update(JSON.stringify(elementos)).digest("hex"), elementos.length];
}

function fotografiar(): Fotos {
  const fotos: Fotos = {};
  for (const f of FONDOS_CATALOGO) fotos[f.id] = fotoDe(piezaDeEntrada(f));
  for (const tipo of TIPOS_MESA) fotos[`mesa_param:${tipo}`] = fotoDe(piezaDeMesa(mesaDePedido({ tipo })));
  const mesa = mesaDePedido({ tipo: "redonda" });
  for (const tipo of TIPOS_SILLA) {
    const { sillas } = sillasParaMesa(mesa, { cantidad: SILLAS_DE_PARTIDA, tipo });
    assert.ok(sillas, `las ${tipo} no caben en la mesa redonda de partida`);
    fotos[`sillas_param:${tipo}`] = fotoDe(piezaDeSillas(sillas));
  }
  return fotos;
}

if (process.argv.includes("--escribir")) {
  const fotos = fotografiar();
  writeFileSync(RUTA, `{\n${Object.entries(fotos).map(([id, foto]) => `${JSON.stringify(id)}: ${JSON.stringify(foto)}`).join(",\n")}\n}\n`);
  console.log(`escrita la foto de ${Object.keys(fotos).length} entradas en ${RUTA.pathname}`);
} else {
  const guardada = JSON.parse(readFileSync(RUTA, "utf8")) as Fotos;
  const actual = fotografiar();
  const diferencias: string[] = [];
  for (const id of new Set([...Object.keys(guardada), ...Object.keys(actual)])) {
    const antes = guardada[id], ahora = actual[id];
    if (!antes || !ahora) { diferencias.push(`${id}: ${antes ? "ya no está" : "es nueva (¿--escribir?)"}`); continue; }
    if (antes[0] !== ahora[0]) diferencias.push(`${id}: los sólidos cambiaron (${antes[1]} → ${ahora[1]} sólidos)`);
  }
  console.log(`entradas: ${Object.keys(actual).length}; diferencias: ${diferencias.length}`);
  assert.equal(diferencias.length, 0, `cambió cómo se arma el catálogo de fondos y mobiliario:\n${diferencias.slice(0, 15).join("\n")}`);
  console.log("test-catalogo-dorado: ok");
}
