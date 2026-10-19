import assert from "node:assert/strict";
import test from "node:test";
import { alturaDePieza } from "./altura-pieza";
import { alturaEstimada } from "./altura-estimada";
import { SALA_INICIAL, type Escena } from "./escena";
import { aplicarHerramienta } from "./herramientas-escena";
import { comprobadorDeAlto, crearCuota } from "./herramientas-escena-tamanos-busqueda";
import { conGrosor, esPiezaOrganica, opcionesDe, type Organico } from "./organico-ajustes";
import { EMPAQUES } from "./organico-empaques";

const sala = { ...SALA_INICIAL, altoCm: 700, anchoCm: 1200 };
const crear = (pedido: Record<string, unknown>): Organico => {
  const r = aplicarHerramienta({ sala, nodos: [] } satisfies Escena, "agregar_pieza", pedido);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const pieza = r.escena.nodos[0]!.pieza;
  assert.ok(esPiezaOrganica(pieza) && pieza.tipo === "organico");
  return pieza as Organico;
};

const PIEZAS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["columna de 200 × 70", { tipo: "columna_organica", alto_cm: 200, grosor_cm: 70 }],
  ["semiarco de 150 × 200", { tipo: "semiarco_organico", ancho_cm: 150, alto_cm: 200, grosor_cm: 60 }],
  ["marco de 220 × 230", { tipo: "marco_organico", ancho_cm: 220, alto_cm: 230, grosor_cm: 60 }],
];

test("el alto de un cuerpo más grueso, sin armarlo, cae a pocos centímetros del de verdad", () => {
  for (const [nombre, pedido] of PIEZAS) {
    const base = crear(pedido);
    const altoBase = alturaDePieza(base);
    for (const factor of [1.12, 1.25]) {
      const gruesa = conGrosor(base, factor) as Organico;
      const estimado = alturaEstimada(altoBase, opcionesDe(base), opcionesDe(gruesa));
      const real = alturaDePieza(gruesa);
      assert.ok(Math.abs(estimado - real) <= 4, `${nombre} ×${factor}: estimado ${estimado.toFixed(1)}, real ${real.toFixed(1)}`);
    }
  }
});

test("el comprobador de alto decide sin armar lo que queda lejos del techo y arma solo lo que queda dentro del margen", () => {
  const base = crear(PIEZAS[0]![1]);
  const alto = alturaDePieza(base);
  const gruesa = conGrosor(base, 1.37) as Organico;
  const cuota = crearCuota(base);
  const antes = EMPAQUES.hechos;
  assert.equal(comprobadorDeAlto(base, alto + 80, cuota)(gruesa), "si");
  assert.equal(comprobadorDeAlto(base, alto + 1, cuota)(gruesa), "no");
  assert.equal(EMPAQUES.hechos, antes, "las dos decisiones, sin armar");
  // Con el techo donde cae la estimación, está dentro del margen: se arma de verdad y decide el alto armado.
  const techoAlFilo = alturaEstimada(alto, opcionesDe(base), opcionesDe(gruesa));
  const antesDelFilo = EMPAQUES.hechos;
  assert.equal(comprobadorDeAlto(base, techoAlFilo, cuota)(gruesa), alturaDePieza(gruesa) <= techoAlFilo ? "si" : "no");
  assert.ok(EMPAQUES.hechos - antesDelFilo <= 1, "armó la pieza más gruesa, si no estaba ya armada");
  assert.equal(comprobadorDeAlto(base, undefined, cuota)(gruesa), "si", "sin techo, siempre cabe");
});
