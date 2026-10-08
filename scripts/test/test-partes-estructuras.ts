/**
 * **Partes de las estructuras en toda la biblioteca** (regla del dueño: toda decoración y estructura está hecha de un
 * tipo de globo o de un producto, y la IA tiene que poder apuntar a «los Link-O-Loon de las ramas», «los R-24», «el
 * tronco del árbol» sin tocar lo demás). Sin coste: no llama a ninguna IA ni a la red; arma TODO (lento: minutos).
 *
 * Arma cada pieza de cada item de la biblioteca de fábrica (escenas predefinidas, Celebra, ideas de Sempertex, bases
 * orgánicas, referencias del dueño, utilería), más las formas básicas y el catálogo de murales/techo/árboles, y por
 * cada globo y tubito de una ESTRUCTURA exige:
 * - formato conocido y color que se fabrica en ese formato;
 * - `parte` puesta y del vocabulario de `partes-estructuras.ts`.
 * Utilería y metalizados: cada uno declara su producto de la tienda o se dice genérico. La escenografía de montaje
 * (paneles, mesas, tapete) no es producto: se cuenta aparte. Las decoraciones pequeñas (flores, figuras…) solo se
 * informan (su vocabulario es de otro módulo).
 * `--informe`: imprime el informe y no falla. `--ruido`: imprime cada pieza al armarla.
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, type ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { armarPieza, type Pieza, type PiezaArmada } from "@/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { esParteEstructura, parteDeTramo, PARTES_ESTRUCTURA, tramosDeParte } from "@/lib/globos3d/partes-estructuras";
import { IDEAS_FORMAS, FORMAS_BASICAS } from "@/lib/globos3d/ideas-formas";
import { piezasMuralTechoArbol } from "@/lib/globos3d/catalogo-murales-techo-arboles";
import { PIEZAS_NUEVAS, piezaNueva } from "@/lib/globos3d/escenas-presets";

const INFORME = process.argv.includes("--informe");
const RUIDO = process.argv.includes("--ruido");

// El vocabulario: sin repetidos, cada parte con su descripción y cómo se dice en inglés; nombres bien formados.
const ids = PARTES_ESTRUCTURA.map((p) => p.id);
assert.equal(new Set(ids).size, ids.length, "partes sin repetir");
for (const p of PARTES_ESTRUCTURA) {
  assert.match(p.id, /^[a-z]+(\/[a-z]+)*$/, `«${p.id}»: minúsculas sin tildes, con «/»`);
  assert.ok(p.descripcion.length > 10 && p.en.length > 0, `«${p.id}»: descripción y sinónimos en inglés`);
  if (p.id.includes("/")) assert.ok(ids.includes(p.id.split("/")[0]!), `«${p.id}»: su parte de arriba está en el vocabulario`);
}
for (const bien of ["trenza", "pata/izquierda", "columna/derecha/relleno", "copa/frutas", "copa/acento", "racimo/3", "letras/a", "letras/ñ", "trenza/grande", "fleco/racimo"]) assert.ok(esParteEstructura(bien), bien);
for (const mal of ["", "petalos", "pata/roja", "letras/ab", "Trenza", "tramo-merlot"]) assert.ok(!esParteEstructura(mal), mal);
// Los tramos orgánicos: los ids libres de los datos a palabras de oficio (los ids no se renombran).
const tramo = (id: string, nombre = "") => parteDeTramo({ id, nombre });
assert.equal(tramo("pata_izquierda"), "pata/izquierda");
assert.equal(tramo("semiarco_derecho"), "semiarco/derecha");
assert.equal(tramo("columna_izquierda"), "columna/izquierda");
assert.equal(tramo("espiral_derecha"), "espiral/derecha");
assert.equal(tramo("anillo_exterior"), "anillo/exterior");
assert.equal(tramo("racimo_3"), "racimo/3");
assert.equal(tramo("racimo_abajo_derecha"), "racimo/abajo/derecha");
assert.equal(tramo("abajo_derecha", "Montículo de abajo a la derecha"), "monticulo/abajo/derecha");
assert.equal(tramo("orquidea", "Columna Orquídea Morada"), "columna");
assert.equal(tramo("pie_derecho", "Pie derecho"), "base/derecha");
assert.equal(tramo("tramo-merlot-arriba", "Aro: tramo Merlot de arriba"), "marco/arriba");
assert.equal(tramo("tramo-merlot", "Arco orgánico: tramo Merlot"), "arco");
assert.equal(tramo("naval", "Naval"), "guirnalda");
assert.equal(tramo("columna", "Columna"), "columna");
assert.equal(parteDeTramo({ id: "columna" }, true), "columna/relleno");
for (const id of ["pata_izquierda", "abajo_derecha", "naval", "racimo_3", "tramo-crema"]) assert.ok(esParteEstructura(tramo(id)), id);
assert.deepEqual(tramosDeParte([{ id: "pata_izquierda" }, { id: "pata_derecha" }, { id: "clave" }], "pata"), ["pata_izquierda", "pata_derecha"]);
assert.deepEqual(tramosDeParte([{ id: "pata_izquierda" }, { id: "pata_derecha" }], "pata/derecha/relleno"), ["pata_derecha"]);

type Fuente = { donde: string; pieza: Pieza };

function piezasDeItem(item: ItemBiblioteca): Fuente[] {
  const c = item.contenido;
  if (c.tipo === "escena") return c.escena.nodos.map((n) => ({ donde: `${item.id} › ${n.nombre}`, pieza: n.pieza }));
  if (c.tipo === "conjunto") return [{ donde: `${item.id} › ${c.conjunto.raiz.nombre}`, pieza: c.conjunto.raiz.pieza }, ...c.conjunto.hijos.map((h) => ({ donde: `${item.id} › ${h.nombre}`, pieza: h.pieza }))];
  return [{ donde: `${item.id} › ${c.nombre}`, pieza: c.pieza }];
}

const fuentes: Fuente[] = [];
for (const item of BIBLIOTECA_FABRICA) fuentes.push(...piezasDeItem(item));
for (const f of [...IDEAS_FORMAS, ...FORMAS_BASICAS]) fuentes.push({ donde: `forma:${f.slug}`, pieza: f.pieza });
for (const p of piezasMuralTechoArbol()) fuentes.push({ donde: `mural-techo-arbol:${p.id}`, pieza: p.pieza });
for (const p of PIEZAS_NUEVAS) fuentes.push({ donde: `nueva:${p.id}`, pieza: piezaNueva(p.id).pieza });

// Sin repetir: la misma pieza (mismo JSON) se arma una vez y se informa con su primer lugar.
const unicas = new Map<string, Fuente & { veces: number }>();
for (const f of fuentes) {
  const k = JSON.stringify(f.pieza);
  const previa = unicas.get(k);
  if (previa) previa.veces += 1; else unicas.set(k, { ...f, veces: 1 });
}
console.log(`${fuentes.length} piezas en la biblioteca, ${unicas.size} distintas. Armando…`);

const ES_DECORACION = new Set<Pieza["tipo"]>(["decoracion"]);
const coloresPorFormato = new Map<string, Set<string>>();
const seFabrica = (formatoId: string, codigo: string) => {
  let s = coloresPorFormato.get(formatoId);
  if (!s) coloresPorFormato.set(formatoId, s = new Set(coloresDelFormato(formatoId).map((r) => r.codigo)));
  return s.has(codigo);
};

type Cuenta = { piezas: number; elementos: number; conParte: number; enVocabulario: number; partes: Map<string, number> };
const porTipo = new Map<string, Cuenta>();
const cuenta = (tipo: string) => porTipo.get(tipo) ?? (porTipo.set(tipo, { piezas: 0, elementos: 0, conParte: 0, enVocabulario: 0, partes: new Map() }).get(tipo)!);
const fallos: string[] = [];
const fallo = (m: string) => { if (fallos.length < 4000) fallos.push(m); };
/** Formato o color que no existe; `decoracion`: solo sale en decoraciones (de otro módulo: se informa, no falla). */
const datosMalos = new Map<string, { donde: string[]; decoracion: boolean }>();
const datoMalo = (m: string, donde: string, decoracion: boolean) => {
  const d = datosMalos.get(m) ?? { donde: [], decoracion: true };
  if (d.donde.length < 3) d.donde.push(donde);
  d.decoracion &&= decoracion;
  datosMalos.set(m, d);
};
let escenografiaMontaje = 0, utileria = 0, utileriaGenerica = 0, metalizados = 0, metalizadosGenericos = 0;

const inicio = Date.now();
let n = 0;
for (const f of unicas.values()) {
  n += 1;
  if (RUIDO || n % 50 === 0) console.log(`  ${n}/${unicas.size} (${Math.round((Date.now() - inicio) / 1000)} s) ${f.donde}`);
  let armada: PiezaArmada;
  try { armada = armarPieza(f.pieza); } catch (e) { fallo(`${f.donde}: no se arma (${(e as Error).message})`); continue; }
  const tipo = f.pieza.tipo === "escenografia" ? (f.pieza.utileria ? "utileria" : "escenografia") : f.pieza.tipo;
  const c = cuenta(tipo);
  c.piezas += 1;
  // Productos: utilería y metalizados dicen su producto (o que es genérico).
  if (f.pieza.tipo === "escenografia") {
    if (!f.pieza.utileria) escenografiaMontaje += 1;
    else {
      utileria += 1;
      const ps = f.pieza.productos ?? [];
      if (!ps.length) fallo(`${f.donde}: utilería sin producto`);
      if (ps.some((p) => p.generico)) utileriaGenerica += 1;
      for (const p of ps) if (!p.generico && !p.url.startsWith("/products/")) fallo(`${f.donde}: producto sin url de la tienda (${p.nombre})`);
    }
  }
  if (f.pieza.tipo === "metalizado") {
    metalizados += 1;
    const ps = armada.productos ?? [];
    if (!ps.length) fallo(`${f.donde}: metalizado sin producto (${JSON.stringify(f.pieza.metalizado.forma)} ${f.pieza.metalizado.color})`);
    if (ps.some((p) => p.generico)) metalizadosGenericos += 1;
    for (const p of ps) if (!p.generico && !p.url.startsWith("/products/")) fallo(`${f.donde}: metalizado con url que no es de la tienda (${p.nombre})`);
  }
  const elementos = [...armada.globos, ...armada.tubos.filter((t) => !t.papel)];
  for (const e of elementos) {
    c.elementos += 1;
    if (e.parte) { c.conParte += 1; c.partes.set(e.parte, (c.partes.get(e.parte) ?? 0) + 1); }
    const valida = e.parte !== undefined && esParteEstructura(e.parte);
    if (valida) c.enVocabulario += 1;
    const formato = formatoPorId(e.formatoId);
    const decoracion = ES_DECORACION.has(f.pieza.tipo);
    if (!formato) datoMalo(`formato desconocido ${e.formatoId}`, f.donde, decoracion);
    else if (!seFabrica(e.formatoId, e.codigo)) datoMalo(`${e.formatoId} ${e.codigo} no se fabrica`, f.donde, decoracion);
    if (decoracion) continue;
    if (!e.parte) fallo(`${f.donde} (${tipo}): ${e.formatoId} ${e.codigo} sin parte`);
    else if (!valida) fallo(`${f.donde} (${tipo}): parte «${e.parte}» fuera del vocabulario`);
  }
}

console.log(`\nArmado en ${Math.round((Date.now() - inicio) / 1000)} s.\n\nCobertura de partes (elementos con parte / del vocabulario / total):`);
const filas = [...porTipo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
let totE = 0, totP = 0, totV = 0;
for (const [tipo, c] of filas) {
  const decoracion = ES_DECORACION.has(tipo as Pieza["tipo"]);
  if (!decoracion) { totE += c.elementos; totP += c.conParte; totV += c.enVocabulario; }
  const pct = c.elementos ? Math.round((100 * c.enVocabulario) / c.elementos) : 100;
  const partes = [...c.partes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([p, k]) => `${p}×${k}`).join(", ");
  console.log(`  ${tipo.padEnd(14)} ${String(c.piezas).padStart(4)} piezas  ${String(c.conParte).padStart(7)}/${String(c.enVocabulario).padStart(7)}/${String(c.elementos).padStart(7)}  ${String(pct).padStart(3)} %${decoracion ? "  (decoración: solo informe)" : ""}${partes ? `\n${" ".repeat(18)}${partes}` : ""}`);
}
console.log(`  ESTRUCTURAS: ${totV}/${totE} en vocabulario (${totE ? Math.round((1000 * totV) / totE) / 10 : 100} %), ${totP} con parte.`);
console.log(`\nProductos: utilería ${utileria} (${utileriaGenerica} con algo genérico), metalizados ${metalizados} (${metalizadosGenericos} genéricos), escenografía de montaje (no es producto) ${escenografiaMontaje}.`);
if (datosMalos.size) {
  console.log(`\nDatos con formato o color que no existe (${datosMalos.size}):`);
  for (const [m, d] of datosMalos) console.log(`  ${m} — ${d.donde.join(" | ")}${d.decoracion ? " (solo en decoraciones: de otro módulo, se informa)" : ""}`);
}
if (fallos.length) {
  // Agrupados por mensaje sin el lugar, para leerlos.
  const grupos = new Map<string, { n: number; ejemplo: string }>();
  for (const m of fallos) { const k = m.replace(/^.*?: /, ""); const g = grupos.get(k) ?? { n: 0, ejemplo: m }; g.n += 1; grupos.set(k, g); }
  console.log(`\nFallos (${fallos.length}, ${grupos.size} distintos):`);
  for (const [, g] of [...grupos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log(`  ×${g.n} ${g.ejemplo}`);
}
if (!INFORME) {
  assert.deepEqual([...datosMalos.entries()].filter(([, d]) => !d.decoracion).map(([m]) => m), [], "todo globo de estructura es de un formato que existe y de un color que se fabrica en él");
  assert.equal(fallos.length, 0, "todo globo de estructura lleva su parte del vocabulario; utilería y metalizados, su producto");
  console.log("\ntest-partes-estructuras: OK");
}
