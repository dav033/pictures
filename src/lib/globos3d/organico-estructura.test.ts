import assert from "node:assert/strict";
import test from "node:test";
import { SALA_INICIAL, type Escena } from "./escena";
import { aplicarHerramienta } from "./herramientas-escena";
import { filtroZona } from "./herramientas-escena-tamanos-busqueda";
import { armarOrganico } from "./organico";
import { EMPAQUES } from "./organico-empaques";
import { esPiezaOrganica, opcionesDe } from "./organico-ajustes";
import { contarEstructura, globosDeEstructura } from "./organico-estructura";
import type { ZonaOrganica } from "./zonas-organicas";

const sala = { ...SALA_INICIAL, altoCm: 600, anchoCm: 1200 };
const crear = (pedido: Record<string, unknown>) => {
  const vacia: Escena = { sala, nodos: [] };
  const r = aplicarHerramienta(vacia, "agregar_pieza", pedido);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const pieza = r.escena.nodos[0]!.pieza;
  assert.ok(esPiezaOrganica(pieza));
  return opcionesDe(pieza);
};

const PIEZAS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["columna de 200 × 70", { tipo: "columna_organica", alto_cm: 200, grosor_cm: 70 }],
  ["guirnalda de 400 × 45", { tipo: "guirnalda_organica", ancho_cm: 400, grosor_cm: 45 }],
  ["semiarco de 150 × 200", { tipo: "semiarco_organico", ancho_cm: 150, alto_cm: 200, grosor_cm: 60 }],
];

test("la cuenta sin armar es lo que el empaque se propone poner: nunca menos de lo que arma, y a poca distancia (solo se pierden los que no caben sin montarse)", () => {
  for (const [nombre, pedido] of PIEZAS) {
    const o = crear(pedido);
    const armados = armarOrganico(o).globos.filter((g) => g.tamano !== "relleno");
    for (const formato of ["R-24", "R-18", "R-12"]) {
      const estimado = contarEstructura(o, formato).cantidad, armado = armados.filter((g) => g.formatoId === formato).length;
      assert.ok(estimado >= armado && estimado - armado <= Math.max(3, 0.15 * estimado), `${nombre}: ${formato} estimado ${estimado}, armado ${armado}`);
    }
  }
});

test("contar la estructura no arma nada", () => {
  const o = crear(PIEZAS[1]![1]);
  const antes = EMPAQUES.hechos;
  contarEstructura(o, "R-24");
  contarEstructura(o, "R-12", filtroZona(o, "medio"));
  globosDeEstructura(o);
  assert.equal(EMPAQUES.hechos, antes);
});

test("en una zona se cuenta la parte del recorrido que la cumple: los tres tercios suman el total", () => {
  const o = crear(PIEZAS[1]![1]);
  const total = contarEstructura(o, "R-12");
  const tercios = (["inicio", "medio", "fin"] as ZonaOrganica[]).map((zona) => contarEstructura(o, "R-12", filtroZona(o, zona)));
  assert.ok(Math.abs(tercios.reduce((s, t) => s + t.cantidad, 0) - total.cantidad) <= 3, `${tercios.map((t) => t.cantidad)} contra ${total.cantidad}`);
  assert.ok(Math.abs(tercios.reduce((s, t) => s + t.estructura, 0) - total.estructura) <= 6);
  assert.ok(tercios.every((t) => t.cantidad < total.cantidad));
});

test("un cuerpo de solo R-5 lleva muchos más globos de estructura que el de la mezcla de siempre, y uno de R-24, muchos menos", () => {
  const medida = { tipo: "columna_organica", alto_cm: 200, grosor_cm: 90 } as const;
  const mezcla = globosDeEstructura(crear(medida));
  const chicos = globosDeEstructura(crear({ ...medida, tamanos: ["R-5"] }));
  const grandes = globosDeEstructura(crear({ ...medida, tamanos: ["R-24"] }));
  assert.ok(chicos > 2 * mezcla, `R-5 ${chicos} contra la mezcla ${mezcla}`);
  assert.ok(grandes < mezcla, `R-24 ${grandes} contra la mezcla ${mezcla}`);
});
