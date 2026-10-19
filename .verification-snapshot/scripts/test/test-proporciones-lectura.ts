/**
 * Proporciones de lo armado contra la foto (REQ-001): lo que pierde la forma de una guirnalda leída al compilarla.
 * - una punta libre de la guirnalda se recoge lo que sobresale su remate (el semiarco de arriba no sale completo); la que toca el
 *   piso no se toca;
 * - un telón de piso (marco con tela, pared de lentejuelas) del que la foto enseña solo la parte de arriba conserva su tope y se
 *   prolonga al piso; un panel redondo o un telón apoyado en el piso no cambia;
 * - un montón de piso cuyo pie se ve sobre la línea del piso (colgado de un aro) va en el aire, a esa altura.
 * - un globo suelto en el piso se coloca por su pie: el que se ve más abajo que la línea del piso está por delante y mide menos.
 * Sin coste: no llama a ningún modelo.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-proporciones-lectura.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "@/lib/globos3d/encuadre-foto";
import { armarEscena } from "@/lib/globos3d/escena";
import { centroDe } from "@/lib/globos3d/letras";
import { camaraNumerica, proyectar } from "@/lib/globos3d/proyeccion-foto";
import { LecturaFotoSchema, type LecturaFoto } from "@/lib/globos3d/lectura-foto";
import { FRACCION_PUNTA, recogerPuntas } from "@/lib/globos3d/puntas-lectura";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const blanco = [{ nombre: "blanco", hex: "#f5f3ee", peso: 100, acabado: "mate" as const }];
const MEZCLA = { grandes: 20, medianos: 60, chicos: 20, diametroGrande: 0.09, diametroMediano: 0.065, diametroChico: 0.03, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };
const H = 400, PISO = 0.74;

function lectura(piezas: LecturaFoto["piezas"]): LecturaFoto {
  return LecturaFotoSchema.parse({ resumen: "prueba de proporciones", aspecto: 0.75, escala: { altoImagenCm: H, referencia: "prueba" }, pisoY: PISO, sala: { pared: "#ece8e2", piso: "#8a5a36" }, piezas });
}
const marco = (yBase: number, alto: number): LecturaFoto["piezas"][number] => ({ tipo: "fondo", id: "marco_tela", x: 0.5, yBase, ancho: 0.59, alto, colores: blanco });
const caja = (l: LecturaFoto, prefijo: string) => armarEscena(compilarLectura(l).escena).porNodo.find((n) => n.id.startsWith(prefijo))!.caja;

console.log("Puntas de la guirnalda");
prueba("una punta libre se recoge hacia dentro medio radio y la del piso queda donde estaba", () => {
  const libres = recogerPuntas([{ x: 0, y: 150, grosor: 60 }, { x: 100, y: 150, grosor: 60 }, { x: 200, y: 150, grosor: 60 }]);
  assert.equal(libres[0]!.x, 30 * FRACCION_PUNTA);
  assert.equal(libres[2]!.x, 200 - 30 * FRACCION_PUNTA);
  assert.equal(libres[1]!.x, 100, "el punto de en medio no se mueve");
  const alPiso = recogerPuntas([{ x: 0, y: 150, grosor: 60 }, { x: 100, y: 150, grosor: 60 }, { x: 150, y: 30, grosor: 60 }]);
  assert.deepEqual(alPiso[2], { x: 150, y: 30, grosor: 60 }, "una punta a 0 cm del piso queda abierta: no lleva remate");
});

prueba("un primer tramo corto no se pliega sobre sí mismo", () => {
  const [a] = recogerPuntas([{ x: 0, y: 150, grosor: 100 }, { x: 10, y: 150, grosor: 100 }, { x: 200, y: 150, grosor: 100 }], 1);
  assert.ok(a!.x <= 6 + 1e-9, `se recogió ${a!.x} cm de un tramo de 10`);
});

prueba("la guirnalda armada no sobresale más de lo que dice su primer y último punto (el tramo de arriba del semiarco)", () => {
  const grosor = 0.15;
  const l = lectura([{ tipo: "guirnalda_organica", puntos: [{ x: 0.2, y: 0.3, grosor }, { x: 0.5, y: 0.28, grosor }, { x: 0.8, y: 0.3, grosor }], tamanos: {}, mezcla: MEZCLA, racimos: 0.3, colores: blanco }]);
  const c = caja(l, "guirnalda-organica");
  const centro = 0.5 * 0.75 * H;
  const izquierda = (0.2 * 0.75 * H) - centro, derecha = (0.8 * 0.75 * H) - centro;
  const g = grosor * H;
  assert.ok(izquierda - c.min.x < 0.4 * g, `sobresale ${(izquierda - c.min.x).toFixed(0)} cm por la izquierda (de un grosor de ${g.toFixed(0)})`);
  assert.ok(c.max.x - derecha < 0.4 * g, `sobresale ${(c.max.x - derecha).toFixed(0)} cm por la derecha`);
});

console.log("Telones con el pie tapado");
prueba("el marco con tela leído con el pie sobre el piso conserva su tope y llega al piso", () => {
  const c = caja(lectura([marco(0.63, 0.44)]), "marco-tela");
  const topeLeido = (PISO - 0.63) * H + 0.44 * H;
  assert.ok(Math.abs(c.max.y - topeLeido) <= 2, `tope ${c.max.y.toFixed(0)} cm, leído ${topeLeido.toFixed(0)} cm`);
  assert.ok(c.min.y <= 1, `el pie quedó a ${c.min.y.toFixed(0)} cm`);
});

prueba("el marco apoyado en el piso mide lo leído", () => {
  const c = caja(lectura([marco(PISO, 0.44)]), "marco-tela");
  assert.ok(Math.abs(c.max.y - 0.44 * H) <= 2, `tope ${c.max.y.toFixed(0)} cm`);
});

prueba("la pared de lentejuelas con el pie tapado también conserva su tope", () => {
  const l = lectura([{ tipo: "fondo", id: "lentejuelas", x: 0.5, yBase: 0.6, ancho: 0.5, alto: 0.4, colores: blanco }]);
  const c = caja(l, "lentejuelas");
  assert.ok(Math.abs(c.max.y - ((PISO - 0.6) * H + 0.4 * H)) <= 2, `tope ${c.max.y.toFixed(0)} cm`);
});

prueba("el panel redondo (su alto es un diámetro) no se prolonga", () => {
  const l = lectura([{ tipo: "fondo", id: "panel_redondo", x: 0.5, yBase: 0.6, ancho: 0.3, alto: 0.3, colores: blanco }]);
  const c = caja(l, "panel-redondo");
  const tope = (PISO - 0.6) * H + 0.3 * H;
  assert.ok(Math.abs(c.max.y - tope) <= 2, `tope ${c.max.y.toFixed(0)} cm, leído ${tope.toFixed(0)} cm (con el disco prolongado sería ${((PISO - 0.6) * H * 2 + 0.3 * H).toFixed(0)})`);
});

console.log("Montón colgado");
const monton = (yPie: number): LecturaFoto["piezas"][number] => ({ tipo: "racimo_piso", x: 0.3, yPie, yArriba: yPie - 0.25, ancho: 0.25, tamanos: {}, mezcla: MEZCLA, racimos: 0.5, colores: blanco });
prueba("un montón cuyo pie se ve sobre la línea del piso va en el aire, a esa altura", () => {
  const nodo = compilarLectura(lectura([monton(0.5)])).escena.nodos.find((n) => n.id.startsWith("racimo-piso"))!;
  assert.equal(nodo.colocacion.en, "libre");
  assert.ok(nodo.colocacion.en === "libre" && Math.abs(nodo.colocacion.yCm - (PISO - 0.5) * H) <= 1, JSON.stringify(nodo.colocacion));
});

prueba("un montón con el pie en la línea del piso o más abajo sigue en el piso", () => {
  for (const yPie of [PISO, 0.85]) {
    const nodo = compilarLectura(lectura([monton(yPie)])).escena.nodos.find((n) => n.id.startsWith("racimo-piso"))!;
    assert.equal(nodo.colocacion.en, "piso", `yPie ${yPie}`);
  }
});

console.log("Globos sueltos en el piso");
const suelto = (y: number): LecturaFoto["piezas"][number] => ({ tipo: "globo", x: 0.3, y, diametro: 0.1, en: "piso", colores: blanco });
prueba("un globo suelto cuyo pie se ve más abajo que la línea del piso está por delante de la decoración y, a igual tamaño en la foto, mide menos", () => {
  const en = (y: number) => { const n = compilarLectura(lectura([suelto(y)])).escena.nodos[0]!; return { colocacion: n.colocacion, pieza: n.pieza }; };
  const pared = en(PISO - 0.05), delante = en(0.93);
  assert.ok(pared.colocacion.en === "piso" && delante.colocacion.en === "piso");
  if (pared.colocacion.en === "piso" && delante.colocacion.en === "piso") assert.ok(delante.colocacion.zCm > pared.colocacion.zCm + 40, `z ${delante.colocacion.zCm} contra ${pared.colocacion.zCm}`);
  const inflado = (x: ReturnType<typeof en>) => (x.pieza.tipo === "globo" ? x.pieza.infladoCm : 0);
  assert.ok(inflado(delante) < inflado(pared), `inflado ${inflado(delante)} cm contra ${inflado(pared)} cm`);
});

prueba("el globo suelto armado se ve donde estaba su pie en la foto (la cámara de la foto lo proyecta en su fila)", () => {
  const l = lectura([suelto(0.93)]);
  const escena = compilarLectura(l).escena;
  const armada = armarEscena(escena);
  const camara = camaraNumerica(encuadreDeLectura(l), escena.sala);
  const g = armada.globos[0]!;
  const c = centroDe(g);
  const pie = proyectar(camara, { x: c.x, y: c.y - g.infladoCm / 2, z: c.z });
  const fila = pie ? (1 - pie.y) / 2 : NaN;
  assert.ok(Math.abs(fila - 0.93) < 0.04, `el pie cae en la fila ${fila.toFixed(3)} de 0,93`);
});

console.log(`test-proporciones-lectura: ${pruebas} pruebas ok`);
