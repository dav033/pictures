/**
 * Las fichas de la biblioteca del taller (`src/lib/taller/fichas.ts`, REQ-002). Sin coste: no llama a ninguna IA ni a la red.
 * - una columna clásica dice su formato, cuántos globos lleva y sus colores;
 * - una guirnalda orgánica dice sus tamaños (R-24, R-12, R-5) y sus partes;
 * - una referencia del dueño dice su ocasión (con la palabra bien escrita) y su fuente;
 * - una decoración de link-o-loon lista sus partes de LOL;
 * - la huella es estable entre corridas y cambia cuando cambian los datos (o la clasificación);
 * - la clasificación que se pasa entra al registro y a la ficha;
 * - TODO item de fábrica se extrae sin fallar, con la ficha dentro del tope de palabras (`--derivados` suma los indexados).
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, copiarItem, indexarEscena, type ItemBiblioteca } from "../../src/lib/globos3d/biblioteca";
import type { PiezaArmada } from "../../src/lib/globos3d/piezas";
import { contarPalabras, fichaDeItem, PALABRAS_MAX_FICHA, type RegistroTaller } from "../../src/lib/taller/fichas";

const cache = new Map<string, PiezaArmada>();
const itemDe = (id: string): ItemBiblioteca => {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === id);
  assert.ok(item, `existe el item ${id}`);
  return item;
};
const incluye = (r: RegistroTaller, ...trozos: string[]) => { for (const t of trozos) assert.ok(r.ficha.includes(t), `${r.id}: la ficha dice «${t}»\n${r.ficha}`); };

// ----------------------------------------------------------------------------------------------------------
// 1. Columna clásica: formato, cantidad y colores
// ----------------------------------------------------------------------------------------------------------

const columna = itemDe("celebra:columna_espiral_azul_dorada");
const rColumna = fichaDeItem(columna, { cache });
assert.deepEqual(rColumna.tiposPieza, ["columna"]);
assert.deepEqual(rColumna.formatos, ["R-12"]);
assert.equal(rColumna.globos, 92, "92 globos: 23 cuartetos de R-12");
assert.equal(rColumna.tubos, 0);
assert.equal(rColumna.lineasPartes.reduce((s, l) => s + l.cantidad, 0), 92, "las líneas de partes suman los globos");
assert.deepEqual(rColumna.colores.map((c) => c.codigo).sort(), ["540", "570"]);
assert.ok(rColumna.colores.some((c) => c.nombre === "Metal Azul"));
assert.ok(rColumna.medidas.altoCm > 400 && rColumna.medidas.anchoCm < 100, `columna alta y angosta: ${JSON.stringify(rColumna.medidas)}`);
assert.equal(rColumna.fuente?.tipo, "celebra");
incluye(rColumna, "columna", "R-12", "de 12 pulgadas", "92", "Metal Azul", "Metal Dorado", "540", "570", "trenza", "Mide unos 4,7 m de alto");
console.log("OK columna clásica");

// ----------------------------------------------------------------------------------------------------------
// 2. Guirnalda orgánica: tamaños y partes
// ----------------------------------------------------------------------------------------------------------

const guirnalda = fichaDeItem(itemDe("base-organica:guirnalda-marco-lila-plata"), { cache });
for (const f of ["R-24", "R-12", "R-5"]) assert.ok(guirnalda.formatos.includes(f), `guirnalda con ${f}`);
assert.ok(guirnalda.partes.length >= 1 && guirnalda.partes.every((p) => p.length > 0));
assert.equal(guirnalda.fuente?.tipo, "referencia-web");
incluye(guirnalda, "R-24 «de 24 pulgadas»", "R-12", "R-5", "guirnalda orgánica", "Por partes", `«${guirnalda.partes[0]}»`);
console.log("OK guirnalda orgánica");

// ----------------------------------------------------------------------------------------------------------
// 3. Referencia del dueño: ocasión y fuente
// ----------------------------------------------------------------------------------------------------------

const dueno = fichaDeItem(itemDe("referencia:dino-jungla-mesa"), { cache });
assert.deepEqual(dueno.ocasiones, ["cumpleanos", "fiesta-infantil"], "las ocasiones se guardan tal como están (ids de la taxonomía)");
assert.equal(dueno.fuente?.tipo, "referencia-dueno");
assert.equal(dueno.tipo, "escena");
incluye(dueno, "cumpleaños", "infantil", "dueño", "Pinterest", "Escena completa");
console.log("OK referencia del dueño");

// ----------------------------------------------------------------------------------------------------------
// 4. Decoración de link-o-loon: sus partes de LOL
// ----------------------------------------------------------------------------------------------------------

const escenaLol = itemDe("idea:flor-en-lol-3");
const flor = indexarEscena(escenaLol, undefined, cache).find((i) => i.id === "idea:flor-en-lol-3~flor");
assert.ok(flor && flor.tipo === "decoracion", "la flor de link-o-loon sale de indexar su escena");
const rFlor = fichaDeItem(flor, { cache });
assert.ok(rFlor.formatos.every((f) => f.startsWith("LOL-")), `solo link-o-loon: ${rFlor.formatos}`);
assert.ok(rFlor.partes.includes("petalos"));
assert.ok(rFlor.lineasPartes.every((l) => l.formatoId.startsWith("LOL-") && l.parte === "petalos" && l.cantidad > 0));
incluye(rFlor, "link-o-loon", "LOL-12", "petalos", "6 LOL-12");
const rEscenaLol = fichaDeItem(escenaLol, { cache });
assert.ok(rEscenaLol.formatos.some((f) => f.startsWith("LOL-")));
incluye(rEscenaLol, "link-o-loon");
console.log("OK decoración de link-o-loon");

// ----------------------------------------------------------------------------------------------------------
// 5. Huella estable y sensible a los datos; clasificación opcional
// ----------------------------------------------------------------------------------------------------------

const otraCorrida = fichaDeItem(columna, { cache: new Map() });
assert.equal(otraCorrida.hash, rColumna.hash, "la huella no depende del cache ni de la corrida");
assert.equal(otraCorrida.ficha, rColumna.ficha, "la ficha es determinista");
assert.deepEqual(JSON.parse(JSON.stringify(otraCorrida)), JSON.parse(JSON.stringify(rColumna)));
assert.match(rColumna.hash, /^[0-9a-f]{64}$/);

const cambiaNombre = fichaDeItem(copiarItem(columna, { nombre: "Otra columna" }), { cache });
assert.notEqual(cambiaNombre.hash, rColumna.hash, "cambia con el nombre");
const contenidoOtro = JSON.parse(JSON.stringify(columna.contenido).replaceAll('"540"', '"541"')) as ItemBiblioteca["contenido"];
assert.notEqual(JSON.stringify(contenidoOtro), JSON.stringify(columna.contenido), "el contenido de prueba sí cambió");
assert.notEqual(fichaDeItem(copiarItem(columna, { contenido: contenidoOtro }), { cache }).hash, rColumna.hash, "cambia con el contenido");

const clasificacion = { celebraciones: ["graduacion", "cumpleanos-adulto"], tematicas: ["elegante-lujo", "metalico-cromado"] };
const clasificada = fichaDeItem(columna, { cache, clasificacion });
assert.deepEqual(clasificada.clasificacion, clasificacion);
assert.equal(rColumna.clasificacion, null);
incluye(clasificada, "Celebraciones: Graduación, Cumpleaños adulto", "Temáticas: Elegante / lujo, Metálico / cromado");
assert.notEqual(clasificada.hash, rColumna.hash, "la clasificación cambia lo que se embebe");
const mismaEnOtroOrden = fichaDeItem(columna, { cache, clasificacion: { celebraciones: [...clasificacion.celebraciones].reverse(), tematicas: [...clasificacion.tematicas].reverse() } });
assert.equal(mismaEnOtroOrden.hash, clasificada.hash, "el orden de la clasificación no cambia la huella");
console.log("OK huella y clasificación");

// ----------------------------------------------------------------------------------------------------------
// 6. Todo item de fábrica se extrae
// ----------------------------------------------------------------------------------------------------------

const inicio = Date.now();
const items: ItemBiblioteca[] = [...BIBLIOTECA_FABRICA];
if (process.argv.includes("--derivados")) for (const e of BIBLIOTECA_FABRICA) if (e.tipo === "escena") items.push(...indexarEscena(e, undefined, cache));
const ids = new Set<string>();
let maxPalabras = 0;
for (const item of items) {
  const r = fichaDeItem(item, { cache });
  assert.ok(!ids.has(r.id), `id repetido: ${r.id}`);
  ids.add(r.id);
  const palabras = contarPalabras(r.ficha);
  maxPalabras = Math.max(maxPalabras, palabras);
  assert.ok(palabras >= 20 && palabras <= PALABRAS_MAX_FICHA, `${r.id}: ${palabras} palabras`);
  assert.match(r.hash, /^[0-9a-f]{64}$/, r.id);
  assert.ok(r.ficha.startsWith(r.nombre.replace(/[.]+$/, "")), `${r.id}: la ficha empieza por el nombre`);
  assert.equal(r.globos + r.tubos, r.lineasPartes.filter((l) => l.cantidad > 0).reduce((s, l) => s + l.cantidad, 0), `${r.id}: globos + tubos = suma de las líneas`);
}
console.log(`OK ${items.length} items extraídos sin fallar (hasta ${maxPalabras} palabras) en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
