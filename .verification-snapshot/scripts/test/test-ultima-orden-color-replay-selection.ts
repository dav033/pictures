/** REQ-016 M2 audit blocker: repeating one order must not drift to another shade in the same selection. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aplicarEdicion, ContextoOrdenColorSchema, crearContextoOrdenColorVacio,
  especDesdePropuesta, podarContextoOrdenColor,
} from "../../src/lib/globos3d/motor/v1";
import { abrirContextoPlan, crearTokenPlan } from "../../src/lib/plan/aprobacion";

const { espec: initial } = especDesdePropuesta({
  frase: "Audit replay selection",
  colores: ["azul", "blanco"],
  piezas: [{ estructura: "columna", cantidad: 2 }],
});
const espec = {
  ...initial,
  piezas: initial.piezas.map((piece, index) => ({
    ...piece,
    colores: [
      { codigo: index === 0 ? "011" : "009", nombre: index === 0 ? "fashion rosa" : "rosado", peso: 0.5 },
      { codigo: "040", nombre: "azul", peso: 0.5 },
    ],
  })),
};
const order = { op: "reemplazar_color", de: "rosado", a: "rojo reflex" } as const;
const first = aplicarEdicion(espec, order, { ordenColor: crearContextoOrdenColorVacio() });

test("identical selection keeps original exact-card resolution, including untouched pieces", () => {
  assert.equal(first.noAplicado, undefined);
  assert.deepEqual(first.tocadas, [initial.piezas[1]!.id]);
  assert.equal(first.espec.piezas[0]!.colores[0]!.codigo, "011");
  const repeat = aplicarEdicion(first.espec, order, { ordenColor: first.ordenColor });
  assert.deepEqual(repeat.espec, first.espec, "the identical order/selection must not reinterpret the previously untouched 011 after removing 009 elsewhere");
  assert.ok(repeat.noAplicado);
  assert.doesNotMatch(repeat.noAplicado, /puede ser|¿/);
});

test("replaying only the untouched piece reports an honest no-op", () => {
  const repeat = aplicarEdicion(first.espec, { ...order, piezas: [espec.piezas[0]!.id] }, { ordenColor: first.ordenColor });
  assert.deepEqual(repeat.espec, first.espec);
  assert.match(repeat.noAplicado!, /no cambiaba/);
  assert.doesNotMatch(repeat.noAplicado!, /ya estaba aplicado/);
});

test("expanded selections apply to new pieces and retain unselected snapshots", () => {
  const third = { ...espec.piezas[0]!, id: "EST_03_COLUMNA", nombre: "Third column" };
  const expanded = { ...first.espec, piezas: [...first.espec.piezas, third] };
  const next = aplicarEdicion(expanded, { ...order, piezas: [third.id] }, { ordenColor: first.ordenColor });
  assert.deepEqual(next.tocadas, [third.id]);
  assert.equal(next.espec.piezas[2]!.colores[0]!.codigo, "915");
  const replay = aplicarEdicion(next.espec, order, { ordenColor: next.ordenColor });
  assert.deepEqual(replay.espec, next.espec);
});

test("size edits preserve untouched source resolutions", () => {
  const sized = aplicarEdicion(first.espec, { op: "tamano_pieza", pieza: espec.piezas[0]!.id, direccion: 1 }, { ordenColor: first.ordenColor });
  assert.equal(sized.noAplicado, undefined);
  const replay = aplicarEdicion(sized.espec, order, { ordenColor: sized.ordenColor });
  assert.deepEqual(replay.espec, sized.espec);
});

test("colour changes invalidate only the affected untouched snapshot", () => {
  const changed = aplicarEdicion(first.espec, { op: "agregar_color", color: "verde", piezas: [espec.piezas[0]!.id] }, { ordenColor: first.ordenColor });
  const replay = aplicarEdicion(changed.espec, order, { ordenColor: changed.ordenColor });
  assert.deepEqual(replay.tocadas, [espec.piezas[0]!.id]);
  assert.ok(replay.espec.piezas[0]!.colores.some((color) => color.codigo === "915"));
});

test("pruning the last changed piece retains valid untouched resolutions", () => {
  const removed = { ...first.espec, piezas: [first.espec.piezas[0]!] };
  const context = ContextoOrdenColorSchema.parse(podarContextoOrdenColor(first.ordenColor!, removed));
  assert.deepEqual(context.lastReplacement!.piezasCambiadas, []);
  const replay = aplicarEdicion(removed, order, { ordenColor: context });
  assert.deepEqual(replay.espec, removed);
});

test("a new destination or explicit source can still change the untouched piece", () => {
  const destination = aplicarEdicion(first.espec, { ...order, a: "blanco" }, { ordenColor: first.ordenColor });
  assert.deepEqual(destination.tocadas, [espec.piezas[0]!.id]);
  const source = aplicarEdicion(first.espec, { ...order, de: "011" }, { ordenColor: first.ordenColor });
  assert.deepEqual(source.tocadas, [espec.piezas[0]!.id]);
});

test("v1 history remains readable without inventing missing untouched resolutions", () => {
  const current = ContextoOrdenColorSchema.parse(first.ordenColor);
  assert.equal(current.v, "colour-order.v2");
  assert.ok(current.lastReplacement);
  const { resolucionesSinCambio: snapshots, ...record } = current.lastReplacement;
  assert.ok(snapshots.length);
  const legacy = ContextoOrdenColorSchema.parse({ v: "colour-order.v1", lastReplacement: record });
  const pruned = podarContextoOrdenColor(legacy, first.espec);
  assert.equal(pruned.v, "colour-order.v1");
  assert.deepEqual(pruned.lastReplacement!.cambiosPorPieza, record.cambiosPorPieza);
  assert.ok(!("resolucionesSinCambio" in pruned.lastReplacement!));
  const replay = aplicarEdicion(first.espec, { ...order, piezas: [espec.piezas[1]!.id] }, { ordenColor: legacy });
  assert.deepEqual(replay.espec, first.espec);
});

test("signed v2 history survives reload; default writer still emits token v2 without history", () => {
  const prior = process.env.PLAN_COLOR_ORDER_V3;
  try {
    const input = { planHash: "replay-selection-test", requestId: "replay-selection-test", backend: "globos3d" as const, catalogSnapshotId: null, allowlist: [], colorOrder: first.ordenColor };
    delete process.env.PLAN_COLOR_ORDER_V3;
    assert.equal(abrirContextoPlan(crearTokenPlan(input))?.colorOrder, undefined);
    process.env.PLAN_COLOR_ORDER_V3 = "true";
    const context = abrirContextoPlan(crearTokenPlan(input));
    assert.deepEqual(context?.colorOrder, first.ordenColor);
    const replay = aplicarEdicion(first.espec, order, { ordenColor: context?.colorOrder });
    assert.deepEqual(replay.espec, first.espec);
    assert.equal(ContextoOrdenColorSchema.safeParse({ v: "colour-order.v1", lastReplacement: first.ordenColor!.lastReplacement }).success, false);
  } finally {
    if (prior === undefined) delete process.env.PLAN_COLOR_ORDER_V3;
    else process.env.PLAN_COLOR_ORDER_V3 = prior;
  }
});
