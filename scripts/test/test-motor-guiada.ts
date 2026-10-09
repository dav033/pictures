/**
 * El motor 3D de la vista guiada (REQ-007, fase 1): contrato, conversiones y fachada. Sin coste: no llama a ninguna IA.
 * - la espec se valida en el borde (pesos que suman 1, ids únicos, 1 a 8 piezas, códigos de la lámina);
 * - propuesta → espec y plan de una idea → espec: lados, medidas, colores, mezcla → tamaños, flores, remate;
 * - `armarDesdeEspec` es determinista (mismos bytes), su hash no depende del orden de las llaves y su resultado cumple
 *   el contrato `resultado-motor.v1`;
 * - lo que no se representa se dice con su motivo y no entra a la lista; lo declarado se cuenta sin dibujarse;
 * - topes: 700 globos por pieza, 1 500 por plan; la armada compacta de 1 500 globos pesa menos de 30 KB;
 * - velocidad: p95 por plan ≤ 1,5 s con el motor caliente (el primer plan orgánico de un proceso tarda ~1 s: arma sus tablas de empaque).
 */
import assert from "node:assert/strict";
import { armarDesdeEspec, especDesdePlan, especDesdePropuesta, EspecClienteV1Schema, VERSION_MOTOR, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";
import { ResultadoMotorV1Schema } from "../../src/lib/globos3d/motor/resultado-motor-v1";
import { jsonEstable } from "../../src/lib/globos3d/motor/hash-espec";
import { TOPE_BYTES_ARMADA } from "../../src/lib/globos3d/motor/armada-compacta";
import { resolverProductoDeIdeas } from "../../src/lib/globos3d/motor/productos-ideas";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { readFileSync } from "node:fs";
import path from "node:path";
import { todosLosCasos } from "../lib/casos-motor-guiada";

const AZUL = [{ codigo: "040", nombre: "azul", peso: 0.6 }, { codigo: "005", nombre: "blanco", peso: 0.4 }];
const pieza = (parcial: Partial<PiezaEspec> & Pick<PiezaEspec, "id" | "oficial">): PiezaEspec => ({
  nombre: parcial.oficial, lugar: "centro", medidas: {}, colores: AZUL, tamanos: "organica_fina", ...parcial,
});
const espec = (...piezas: PiezaEspec[]): EspecClienteV1 => ({ version: "espec-cliente.v1", origen: { tipo: "propuesta" }, piezas });
const globosDe = (r: ReturnType<typeof armarDesdeEspec>, id: string) => r.armada.piezas.find((p) => p.id === id)!.globos[1];
/** Misma espec con las llaves en el orden contrario, a todo lo hondo. */
const invertirLlaves = <T,>(valor: T): T => {
  if (Array.isArray(valor)) return valor.map(invertirLlaves) as T;
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).reverse().map(([k, v]) => [k, invertirLlaves(v)])) as T;
  return valor;
};
const unidades = (lineas: ReadonlyArray<{ cantidad: number }>) => lineas.reduce((s, l) => s + l.cantidad, 0);

// 1. El contrato se valida en el borde.
assert.ok(EspecClienteV1Schema.safeParse(espec(pieza({ id: "EST_01_ARCO", oficial: "arco", tamanos: "clasica" }))).success);
assert.ok(!EspecClienteV1Schema.safeParse(espec(pieza({ id: "EST_01_ARCO", oficial: "arco", colores: [{ codigo: "040", nombre: "azul", peso: 0.5 }] }))).success, "pesos que no suman 1");
assert.ok(!EspecClienteV1Schema.safeParse(espec(pieza({ id: "EST_01_ARCO", oficial: "arco" }), pieza({ id: "EST_01_ARCO", oficial: "columna" }))).success, "ids repetidos");
assert.ok(!EspecClienteV1Schema.safeParse(espec(...Array.from({ length: 9 }, (_, i) => pieza({ id: `EST_0${i + 1}_ARCO`, oficial: "arco" })))).success, "más de 8 piezas");
assert.ok(!EspecClienteV1Schema.safeParse(espec(pieza({ id: "EST_01_ARCO", oficial: "arco", colores: [{ codigo: "azul", nombre: "azul", peso: 1 }] }))).success, "el código es de tres cifras");
assert.throws(() => armarDesdeEspec({ version: "espec-cliente.v1", origen: { tipo: "propuesta" }, piezas: [] }), "una espec vacía no se arma");

// 2. Propuesta → espec.
{
  const { espec: e, avisos } = especDesdePropuesta(
    { frase: "x", colores: ["verde salvia" as never, "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }, { estructura: "guirnalda", cantidad: 1 }] },
    { medida: { texto: "unos 3 metros", metros: 3 }, estructura: { id: "arco", texto: "arco", organica: true } },
  );
  assert.equal(EspecClienteV1Schema.safeParse(e).success, true, "la espec de una propuesta es válida");
  assert.deepEqual(e.piezas.map((p) => p.id), ["EST_01_ARCO", "EST_02_COLUMNA", "EST_03_COLUMNA", "EST_04_GUIRNALDA"]);
  assert.deepEqual(e.piezas.map((p) => p.lugar), ["centro", "izquierda", "derecha", "fondo"], "dos columnas son la izquierda y la derecha; la guirnalda va al fondo");
  assert.deepEqual(e.piezas.map((p) => p.nombre), ["Arco", "Columna izquierda", "Columna derecha", "Guirnalda"]);
  assert.equal(e.piezas[0]!.medidas.anchoM, 3, "«3 metros» de un arco es su ancho");
  assert.equal(e.piezas[0]!.tamanos, "organica_fina", "«arco orgánico» mezcla tamaños");
  assert.equal(e.piezas[1]!.tamanos, "clasica");
  assert.deepEqual(e.piezas[0]!.colores.map((c) => c.codigo), ["027", "970"], "los colores salen de la tabla revisada, no de un modelo");
  assert.ok(avisos.some((a) => a.includes("verde salvia")) === false, "«verde salvia» sí se reconoce");
  const r = armarDesdeEspec(e);
  assert.deepEqual(r.noRepresentable, []);
  assert.ok(unidades(r.bom.total) > 100);
}
{
  const { espec: e, avisos } = especDesdePropuesta({ frase: "x", colores: ["azul"], piezas: [{ estructura: "columna", cantidad: 12 }] });
  assert.equal(e.piezas.length, 8, "nunca más de 8 piezas");
  assert.ok(avisos.some((a) => a.includes("máximo")));
}

// 3. Plan de una idea → espec.
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "..", "..", "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const idea = (prefijo: string) => Object.entries(planes.ideas).find(([id]) => id.startsWith(prefijo))!;
const deIdea = (prefijo: string) => { const [id, i] = idea(prefijo); return especDesdePlan(i.plan, { resolverProducto: resolverProductoDeIdeas, origen: { tipo: "idea", ideaIds: [id] } }).espec; };
{
  const dos = deIdea("deco-real-29");
  assert.deepEqual(dos.piezas.map((p) => [p.id, p.lugar]), [["EST_01_COLUMNA", "izquierda"], ["EST_01_COLUMNA_B", "derecha"]], "repeticiones: 2 son dos piezas, izquierda y derecha");
  const remate = deIdea("deco-real-08");
  assert.deepEqual(remate.piezas[0]!.remate, { formatoId: "R-36", codigo: "080" }, "la bola negra de arriba de las columnas negras y doradas");
  const aro = deIdea("deco-real-28").piezas[0]!;
  assert.deepEqual([aro.flores?.cantidad, aro.flores?.petalos, aro.flores?.codigo, aro.flores?.centro, aro.forma], [2, 6, "806", "970", "organico"]);
  const arco = deIdea("deco-real-01").piezas[0]!;
  assert.deepEqual(arco.colores, [{ codigo: "080", nombre: "Negro", peso: 0.5 }, { codigo: "005", nombre: "Blanco", peso: 0.5 }], "participacion → peso");
  assert.equal(arco.tamanos, "clasica");
  assert.equal(deIdea("deco-real-04").piezas[0]!.tamanos, "organica_fina");
  for (const caso of todosLosCasos()) assert.ok(EspecClienteV1Schema.safeParse(caso.espec).success, `${caso.id}: la espec no valida`);
}

// 4. La fachada.
const gordo = espec(
  pieza({ id: "EST_01_ARCO_ASIMETRICO", oficial: "arco_asimetrico", lugar: "centro", colores: AZUL }),
  pieza({ id: "EST_02_COLUMNA", oficial: "columna", lugar: "izquierda", tamanos: "clasica", colores: [{ codigo: "970", nombre: "dorado", peso: 1 }], remate: { formatoId: "R-36", codigo: "970" } }),
  pieza({ id: "EST_03_COLUMNA", oficial: "columna", lugar: "derecha", tamanos: "clasica", colores: [{ codigo: "970", nombre: "dorado", peso: 1 }] }),
  pieza({ id: "EST_04_GUIRNALDA", oficial: "guirnalda", lugar: "fondo", medidas: { largoM: 3 }, flores: { cantidad: 3, petalos: 4, codigo: "009", centro: "970" } }),
);
const uno = armarDesdeEspec(gordo);
const dos = armarDesdeEspec(structuredClone(gordo));
assert.equal(JSON.stringify(uno), JSON.stringify(dos), "la misma espec da los mismos bytes");
assert.equal(jsonEstable(uno.bom), jsonEstable(dos.bom));
assert.ok(ResultadoMotorV1Schema.safeParse(uno).success, "el resultado cumple resultado-motor.v1");
assert.deepEqual(uno.motor, { id: "globos3d", version: VERSION_MOTOR });
assert.equal(uno.especHash, armarDesdeEspec({ ...gordo, piezas: gordo.piezas.map((p) => invertirLlaves(p)) }).especHash, "el hash no depende del orden de las llaves");
assert.notEqual(uno.especHash, armarDesdeEspec({ ...gordo, piezas: gordo.piezas.map((p) => (p.id === "EST_04_GUIRNALDA" ? { ...p, medidas: { largoM: 3.1 } } : p)) }).especHash, "cambiar la espec cambia el hash");
assert.deepEqual(Object.keys(uno.bom.porPieza), [...Object.keys(uno.bom.porPieza)].sort(), "las piezas del BOM van en orden");
for (const linea of uno.bom.total) assert.ok(linea.cantidad > 0);
assert.equal(unidades(uno.bom.total), Object.values(uno.bom.porPieza).reduce((s, l) => s + unidades(l), 0), "el total es la suma de las piezas");
assert.deepEqual(uno.armada.piezas.map((p) => p.id), ["EST_01_ARCO_ASIMETRICO", "EST_02_COLUMNA", "EST_03_COLUMNA", "EST_04_GUIRNALDA"]);
assert.ok(uno.armada.piezas.every((p) => p.globos[1] > 0), "todas las piezas se dibujan");
// El remate suma un R-36 dorado a su columna y no a la otra.
const r36 = (id: string) => uno.bom.porPieza[id]!.filter((l) => l.formatoId === "R-36").reduce((s, l) => s + l.cantidad, 0);
assert.equal(r36("EST_02_COLUMNA") - r36("EST_03_COLUMNA"), 1);
// Las flores de globo cuelgan de su pieza y se cuentan en ella: 3 flores × (4 pétalos + 1 centro) de R-5.
const flores = uno.bom.porPieza["EST_04_GUIRNALDA"]!.filter((l) => l.formatoId === "R-5" && (l.codigo === "009" || l.codigo === "970"));
assert.ok(unidades(flores) >= 15, `las flores se cuentan: ${JSON.stringify(flores)}`);
// En una pieza sin dónde colgarlas se dice y no se pierden en silencio.
const sinAncla = armarDesdeEspec(espec(pieza({ id: "EST_01_BOUQUET", oficial: "bouquet", lugar: "mesa", tamanos: "clasica", flores: { cantidad: 2, petalos: 3, codigo: "009" } })));
assert.ok(sinAncla.avisos.some((a) => a.includes("flores")), "el aviso de flores que no se dibujan");
// Con los mismos colores, las clásicas y las orgánicas cuentan distinto, pero cuentan.
assert.ok(globosDe(uno, "EST_01_ARCO_ASIMETRICO") > 150);

// El arco asimétrico es asimétrico y su lado pesado cambia con el lugar; el semiarco de la derecha es el espejo.
const lado = (id: string, lugar: "centro" | "derecha", oficial: "arco_asimetrico" | "semiarco") => {
  const r = armarDesdeEspec(espec(pieza({ id, oficial, lugar })));
  const p = r.armada.piezas[0]!;
  const cx = (p.caja[0] + p.caja[3]) / 2;
  let izquierda = 0, derecha = 0;
  for (let i = p.globos[0]; i < p.globos[0] + p.globos[1]; i++) {
    if (r.armada.globos[i * 5]! < cx) izquierda++;
    else derecha++;
  }
  return { izquierda, derecha, ancho: p.caja[3] - p.caja[0] };
};
const asim = lado("EST_01_ARCO_ASIMETRICO", "centro", "arco_asimetrico"), asimDerecha = lado("EST_01_ARCO_ASIMETRICO", "derecha", "arco_asimetrico");
assert.ok(asim.izquierda > asim.derecha * 1.1, `el lado pesado es la izquierda: ${asim.izquierda} contra ${asim.derecha}`);
assert.ok(asimDerecha.derecha > asimDerecha.izquierda * 1.1, `con lugar derecha el pesado es la derecha: ${asimDerecha.izquierda} contra ${asimDerecha.derecha}`);
const sa = lado("EST_01_SEMIARCO", "centro", "semiarco"), saDerecha = lado("EST_01_SEMIARCO", "derecha", "semiarco");
assert.ok(sa.izquierda !== sa.derecha && Math.sign(sa.izquierda - sa.derecha) === -Math.sign(saDerecha.izquierda - saDerecha.derecha), "el semiarco de la derecha es el espejo del de la izquierda");

// 5. Lo que no se representa se dice; lo declarado se cuenta sin dibujarse.
{
  const r = armarDesdeEspec(espec(
    pieza({ id: "EST_01_ARCO", oficial: "arco", tamanos: "clasica" }),
    pieza({ id: "EST_02_ARO_CIRCULAR", oficial: "aro_circular", forma: "parcial" }),
    pieza({ id: "EST_03_CENTRO_MESA", oficial: "centro_mesa" }),
    pieza({ id: "EST_04_FIGURA", oficial: "figura", declarada: { motivo: "Figura del catálogo, contada de su lista.", materiales: [{ formatoId: "R-12", codigo: "061", cantidad: 18 }, { formatoId: "R-5", codigo: "080", cantidad: 6 }] } }),
    pieza({ id: "EST_05_COLUMNA", oficial: "columna", colores: [{ codigo: "999", nombre: "inventado", peso: 1 }] }),
  ));
  assert.deepEqual(r.noRepresentable.map((n) => n.piezaId), ["EST_02_ARO_CIRCULAR", "EST_03_CENTRO_MESA", "EST_05_COLUMNA"]);
  assert.ok(r.noRepresentable.every((n) => n.motivo.length > 20), "cada motivo está dicho");
  assert.ok(!("EST_02_ARO_CIRCULAR" in r.bom.porPieza) && !("EST_03_CENTRO_MESA" in r.bom.porPieza), "lo que no se representa no entra a la lista");
  assert.deepEqual(r.bom.porPieza["EST_04_FIGURA"], [{ formatoId: "R-5", codigo: "080", cantidad: 6 }, { formatoId: "R-12", codigo: "061", cantidad: 18 }], "lo declarado se cuenta, ordenado");
  assert.ok(!r.armada.piezas.some((p) => p.id === "EST_04_FIGURA"), "lo declarado no se dibuja");
  assert.ok(r.avisos.some((a) => a.includes("no se dibuja")));
}

// 6. Medidas fuera de rango se acotan y se avisa; una pieza aproximada lo dice.
{
  const r = armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", medidas: { altoM: 9 } }), pieza({ id: "EST_02_ARCO_NO_DENSO", oficial: "arco_no_denso", densidad: "sencilla" })));
  assert.ok(r.avisos.some((a) => a.includes("900 cm") && a.includes("500 cm")), `acota el alto: ${r.avisos.join(" | ")}`);
  assert.ok(r.avisos.some((a) => a.includes("ligera")), "el arco no denso se arma aproximado y se dice");
  const sieteColores = armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", medidas: { altoM: 3 }, colores: ["015", "020", "040", "030", "061", "051"].map((codigo) => ({ codigo, nombre: codigo, peso: 1 / 6 })).map((c, i, a) => (i === a.length - 1 ? { ...c, peso: 1 - (a.length - 1) * (1 / 6) } : c)) })));
  assert.ok(sieteColores.avisos.some((a) => a.includes("bandas")), "más de 4 colores en una trenza van en bandas y se dice");
  assert.equal(new Set(sieteColores.bom.total.map((l) => l.codigo)).size, 6, "las bandas llevan los seis colores");
}

// 7. Topes y tamaño de la armada.
{
  const enorme = (i: number) => pieza({ id: `EST_0${i + 1}_ARCO_ASIMETRICO`, oficial: "arco_asimetrico", medidas: { anchoM: 5, altoM: 3.2, grosorM: 1.2 }, densidad: "lujosa" });
  const r = armarDesdeEspec(espec(...Array.from({ length: 8 }, (_, i) => enorme(i))));
  const dibujados = r.armada.piezas.reduce((s, p) => s + p.globos[1], 0);
  assert.ok(dibujados <= 1500, `el plan dibuja ${dibujados} globos: pasa del tope de 1 500`);
  assert.ok(r.armada.piezas.every((p) => p.globos[1] <= 700), "ninguna pieza pasa de 700 globos");
  assert.ok(r.noRepresentable.length > 0 && r.noRepresentable.every((n) => /tope|pasa de/.test(n.motivo)), "lo que pasa de los topes se dice");
}
{
  const plan = espec(
    pieza({ id: "EST_01_ARCO_ASIMETRICO", oficial: "arco_asimetrico" }), pieza({ id: "EST_02_ARCO_ASIMETRICO", oficial: "arco_asimetrico", lugar: "izquierda" }), pieza({ id: "EST_03_ARCO_ASIMETRICO", oficial: "arco_asimetrico", lugar: "derecha" }),
    pieza({ id: "EST_04_SEMIARCO", oficial: "semiarco", lugar: "fondo" }), pieza({ id: "EST_05_COLUMNA_ASIMETRICA", oficial: "columna_asimetrica", lugar: "izquierda" }),
  );
  const r = armarDesdeEspec(plan);
  const globos = r.armada.globos.length / 5;
  assert.ok(globos > 1000 && globos <= 1500, `un plan grande de prueba: ${globos} globos`);
  const bytes = Buffer.byteLength(JSON.stringify(r.armada));
  assert.ok(bytes <= TOPE_BYTES_ARMADA, `la armada de ${globos} globos pesa ${bytes} bytes y el tope es ${TOPE_BYTES_ARMADA}`);
  assert.ok((bytes / globos) * 1500 <= TOPE_BYTES_ARMADA, `a este paso, 1 500 globos pesarían ${Math.round((bytes / globos) * 1500)} bytes y el tope es ${TOPE_BYTES_ARMADA}`);
  console.log(`  armada compacta: ${globos} globos en ${(bytes / 1024).toFixed(1)} KB`);
}

// 8. Velocidad: p95 por plan con el motor caliente.
{
  const planesDePrueba = todosLosCasos().map((c) => c.espec);
  for (const e of planesDePrueba) armarDesdeEspec(e);
  const tiempos = planesDePrueba.map((e) => { const t = performance.now(); armarDesdeEspec(e); return performance.now() - t; }).sort((a, b) => a - b);
  const p95 = tiempos[Math.ceil(tiempos.length * 0.95) - 1]!;
  assert.ok(p95 <= 1500, `p95 = ${p95.toFixed(0)} ms: pasa de 1,5 s`);
  console.log(`  velocidad: ${planesDePrueba.length} planes, p95 ${p95.toFixed(0)} ms, máximo ${tiempos.at(-1)!.toFixed(0)} ms`);
}

// 9. Lo que la revisión antagonista encontró: nada se pierde ni revienta en silencio.
{
  const lineas = (r: ReturnType<typeof armarDesdeEspec>, id: string, formato: string, codigo: string) => r.bom.porPieza[id]?.find((l) => l.formatoId === formato && l.codigo === codigo)?.cantidad ?? 0;
  // Las flores se cuentan de la espec aunque la pieza no tenga dónde colgarlas, y también en una pieza de cuartetos.
  const ramo = armarDesdeEspec(espec(pieza({ id: "EST_01_BOUQUET", oficial: "bouquet", lugar: "mesa", tamanos: "clasica", flores: { cantidad: 3, petalos: 4, codigo: "009", centro: "970" } })));
  assert.equal(lineas(ramo, "EST_01_BOUQUET", "R-5", "009"), 12, "3 flores × 4 pétalos");
  assert.equal(lineas(ramo, "EST_01_BOUQUET", "R-5", "970"), 3, "3 centros");
  const muchas = armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", flores: { cantidad: 24, petalos: 3, codigo: "009" } })));
  assert.equal(lineas(muchas, "EST_01_COLUMNA", "R-5", "009"), 72, "24 flores × 3 pétalos, se dibujen todas o no");
  // Un código de flor que no existe no revienta la fachada: la pieza queda como no representable.
  const mala = armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", flores: { cantidad: 2, petalos: 3, codigo: "999" } })));
  assert.deepEqual(mala.noRepresentable.map((n) => n.piezaId), ["EST_01_COLUMNA"]);
  // El esquema rechaza lo que el motor no puede armar.
  const conRemate = (formatoId: string) => espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", remate: { formatoId: formatoId as "R-36", codigo: "970" } }));
  assert.ok(!EspecClienteV1Schema.safeParse(conRemate("LOL-12")).success, "un remate no puede ser Link-O-Loon");
  assert.ok(EspecClienteV1Schema.safeParse(conRemate("R-36")).success);
  assert.ok(!EspecClienteV1Schema.safeParse(espec(pieza({ id: "EST_01_FIGURA", oficial: "figura", declarada: { motivo: "x", materiales: [{ formatoId: "NOPE", codigo: "061", cantidad: 1 }] } }))).success, "un formato declarado debe existir");
  // El remate también va en una columna orgánica.
  const organica = armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA_ASIMETRICA", oficial: "columna_asimetrica", remate: { formatoId: "R-36", codigo: "570" } })));
  assert.equal(lineas(organica, "EST_01_COLUMNA_ASIMETRICA", "R-36", "570"), 1);
  assert.ok(armarDesdeEspec(espec(pieza({ id: "EST_01_ARCO", oficial: "arco", tamanos: "clasica", remate: { formatoId: "R-36", codigo: "970" } }))).avisos.some((a) => a.includes("solo las columnas")), "un remate fuera de una columna se dice");
  // Los pesos de color se notan en las piezas de cuartetos; los armados que no los reparten lo dicen.
  const columna = (colores: Array<[string, number]>) => armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", medidas: { altoM: 3 }, colores: colores.map(([codigo, peso]) => ({ codigo, nombre: codigo, peso })) })));
  const pesada = columna([["040", 0.9], ["012", 0.1]]), pareja = columna([["040", 0.5], ["012", 0.5]]);
  assert.ok(lineas(pesada, "EST_01_COLUMNA", "R-12", "040") >= 3 * lineas(pesada, "EST_01_COLUMNA", "R-12", "012"), "90/10 se nota");
  assert.ok(Math.abs(lineas(pareja, "EST_01_COLUMNA", "R-12", "040") - lineas(pareja, "EST_01_COLUMNA", "R-12", "012")) <= 4, "50/50 queda parejo");
  const tres = columna([["040", 1 / 3], ["012", 1 / 3], ["015", 1 / 3]]).bom.total.map((l) => l.cantidad);
  assert.ok(Math.max(...tres) - Math.min(...tres) <= 12, "tres colores parejos no se vuelven 50/25/25");
  const pared = armarDesdeEspec(espec(pieza({ id: "EST_01_PARED_DENSA", oficial: "pared_densa", lugar: "fondo", tamanos: "clasica", colores: [{ codigo: "040", nombre: "a", peso: 0.7 }, { codigo: "012", nombre: "b", peso: 0.3 }] })));
  assert.ok(pared.avisos.some((a) => a.includes("partes iguales")), "la pared no reparte por peso y lo dice");
  const seis = (["015", "020", "040", "030", "061", "051"] as const).map((codigo, i) => ({ codigo, nombre: codigo, peso: i < 5 ? 1 / 6 : 1 - 5 / 6 }));
  assert.ok(armarDesdeEspec(espec(pieza({ id: "EST_01_PARED_DENSA", oficial: "pared_densa", lugar: "fondo", tamanos: "clasica", colores: seis }))).avisos.some((a) => a.includes("hasta 4 colores")), "más de 4 colores en la pared se dicen");
  assert.ok(armarDesdeEspec(espec(pieza({ id: "EST_01_COLUMNA", oficial: "columna", tamanos: "clasica", densidad: "sencilla" }))).avisos.some((a) => a.includes("densidad ligera")), "la densidad ligera en cuartetos se dice");
  // Un plan con más repeticiones de las que caben se recorta como el de la propuesta.
  const [, ideaBase] = idea("deco-real-29");
  const demasiadas = structuredClone(ideaBase.plan);
  demasiadas.estructuras[0]!.repeticiones = 11;
  const recortado = especDesdePlan(demasiadas, { resolverProducto: resolverProductoDeIdeas });
  assert.equal(recortado.espec.piezas.length, 8);
  assert.equal(new Set(recortado.espec.piezas.map((p) => p.id)).size, 8, "ids únicos");
  assert.ok(EspecClienteV1Schema.safeParse(recortado.espec).success && recortado.avisos.some((a) => a.includes("máximo")));
  // La medida del cliente gana a la del modelo y no se pega a otra pieza.
  const propuesta = { frase: "x", colores: ["azul" as const], piezas: [{ estructura: "arco" as const, cantidad: 1, medidas: { ancho_m: 2.4 } }, { estructura: "guirnalda" as const, cantidad: 1 }] };
  const gana = especDesdePropuesta(propuesta, { medida: { texto: "3 metros", metros: 3 }, estructura: { id: "arco", texto: "arco" } });
  assert.equal(gana.espec.piezas[0]!.medidas.anchoM, 3);
  const ajena = especDesdePropuesta(propuesta, { medida: { texto: "3 metros", metros: 3 }, estructura: { id: "columna", texto: "columna" } });
  assert.equal(ajena.espec.piezas[0]!.medidas.anchoM, 2.4);
  assert.equal(ajena.espec.piezas[1]!.medidas.largoM, undefined);
  assert.ok(ajena.avisos.some((a) => a.includes("no se aplicó")));
}

console.log("test-motor-guiada: ok");
