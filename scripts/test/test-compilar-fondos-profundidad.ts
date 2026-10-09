/**
 * Los fondos y muebles de piso de una lectura siguen el modelo de profundidad de la foto (`compilar-lectura.ts`, `profundidadEnElPiso`),
 * igual que el montón de piso: si su pie se ve más abajo que la línea del piso están más cerca de la cámara, se ven más grandes de lo que
 * son y se ponen en la profundidad que dice su pie (en vez de a un retiro fijo de la pared). Sin coste ni red.
 * - una mesa, unos pedestales, un tapete y una silla en primer plano miden menos (su tamaño real) y su cara de delante queda donde dice
 *   el pie; con el pie en la línea del piso conservan su retiro y su medida de siempre;
 * - los paneles pegados a la pared (panel redondo, lentejuelas) no se mueven aunque el pie baje: fijan la escala de la foto.
 *
 * Run: npx tsx scripts/test/test-compilar-fondos-profundidad.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { armarEscena } from "@/lib/globos3d/escena";
import { profundidadEnElPiso } from "@/lib/globos3d/encuadre-foto";
import { PROFUNDIDAD_DE_LA_FOTO_CM } from "@/lib/globos3d/proyeccion-foto";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "@/lib/globos3d/lectura-foto";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 100, acabado: "mate" };
const PISO = 0.8;
const fondo = (id: string, yBase: number, ancho: number, alto: number, extra: Partial<Extract<PiezaLeida, { tipo: "fondo" }>> = {}): PiezaLeida => ({ tipo: "fondo", id, x: 0.5, yBase, ancho, alto, colores: [BLANCO], ...extra });
const lectura = (piezas: PiezaLeida[]): LecturaFoto => ({ resumen: "prueba de profundidad", aspecto: 1, escala: { altoImagenCm: 300, referencia: "prueba" }, pisoY: PISO, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas });

/** El nodo armado de la primera pieza que compila `piezas`, con su ancho, alto y z de centro (cm). */
function medidas(piezas: PiezaLeida[], prefijo: string) {
  const { escena, omitidas } = compilarLectura(lectura(piezas));
  assert.deepEqual(omitidas, []);
  const n = armarEscena(escena).porNodo.find((x) => x.id.startsWith(prefijo));
  assert.ok(n, `no hay nodo ${prefijo}`);
  return { ancho: n.caja.max.x - n.caja.min.x, alto: n.caja.max.y - n.caja.min.y, zFrente: n.caja.max.z, zCentro: (n.caja.max.z + n.caja.min.z) / 2 };
}

for (const [id, prefijo, ancho, alto] of [["mesa_mantel", "mesa-mantel", 0.4, 0.3], ["pedestales", "pedestales", 0.4, 0.3], ["tapete_redondo", "tapete-redondo", 0.5, 0.15]] as const) {
  prueba(`${id} con el pie delante del piso se ve a su tamaño real y se pone donde dice su pie`, () => {
    const enLinea = medidas([fondo(id, PISO, ancho, alto, { colores: [BLANCO, BLANCO, BLANCO] })], prefijo);
    const delante = medidas([fondo(id, 0.97, ancho, alto, { colores: [BLANCO, BLANCO, BLANCO] })], prefijo);
    assert.ok(delante.ancho < enLinea.ancho * 0.9, `ancho ${delante.ancho.toFixed(0)} vs ${enLinea.ancho.toFixed(0)}`);
    if (id !== "tapete_redondo") assert.ok(delante.alto < enLinea.alto * 0.9, `alto ${delante.alto.toFixed(0)} vs ${enLinea.alto.toFixed(0)}`);
    // Su cara de delante queda donde dice su pie (el modelo de profundidad), no a su retiro de la pared.
    const esperado = -250 + PROFUNDIDAD_DE_LA_FOTO_CM + profundidadEnElPiso(lectura([]), 0.97).delanteCm;
    assert.ok(Math.abs(delante.zFrente - esperado) <= 8, `z ${delante.zFrente.toFixed(0)}, esperado ${esperado}`);
  });
}

prueba("tres pedestales de primer plano no pasan de su altura real (no 130 cm)", () => {
  const p = fondo("pedestales", 0.97, 0.45, 0.4, { colores: [BLANCO, BLANCO, BLANCO] });
  const delante = medidas([p], "pedestales");
  const enLinea = medidas([{ ...p, yBase: PISO } as PiezaLeida], "pedestales");
  assert.ok(delante.alto < enLinea.alto * 0.85, `${delante.alto.toFixed(0)} vs ${enLinea.alto.toFixed(0)}`);
});

prueba("una mesa del catálogo y una silla en primer plano también se achican y se ponen donde dice su pie", () => {
  for (const [id, prefijo] of [["mesa_postres_mantel", "mesa-postres-mantel"], ["silla_tiffany", "silla-tiffany"]] as const) {
    const enLinea = medidas([fondo(id, PISO, 0.4, 0.25)], prefijo);
    const delante = medidas([fondo(id, 0.97, 0.4, 0.25)], prefijo);
    assert.ok(delante.alto <= enLinea.alto, id);
    const esperado = -250 + PROFUNDIDAD_DE_LA_FOTO_CM + profundidadEnElPiso(lectura([]), 0.97).delanteCm;
    assert.ok(Math.abs(delante.zFrente - esperado) <= 8, `${id}: z ${delante.zFrente.toFixed(0)}, esperado ${esperado}`);
    assert.notEqual(Math.round(delante.zFrente), Math.round(enLinea.zFrente), `${id}: sigue en el retiro de siempre`);
  }
  const a = medidas([fondo("mesa_postres_mantel", PISO, 0.4, 0.25)], "mesa-postres-mantel");
  const b = medidas([fondo("mesa_postres_mantel", 0.97, 0.4, 0.25)], "mesa-postres-mantel");
  assert.ok(b.ancho < a.ancho, `ancho ${b.ancho.toFixed(0)} vs ${a.ancho.toFixed(0)}`);
});

prueba("un pie en la línea del piso conserva el retiro de siempre", () => {
  const { escena } = compilarLectura(lectura([fondo("mesa_mantel", PISO, 0.4, 0.2)]));
  const nodo = escena.nodos.find((n) => n.id.startsWith("mesa-mantel"))!;
  assert.equal(nodo.colocacion.en, "piso");
  assert.equal((nodo.colocacion as { zCm: number }).zCm, -250 + 120);
});

prueba("un panel pegado a la pared no se mueve aunque su pie quede bajo la línea del piso", () => {
  const a = compilarLectura(lectura([fondo("panel_redondo", PISO, 0.4, 0.4)])).escena.nodos[0]!;
  const b = compilarLectura(lectura([fondo("panel_redondo", 0.97, 0.4, 0.4)])).escena.nodos[0]!;
  assert.equal((a.colocacion as { zCm: number }).zCm, (b.colocacion as { zCm: number }).zCm);
});

prueba("los telones del catálogo de muebles (marco con tela, aros, arco metálico, biombo) tampoco avanzan hacia la cámara", () => {
  for (const id of ["marco_tela", "aro_metalico", "aro_hexagonal", "arco_metalico", "biombo"]) {
    const a = compilarLectura(lectura([fondo(id, PISO, 0.4, 0.4)])).escena.nodos[0]!;
    const b = compilarLectura(lectura([fondo(id, 0.97, 0.4, 0.4)])).escena.nodos[0]!;
    assert.deepEqual(b.colocacion, a.colocacion, `${id} no debe moverse con el pie`);
  }
});

console.log(`test-compilar-fondos-profundidad: ${pruebas} pruebas ok`);
