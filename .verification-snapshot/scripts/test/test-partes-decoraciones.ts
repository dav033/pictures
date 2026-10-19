/**
 * **Partes de las decoraciones** (regla del dueño: toda decoración está hecha de un tipo de globo o de un producto, y la
 * IA tiene que poder apuntar a «los Link-O-Loon de las ramas» o «los R-24» sin tocar lo demás). Sin coste: no llama a
 * ninguna IA ni a la red.
 *
 * Arma todas las decoraciones que el taller conoce y revisa cada globo y cada tubito:
 * - las predefinidas (`DECORACIONES_PREDEFINIDAS`: flores, moños, estrellas, Halloween, figuras, rizos, burbujas, racimos);
 * - las del catálogo Celebra (`CATALOGO_DECORACIONES`) que son decoración;
 * - las de la biblioteca de fábrica (ideas de sempertex.com, referencias del dueño, escenas de partida): los items de
 *   tipo «decoracion» y las piezas «decoracion» que van dentro de sus escenas y conjuntos.
 * Para cada globo y tubito de látex: el formato existe (`formatoPorId`), el color se fabrica en ese formato
 * (`coloresDelFormato`) y la `parte` está puesta y es del vocabulario (`partes-decoraciones.ts`). Lo de papel solo
 * necesita la parte. Imprime la cobertura por tipo de decoración antes de fallar.
 *
 * Run: npx tsx scripts/test/test-partes-decoraciones.ts [--sin-biblioteca] [--detalle]
 */
import assert from "node:assert/strict";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, type Decoracion } from "@/lib/globos3d/figuras";
import { CATALOGO_DECORACIONES } from "@/lib/globos3d/catalogo-fotos";
import { BIBLIOTECA_FABRICA } from "@/lib/globos3d/biblioteca";
import { armarPieza, type Pieza } from "@/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { PARTES_DECORACIONES, esParteDecoracion } from "@/lib/globos3d/partes-decoraciones";
import type { GloboDecoracion, TuboDecoracion } from "@/lib/globos3d/decoraciones";
import { contar, type SelectorGlobos } from "@/lib/globos3d/partes-globos";

const SIN_BIBLIOTECA = process.argv.includes("--sin-biblioteca");
const DETALLE = process.argv.includes("--detalle");

type Revisada = { fuente: string; tipo: string; globos: readonly GloboDecoracion[]; tubos: readonly TuboDecoracion[] };

const revisadas: Revisada[] = [];
const vistos = new Set<string>();

function agregar(fuente: string, tipo: string, armado: { globos: readonly GloboDecoracion[]; tubos: readonly TuboDecoracion[] }, clave: string) {
  if (vistos.has(clave)) return;
  vistos.add(clave);
  revisadas.push({ fuente, tipo, globos: armado.globos, tubos: armado.tubos });
}

function deDecoracion(fuente: string, d: Decoracion) {
  agregar(fuente, d.tipo, armarDecoracion(d), JSON.stringify(d));
}

/** Una pieza de clase «decoración» (la decoración o el globo suelto), por `armarPieza` (como la arma la escena). */
function dePieza(fuente: string, p: Pieza) {
  if (p.tipo === "decoracion") agregar(fuente, p.decoracion.tipo, armarPieza(p), JSON.stringify(p));
  else if (p.tipo === "globo") agregar(fuente, "globo_suelto", armarPieza(p), JSON.stringify(p));
}

const t0 = Date.now();
for (const d of DECORACIONES_PREDEFINIDAS) deDecoracion(`predefinida:${d.id}`, d.decoracion);
for (const d of CATALOGO_DECORACIONES) dePieza(`celebra:${d.id}`, d.pieza);

let itemsBiblioteca = 0;
if (!SIN_BIBLIOTECA) {
  for (const item of BIBLIOTECA_FABRICA) {
    if (item.tipo !== "decoracion" && item.tipo !== "escena" && item.tipo !== "conjunto") continue;
    const c = item.contenido;
    itemsBiblioteca += 1;
    if (c.tipo === "pieza") dePieza(item.id, c.pieza);
    else if (c.tipo === "escena") for (const n of c.escena.nodos) dePieza(`${item.id} › ${n.nombre}`, n.pieza);
    else {
      dePieza(`${item.id} › ${c.conjunto.raiz.nombre}`, c.conjunto.raiz.pieza);
      for (const n of c.conjunto.hijos) dePieza(`${item.id} › ${n.nombre}`, n.pieza);
    }
  }
}

// ----- Revisión
type Fila = { piezas: number; elementos: number; sinParte: number; parteDesconocida: number; formato: number; color: number };
const porTipo = new Map<string, Fila>();
const problemas = new Map<string, string[]>();
const anotar = (tipo: string, que: string, fuente: string) => {
  const clave = `${tipo} · ${que}`;
  const lista = problemas.get(clave) ?? [];
  if (lista.length < 4 && !lista.includes(fuente)) lista.push(fuente);
  problemas.set(clave, lista);
};

for (const r of revisadas) {
  const fila = porTipo.get(r.tipo) ?? { piezas: 0, elementos: 0, sinParte: 0, parteDesconocida: 0, formato: 0, color: 0 };
  fila.piezas += 1;
  const revisar = (e: { formatoId: string; codigo: string; parte?: string }, papel: boolean) => {
    fila.elementos += 1;
    if (!e.parte) { fila.sinParte += 1; anotar(r.tipo, `sin parte (${e.formatoId})`, r.fuente); }
    else if (!esParteDecoracion(e.parte)) { fila.parteDesconocida += 1; anotar(r.tipo, `parte «${e.parte}» fuera del vocabulario`, r.fuente); }
    if (papel) return;
    if (!formatoPorId(e.formatoId)) { fila.formato += 1; anotar(r.tipo, `formato ${e.formatoId} no existe`, r.fuente); return; }
    if (!coloresDelFormato(e.formatoId).some((c) => c.codigo === e.codigo)) { fila.color += 1; anotar(r.tipo, `color ${e.codigo} no se fabrica en ${e.formatoId}`, r.fuente); }
  };
  for (const g of r.globos) revisar(g, false);
  for (const t of r.tubos) revisar(t, Boolean(t.papel));
  porTipo.set(r.tipo, fila);
}

const filas = [...porTipo.entries()].sort((a, b) => b[1].sinParte - a[1].sinParte || a[0].localeCompare(b[0]));
const total = filas.reduce((s, [, f]) => ({ e: s.e + f.elementos, sp: s.sp + f.sinParte, pd: s.pd + f.parteDesconocida, fo: s.fo + f.formato, co: s.co + f.color }), { e: 0, sp: 0, pd: 0, fo: 0, co: 0 });
console.log(`Decoraciones revisadas: ${revisadas.length} (${itemsBiblioteca} items de la biblioteca) en ${((Date.now() - t0) / 1000).toFixed(1)} s; vocabulario: ${PARTES_DECORACIONES.length} partes.`);
console.log("tipo".padEnd(18), "piezas".padStart(6), "elementos".padStart(9), "sin parte".padStart(9), "fuera voc.".padStart(10), "formato".padStart(7), "color".padStart(5));
for (const [tipo, f] of filas) console.log(tipo.padEnd(18), String(f.piezas).padStart(6), String(f.elementos).padStart(9), String(f.sinParte).padStart(9), String(f.parteDesconocida).padStart(10), String(f.formato).padStart(7), String(f.color).padStart(5));
const cobertura = total.e ? (100 * (total.e - total.sp)) / total.e : 100;
console.log(`TOTAL: ${total.e} globos y tubitos; sin parte ${total.sp} (cobertura ${cobertura.toFixed(1)} %); fuera del vocabulario ${total.pd}; formato inválido ${total.fo}; color inválido ${total.co}.`);
if (problemas.size) {
  console.log("Problemas (hasta 4 fuentes por problema):");
  for (const [que, fuentes] of [...problemas.entries()].slice(0, DETALLE ? Infinity : 40)) console.log(`  - ${que}: ${fuentes.join("; ")}`);
}

// ----- Que cada parte sea la que es (no basta con que esté puesta): conteos en predefinidas conocidas
const armadaDe = (id: string) => {
  const d = DECORACIONES_PREDEFINIDAS.find((x) => x.id === id);
  assert.ok(d, `falta la predefinida ${id}`);
  return armarPieza({ tipo: "decoracion", decoracion: d.decoracion });
};
const cuantos = (id: string, s: SelectorGlobos) => contar(armadaDe(id), s);
assert.equal(cuantos("flor5", { partes: ["petalos"] }), 5, "flor5: 5 pétalos");
assert.equal(cuantos("flor5", { partes: ["centro"] }), 1, "flor5: 1 centro");
assert.equal(cuantos("flor_grande", { partes: ["centro"], formatos: ["R-5"] }), 3, "flor_grande: trío de R-5 al centro");
assert.equal(cuantos("flor_graffiti", { partes: ["petalos"], formatos: ["R-12"] }), 5, "flor_graffiti: 5 pétalos R-12");
assert.equal(cuantos("flor_graffiti", { partes: ["corona"] }), 6, "flor_graffiti: corona de 6");
assert.equal(cuantos("flor_lazos_dorados", { partes: ["petalos"] }), 6, "flor de lazos: «petalos» vale para el anillo interior");
assert.equal(cuantos("flor_lazos_dorados", { partes: ["petalos/interior"], colores: ["009"] }), 3, "flor de lazos: 3 lazos interiores rosados");
assert.equal(cuantos("mono_fucsia", { partes: ["lazos"] }), 4, "moño: 2 lazos por lado");
assert.equal(cuantos("mono_fucsia", { partes: ["colas"] }), 2, "moño: 2 colas");
assert.equal(cuantos("estrella_dorada", { partes: ["rayos/perillas"] }), 5, "estrella: una perilla por punta");
assert.equal(cuantos("flor_corazones", { partes: ["petalos"], formatos: ["C-*"] }), 5, "flor de corazones: 5 corazones de pétalos");
assert.equal(cuantos("arana_articulada", { partes: ["patas"], formatos: ["T-260"] }), 24, "araña: 8 patas de 3 burbujas");
assert.equal(cuantos("calabaza_grande", { partes: ["tallo"] }), 9, "calabaza: tallo + 6 lazos + 2 zarcillos");
assert.equal(cuantos("calabaza_grande", { formatos: ["R-24"], partes: ["calabaza"] }), 1, "calabaza: el R-24");
assert.equal(cuantos("arbol_trenzado", { partes: ["copa/ojos"] }), 2, "árbol: dos ojos en la copa");
assert.equal(cuantos("arbol_trenzado", { partes: ["base/acentos"] }), 12, "árbol: 12 acentos en la base");
assert.equal(cuantos("mano_verde", { partes: ["dedos/pulgar"] }), 2, "mano: pulgar de 2 burbujas");
assert.equal(cuantos("burbuja_r5_pastel", { partes: ["exterior"], formatos: ["R-24"] }), 1, "burbuja: un exterior R-24");
assert.equal(cuantos("burbuja_r5_pastel", { partes: ["interiores"] }), armadaDe("burbuja_r5_pastel").globos.length - 1, "burbuja: el resto son interiores");
assert.equal(cuantos("orbe_flecos_dorado", { partes: ["collar"] }), 8, "orbe: collar de 8");
assert.equal(cuantos("figura_perrito", { partes: ["patas/delantera"] }) > 0 && cuantos("figura_perrito", { partes: ["patas/trasera"] }) > 0, true, "perrito: patas de adelante y de atrás");
assert.equal(cuantos("figura_abeja", { partes: ["patas/media"] }) > 0, true, "abeja: patas del medio");
assert.equal(cuantos("figura_abeja", { partes: ["aguijon"] }), 1, "abeja: aguijón");
assert.equal(cuantos("figura_de_pie", { partes: ["piernas/pies"], formatos: ["R-5"] }), 2, "muñeco: dos pies de R-5");
assert.equal(cuantos("figura_de_pie", { partes: ["sombrero/copa"], formatos: ["R-9"] }), 1, "muñeco: copa del sombrero R-9");
assert.equal(cuantos("figura_auto", { partes: ["ruedas"] }), 4, "auto: 4 ruedas");
assert.equal(cuantos("figura_pajaro", { partes: ["ojos"] }), 2, "pájaro: 2 ojos pegados");

// ----- El vocabulario mismo
const nombres = PARTES_DECORACIONES.map((p) => p.nombre);
assert.equal(new Set(nombres).size, nombres.length, "partes repetidas en el vocabulario");
for (const p of PARTES_DECORACIONES) {
  assert.match(p.nombre, /^[a-z]+(\/[a-z]+)*$/, `«${p.nombre}»: minúsculas sin tildes, con «/»`);
  assert.ok(p.descripcion.length > 10 && p.ingles.length > 0, `«${p.nombre}» sin descripción o sin sinónimos en inglés`);
  const padre = p.nombre.split("/").slice(0, -1).join("/");
  if (padre) assert.ok(nombres.includes(padre), `«${p.nombre}»: falta su parte madre «${padre}»`);
}

assert.equal(total.sp, 0, `${total.sp} globos o tubitos de decoraciones sin parte`);
assert.equal(total.pd, 0, `${total.pd} partes fuera del vocabulario`);
assert.equal(total.fo, 0, `${total.fo} globos con formato inexistente`);
assert.equal(total.co, 0, `${total.co} globos con un color que no se fabrica en su formato`);
console.log("test-partes-decoraciones: ok");
