import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { globosPorColor, lineaGlobo, piezasVistaDePlan, tablaGlobos, tamanoDeLinea, tramosDe, type LineaGlobo } from "../../src/components/guiado/piezas-vista";
import { motorDePieza } from "../../src/components/guiado/motor-pieza";

/**
 * «Ver detalle» de «Tu plan» (tabla por pieza) y la gráfica de cada pieza, sin red, sin Python y sin modelo: lee
 * planes ya resueltos de la biblioteca (`data/biblioteca-real/analisis`). Sin coste.
 *
 *   npx tsx scripts/test/test-tabla-globos.ts
 */

const ANALISIS = path.join(process.cwd(), "data", "biblioteca-real", "analisis");
type Cruda = { color?: string | null; diam_pulg?: number | null; tamano_codigo?: string | null; forma?: string | null; titulo?: string | null; acabado?: string | null; unidades: number };

function planResuelto(archivo: string): Record<string, unknown> & { estructuras: Array<{ estructura_id: string; lineas: Cruda[] }>; plan: { estructuras: Array<Record<string, unknown>> } } {
  const crudo = JSON.parse(readFileSync(path.join(ANALISIS, archivo), "utf8")) as { plan_resuelto: ReturnType<typeof planResuelto> };
  return crudo.plan_resuelto;
}

function lineas(crudas: readonly Cruda[]): LineaGlobo[] {
  return crudas.flatMap((cruda) => {
    const linea = lineaGlobo(cruda);
    return linea ? [linea] : [];
  });
}

let pruebas = 0;
function prueba(nombre: string, cuerpo: () => void): void {
  cuerpo();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("tamanoDeLinea: redondo, link, corazón, tubito, metalizado y desconocido", () => {
  assert.deepEqual(tamanoDeLinea({ tamano_codigo: "R-12", diam_pulg: 12, forma: "redondo" }), { clave: "R-12", etiqueta: "12″", descripcion: "12 pulgadas", orden: 12, pulgadas: 12 });
  assert.equal(tamanoDeLinea({ tamano_codigo: "R-5" }).clave, "R-5");
  assert.equal(tamanoDeLinea({ diam_pulg: 18 }).etiqueta, "18″");
  const link = tamanoDeLinea({ tamano_codigo: "LOL6" });
  assert.equal(link.etiqueta, "Link 6″");
  assert.equal(link.pulgadas, null);
  assert.equal(tamanoDeLinea({ tamano_codigo: "C-12" }).etiqueta, "Corazón 12″");
  assert.equal(tamanoDeLinea({ tamano_codigo: "T260" }).etiqueta, "Tubito");
  assert.equal(tamanoDeLinea({ tamano_codigo: "18 IN" }).etiqueta, "Metalizado 18″");
  assert.equal(tamanoDeLinea({ tamano_codigo: "XYZ" }).clave, "OTROS");
  // Orden: redondos por pulgada, luego link, corazón, tubito, metalizado y otros.
  const orden = ["XYZ", "18 IN", "T260", "C-12", "LOL6", "R-24", "R-5"].map((codigo) => tamanoDeLinea({ tamano_codigo: codigo })).sort((a, b) => a.orden - b.orden).map((t) => t.clave);
  assert.deepEqual(orden, ["R-5", "R-24", "LOL-6", "C-12", "TUBITO", "MET-18", "OTROS"]);
});

prueba("tablaGlobos sobre nueva-sempertex-07: 1 fila, 5 tamaños (5, 9, 12, 18, 24) y 151 globos", () => {
  const plan = planResuelto("nueva-sempertex-07.plan.json");
  const tabla = tablaGlobos(lineas(plan.estructuras[0]!.lineas));
  assert.equal(tabla.filas.length, 1);
  assert.deepEqual(tabla.columnas.map((columna) => columna.etiqueta), ["5″", "9″", "12″", "18″", "24″"]);
  assert.deepEqual(tabla.totalesColumna, [32, 27, 81, 8, 3]);
  assert.equal(tabla.total, 151);
  assert.equal(tabla.filas[0]!.total, 151);
  assert.deepEqual(tabla.filas[0]!.celdas, [32, 27, 81, 8, 3], "dos líneas de 12″ del mismo color se suman en una celda");
});

prueba("tablaGlobos sobre real-05: 4 colores en orden de aparición, una sola columna (12″) y 102 globos", () => {
  const plan = planResuelto("real-05-arco-organico-bf3d4c2f-12ab-4c83-a87b-97da3b53ec.plan.json");
  const crudas = plan.estructuras.flatMap((estructura) => estructura.lineas);
  const tabla = tablaGlobos(lineas(crudas));
  assert.equal(tabla.filas.length, 4);
  assert.equal(tabla.columnas.length, 1);
  assert.equal(tabla.columnas[0]!.etiqueta, "12″");
  assert.equal(tabla.total, 102);
  const primeros = [...new Set(crudas.map((cruda) => cruda.color))];
  assert.deepEqual(tabla.filas.map((fila) => fila.color), primeros);
  assert.equal(tabla.filas.reduce((suma, fila) => suma + fila.total, 0), 102);
});

prueba("las líneas en 0 se descartan y cada color lleva su tono (nunca vacío)", () => {
  const conCero = lineas([{ color: "dorado", tamano_codigo: "R-12", unidades: 0 }, { color: "dorado", tamano_codigo: "R-12", unidades: 4, acabado: "reflex", titulo: "B2b Globo Latex Redondo Reflex Dorado — R-12" }, { color: "rosa claro", tamano_codigo: "R-5", unidades: 2 }]);
  assert.equal(conCero.length, 2);
  for (const linea of conCero) assert.match(linea.hex, /^#[0-9a-f]{6}$/i);
  // Nombre de la fuente única (color-sempertex): el tono Sempertex y su acabado conocido (Reflex → cromado).
  assert.equal(conCero[0]!.etiqueta, "Dorado cromado");
  assert.equal(conCero[0]!.hex, "#c5a253", "el hex de la referencia Reflex Dorado del catálogo");
  assert.equal(conCero[1]!.etiqueta, "Rosa claro", "un color fuera de la paleta se muestra tal cual");
  const tabla = tablaGlobos(conCero);
  assert.deepEqual(tabla.columnas.map((columna) => columna.etiqueta), ["5″", "12″"]);
  assert.deepEqual(tabla.filas.map((fila) => fila.celdas), [[0, 4], [2, 0]]);
  assert.deepEqual(globosPorColor(conCero).map((globo) => [globo.color, globo.cantidad]), [["dorado", 4], ["rosa claro", 2]]);
  assert.deepEqual(tramosDe(conCero), [{ pulgadas: 5, unidades: 2 }, { pulgadas: 12, unidades: 4 }]);
});

prueba("piezasVistaDePlan sobre real-07 (dos columnas separadas) conserva piezas, repeticiones y totales de Python", () => {
  const archivo = readdirReal("real-07");
  const resuelto = planResuelto(archivo);
  const plan = PlanGuiadoSchema.parse({ ...resuelto, approval_token: "prueba" });
  const piezas = piezasVistaDePlan(plan);
  assert.equal(piezas.length, plan.plan.estructuras.length);
  for (const pieza of piezas) {
    const dePython = resuelto.estructuras.find((estructura) => estructura.estructura_id === pieza.id)!.lineas.reduce((suma, linea) => suma + linea.unidades, 0);
    assert.equal(tablaGlobos(pieza.lineas).total, dePython, `${pieza.nombre}: la tabla suma lo mismo que Python`);
  }
});

prueba("motorDePieza: con armado manda el guardado; sin armado, la receta del motor de su pieza oficial", () => {
  assert.deepEqual(motorDePieza({ tipo: "columna", estructura_oficial: "columna_asimetrica" }), { tipo: "motor", campo: "armado_columna_organica", ruta: "/api/plan-armado-columna-organica", armado: null });
  assert.equal(motorDePieza({ tipo: "columna", estructura_oficial: "columna" })?.tipo, "motor");
  assert.deepEqual(motorDePieza({ tipo: "semiarco", estructura_oficial: "semiarco_asimetrico" }), { tipo: "motor", campo: "armado_arco_organico", ruta: "/api/plan-armado-arco-organico", armado: null });
  const guardado = { version: "x" };
  assert.deepEqual(motorDePieza({ tipo: "columna", estructura_oficial: "columna", armado_columna: guardado }), { tipo: "motor", campo: "armado_columna", ruta: "/api/plan-armado-columna", armado: guardado });
  assert.deepEqual(motorDePieza({ tipo: "pared", estructura_oficial: "pared_densa" }), { tipo: "dibujo" });
  assert.deepEqual(motorDePieza({ tipo: "arco", estructura_oficial: "aro_circular", armado_arco: guardado }), { tipo: "dibujo" }, "un aro nunca va al motor del arco");
  assert.equal(motorDePieza({ tipo: "kit", estructura_oficial: "bouquet" }), null, "el bouquet muestra su icono sin pedir nada");
  assert.equal(motorDePieza({ tipo: "kit", estructura_oficial: "figura" }), null);
});

function readdirReal(prefijo: string): string {
  const archivos = readdirSync(ANALISIS).filter((nombre) => nombre.startsWith(prefijo) && nombre.endsWith(".plan.json"));
  assert.ok(archivos[0], `falta el plan de ${prefijo}`);
  return archivos[0];
}

console.log(`\n${pruebas} pruebas, todas bien.`);
