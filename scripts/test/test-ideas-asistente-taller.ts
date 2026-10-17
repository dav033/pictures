/**
 * D-038/D-039: las ideas de la vista guiada que el motor 3D arma están en el Taller 3D, en «Añadir → Ideas → Ideas del asistente»,
 * con la misma geometría que el motor arma para el cliente y el mismo precio que su tarjeta «¿Cuánto cuesta?». Sin red, sin base,
 * sin IA: Python se sustituye por el doble que cotiza con los paquetes del cruce.
 * 1. `escenas.json` es lo que el motor arma hoy (si cambia el motor, `VERSION_MOTOR` o los planes guardados, se regenera con
 *    `scripts/biblioteca/precomputar-escenas-ideas-asistente.ts`), y qué ideas no están en el Taller y por qué está dicho aquí.
 * 2. Cada idea que el motor arma está en la biblioteca de fábrica del Taller, de Sempertex, con la escena del motor; las demás no.
 *    Dos ideas que arman la misma escena no se juntan en una sola (la biblioteca junta lo igual): cada idea del carrusel está en el Taller.
 * 3. Abierta en la escena del Taller («Abrir en Escena») o añadida a una vacía («Añadir a mi escena»), la lista de globos es la
 *    del motor y el «Precio en la tienda» da el mismo total, al peso, que la tarjeta de la vista guiada para esa idea.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-ideas-asistente-taller.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { repositorioDeItem } from "../../src/lib/catalogo/indice";
import { BIBLIOTECA_FABRICA, claveContenido, copiarItem, escenaDeItem, indexarEscena, insertarEnEscena, unirBiblioteca } from "../../src/lib/globos3d/biblioteca";
import { SALA_INICIAL, armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { esIdeaDelAsistente, GRUPO_IDEAS_ASISTENTE, IDEAS_ASISTENTE, PREFIJO_IDEA_ASISTENTE, separarIdeasDelAsistente } from "../../src/lib/globos3d/ideas-asistente";
import { crosswalkIncluido, VERSION_MOTOR } from "../../src/lib/globos3d/motor/v1";
import { costearDecoracion } from "../../src/lib/guiada-motor/costear-idea";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { construirEscenasDeIdeas, RUTA_ESCENAS_IDEAS_ASISTENTE, textoDelArchivo } from "../biblioteca/precomputar-escenas-ideas-asistente";
import { dependenciasDeLaTarjeta, totalDelTaller } from "../lib/precio-tarjeta-taller";

const cruce = crosswalkIncluido();
const pesos = (valor: number): string => valor.toLocaleString("es-CO");

async function main(): Promise<void> {
  // 1. El archivo es lo que el motor arma hoy, y lo que queda fuera está dicho.
  const { archivo, fuera } = construirEscenasDeIdeas();
  assert.equal(readFileSync(RUTA_ESCENAS_IDEAS_ASISTENTE, "utf8").replace(/\r\n/g, "\n"), textoDelArchivo(archivo), "escenas.json está al día (regenéralo con scripts/biblioteca/precomputar-escenas-ideas-asistente.ts)");
  const deLasIdeas = decoracionesSempertex.map((d) => d.id);
  assert.equal(deLasIdeas.length, 46, "las 46 ideas del carrusel");
  assert.equal(Object.keys(archivo.ideas).length + fuera.length, 46, "cada idea o está en el Taller o está dicho por qué no");
  const sinPlan = deLasIdeas.filter((id) => planGuardadoDeIdea(id) === null);
  assert.deepEqual(fuera.filter((f) => /^sin plan guardado/.test(f.razon)).map((f) => f.ideaId).sort(), [...sinPlan].sort(), "fuera del Taller: las 18 ideas sin plan guardado (su lista curada no trae geometría)");
  assert.equal(sinPlan.length, 18);
  assert.deepEqual(fuera.filter((f) => !/^sin plan guardado/.test(f.razon)).map((f) => f.ideaId), ["deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", "deco-real-27-aro-navideno-verde-salvia", "deco-real-30-columna-balon-futbol"], "fuera del Taller: las 3 que el motor no arma (centro de mesa con bouquet, aro parcial y figura de fútbol)");
  assert.ok(fuera.every((f) => !/la escena del Taller no lleva/.test(f.razon)), "ninguna idea que el motor arma se queda fuera por lista distinta en el Taller");
  assert.equal(Object.keys(archivo.ideas).length, 25);
  assert.equal(archivo.motor, VERSION_MOTOR, "las escenas son de esta versión del motor");
  console.log(`[PASS] escenas.json al día: ${Object.keys(archivo.ideas).length} ideas en el Taller; ${fuera.length} fuera (${sinPlan.length} sin plan guardado, ${fuera.length - sinPlan.length} que el motor no arma)`);

  // 2. Están en la biblioteca de fábrica, de Sempertex, con la escena del motor.
  assert.equal(IDEAS_ASISTENTE.length, 25);
  const porId = new Map(BIBLIOTECA_FABRICA.map((item) => [item.id, item]));
  assert.equal(porId.size, BIBLIOTECA_FABRICA.length, "ningún id repetido en la biblioteca");
  for (const [ideaId, datos] of Object.entries(archivo.ideas)) {
    const item = porId.get(`${PREFIJO_IDEA_ASISTENTE}${ideaId}`);
    assert.ok(item, `${ideaId}: está en la biblioteca del Taller`);
    assert.deepEqual([item.tipo, item.nombre, repositorioDeItem(item)], ["escena", datos.titulo, "sempertex"], `${ideaId}: una escena de Sempertex con el nombre de la tarjeta`);
    assert.ok(item.ocasiones.length > 0 && item.descripcion.includes("motor 3D") && !/precio/i.test(item.descripcion), `${ideaId}: ocasiones y descripción`);
    assert.equal(item.contenido.tipo, "escena");
    if (item.contenido.tipo === "escena") assert.deepEqual(JSON.parse(JSON.stringify(item.contenido.escena)), datos.escena, `${ideaId}: la escena es la que arma el motor`);
  }
  for (const { ideaId } of fuera) assert.equal(porId.has(`${PREFIJO_IDEA_ASISTENTE}${ideaId}`), false, `${ideaId}: no se ofrece lo que el Taller no puede armar`);
  const ideas = BIBLIOTECA_FABRICA.filter((item) => item.tipo === "escena");
  const { delAsistente, resto } = separarIdeasDelAsistente(ideas);
  assert.deepEqual(delAsistente.map((item) => item.id), IDEAS_ASISTENTE.map((idea) => idea.id), `el grupo «${GRUPO_IDEAS_ASISTENTE}» son sus 25 ideas, en orden`);
  assert.equal(resto.length + delAsistente.length, ideas.length);
  const primera = porId.get(IDEAS_ASISTENTE[0]!.id)!;
  const gemela = copiarItem(primera, { id: `${PREFIJO_IDEA_ASISTENTE}gemela` });
  const propia = copiarItem(primera, { id: "propio:gemela" });
  assert.equal(unirBiblioteca([primera, gemela], new Map()).length, 2, "dos ideas del asistente con la misma escena siguen siendo dos");
  assert.equal(unirBiblioteca([propia, copiarItem(primera, { id: "propio:otra" })], new Map()).length, 1, "lo demás se junta como siempre");
  const derivadas = unirBiblioteca([primera, gemela], new Map([primera, gemela].map((idea) => [idea.id, indexarEscena(idea)] as const))).filter((item) => item.derivado);
  assert.ok(derivadas.length > 0 && new Set(derivadas.map((item) => claveContenido(item.contenido))).size === derivadas.length, "lo que sale de dos ideas con la misma escena (su arco, su columna…) sí se junta");
  assert.ok(IDEAS_ASISTENTE.every((idea) => esIdeaDelAsistente(idea.id)));
  console.log(`[PASS] las ${delAsistente.length} ideas están en la biblioteca del Taller (de ${BIBLIOTECA_FABRICA.length} items), de Sempertex y con la escena del motor`);

  // 3. Abiertas o añadidas en el Taller, su lista de globos y su precio son los de la tarjeta.
  const filas: string[] = [];
  for (const idea of IDEAS_ASISTENTE) {
    const item = porId.get(idea.id)!;
    const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
    const { escena } = insertarEnEscena(vacia, item);
    const globosDelTaller = armarEscena(escena).materiales;
    assert.deepEqual(armarEscena(escenaDeItem(item)).materiales, globosDelTaller, `${idea.ideaId}: «Abrir en Escena» y «Añadir a mi escena» llevan los mismos globos`);
    const tarjeta = await costearDecoracion({ id: idea.ideaId, materiales: [] }, "personal", dependenciasDeLaTarjeta(cruce));
    assert.equal(tarjeta.decision.usar, "motor", `${idea.ideaId}: la tarjeta cotiza con el motor`);
    const delTaller = await totalDelTaller(globosDelTaller, cruce);
    assert.equal(delTaller, tarjeta.cotizacion?.total, `${idea.ideaId}: «Precio en la tienda» del Taller ${pesos(delTaller)}, tarjeta ${pesos(tarjeta.cotizacion?.total ?? 0)}`);
    filas.push(`${idea.ideaId.slice(0, 40)} ${pesos(delTaller)}`);
  }
  console.log(`[PASS] ${filas.length} ideas: el «Precio en la tienda» del Taller, con la idea abierta o añadida a una escena vacía, es el de la tarjeta al peso`);
  console.log(filas.map((fila) => `  ${fila}`).join("\n"));
  console.log("\ntest-ideas-asistente-taller: ok");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
