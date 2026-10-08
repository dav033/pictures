/**
 * Taxonomía de celebraciones y temáticas del taller (src/lib/taller/taxonomia-celebraciones.ts). Sin coste: no llama
 * a ninguna IA ni a la red.
 *   npx tsx scripts/test/test-taxonomia-celebraciones.ts
 * - ids únicos, ascii y estables; cada entrada con nombre, inglés, grupo y sinónimos;
 * - ningún término nombra a dos ids del mismo eje, y cada término se resuelve a SU id y a ningún otro;
 * - faltas de ortografía, formas sin tildes y frases en inglés como las escribe el dueño;
 * - el más largo gana («cumpleaños infantil» no suma «cumpleaños»), solo palabras completas;
 * - sin marcas ni personajes con licencia (ni como categoría ni como sinónimo);
 * - los ids viejos de la biblioteca (`cumpleanos`/`cumpleaños`, `grado`/`graduacion`…) migran a los nuevos.
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, filtrarBiblioteca, validarItem } from "../../src/lib/globos3d/biblioteca";
import {
  CELEBRACIONES, EQUIVALENCIA_EXTERNA, IDS_OCASION, NOMBRE_GRUPO_CELEBRACION, NOMBRE_GRUPO_TEMATICA, OCASION_GENERAL, TEMATICAS,
  canonicalizarOcasiones, celebracionPorId, celebracionesDeTexto, idCelebracionCanonico, idsCelebracionCanonicos, nombreOcasion, normalizar,
  tematicaPorId, tematicasDeTexto, terminosDe, terminosRepetidos, type EntradaTaxonomia,
} from "../../src/lib/taller/taxonomia-celebraciones";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ids = (r: ReadonlyArray<{ id: string }>) => r.map((x) => x.id);
const celebra = (t: string) => ids(celebracionesDeTexto(t));
const tema = (t: string) => ids(tematicasDeTexto(t));

/** Marcas y personajes con licencia que NO pueden aparecer en la taxonomía (como palabras completas). */
const MARCAS = [
  "disney", "pixar", "frozen", "elsa", "marvel", "avengers", "vengadores", "batman", "superman", "spiderman", "spider man", "mickey", "minnie",
  "barbie", "hello kitty", "pokemon", "paw patrol", "peppa", "mario", "sonic", "star wars", "harry potter", "moana", "encanto", "bluey",
  "cocomelon", "baby shark", "minecraft", "fortnite", "roblox", "fifa", "coca cola", "lego", "toy story", "shrek", "minions", "stitch",
  "wonder woman", "netflix", "spotify", "coachella", "tomorrowland", "lollapalooza", "stetson", "mcdonald", "nfl", "jurassic", "amazon",
];

console.log("Taxonomía de celebraciones y temáticas");

prueba("tamaño: más de 60 celebraciones y unas 50 temáticas, cada una con sinónimos", () => {
  assert.ok(CELEBRACIONES.length >= 60, `celebraciones: ${CELEBRACIONES.length}`);
  assert.ok(TEMATICAS.length >= 45, `temáticas: ${TEMATICAS.length}`);
  for (const e of [...CELEBRACIONES, ...TEMATICAS]) assert.ok(e.sinonimos.length >= 4, `${e.id}: pocos sinónimos (${e.sinonimos.length})`);
});

prueba("ids únicos por eje, ascii y con forma de slug; nombre, inglés y grupo válidos", () => {
  for (const [eje, lista, grupos] of [["celebraciones", CELEBRACIONES, NOMBRE_GRUPO_CELEBRACION], ["temáticas", TEMATICAS, NOMBRE_GRUPO_TEMATICA]] as const) {
    const vistos = new Set<string>();
    for (const e of lista as readonly EntradaTaxonomia<string>[]) {
      assert.match(e.id, SLUG, `${eje}: id «${e.id}» no es un slug ascii`);
      assert.ok(!vistos.has(e.id), `${eje}: id repetido «${e.id}»`);
      vistos.add(e.id);
      assert.ok(e.nombre.trim() && e.en.trim(), `${e.id}: nombre e inglés`);
      assert.ok(e.grupo in grupos, `${e.id}: grupo «${e.grupo}» desconocido`);
    }
  }
  assert.ok(!IDS_OCASION.slice(1).includes(OCASION_GENERAL), "«general» no es una celebración");
  assert.equal(IDS_OCASION[0], OCASION_GENERAL);
});

prueba("ningún término nombra a dos ids del mismo eje", () => {
  assert.deepEqual(terminosRepetidos("celebraciones"), []);
  assert.deepEqual(terminosRepetidos("tematicas"), []);
});

prueba("cada término de cada celebración se resuelve a su id y a ningún otro", () => {
  const fallos: string[] = [];
  for (const e of CELEBRACIONES) {
    const { fuertes, debiles } = terminosDe(e);
    for (const t of [...fuertes, ...debiles]) {
      const r = celebracionesDeTexto(t);
      if (r.length !== 1 || r[0]!.id !== e.id) fallos.push(`«${t}» (${e.id}) → ${JSON.stringify(r.map((x) => x.id))}`);
    }
  }
  assert.deepEqual(fallos, []);
});

prueba("cada término de cada temática se resuelve a su id y a ningún otro", () => {
  const fallos: string[] = [];
  for (const e of TEMATICAS) {
    const { fuertes, debiles } = terminosDe(e);
    for (const t of [...fuertes, ...debiles]) {
      const r = tematicasDeTexto(t);
      if (r.length !== 1 || r[0]!.id !== e.id) fallos.push(`«${t}» (${e.id}) → ${JSON.stringify(r.map((x) => x.id))}`);
    }
  }
  assert.deepEqual(fallos, []);
});

prueba("como lo escribe el dueño: sin tildes, mayúsculas, guiones y espacios", () => {
  assert.deepEqual(celebra("Día de la Madre"), ["dia-de-la-madre"]);
  assert.deepEqual(celebra("DIA DE LA MADRE"), ["dia-de-la-madre"]);
  assert.deepEqual(celebra("graduación"), ["graduacion"]);
  assert.deepEqual(celebra("graduacion"), ["graduacion"]);
  assert.deepEqual(celebra("revelación de sexo"), ["revelacion-genero"]);
  assert.deepEqual(celebra("revelacion de sexo"), ["revelacion-genero"]);
  assert.deepEqual(celebra("año nuevo"), ["ano-nuevo"]);
  assert.deepEqual(celebra("ano nuevo"), ["ano-nuevo"]);
  assert.deepEqual(celebra("san-valentín"), ["san-valentin"]);
  assert.deepEqual(celebra("15años"), ["quince-anos"]);
  assert.deepEqual(celebra("mis XV"), ["quince-anos"]);
  assert.deepEqual(celebra("Mi Primera Comunión"), ["primera-comunion"]);
});

prueba("faltas de ortografía frecuentes", () => {
  assert.deepEqual(celebra("jalouin"), ["halloween"]);
  assert.deepEqual(celebra("haloween"), ["halloween"]);
  assert.deepEqual(celebra("babyshower"), ["baby-shower"]);
  assert.deepEqual(celebra("cumpleanios"), ["cumpleanos"]);
  assert.deepEqual(celebra("cumpleaño"), ["cumpleanos"]);
  assert.deepEqual(celebra("quinceañera"), ["quince-anos"]);
  assert.deepEqual(celebra("quinceanera"), ["quince-anos"]);
  assert.deepEqual(celebra("san balentin"), ["san-valentin"]);
  assert.deepEqual(celebra("bautiso"), ["bautizo"]);
  assert.deepEqual(celebra("graduasion"), ["graduacion"]);
  assert.deepEqual(celebra("inaguracion"), ["inauguracion"]);
  assert.deepEqual(celebra("navidd"), ["navidad"]);
});

prueba("frases en inglés y mezcla de idiomas", () => {
  assert.deepEqual(celebra("baby shower"), ["baby-shower"]);
  assert.deepEqual(celebra("sweet 16"), ["sweet-sixteen"]);
  assert.deepEqual(celebra("sweet sixteen party"), ["sweet-sixteen"]);
  assert.deepEqual(celebra("gender reveal party"), ["revelacion-genero"]);
  assert.deepEqual(celebra("graduation party"), ["graduacion"]);
  assert.deepEqual(celebra("bachelorette party"), ["despedida-soltera"]);
  assert.deepEqual(celebra("bridal shower"), ["bridal-shower"]);
  assert.deepEqual(celebra("Happy Birthday"), ["cumpleanos"]);
  assert.deepEqual(celebra("mother's day"), ["dia-de-la-madre"]);
  assert.deepEqual(celebra("grand opening"), ["inauguracion"]);
  assert.deepEqual(celebra("Fourth of July party"), ["cuatro-de-julio"]);
  assert.deepEqual(celebra("quince"), ["quince-anos"]);
  assert.deepEqual(tema("mermaid party"), ["sirenas"]);
  assert.deepEqual(tema("jungle safari"), ["safari-jungla"]);
  assert.deepEqual(tema("unicorn"), ["unicornio"]);
});

prueba("el término más largo gana y no suma el corto", () => {
  assert.deepEqual(celebra("cumpleaños infantil"), ["cumpleanos-infantil"]);
  assert.deepEqual(celebra("primer cumpleaños"), ["primer-cumpleanos"]);
  assert.deepEqual(celebra("bodas de oro"), ["bodas-plata-oro"]);
  assert.deepEqual(celebra("despedida de soltera"), ["despedida-soltera"]);
  assert.deepEqual(celebra("graduación de preescolar"), ["graduacion-preescolar"]);
  assert.deepEqual(celebra("aniversario de la empresa"), ["aniversario-empresa"]);
  assert.deepEqual(celebra("fiesta de cumpleaños infantil"), ["cumpleanos-infantil"]);
  assert.deepEqual(celebra("papá noel"), ["navidad"]);
  assert.deepEqual(celebra("año nuevo chino"), ["ano-nuevo-chino"]);
});

prueba("varias celebraciones y varias temáticas en una misma frase", () => {
  assert.deepEqual(celebra("Cumpleaños de dinosaurios y baby shower").sort(), ["baby-shower", "cumpleanos"]);
  assert.deepEqual(tema("cumpleaños de dinosaurios con flores").sort(), ["dinosaurios", "flores-jardin"]);
  assert.deepEqual(celebra("Mis XV años tropical"), ["quince-anos"]);
  assert.deepEqual(tema("Mis XV años tropical"), ["tropical-hawaiana"]);
});

prueba("solo palabras completas y plurales simples", () => {
  assert.deepEqual(celebra("gradiente de colores"), []);
  assert.deepEqual(celebra("armada de globos"), []);
  assert.deepEqual(celebra("abodado"), []);
  assert.deepEqual(celebra("globos"), []);
  assert.deepEqual(tema("dinosauriosaurio"), []);
  assert.deepEqual(celebra("graduaciones"), ["graduacion"]);
  assert.deepEqual(celebra("bautizos"), ["bautizo"]);
  assert.deepEqual(tema("unicornios"), ["unicornio"]);
});

prueba("pistas débiles: se marcan y no pisan a las fuertes", () => {
  const mama = celebracionesDeTexto("mi mamá y yo");
  assert.ok(mama.some((c) => c.id === "dia-de-la-madre" && c.debil), "«mamá» solo es pista débil");
  const fuerte = celebracionesDeTexto("feliz día mamá");
  assert.deepEqual(fuerte.map((c) => [c.id, c.debil]), [["dia-de-la-madre", false]]);
  assert.ok(celebracionesDeTexto("calabaza").every((c) => c.debil), "una calabaza sola no asegura Halloween");
});

prueba("el dato de salida trae el término de la taxonomía que casó", () => {
  const r = celebracionesDeTexto("Mis quince años de unicornios");
  assert.equal(r.length, 1);
  assert.equal(r[0]!.id, "quince-anos");
  assert.equal(normalizar(r[0]!.termino), "mis quince anos");
  assert.deepEqual(tematicasDeTexto("Mis quince años de unicornios").map((t) => t.id), ["unicornio"]);
});

prueba("sin marcas ni personajes con licencia (ni como categoría ni como sinónimo)", () => {
  const todos = [...CELEBRACIONES, ...TEMATICAS];
  const frases = todos.flatMap((e) => [e.id.replace(/-/g, " "), e.nombre, e.en, ...e.sinonimos, ...(e.ambiguos ?? [])]).map((t) => ` ${normalizar(t)} `);
  for (const marca of MARCAS) {
    const m = ` ${normalizar(marca)} `;
    const hit = frases.find((f) => f.includes(m));
    assert.equal(hit, undefined, `«${marca}» aparece en la taxonomía: ${hit}`);
  }
  // Lo que el cliente nombra con una marca se describe aquí con la temática genérica.
  assert.deepEqual(tema("princesas"), ["princesas"]);
  assert.deepEqual(tema("superhéroes"), ["superheroes"]);
  assert.deepEqual(tema("invierno"), ["invierno"]);
});

prueba("las celebraciones y las temáticas son ejes independientes", () => {
  for (const c of CELEBRACIONES) assert.equal(tematicaPorId(c.id), undefined, `${c.id} está en los dos ejes`);
  for (const t of TEMATICAS) assert.equal(celebracionPorId(t.id), undefined, `${t.id} está en los dos ejes`);
  assert.deepEqual(celebra("dinosaurios"), []);
  assert.deepEqual(tema("cumpleaños"), []);
});

prueba("ids viejos de la biblioteca → ids de la taxonomía (P-012)", () => {
  assert.equal(idCelebracionCanonico("cumpleanos"), "cumpleanos");
  assert.equal(idCelebracionCanonico("cumpleaños"), "cumpleanos");
  assert.equal(idCelebracionCanonico("grado"), "graduacion");
  assert.equal(idCelebracionCanonico("graduacion"), "graduacion");
  assert.equal(idCelebracionCanonico("graduación"), "graduacion");
  assert.equal(idCelebracionCanonico("quince años"), "quince-anos");
  assert.equal(idCelebracionCanonico("baby shower"), "baby-shower");
  assert.equal(idCelebracionCanonico("día de la madre"), "dia-de-la-madre");
  assert.equal(idCelebracionCanonico("año nuevo"), "ano-nuevo");
  assert.equal(idCelebracionCanonico("amor"), "san-valentin");
  assert.equal(idCelebracionCanonico("infantil"), "fiesta-infantil");
  assert.equal(idCelebracionCanonico("verano"), "fiesta-verano");
  assert.equal(idCelebracionCanonico("halloween"), "halloween");
  assert.equal(idCelebracionCanonico("navidad"), "navidad");
  assert.equal(idCelebracionCanonico("boda"), "boda");
  assert.equal(idCelebracionCanonico("general"), OCASION_GENERAL);
  assert.equal(idCelebracionCanonico("elegante"), null, "«elegante» era una temática, no una celebración");
  assert.equal(idCelebracionCanonico("cosa inventada"), null);
  assert.equal(idCelebracionCanonico(""), null);
  assert.deepEqual(idsCelebracionCanonicos("bautizo y comunión"), ["bautizo", "primera-comunion"]);
});

prueba("un id nuevo se reconoce a sí mismo (migrar dos veces no cambia nada)", () => {
  for (const c of CELEBRACIONES) assert.equal(idCelebracionCanonico(c.id), c.id, `${c.id} no se reconoce a sí mismo`);
  const viejas = ["cumpleaños", "grado", "bautizo y comunión", "elegante"];
  assert.deepEqual(canonicalizarOcasiones(canonicalizarOcasiones(viejas)), canonicalizarOcasiones(viejas));
});

prueba("canonicalizarOcasiones: sin repetidos, descarta lo desconocido y nunca queda vacío", () => {
  assert.deepEqual(canonicalizarOcasiones(["cumpleaños", "cumpleanos", "infantil", "general"]), ["cumpleanos", "fiesta-infantil", "general"]);
  assert.deepEqual(canonicalizarOcasiones(["grado", "graduacion"]), ["graduacion"]);
  assert.deepEqual(canonicalizarOcasiones(["elegante"]), ["general"]);
  assert.deepEqual(canonicalizarOcasiones([]), ["general"]);
});

prueba("nombres para mostrar de las ocasiones guardadas", () => {
  assert.equal(nombreOcasion("quince-anos"), "Quince años (quinceañera)");
  assert.equal(nombreOcasion("general"), "General");
  assert.equal(nombreOcasion("algo-viejo"), "algo-viejo");
});

prueba("equivalencias con otros vocabularios (catálogo, asistente guiado) apuntan a ids que existen", () => {
  for (const [externo, id] of Object.entries(EQUIVALENCIA_EXTERNA)) assert.ok(celebracionPorId(id), `${externo} → ${id} no existe`);
  assert.equal(EQUIVALENCIA_EXTERNA["xv_anos"], "quince-anos");
  assert.equal(idCelebracionCanonico("xv_anos"), "quince-anos");
  assert.equal(idCelebracionCanonico("baby_shower"), "baby-shower");
});

prueba("lo guardado en el navegador con ids viejos se migra al leerlo (validarItem) y los filtros viejos siguen sirviendo", () => {
  const base = BIBLIOTECA_FABRICA.find((i) => i.tipo === "decoracion" && i.contenido.tipo === "pieza");
  assert.ok(base);
  const guardado = JSON.parse(JSON.stringify({ ...base, propio: true, ocasiones: ["cumpleaños", "grado", "bautizo y comunión", "elegante", "infantil"] })) as unknown;
  const leido = validarItem(guardado);
  assert.ok(leido, "el item guardado sigue siendo válido");
  assert.deepEqual(leido.ocasiones, ["cumpleanos", "graduacion", "bautizo", "primera-comunion", "fiesta-infantil"]);
  assert.deepEqual(validarItem({ ...(guardado as object), ocasiones: ["elegante"] })?.ocasiones, ["general"], "lo que ya no es una celebración queda como general");
  assert.equal(validarItem({ ...(guardado as object), ocasiones: [3] }), null, "ocasiones que no son texto siguen descartando el item");
  for (const filtro of ["cumpleaños", "cumpleanos", "grado", "graduacion", "infantil"]) {
    assert.deepEqual(filtrarBiblioteca([leido], new Map(), { ocasion: filtro }).length, 1, `el filtro viejo «${filtro}» debía seguir sirviendo`);
  }
  assert.equal(filtrarBiblioteca([leido], new Map(), { ocasion: "halloween" }).length, 0);
  assert.equal(filtrarBiblioteca([leido], new Map(), { texto: "quinceañera" }).length, 0);
  assert.equal(filtrarBiblioteca([leido], new Map(), { texto: "graduación" }).length, 1, "el texto busca por el nombre de la celebración");
});

const terminos = [...CELEBRACIONES, ...TEMATICAS].reduce((n, e) => n + 2 + e.sinonimos.length + (e.ambiguos?.length ?? 0), 0);
console.log(`\n${pruebas} pruebas OK · ${CELEBRACIONES.length} celebraciones, ${TEMATICAS.length} temáticas, ${terminos} términos`);
