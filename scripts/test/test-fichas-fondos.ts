/**
 * Las fichas de mobiliario y escenografía para el RAG del taller (`src/lib/catalogo/fichas-fondos.ts`, REQ-013 fase 3, T14). Sin
 * coste: ni IA ni red ni base.
 * - una ficha por entrada de cada repositorio (mobiliario 26 + 2 generadores, escenografía 25), en su orden, con su clase por tipo;
 * - cada ficha entre 80 y 250 palabras, con lo que se busca: nombre, para qué sirve, medidas, puestos, sinónimos (sin el sustantivo
 *   genérico de su nombre ni lo que nombra una estructura de globos), procedencia y repositorio; los generadores, todos sus tipos y
 *   sin medida; ni globos ni la tienda Sempertex en la ficha ni en la descripción (no la acerca a las búsquedas de globos);
 * - determinista: dos corridas dan lo mismo; la huella es única por id y no lleva el campo `repositorio`;
 * - el JSONL que escribe el extractor lo lee el indexador sin errores, con su repositorio, y solo con `--permitir-otros-repos`;
 * - ninguna ficha de Sempertex sale por aquí;
 * - el oro del catálogo (`oro-busqueda-catalogo.json`, T18) está bien formado y cita solo ids de estas fichas.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-fichas-fondos.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASIGNACION_FONDOS } from "../../src/lib/catalogo/asignacion-fondos";
import { fichaDeEntradaFondo, fichasDeRepositorio, sinGlobos, VERSION_FICHA_FONDOS, type RegistroFondo } from "../../src/lib/catalogo/fichas-fondos";
import { repositorioDeIdLocal } from "../../src/lib/catalogo/indice";
import { repositorio } from "../../src/lib/catalogo/registro";
import { NOMBRE_MESA, TIPOS_MESA, TIPOS_SILLA } from "../../src/lib/globos3d/mobiliario-conjunto-tipos";
import { SILLAS } from "../../src/lib/globos3d/mobiliario-sillas-param";
import { contarPalabras, PALABRAS_MAX_FICHA, PALABRAS_MIN_FICHA } from "../../src/lib/taller/fichas";
import { idsDelOro, leerOro } from "../../src/lib/taller/evaluar-oro";
import { erroresDeCorrida, leerFichasJsonl } from "../../src/lib/taller/indice";

let casos = 0;
const ok = (nombre: string) => { casos += 1; console.log(`ok ${casos} - ${nombre}`); };

const mobiliario = fichasDeRepositorio("mobiliario");
const escenografia = fichasDeRepositorio("escenografia");
const todas = [...mobiliario, ...escenografia];
const ficha = (id: string): RegistroFondo => {
  const r = todas.find((x) => x.id === id);
  assert.ok(r, `hay ficha de ${id}`);
  return r;
};
const dice = (id: string, ...trozos: string[]) => { const r = ficha(id); for (const t of trozos) assert.ok(r.ficha.includes(t), `${id}: la ficha dice «${t}»\n${r.ficha}`); };

// 1. Una por entrada, en el orden del repositorio.
{
  assert.equal(mobiliario.length, 28, "mobiliario: 26 del catálogo + 2 generadores");
  assert.equal(escenografia.length, 25);
  for (const [id, fichas] of [["mobiliario", mobiliario], ["escenografia", escenografia]] as const) {
    const entradas = repositorio(id)!.entradas();
    assert.deepEqual(fichas.map((f) => f.id), entradas.map((e) => e.idLocal), `${id}: los ids locales, en su orden`);
    assert.deepEqual(fichas.map((f) => f.tipo), entradas.map((e) => e.clase), `${id}: el tipo es la clase`);
    assert.ok(fichas.every((f) => f.repositorio === id && repositorioDeIdLocal(f.id) === id), `${id}: cada id es de su repositorio y de ningún otro`);
  }
  assert.equal(new Set(todas.map((f) => f.id)).size, ASIGNACION_FONDOS.size, "todo lo asignado tiene ficha, sin repetir");
  assert.deepEqual([...new Set(mobiliario.map((f) => f.tipo))].sort(), ["generador", "mueble", "mueble-fijo"]);
  assert.deepEqual([...new Set(escenografia.map((f) => f.tipo))].sort(), ["decorado", "fondo"]);
  ok("una ficha por entrada (28 + 25), en el orden del repositorio, con su clase por tipo");
}

// 2. El texto: dentro del tope y con lo que se busca.
{
  for (const r of todas) {
    const palabras = contarPalabras(r.ficha);
    assert.ok(palabras >= PALABRAS_MIN_FICHA && palabras <= PALABRAS_MAX_FICHA, `${r.id}: ${palabras} palabras`);
    assert.ok(r.ficha.startsWith(`${r.nombre}.`), `${r.id}: empieza por su nombre`);
    assert.ok(r.ficha.includes(r.repositorio === "mobiliario" ? "Del repositorio Mobiliario." : "Del repositorio Escenografía."), `${r.id}: nombra su repositorio`);
    assert.ok(r.ficha.includes("Modelo paramétrico del taller, no un producto de la tienda."), `${r.id}: su procedencia`);
    assert.doesNotMatch(`${r.ficha} ${r.descripcion}`, /glob|sempertex/i, `${r.id}: ni globos ni Sempertex, tampoco en la descripción`);
    assert.equal(r.globos + r.tubos, 0);
    assert.deepEqual([r.formatos, r.colores, r.partes, r.lineasPartes, r.productos], [[], [], [], [], []], `${r.id}: nada de globos ni tienda`);
    assert.equal(r.fuente?.tipo, "propio");
  }
  dice("silla_tiffany", "chiavari", "dorada", "Colores en orden: 1 estructura, 2 cojín", "Mide unos 90 cm de alto", "cuenta como un puesto", "«silla chiavari dorada»");
  for (const generico of ["«silla»", "«sillas»"]) assert.ok(!ficha("silla_tiffany").ficha.includes(generico), `silla_tiffany: sin el genérico ${generico}`);
  // Lo que nombra una estructura de globos (el glosario lo lee como arco, aro, columna, pared, letras… o es círculo, hexágono, marco).
  const ESTRUCTURAS: Array<[string, string[]]> = [
    ["columna_griega", ["«columna»", "«pilar»", "«columna romana»"]], ["panel_redondo", ["«circulo»", "«panel circulo»", "«backdrop redondo»"]],
    ["arcos_chiara", ["«arco chiavari»", "«arcos escalonados»"]], ["aro_metalico", ["«aro dorado»"]], ["arco_metalico", ["«arco de metal»"]],
    ["lentejuelas", ["«pared shimmer»"]], ["aro_hexagonal", ["«hexagono»", "«marco hexagonal»"]], ["rotulo_acrilico", ["«letras acrilico»"]],
  ];
  for (const [id, dichos] of ESTRUCTURAS) for (const d of dichos) assert.ok(!ficha(id).ficha.includes(d), `${id}: sin ${d}, que nombra una estructura de globos`);
  dice("lentejuelas", "«shimmer wall»");
  assert.equal(sinGlobos("Aro dorado (fondo circular para globos o flores)."), "Aro dorado (fondo circular para flores).");
  assert.equal(sinGlobos("Arco con patines (para cubrir de globos o flores)."), "Arco con patines (para cubrir de flores).");
  assert.equal(ficha("aro_metalico").descripcion, sinGlobos(repositorio("escenografia")!.porIdLocal("aro_metalico")!.descripcion), "la descripción del registro, sin globos");
  dice("mesa_imperial_sillas", "Trae 10 sillas de partida y admite de 4 a 20: una en cada cabecera");
  dice("panel_redondo", "telón", "«panel circular»", "Admite un nombre o un texto en cursiva", "Great Vibes");
  dice("cortina_flecos", "«cortina tinsel»", "«fringe curtain»", "Se cuelga en la pared del fondo");
  assert.ok(!ficha("cortina_flecos").ficha.includes("«cortina de flecos»"), "su nombre no se repite como sinónimo");
  dice("rotulo_acrilico", "por defecto «", "de hasta 3 líneas", "Acabados: espejo o mate", "Va en el aire, a 115 cm del piso");
  dice("base_pastel", "Va encima de una mesa");
  dice("tapete_redondo", "Mide unos 2 m de ancho y 1,6 m de fondo.", "Se pone tal como viene");
  assert.ok(!ficha("silla_tiffany").ficha.includes("Al ponerlo en la escena"), "la explicación de la clase solo en la ficha que queda corta");
  assert.ok(!ficha("tapete_redondo").ficha.includes("Great Vibes"), "la atribución de la fuente solo en lo que lleva texto");
  assert.deepEqual(ficha("silla_tiffany").medidas, { altoCm: 90, anchoCm: 44, fondoCm: 44 }, "las de la pieza armada");
  for (const t of TIPOS_MESA) dice("mesa_param", NOMBRE_MESA[t].toLowerCase());
  for (const t of TIPOS_SILLA) dice("sillas_param", SILLAS[t].plural);
  assert.equal(ficha("mesa_param").medidas, null, "un generador no tiene medida de partida: NULL, no ceros que pasan cualquier filtro");
  ok("80–250 palabras, con nombre, uso, medidas, puestos, sinónimos, texto, procedencia y repositorio; sin globos ni Sempertex");
}

// 3. Determinista, con huella única. Como en la biblioteca, el campo `repositorio` no entra en ella (el texto sí lo nombra).
{
  assert.deepEqual([...fichasDeRepositorio("mobiliario"), ...fichasDeRepositorio("escenografia")], todas, "dos corridas, lo mismo");
  assert.equal(new Set(todas.map((r) => r.hash)).size, todas.length, "una huella por ficha");
  for (const r of todas) {
    const datos: Partial<RegistroFondo> = { ...r };
    delete datos.hash;
    delete datos.repositorio;
    assert.equal(r.hash, createHash("sha256").update(JSON.stringify({ v: VERSION_FICHA_FONDOS, ...datos })).digest("hex"), `${r.id}: la huella cubre lo que alimenta la ficha, sin el campo repositorio`);
  }
  ok("determinista; huella sha256 única por ficha, sin el campo repositorio");
}

// 4. Lo que escribe el extractor lo lee el indexador, y solo indexa con permiso.
{
  for (const [id, fichas] of [["mobiliario", mobiliario], ["escenografia", escenografia]] as const) {
    const { registros, errores } = leerFichasJsonl(`${fichas.map((r) => JSON.stringify(r)).join("\n")}\n`);
    assert.deepEqual(errores, []);
    assert.deepEqual(registros.map((r) => [r.id, r.repositorio, r.tipo, r.hash, r.ficha]), fichas.map((r) => [r.id, id, r.tipo, r.hash, r.ficha]));
    assert.deepEqual(registros[0]!.medidas, fichas[0]!.medidas);
    for (const r of registros.filter((x) => x.tipo === "generador")) assert.deepEqual(r.medidas, { altoCm: null, anchoCm: null, fondoCm: null }, `${r.id}: sin medida llega NULL al índice`);
    assert.deepEqual(erroresDeCorrida({ registros, erroresLectura: [], repositorio: id, permitirOtros: true }), []);
    assert.match(erroresDeCorrida({ registros, erroresLectura: [], repositorio: id, permitirOtros: false }).join(), /--permitir-otros-repos/);
    assert.match(erroresDeCorrida({ registros, erroresLectura: [], repositorio: "sempertex", permitirOtros: true }).join(), /no son de «sempertex»/, "nunca en la corrida de Sempertex");
  }
  ok("el JSONL del extractor lo lee el indexador con su repositorio; indexarlo exige --permitir-otros-repos");
}

// 5. Solo mobiliario y escenografía.
{
  const deSempertex = repositorio("sempertex")!.entradas()[0]!;
  assert.throws(() => fichaDeEntradaFondo(deSempertex), /no es una entrada de mobiliario ni de escenografía/);
  ok("una entrada de Sempertex no tiene ficha de fondos (la biblioteca usa fichaDeItem)");
}

// 6. El oro del catálogo (T18): bien formado, ids de estas fichas, sin chocar con los oros de Sempertex.
{
  const fixtures = path.resolve(__dirname, "fixtures");
  const leer = (archivo: string) => leerOro(JSON.parse(readFileSync(path.join(fixtures, archivo), "utf8")));
  const oro = leer("oro-busqueda-catalogo.json");
  assert.ok(oro.consultas.length >= 15, "al menos 15 consultas");
  assert.equal(new Set(oro.consultas.map((c) => c.texto)).size, oro.consultas.length, "textos únicos");
  const deSempertex = new Set([...leer("oro-busqueda-taller.json").consultas, ...leer("oro-busqueda-taller-holdout.json").consultas].map((c) => c.id));
  assert.deepEqual(oro.consultas.map((c) => c.id).filter((id) => deSempertex.has(id)), [], "ids de consulta que no chocan con los de Sempertex");
  const conocidos = new Set(todas.map((f) => f.id));
  assert.deepEqual(idsDelOro(oro).filter((id) => !conocidos.has(id)), [], "solo ids de mobiliario y escenografía");
  assert.ok(oro.consultas.every((c) => c.relevantes.some((r) => r.grado === 2)), "cada consulta con al menos un exacto");
  for (const repo of ["mobiliario", "escenografia"] as const) assert.ok(oro.consultas.some((c) => c.relevantes.some((r) => r.grado === 2 && ficha(r.id).repositorio === repo)), `cubre ${repo}`);
  ok(`el oro del catálogo: ${oro.consultas.length} consultas, solo ids de estas fichas, sin chocar con los de Sempertex`);
}

console.log(`\n${casos} casos ok`);
