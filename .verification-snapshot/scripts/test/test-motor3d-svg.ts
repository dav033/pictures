/**
 * La vista de reserva del plan 3D (REQ-007, fase 3): `motor/vista2d-svg.ts`. Sin red ni coste, pura estructura:
 * - en las 40 ideas y estructuras oficiales que el motor arma, y en las dos cámaras, el número de círculos de cada color es
 *   el de globos de ese color en la lista de materiales; lo mismo pieza por pieza al pedir una sola;
 * - los círculos van del fondo al frente (lo más cercano a la cámara se pinta al final) y cada uno usa su degradado;
 * - tubitos y flores artificiales no se cuentan como globos; el SVG es determinista, cuadrado y escapa su título;
 * - una armada sin nada o una pieza que no existe dan un SVG válido sin círculos.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor3d-svg.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { armarDesdeEspec, svgDeArmada, type ArmadaCompactaV1 } from "../../src/lib/globos3d/motor/v1";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { todosLosCasos } from "../lib/casos-motor-guiada";

const VISTAS = ["frente", "tres-cuartos"] as const;

/** Círculos de globo por color (hex): `data-c` es el índice de la paleta. */
function circulosPorHex(svg: string, armada: ArmadaCompactaV1): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const m of svg.matchAll(/<circle data-c="(\d+)"/g)) {
    const hex = armada.paleta[Number(m[1])]!;
    cuenta.set(hex, (cuenta.get(hex) ?? 0) + 1);
  }
  return cuenta;
}

function bomPorHex(lineas: ReadonlyArray<{ codigo: string; cantidad: number }>): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const l of lineas) {
    const hex = referenciaPorCodigo(l.codigo)!.hexGlobo;
    cuenta.set(hex, (cuenta.get(hex) ?? 0) + l.cantidad);
  }
  return cuenta;
}

const aObjeto = (mapa: Map<string, number>) => Object.fromEntries([...mapa].sort(([a], [b]) => a.localeCompare(b)));

const armados = todosLosCasos().flatMap((caso) => {
  const resultado = armarDesdeEspec(caso.espec);
  return resultado.noRepresentable.length ? [] : [{ id: caso.id, resultado }];
});

test("hay casos que armar", () => {
  assert.ok(armados.length >= 38, `casos armados: ${armados.length}`);
});

test("círculos por color = globos por color de la lista de materiales, en las dos cámaras", () => {
  for (const { id, resultado } of armados) {
    for (const vista of VISTAS) {
      const svg = svgDeArmada(resultado.armada, { vista });
      assert.deepEqual(aObjeto(circulosPorHex(svg, resultado.armada)), aObjeto(bomPorHex(resultado.bom.total)), `${id} (${vista})`);
    }
  }
});

test("pieza por pieza: los círculos de una pieza son su lista de materiales", () => {
  for (const { id, resultado } of armados) {
    for (const pieza of resultado.armada.piezas) {
      const svg = svgDeArmada(resultado.armada, { pieza: pieza.id, vista: "tres-cuartos" });
      assert.deepEqual(aObjeto(circulosPorHex(svg, resultado.armada)), aObjeto(bomPorHex(resultado.bom.porPieza[pieza.id] ?? [])), `${id} / ${pieza.id}`);
    }
  }
});

/** Una armada mínima a mano: tres globos a distintas profundidades, un tubito y una flor. */
const MANO: ArmadaCompactaV1 = {
  version: "armada-compacta.v1",
  sala: { anchoCm: 600, fondoCm: 400, altoCm: 300 },
  paleta: ["#ff0000", "#0000ff", "#00ff00"],
  // x, y, z, diámetro, color: el primero está lejos (z negativa), el segundo cerca, el tercero en medio.
  globos: [0, 100, -200, 30, 0, 10, 100, 200, 30, 1, 5, 100, 0, 30, 0],
  tubos: [{ grosorCm: 2, color: 2, puntos: [0, 0, 0, 20, 40, 0] }],
  flores: [50, 50, 50, 20, 2],
  piezas: [{ id: "EST_01_ARCO", globos: [0, 3], tubos: [0, 1], flores: [0, 1], caja: [0, 0, -200, 50, 120, 200] }],
};

test("del fondo al frente: lo más cercano a la cámara se pinta al final", () => {
  const svg = svgDeArmada(MANO, { vista: "frente" });
  const orden = [...svg.matchAll(/<circle data-c="(\d)"/g)].map((m) => Number(m[1]));
  // El rojo con z = -200 es el más lejano: primero. El rojo con z = 0, en medio. El azul con z = 200, el más cercano: último.
  assert.deepEqual(orden, [0, 0, 1]);
  const lejano = /<circle data-c="0" cx="0"/.exec(svg)!.index;
  assert.ok(lejano < svg.lastIndexOf('<circle data-c="1"'), "el azul cercano va después del rojo lejano");
});

test("tubitos y flores no son globos; cada círculo usa un degradado que existe", () => {
  const svg = svgDeArmada(MANO);
  assert.equal([...svg.matchAll(/<circle data-c=/g)].length, 3);
  assert.equal([...svg.matchAll(/<circle data-f=/g)].length, 1, "la flor artificial va con otro atributo");
  assert.equal([...svg.matchAll(/<polyline data-t=/g)].length, 1, "el tubito va como línea");
  for (const m of svg.matchAll(/fill="url\(#(g\d+)\)"/g)) assert.ok(svg.includes(`<radialGradient id="${m[1]}"`), `degradado ${m[1]}`);
  assert.ok(!svg.includes('id="g2"'), "el verde solo lo usan el tubito y la flor, que van lisos: sin degradado de globo");
});

test("determinista, cuadrado y con el título escapado", () => {
  const a = svgDeArmada(MANO, { titulo: "Mi <arco> & \"co\"" });
  assert.equal(a, svgDeArmada(MANO, { titulo: "Mi <arco> & \"co\"" }));
  assert.match(a, /<title>Mi &lt;arco&gt; &amp; &quot;co&quot;<\/title>/);
  const caja = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(a)!;
  const ancho = Number(caja[1]), alto = Number(caja[2]);
  assert.equal(ancho, alto, "el encuadre es cuadrado");
  assert.match(a, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
  assert.ok(a.endsWith("</svg>"));
  assert.ok(!/<script|onload|javascript:/i.test(a));
});

test("una armada vacía o una pieza que no existe dan un SVG válido sin círculos", () => {
  const vacia: ArmadaCompactaV1 = { ...MANO, globos: [], tubos: [], flores: [], piezas: [] };
  for (const svg of [svgDeArmada(vacia), svgDeArmada(MANO, { pieza: "no-existe" })]) {
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
  }
  assert.equal([...svgDeArmada(vacia).matchAll(/<circle/g)].length, 0);
  assert.equal([...svgDeArmada(MANO, { pieza: "no-existe" }).matchAll(/<circle/g)].length, 0, "una pieza que no existe no dibuja nada");
});

test("las dos cámaras no dan el mismo dibujo (la de tres cuartos gira)", () => {
  const { resultado } = armados.find((a) => a.id.includes("columna"))!;
  assert.notEqual(svgDeArmada(resultado.armada, { vista: "frente" }), svgDeArmada(resultado.armada, { vista: "tres-cuartos" }));
});

test("peso: el SVG de un plan grande cabe en la red de un celular", () => {
  const mayor = armados.reduce((a, b) => (b.resultado.armada.globos.length > a.resultado.armada.globos.length ? b : a));
  const svg = svgDeArmada(mayor.resultado.armada);
  assert.ok(svg.length < 400_000, `${mayor.id}: ${svg.length} bytes`);
});
