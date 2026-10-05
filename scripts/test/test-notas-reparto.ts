/**
 * Las notas del reparto de color no son instrucciones para el modelo (2026-10-05).
 *
 * Python dice en `advertencias` cuándo lo que una pieza compra se separa del reparto que declara
 * (`reparto_distinto`), un color se queda sin globos (`color_sin_globos`), un patrón sugerido no cabe
 * (`patron_sin_aplicar`) o la pista de la foto pierde un acento (`pista_patron_incompleta`). El prompt de sistema
 * trata `advertencias` como instrucciones para corregir el plan, y ninguna de esas cuatro se corrige
 * volviendo a confirmar: un arco clásico reparte su espiral por igual pida lo que pida la participación. Por eso
 * `confirmar_plan_decoracion` las manda aparte, en `notas_reparto`, y el prompt dice que se explican, no se
 * corrigen.
 *
 *   npx tsx --conditions=react-server scripts/test/test-notas-reparto.ts
 *
 * Sin red, sin proveedor, sin coste.
 */
import assert from "node:assert/strict";
import { separarNotasReparto } from "../../src/lib/ia/herramientas/registro-herramientas";
import { SYSTEM_PROMPT_BASE } from "../../src/lib/ia/omoikane/prompt-sistema";

const PUERTA = "puerta_fisica:EST_01_ARCO: Arco: 24 globos por metro está fuera de la banda de su densidad.";
const SOBRANTE = "sobrante_alto:V-F14-AMARILLO-9";
const REPARTO = "reparto_distinto:EST_01_ARCO: Arco principal: el plan declara blanco 70 %, dorado 20 % y rosado 10 %; lo que se compra es blanco 34 %, dorado 33 % y rosado 33 % (30, 29 y 29 globos).";
const SIN_GLOBOS = "color_sin_globos:EST_02_CENTRO:dorado: Centro de mesa: el dorado que declara el plan se queda sin globos y no se compra: la pieza lleva 2 globos y no alcanza uno para cada uno de sus 3 colores.";
const PATRON = "patron_sin_aplicar:EST_03_COLUMNA: Columna: el patrón de color sugerido no cabe.";
const PISTA = "pista_patron_incompleta:EST_01_ARCO: Arco principal: la foto muestra lila y esta pieza no lo lleva.";

let fallos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
    console.log(`  ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`  FAIL ${nombre}`);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

caso("las cuatro notas del reparto salen de advertencias, en su orden", () => {
  const { advertencias, notasReparto } = separarNotasReparto([PUERTA, REPARTO, SOBRANTE, SIN_GLOBOS, PATRON, PISTA]);
  assert.deepEqual(notasReparto, [REPARTO, SIN_GLOBOS, PATRON, PISTA]);
  assert.deepEqual(advertencias, [PUERTA, SOBRANTE], "lo que sí es una instrucción se queda donde estaba");
});

caso("sin notas no cambia nada", () => {
  assert.deepEqual(separarNotasReparto([PUERTA, SOBRANTE]), { advertencias: [PUERTA, SOBRANTE], notasReparto: [] });
  assert.deepEqual(separarNotasReparto([]), { advertencias: [], notasReparto: [] });
});

caso("un prefijo solo cuenta al principio: un texto que lo menciona sigue siendo advertencia", () => {
  const menciona = "sobrante_alto:V-1 (ver reparto_distinto: no aplica)";
  assert.deepEqual(separarNotasReparto([menciona]).advertencias, [menciona]);
});

caso("el prompt de sistema dice que notas_reparto se explican y no se corrigen", () => {
  assert.match(SYSTEM_PROMPT_BASE, /"notas_reparto" NO son instrucciones/);
  assert.match(SYSTEM_PROMPT_BASE, /No vuelvas a confirmar el plan por ellas/);
  // Y la regla de siempre sigue: advertencias sí son instrucciones.
  assert.match(SYSTEM_PROMPT_BASE, /"errores", "advertencias" y "accion_requerida" son instrucciones/);
});

console.log(fallos ? `\n${fallos} caso(s) fallan` : "\n[PASS] notas del reparto: se explican, no se corrigen");
process.exit(fallos ? 1 : 0);
