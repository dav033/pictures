/**
 * T27: cotas de alto y ancho del visor del taller. Prueba el cálculo puro de `medidas-caja.ts` (el overlay
 * `EtiquetasMedidas.tsx` solo lo posiciona; el interruptor es el prop `activo`).
 * Run: npx tsx --conditions=react-server scripts/test/test-cotas-medidas.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Caja } from "../../src/lib/globos3d/escena";
import { medidasCajaEnMetros, medidasDePieza, textoMetros } from "../../src/lib/globos3d/medidas-caja";

const caja = (min: [number, number, number], max: [number, number, number]): Caja => ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });

test("una caja en cm da ancho (x), alto (y) y fondo (z) en metros redondeados al cm", () => {
  assert.deepEqual(medidasCajaEnMetros(caja([-120, 0, -20], [120, 230, 20])), { anchoM: 2.4, altoM: 2.3, fondoM: 0.4 });
  assert.deepEqual(medidasCajaEnMetros(caja([0, 0, 0], [100.4, 99.6, 0])), { anchoM: 1, altoM: 1, fondoM: 0 });
});

test("un arco de 3,46 m girado 90° sigue midiendo 3,46 m de ancho: se lee de su marco propio, no de los ejes del mundo", () => {
  const local = caja([-173, 0, -23], [173, 250, 23]);
  const girada = caja([-23, 0, -173], [23, 250, 173]);
  const m = medidasDePieza(local, girada, { en: "piso" });
  assert.equal(m.anchoM, 3.46);
  assert.equal(m.fondoM, 0.46);
  assert.equal(m.altoM, 2.5);
});

test("el alto sale del mundo: una pieza subida del piso mide lo mismo que su caja puesta, no más", () => {
  const local = caja([0, 0, 0], [50, 80, 50]);
  const mundo = caja([0, 100, 0], [50, 180, 50]);
  assert.equal(medidasDePieza(local, mundo, { en: "libre" }).altoM, 0.8);
});

test("lo colgado de un ancla o sobre otra pieza usa la caja puesta tal cual; sin marco propio también", () => {
  const local = caja([-100, 0, 0], [100, 10, 10]);
  const mundo = caja([0, 0, -100], [10, 10, 100]);
  assert.equal(medidasDePieza(local, mundo, { en: "sobre" }).anchoM, 0.1);
  assert.deepEqual(medidasDePieza(undefined, mundo, { en: "piso" }), medidasCajaEnMetros(mundo));
});

test("el texto de la cota va en metros con coma decimal y dos cifras", () => {
  assert.equal(textoMetros(2.4), "2,40 m");
  assert.equal(textoMetros(0.05), "0,05 m");
  assert.equal(textoMetros(3.456), "3,46 m");
});
