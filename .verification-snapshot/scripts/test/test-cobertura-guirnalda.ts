/**
 * El cuerpo de una guirnalda orgánica compilada de una foto no tiene huecos (REQ-001, relleno tupido). Sin red ni coste.
 * Se mide de frente: una banda a cada lado del eje, hasta el 90 % de su semigrosor, y cada punto cuenta como cubierto si cae dentro del
 * círculo de algún globo (`lib-cobertura-guirnalda.ts`). En las fotos de referencia 07 y 01 del dueño:
 * - la cobertura del cuerpo no baja de 93 % (la 07 queda entera) y ningún tramo de 30 cm del eje queda al descubierto más de una cuarta parte;
 * - el control: si se quitan los globos de un tramo, la prueba lo ve (sin esto una medida ciega daría siempre «bien»);
 * - el relleno mediano sigue ahí para taparlas: la pieza lleva un relleno sin tope ni racimos (los chicos en racimos no tapan fugas sueltos).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-cobertura-guirnalda.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { REFERENCIAS_DUENO } from "../../src/lib/globos3d/referencias-dueno";
import { coberturaDelCuerpo, ejeEnCm } from "./lib-cobertura-guirnalda";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const COBERTURA_MINIMA = 0.93;
const PEOR_VENTANA_MAXIMA = 0.25;

for (const numero of [7, 1]) {
  const lectura = REFERENCIAS_DUENO.find((r) => r.numero === numero)!.lectura;
  const nodo = armarEscena(compilarLectura(lectura).escena).porNodo.find((n) => n.id.startsWith("guirnalda-organica"))!;
  const eje = ejeEnCm(lectura);

  prueba(`foto ${String(numero).padStart(2, "0")}: el cuerpo de la guirnalda se ve entero (sin huecos por donde se vea la pared)`, () => {
    const c = coberturaDelCuerpo(eje, nodo.globos);
    assert.ok(c.puntos > 500, `${c.puntos} puntos muestreados`);
    assert.ok(c.cobertura >= COBERTURA_MINIMA, `cobertura ${(c.cobertura * 100).toFixed(1)} %`);
    assert.ok(c.peorVentana <= PEOR_VENTANA_MAXIMA, `un tramo de 30 cm queda ${(c.peorVentana * 100).toFixed(0)} % al descubierto`);
  });

  prueba(`foto ${String(numero).padStart(2, "0")}: una guirnalda con un tramo sin globos falla la prueba`, () => {
    const xs = nodo.globos.map((g) => g.nudo.x);
    const medio = (Math.min(...xs) + Math.max(...xs)) / 2;
    const conHueco = nodo.globos.filter((g) => Math.abs(g.nudo.x - medio) > 25);
    const c = coberturaDelCuerpo(eje, conHueco);
    assert.ok(c.cobertura < COBERTURA_MINIMA || c.peorVentana > PEOR_VENTANA_MAXIMA, `la medida no ve el hueco (cobertura ${(c.cobertura * 100).toFixed(1)} %)`);
  });

  prueba(`foto ${String(numero).padStart(2, "0")}: la pieza lleva un relleno que tapa fugas (sin tope ni racimos)`, () => {
    const pieza = compilarLectura(lectura).escena.nodos.find((n) => n.id.startsWith("guirnalda-organica"))!.pieza;
    assert.equal(pieza.tipo, "organico");
    if (pieza.tipo !== "organico") return;
    const rellenos = pieza.opciones.relleno;
    assert.ok(rellenos.some((r) => r.racimo === undefined && r.maximo === undefined), `relleno: ${JSON.stringify(rellenos)}`);
  });
}

console.log(`test-cobertura-guirnalda: ${pruebas} pruebas ok`);
