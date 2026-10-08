/**
 * Clasificador por reglas (src/lib/taller/clasificar-items.ts): celebraciones y temáticas de cada item de la
 * biblioteca sin IA y sin red. Sin coste.
 *   npx tsx scripts/test/test-clasificar-reglas.ts
 * - las 13 referencias del dueño y varias ideas Sempertex conocidas salen con sus etiquetas esperadas;
 * - un color solo nunca dice qué se celebra (pastel ≠ baby shower, dorado ≠ boda); la única excepción es la regla
 *   estacional explícita (negro + naranja → Halloween), y solo si no hay otra celebración;
 * - una nota de armado con una sola mención no alcanza; las paletas y acabados no salen de las notas;
 * - lo que no tiene etiqueta confiable es «general»;
 * - clasificar no arma el contenido de nada (los items de fábrica son perezosos) y es rápido.
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, itemPerezoso, type ItemBiblioteca } from "../../src/lib/globos3d/biblioteca";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";
import { UMBRAL_CONFIANZA, clasificarPorReglas } from "../../src/lib/taller/clasificar-items";
import { celebracionPorId, tematicaPorId } from "../../src/lib/taller/taxonomia-celebraciones";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Un item sin contenido (si el clasificador lo pidiera, la prueba fallaría): solo lo que el clasificador lee. */
function item(nombre: string, o: { descripcion?: string; ocasiones?: string[]; fuente?: ItemBiblioteca["fuente"] } = {}): ItemBiblioteca {
  return itemPerezoso(
    { id: `prueba:${nombre}`, tipo: "escena", nombre, ocasiones: o.ocasiones ?? ["general"], ...(o.fuente ? { fuente: o.fuente } : {}) },
    o.descripcion ?? "",
    () => { throw new Error("el clasificador no debe armar el contenido"); },
  );
}

const porId = new Map(BIBLIOTECA_FABRICA.map((i) => [i.id, i]));
const dado = (id: string): ItemBiblioteca => { const i = porId.get(id); assert.ok(i, `no existe ${id} en la biblioteca de fábrica`); return i; };
const celebraciones = (i: ItemBiblioteca, c?: Parameters<typeof clasificarPorReglas>[1]) => clasificarPorReglas(i, c).celebraciones.map((x) => x.id);
const tematicas = (i: ItemBiblioteca, c?: Parameters<typeof clasificarPorReglas>[1]) => clasificarPorReglas(i, c).tematicas.map((x) => x.id);

console.log("Clasificador por reglas");

prueba("referencias del dueño: celebración y temática esperadas", () => {
  assert.equal(REFERENCIAS_DUENO.length, 13);
  const esperado: Record<string, { celebra: string[]; tema?: string[]; sinTema?: string[] }> = {
    "referencia:dino-jungla-mesa": { celebra: ["cumpleanos"], tema: ["dinosaurios"] },
    "referencia:dino-menta-mesa": { celebra: ["cumpleanos"], tema: ["dinosaurios"] },
    "referencia:happy-birthday-azul-dorado-redondo": { celebra: ["cumpleanos"] },
    "referencia:happy-birthday-lentejuelas-arco-asimetrico": { celebra: ["cumpleanos"] },
    "referencia:graduacion-columnas-uvas": { celebra: ["graduacion"] },
    "referencia:arcos-chiara-tropical": { celebra: ["cumpleanos"] },
    "referencia:portal-rojo-orbes": { celebra: ["cumpleanos"] },
    "referencia:guirnalda-love-monstera": { celebra: ["san-valentin", "boda"], tema: ["tropical-hawaiana"] },
    "referencia:guirnalda-diagonal-monstera": { celebra: ["san-valentin"], tema: ["tropical-hawaiana"] },
    "referencia:guirnalda-esquina-armario-palmas": { celebra: [], tema: ["tropical-hawaiana"] },
    "referencia:frozen-let-it-go": { celebra: ["cumpleanos"], tema: ["invierno"] },
    "referencia:guirnalda-feston-vino-rosa": { celebra: ["boda"] },
    "referencia:medio-arco-oro-rosa-confeti": { celebra: ["despedida", "boda"], tema: ["glam-dorado"] },
  };
  for (const r of REFERENCIAS_DUENO) {
    const e = esperado[r.id];
    assert.ok(e, `falta lo esperado de ${r.id}`);
    const c = celebraciones(dado(r.id));
    for (const id of e.celebra) assert.ok(c.includes(id), `${r.id}: debía llevar ${id}, salió ${JSON.stringify(c)}`);
    const t = tematicas(dado(r.id));
    for (const id of e.tema ?? []) assert.ok(t.includes(id), `${r.id}: debía llevar la temática ${id}, salió ${JSON.stringify(t)}`);
  }
});

prueba("ideas Sempertex conocidas: el nombre, las etiquetas de la tienda y las ocasiones curadas", () => {
  const caso = (id: string, celebra: string[], tema: string[] = []) => {
    const c = celebraciones(dado(id)), t = tematicas(dado(id));
    for (const x of celebra) assert.ok(c.includes(x), `${id}: debía llevar ${x}, salió ${JSON.stringify(c)}`);
    for (const x of tema) assert.ok(t.includes(x), `${id}: debía llevar la temática ${x}, salió ${JSON.stringify(t)}`);
  };
  caso("idea:arbol-halloween", ["halloween"]);
  caso("idea:arco-mis-15-anos", ["quince-anos"]);
  caso("idea:bouquet-sombrero-dia-del-padre", ["dia-del-padre"]);
  caso("idea:centro-de-mesa-pascua", ["pascua"]);
  caso("idea:arco-primera-comunion-1", ["primera-comunion"]);
  caso("idea:garland-grado", ["graduacion"]);
  caso("idea:arbol-de-navidad", ["navidad"]);
  caso("idea:la-pasion-del-futbol", ["mundial-futbol"], ["deportes"]);
  caso("idea:adivina-nino-o-nina-rosado-azul", ["baby-shower", "revelacion-genero"]);
  caso("idea:feliz-cumpleanos-fantasia-rosado-plata", ["cumpleanos"]);
  caso("idea:arco-sirenita", [], ["sirenas"]);
  caso("idea:arco-organico-tropical", [], ["tropical-hawaiana"]);
  caso("idea:reyes-magos-4", ["dia-de-reyes"]);
});

prueba("el motivo y la confianza acompañan a cada etiqueta", () => {
  const r = clasificarPorReglas(dado("idea:arco-mis-15-anos"));
  const q = r.celebraciones.find((x) => x.id === "quince-anos");
  assert.ok(q && q.confianza >= 0.85 && q.confianza <= 1 && q.motivo.length > 5, JSON.stringify(q));
  assert.deepEqual([...r.celebraciones].sort((a, b) => b.confianza - a.confianza || a.id.localeCompare(b.id)), r.celebraciones, "ordenadas por confianza");
});

prueba("un color solo no dice qué se celebra: pastel ≠ baby shower, dorado ≠ boda, rosa ≠ San Valentín", () => {
  const paletas: Array<[string, string[]]> = [
    ["Arco pastel rosa y celeste", ["rosa", "celeste"]],
    ["Columna pastel azul bebé", ["azul"]],
    ["Arco dorado y blanco", ["dorado", "blanco"]],
    ["Arco rosa y rojo", ["rosa", "rojo"]],
    ["Ramo rojo y verde", ["rojo", "verde"]],
    ["Guirnalda azul marino y dorado", ["azul", "dorado"]],
    ["Ramo negro y dorado", ["negro", "dorado"]],
    ["Ramo naranja y amarillo", ["naranja", "amarillo"]],
    ["Ramo negro y rosa", ["negro", "rosa"]],
    ["Arco morado y verde lima", ["morado", "verde"]],
  ];
  for (const [nombre, colores] of paletas) {
    assert.deepEqual(celebraciones(item(nombre), { colores }), [], `«${nombre}» no debe llevar celebración`);
  }
  // Ni siquiera la mezcla de las paletas: ninguna celebración sale de colores sueltos.
  assert.deepEqual(celebraciones(item("Arco"), { colores: ["rosa", "celeste", "dorado", "rojo", "verde", "azul", "blanco", "morado", "amarillo"] }), []);
});

prueba("regla estacional explícita: negro + naranja (+ morado) → Halloween, y solo así", () => {
  const sola = clasificarPorReglas(item("Arco"), { colores: ["negro", "naranja"] });
  assert.deepEqual(sola.celebraciones.map((x) => x.id), ["halloween"]);
  assert.ok(sola.celebraciones[0]!.confianza >= UMBRAL_CONFIANZA && sola.celebraciones[0]!.confianza < 0.7, "confianza moderada");
  assert.match(sola.celebraciones[0]!.motivo, /estacional/);
  const conMorado = clasificarPorReglas(item("Arco"), { colores: ["negro", "naranja", "morado"] });
  assert.ok(conMorado.celebraciones[0]!.confianza > sola.celebraciones[0]!.confianza, "con morado, más segura");
  assert.deepEqual(celebraciones(item("Arco negro y naranja")), ["halloween"], "también si los colores vienen en el nombre");
  assert.deepEqual(celebraciones(item("Arco negro y violeta")), [], "negro + morado sin naranja no es la regla");
  assert.deepEqual(celebraciones(item("Arco naranja"), { colores: ["naranja"] }), []);
  // Si el item ya tiene una celebración, el color no añade otra.
  assert.deepEqual(celebraciones(item("Arco negro y naranja", { ocasiones: ["cumpleanos"] })), ["cumpleanos"]);
  assert.deepEqual(celebraciones(item("Arco negro y naranja de Navidad")), ["navidad"]);
});

prueba("las palabras ambiguas son pistas débiles: una no alcanza, dos distintas sí", () => {
  assert.deepEqual(celebraciones(item("Calabaza")), [], "una calabaza sola no asegura Halloween");
  assert.deepEqual(celebraciones(item("Mamá")), [], "«mamá» sola no es el Día de la Madre");
  const dos = clasificarPorReglas(item("Fantasma con calabaza"));
  assert.ok(dos.celebraciones.some((x) => x.id === "halloween" && x.confianza >= UMBRAL_CONFIANZA && x.confianza < 0.8), JSON.stringify(dos.celebraciones));
  assert.deepEqual(celebraciones(item("Feliz día mamá")), ["dia-de-la-madre"]);
});

prueba("la descripción es una nota de armado: una mención no alcanza, dos sí; las paletas no salen de ahí", () => {
  const nota = (d: string) => item("Arco de globos", { descripcion: d });
  assert.deepEqual(tematicas(nota("Lleva una flor de globos sobre el arco.")), [], "una sola mención de «flor»");
  assert.deepEqual(tematicas(nota("Globos metalizados, pastel mate y neón con acabado cristal.")), [], "acabados del globo no son temática");
  assert.deepEqual(tematicas(nota("Colores durazno, naranja y mango.")), [], "colores que se llaman como frutas");
  assert.ok(tematicas(nota("Lleva un dinosaurio y un t-rex sobre la mesa.")).includes("dinosaurios"), "dos menciones distintas");
  assert.ok(celebraciones(nota("Es un baby shower: ideal para un shower de bebé.")).includes("baby-shower"), "dos términos distintos de lo mismo");
  assert.deepEqual(celebraciones(nota("Se parece a un cumpleaños.")), [], "una mención en la nota no alcanza");
});

prueba("nombre y ocasiones curadas mandan; las ocasiones viejas se leen con los ids nuevos", () => {
  assert.deepEqual(celebraciones(item("Arco Mis XV años")), ["quince-anos"]);
  assert.deepEqual(celebraciones(item("Columna", { ocasiones: ["cumpleaños", "grado"] })).sort(), ["cumpleanos", "graduacion"]);
  assert.deepEqual(celebraciones(item("Columna", { ocasiones: ["bautizo y comunión"] })).sort(), ["bautizo", "primera-comunion"]);
  const web = clasificarPorReglas(item("Arco", { ocasiones: ["cumpleanos"], fuente: { tipo: "referencia-web", titulo: "Sitio de un decorador" } }));
  assert.ok(web.celebraciones[0]!.confianza < 0.7, "una foto de internet no confirma qué se celebra");
  assert.deepEqual(clasificarPorReglas(item("Arco", { ocasiones: ["infantil"] })).celebraciones.map((x) => x.id), ["fiesta-infantil"]);
});

prueba("personajes con licencia: solo pista de lectura hacia una temática genérica", () => {
  assert.deepEqual(tematicas(item("Guirnalda Frozen azul")), ["invierno"]);
  assert.deepEqual(tematicas(item("Wonder Woman")), ["superheroes"]);
  assert.equal(tematicaPorId("frozen"), undefined);
});

prueba("sin etiqueta confiable → general", () => {
  for (const nombre of ["Columna en franjas alternando tamaños", "Racimo", "Arco azul, arena y dorado", "Servilletas"]) {
    const r = clasificarPorReglas(item(nombre));
    assert.equal(r.general, true, `«${nombre}» debía ser general: ${JSON.stringify(r)}`);
    assert.deepEqual(r.celebraciones, []);
    assert.deepEqual(r.tematicas, []);
  }
  const con = clasificarPorReglas(item("Arco de dinosaurios"));
  assert.equal(con.general, false, "con una temática ya no es general");
  assert.deepEqual(con.celebraciones, []);
});

prueba("toda la biblioteca de fábrica: ids válidos, confianza en rango, sin armar contenido y rápido", () => {
  const t0 = Date.now();
  let conCelebracion = 0, conTematica = 0, generales = 0;
  for (const i of BIBLIOTECA_FABRICA) {
    const r = clasificarPorReglas(i);
    for (const c of r.celebraciones) {
      assert.ok(celebracionPorId(c.id), `${i.id}: celebración desconocida ${c.id}`);
      assert.ok(c.confianza >= UMBRAL_CONFIANZA && c.confianza <= 1 && c.motivo.length > 0, `${i.id}: ${JSON.stringify(c)}`);
      // Solo el color explícito de la regla estacional puede sacar una celebración de los colores.
      if (/color/.test(c.motivo)) assert.equal(c.id, "halloween", `${i.id}: «${c.id}» salió de un color`);
    }
    for (const t of r.tematicas) {
      assert.ok(tematicaPorId(t.id), `${i.id}: temática desconocida ${t.id}`);
      assert.ok(t.confianza >= UMBRAL_CONFIANZA && t.confianza <= 1 && t.motivo.length > 0, `${i.id}: ${JSON.stringify(t)}`);
    }
    assert.equal(r.general, r.celebraciones.length === 0 && r.tematicas.length === 0, `${i.id}: general incoherente`);
    if (r.celebraciones.length) conCelebracion += 1;
    if (r.tematicas.length) conTematica += 1;
    if (r.general) generales += 1;
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `clasificar toda la biblioteca tardó ${ms} ms`);
  assert.ok(conCelebracion > BIBLIOTECA_FABRICA.length * 0.5, `pocas celebraciones: ${conCelebracion}`);
  assert.ok(conTematica > BIBLIOTECA_FABRICA.length * 0.3, `pocas temáticas: ${conTematica}`);
  assert.ok(generales < BIBLIOTECA_FABRICA.length * 0.3, `demasiados generales: ${generales}`);
  console.log(`    ${BIBLIOTECA_FABRICA.length} items en ${ms} ms · celebración ${conCelebracion} · temática ${conTematica} · general ${generales}`);
});

console.log(`\n${pruebas} pruebas OK`);
