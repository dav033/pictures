/**
 * Los fondos y muebles de la lectura puestos en su caja detectada (`medir-fondos.ts`, `fondos-familias.ts`). Sin coste ni red.
 * - una fila (`cantidad` > 1) toma la unión de las cajas que la cubren: seis sillas detectadas una a una no la dejan en una silla;
 * - una sola caja angosta no vale por una fila: queda como se leyó;
 * - ids vecinos entre la lectura y la detección (mesa_mantel / mesa_postres_mantel, tapete_redondo / alfombra_redonda) se casan por familia,
 *   y el mismo id gana a la familia;
 * - los globos sobre cualquier mesa o base del catálogo no cuentan en la guirnalda;
 * - los ids de las familias y de las superficies existen en el catálogo.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-medir-fondos.ts
 */
import assert from "node:assert/strict";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { FONDOS_CON_SUPERFICIE, IDS_CON_FAMILIA, SUPERFICIES_DECLARADAS, mismaFamiliaDeFondo } from "../../src/lib/globos3d/fondos-familias";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { medirConDetecciones, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { medirFondos } from "../../src/lib/globos3d/medir-fondos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;
type Guirnalda = Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
const ASPECTO = 1;
const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 100, acabado: "mate" };
const fondo = (id: string, x: number, yBase: number, ancho: number, alto: number, extra: Partial<Fondo> = {}): Fondo => ({ tipo: "fondo", id, x, yBase, ancho, alto, colores: [BLANCO], ...extra });
const cerca = (a: number, b: number, tol = 0.002) => Math.abs(a - b) <= tol;

console.log("Filas de piezas");
prueba("seis sillas detectadas una a una dejan la fila con el ancho de las seis", () => {
  const fila = fondo("silla_tiffany", 0.5, 0.9, 0.4, 0.16, { cantidad: 6 });
  const sillas = Array.from({ length: 6 }, (_, i) => ({ id: "silla_tiffany", box_2d: [740, 300 + i * 68, 900, 360 + i * 68] }));
  const r = medirFondos([fila], sillas, ASPECTO);
  const f = r.piezas[0] as Fondo;
  assert.ok(cerca(f.ancho, 0.4, 0.01) && cerca(f.x, 0.5, 0.01) && cerca(f.alto, 0.16) && cerca(f.yBase, 0.9), JSON.stringify(f));
  assert.match(r.notas[0]!, /6 cajas/);
});

prueba("una fila con una caja del grupo entero se pone en esa caja", () => {
  const fila = fondo("silla_tiffany", 0.5, 0.9, 0.5, 0.2, { cantidad: 6 });
  const f = medirFondos([fila], [{ id: "silla_tiffany", box_2d: [740, 300, 900, 700] }], ASPECTO).piezas[0] as Fondo;
  assert.ok(cerca(f.ancho, 0.4) && cerca(f.alto, 0.16), JSON.stringify(f));
});

prueba("una sola silla detectada no encoge una fila de seis: queda como se leyó", () => {
  const fila = fondo("silla_tiffany", 0.5, 0.9, 0.4, 0.16, { cantidad: 6 });
  const r = medirFondos([fila], [{ id: "silla_tiffany", box_2d: [740, 480, 900, 540] }], ASPECTO);
  assert.deepEqual(r.piezas[0], fila);
  assert.equal(r.notas.length, 0);
});

prueba("una pieza suelta sigue tomando solo su caja más cercana", () => {
  const mesa = fondo("mesa_mantel", 0.5, 0.9, 0.3, 0.2);
  const r = medirFondos([mesa], [{ id: "mesa_mantel", box_2d: [700, 350, 900, 650] }, { id: "mesa_mantel", box_2d: [700, 800, 900, 950] }], ASPECTO);
  assert.ok(cerca((r.piezas[0] as Fondo).ancho, 0.3));
});

prueba("una caja que es un pedazo de lo leído (el pie del aro que los globos tapan) no encoge el fondo: queda lo leído", () => {
  const aro = fondo("aro_metalico", 0.5, 0.62, 0.45, 0.57);
  const r = medirFondos([aro], [{ id: "aro_metalico", box_2d: [450, 380, 620, 620] }], ASPECTO);
  assert.deepEqual(r.piezas[0], aro);
  assert.match(r.notas.join(" "), /es un pedazo de lo leído/);
  // Una mesa leída a ojo 2,5 veces más grande (corta en las dos medidas, no es un telón): manda la caja.
  const mesa = fondo("mesa_mantel", 0.5, 0.9, 0.5, 0.4);
  const medida = medirFondos([mesa], [{ id: "mesa_mantel", box_2d: [750, 400, 900, 590] }], ASPECTO).piezas[0] as Fondo;
  assert.ok(cerca(medida.ancho, 0.19) && cerca(medida.alto, 0.15), JSON.stringify(medida));
  // Un juego de mesas del que solo se detectó una (corta solo de ancho): se queda lo leído.
  const nido = fondo("mesas_nido_hexagonales", 0.5, 0.8, 0.42, 0.33);
  assert.deepEqual(medirFondos([nido], [{ id: "mesas_nido_hexagonales", box_2d: [480, 420, 800, 584] }], ASPECTO).piezas[0], nido);
  // Un panel redondo tapado por la guirnalda (telón de fondo fijo) se queda como se leyó.
  const panel = fondo("panel_redondo", 0.5, 0.85, 0.5, 0.5);
  assert.deepEqual(medirFondos([panel], [{ id: "panel_redondo", box_2d: [700, 420, 850, 580] }], ASPECTO).piezas[0], panel);
  // Una caja de su tamaño (aunque algo menor) sí lo mide.
  const bien = medirFondos([aro], [{ id: "aro_metalico", box_2d: [60, 330, 620, 640] }], ASPECTO).piezas[0] as Fondo;
  assert.ok(cerca(bien.alto, 0.56) && cerca(bien.ancho, 0.31), JSON.stringify(bien));
});

console.log("Familias de ids");
prueba("la mesa leída como mesa_mantel y detectada como mesa_postres_mantel se mide", () => {
  const mesa = fondo("mesa_mantel", 0.5, 0.9, 0.5, 0.3);
  const f = medirFondos([mesa], [{ id: "mesa_postres_mantel", box_2d: [650, 300, 900, 700] }], ASPECTO).piezas[0] as Fondo;
  assert.ok(cerca(f.ancho, 0.4) && cerca(f.alto, 0.25), JSON.stringify(f));
  assert.equal(f.id, "mesa_mantel");
});

prueba("tapete_redondo y alfombra_redonda son lo mismo; una silla y una mesa, no", () => {
  const tapete = fondo("tapete_redondo", 0.5, 0.95, 0.6, 0.2);
  const f = medirFondos([tapete], [{ id: "alfombra_redonda", box_2d: [770, 250, 950, 750] }], ASPECTO).piezas[0] as Fondo;
  assert.ok(cerca(f.ancho, 0.5), JSON.stringify(f));
  const silla = fondo("silla_tiffany", 0.5, 0.9, 0.1, 0.2);
  assert.deepEqual(medirFondos([silla], [{ id: "mesa_mantel", box_2d: [700, 450, 900, 550] }], ASPECTO).piezas[0], silla);
  assert.ok(mismaFamiliaDeFondo("pedestales", "peldanos") && !mismaFamiliaDeFondo("pedestales", "mesa_mantel"));
});

prueba("el mismo id gana a la familia: cada mesa se queda con su caja", () => {
  const grande = fondo("mesa_postres_mantel", 0.3, 0.9, 0.3, 0.2);
  const otra = fondo("mesa_mantel", 0.32, 0.9, 0.3, 0.2);
  // La caja de «mesa_mantel» está en el mismo sitio que la leída de «mesa_postres_mantel», y la de «mesa_postres_mantel» al lado.
  const r = medirFondos([grande, otra], [{ id: "mesa_mantel", box_2d: [700, 150, 900, 450] }, { id: "mesa_postres_mantel", box_2d: [700, 160, 900, 520] }], ASPECTO);
  assert.ok(cerca((r.piezas[0] as Fondo).ancho, 0.36), JSON.stringify(r.piezas[0]));
  assert.ok(cerca((r.piezas[1] as Fondo).ancho, 0.3), JSON.stringify(r.piezas[1]));
});

prueba("el catálogo conoce todos los ids de las familias y de las superficies", () => {
  const ids = new Set(FONDOS_CATALOGO.map((f) => f.id));
  for (const id of [...IDS_CON_FAMILIA, ...SUPERFICIES_DECLARADAS]) assert.ok(ids.has(id), `«${id}» no está en el catálogo`);
  for (const f of FONDOS_CATALOGO.filter((x) => x.grupo === "mesa")) assert.ok(FONDOS_CON_SUPERFICIE.has(f.id), `la mesa «${f.id}» no tiene superficie`);
  for (const id of ["mesa_mantel", "pedestales", "tapete_redondo", "peldanos", "base_hexagonal", "columna_griega", "alfombra_redonda", "carrito_dulces", "mesa_regalos"]) assert.ok(FONDOS_CON_SUPERFICIE.has(id), id);
  assert.ok(!FONDOS_CON_SUPERFICIE.has("panel_redondo") && !FONDOS_CON_SUPERFICIE.has("lentejuelas"));
});

console.log("Globos sobre muebles");
const EJE = [{ x: 0.12, y: 0.55, grosor: 0.14 }, { x: 0.3, y: 0.32, grosor: 0.14 }, { x: 0.5, y: 0.24, grosor: 0.14 }, { x: 0.7, y: 0.32, grosor: 0.14 }, { x: 0.88, y: 0.55, grosor: 0.14 }];
const guirnalda: Guirnalda = {
  tipo: "guirnalda_organica", puntos: EJE, tamanos: {}, racimos: 0.4, colores: [BLANCO],
  mezcla: { gigantes: 5, grandes: 25, medianos: 50, chicos: 20, diametroGigante: 0.3, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
};
const lectura = (piezas: PiezaLeida[]): LecturaFoto => ({ resumen: "prueba", aspecto: ASPECTO, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: 0.9, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas });
const globo = (cx: number, cy: number, d: number): GloboDetectado => ({ box_2d: [Math.round((cy - d / 2) * 1000), Math.round((cx - d / 2) * 1000), Math.round((cy + d / 2) * 1000), Math.round((cx + d / 2) * 1000)], color: "blanco" });
/** Cuarenta globos de la guirnalda: a lo largo del eje, de a dos por punto. */
const DEL_ARCO: GloboDetectado[] = Array.from({ length: 40 }, (_, i) => {
  const t = i / 39, k = Math.min(3, Math.floor(t * 4)), u = t * 4 - k;
  const a = EJE[k]!, b = EJE[k + 1]!;
  return globo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + (i % 2 ? 0.02 : -0.02), 0.08);
});

prueba("los globos de una mesa de catálogo nueva, o de una base, no entran a la guirnalda", () => {
  for (const id of ["mesa_postres_mantel", "mesa_regalos", "carrito_dulces", "peldanos", "base_hexagonal", "columna_griega", "alfombra_redonda"]) {
    const mueble = fondo(id, 0.84, 0.9, 0.3, 0.3, { colores: [BLANCO] });
    const encima = [0.75, 0.8, 0.85, 0.9].map((x) => globo(x, 0.7, 0.09));
    const sin = medirConDetecciones(lectura([guirnalda, mueble]), DEL_ARCO);
    const con = medirConDetecciones(lectura([guirnalda, mueble]), [...DEL_ARCO, ...encima]);
    assert.deepEqual(con.lectura.piezas[0], sin.lectura.piezas[0], `los globos sobre «${id}» cambiaron la guirnalda`);
    assert.match(con.notas.join(" "), /cajas detectadas son de un fondo/, id);
  }
});

prueba("los mismos globos sobre un panel (sin superficie) siguen siendo de la guirnalda", () => {
  const panel = fondo("panel_redondo", 0.84, 0.9, 0.12, 0.12);
  const encima = [0.75, 0.8, 0.85, 0.9].map((x) => globo(x, 0.7, 0.09));
  const sin = medirConDetecciones(lectura([guirnalda, panel]), DEL_ARCO);
  const con = medirConDetecciones(lectura([guirnalda, panel]), [...DEL_ARCO, ...encima]);
  assert.ok(!/cajas detectadas son de un fondo/.test(con.notas.join(" ")), con.notas.join(" | "));
  assert.notEqual(JSON.stringify(con.lectura.piezas[0]), JSON.stringify(sin.lectura.piezas[0]));
});

console.log(`test-medir-fondos: ${pruebas} pruebas ok`);
