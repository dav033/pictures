/**
 * `ajustar_tamanos` bajo un techo. Sin coste.
 * - la pieza nunca pasa de lo que cabe de alto: ni al engrosar el cuerpo para que quepa un formato, ni al engrosar una zona,
 *   ni por todo el cuerpo, ni por la densidad, ni porque los globos grandes que se piden sobresalgan; en vez de un error, la
 *   herramienta se queda más corta y lo dice;
 * - «cabe» se mide con la MISMA función con que la herramienta valida una pieza (`alturaDePieza`): la herramienta de escena
 *   acepta lo que `ajustar_tamanos` deja bajo el techo.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-ajustar-tamanos-techo.ts
 */
import assert from "node:assert/strict";
import { alturaDePieza } from "../../src/lib/globos3d/altura-pieza";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { piezaDeGenerador } from "../../src/lib/globos3d/generadores-organicos";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { ajustarTamanos, type PedidoTamanos } from "../../src/lib/globos3d/herramientas-escena-tamanos";
import type { Pieza } from "../../src/lib/globos3d/piezas";
import { puntosDeSilueta, type PuntoTrazo } from "../../src/lib/globos3d/trazo-organico";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
type Organico = Extract<Pieza, { tipo: "organico" }>;

const pieza = (grosor: number, puntos?: PuntoTrazo[]): Organico => piezaDeGenerador({
  tipo: "trazo", trazo: { puntos: puntos ?? puntosDeSilueta("feston", { anchoCm: 320, altoCm: 170, grosorCm: grosor }), mezcla: { "R-12": 0.55, "R-9": 0.25, "R-5": 0.2 }, colores: [{ codigo: "032", peso: 50 }, { codigo: "005", peso: 50 }], racimos: 0.3, semilla: 9 },
}, null, 0);

/** El festón con las puntas finas y el medio grueso: un R-24 cabe en parte del cuerpo. */
const conPuntasFinas = () => pieza(100, puntosDeSilueta("feston", { anchoCm: 320, altoCm: 170, grosorCm: 100 }).map((q, i, v) => (i === 0 || i === v.length - 1 ? { ...q, grosor: 24 } : q)));

const SOBRA_CM = 3;
function acotado(p: Organico, pedido: PedidoTamanos) {
  const techo = alturaDePieza(p) + SOBRA_CM;
  const notas: string[] = [];
  const r = ajustarTamanos(p, pedido, notas, techo);
  return { r, notas, techo, alto: alturaDePieza(r.pieza), libre: alturaDePieza(ajustarTamanos(p, pedido, []).pieza) };
}

console.log("Cada camino de engrosar respeta el techo");
prueba("el formato no cabe en ningún punto: engrosar lo que piden pasaría del techo, se queda como está y lo dice", () => {
  const { r, notas, techo, alto, libre } = acotado(pieza(40), { cambios: [{ formato: "R-24", accion: "mas" }] });
  assert.ok(libre > techo, "sin techo, el cuerpo sube más de lo que cabe");
  assert.ok(alto <= techo, `${alto} contra ${techo}`);
  assert.ok(notas.some((n) => /no caben en el cuerpo de ahora y engrosarlo/.test(n)), notas.join(" | "));
  assert.match(r.resumen, /no llegué a la meta/);
});

prueba("el formato cabe en parte del cuerpo: no se engruesa la zona ni todo el cuerpo si pasan del techo, y los globos grandes que sobresalen se recortan", () => {
  const { notas, techo, alto, libre } = acotado(conPuntasFinas(), { cambios: [{ formato: "R-24", accion: "poner", cantidad: 30 }] });
  assert.ok(libre > techo);
  assert.ok(alto <= techo, `${alto} contra ${techo}`);
  assert.ok(notas.some((n) => /no engrosé/.test(n)), notas.join(" | "));
});

prueba("la densidad no engruesa el cuerpo pasando del techo", () => {
  const p = pieza(70);
  assert.match(ajustarTamanos(p, { densidad_factor: 1.03 }, []).resumen, /engrosé el cuerpo un 15 %/, "sin techo, este pedido sí engruesa");
  const { r, alto, techo } = acotado(p, { densidad_factor: 1.03 });
  assert.ok(alto <= techo, `${alto} contra ${techo}`);
  assert.match(r.resumen, /pasaría de los [0-9]+ cm que caben bajo el techo/);
});

prueba("con la pieza ya al límite del techo, un pedido que no cabe ni con el peso mínimo la deja como estaba (sin error)", () => {
  const p = conPuntasFinas();
  const techo = alturaDePieza(p);
  const r = ajustarTamanos(p, { cambios: [{ formato: "R-24", accion: "poner", cantidad: 30 }] }, [], techo);
  assert.ok(alturaDePieza(r.pieza) <= techo + 0.01, `${alturaDePieza(r.pieza)} contra ${techo}`);
});

prueba("sin techo, todo sigue como antes (engrosa)", () => {
  const p = pieza(40);
  const libre = ajustarTamanos(p, { cambios: [{ formato: "R-24", accion: "mas" }] }, []);
  assert.ok(alturaDePieza(libre.pieza) > alturaDePieza(p));
  assert.match(libre.resumen, /R-24: 0 → [1-9]/);
});

console.log("La herramienta de escena y la misma medida de alto");
const escenaCon = (p: Organico, altoSala: number): Escena => ({ sala: { ...SALA_INICIAL, altoCm: altoSala }, nodos: [{ id: "guirnalda", nombre: "Guirnalda", pieza: p, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] });

prueba("ajustar_tamanos en una sala justa no da el error de «no cabe bajo el techo»: se queda más corta", () => {
  const p = pieza(40);
  const sala = Math.ceil(alturaDePieza(p)) + SOBRA_CM;
  const r = aplicarHerramienta(escenaCon(p, sala), "ajustar_tamanos", { id: "guirnalda", cambios: [{ formato: "R-24", accion: "mas" }] });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const nueva = r.ok ? r.escena.nodos[0]!.pieza : p;
  assert.ok(alturaDePieza(nueva) <= sala, `${alturaDePieza(nueva)} contra una sala de ${sala}`);
});

prueba("la herramienta y ajustar_tamanos miden igual: lo que deja bajo el techo lo acepta cambiar_pieza", () => {
  const p = pieza(40);
  const alto = Math.ceil(alturaDePieza(p));
  const r = aplicarHerramienta(escenaCon(p, alto + SOBRA_CM), "cambiar_pieza", { id: "guirnalda", nombre: "Otro nombre" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const estrecha = aplicarHerramienta(escenaCon(p, alto - 5), "cambiar_pieza", { id: "guirnalda", nombre: "Otro nombre" });
  assert.ok(!estrecha.ok && /no cabe bajo el techo/.test(estrecha.error));
});

console.log(`test-ajustar-tamanos-techo: ${pruebas} pruebas ok`);
