import assert from "node:assert/strict";
import test from "node:test";
import { BIBLIOTECA_FABRICA, escenaDeItem, productosDe, type ProductosDeItem } from "./biblioteca";
import type { Caja } from "./escena";
import { armarEscena } from "./escena";
import type { Pieza } from "./piezas";
import { piezasDeContenido, recetaDeIdea, unirCajas } from "./receta-idea";

const caja = (x0: number, y0: number, x1: number, y1: number, z0 = 0, z1 = 0): Caja => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const linea = (formatoId: string, codigo: string, color: string, cantidad: number) => ({
  formatoId, formato: formatoId, codigo, color, nombreOficial: `${formatoId} ${color} ${codigo}`, cantidad, porLargo: false, producto: undefined,
}) as unknown as ProductosDeItem["globos"][number];
const productos = (globos: ProductosDeItem["globos"], tienda: ProductosDeItem["tienda"] = []): ProductosDeItem => ({
  globos, totalGlobos: globos.reduce((s, g) => s + g.cantidad, 0), tienda, utileria: [], escenografia: [],
});
const globoSuelto = (helio = false): Pieza => ({ tipo: "globo", formatoId: "R-12", infladoCm: 30, codigo: "640", ...(helio ? { helio: true as const } : {}) });
const arco = (): Pieza => ({ tipo: "arco", formatoId: "R-12", infladoCm: 30, forma: "redondo", anchoCm: 200, altoCm: 250, patron: "alternado", colores: ["640"] } as unknown as Pieza);
const entrada = (extra: Partial<Parameters<typeof recetaDeIdea>[0]> = {}) => ({ piezas: [], productos: productos([]), cajas: [], ocasiones: [], ...extra });

test("la matriz de color por tamaño suma por color y por tamaño, y los tamaños van del más grande al más chico", () => {
  const r = recetaDeIdea(entrada({
    piezas: [globoSuelto()],
    productos: productos([linea("R-9", "640", "Pastel Azul", 4), linea("R-12", "640", "Pastel Azul", 10), linea("R-12", "005", "Blanco", 6)]),
  }));
  assert.equal(r.total, 20);
  assert.deepEqual(r.tamanos.map((t) => [t.formatoId, t.cantidad]), [["R-12", 16], ["R-9", 4]]);
  const azul = r.colores.find((c) => c.codigo === "640");
  assert.equal(azul?.total, 14);
  assert.deepEqual(azul?.porTamano, { "R-12": 10, "R-9": 4 });
  assert.equal(r.colores.find((c) => c.codigo === "005")?.total, 6);
  assert.equal(r.colores[0]?.codigo, "640", "el color con más globos va primero");
});

test("una idea sin globos da cero, sin tamaños y sin medidas", () => {
  const r = recetaDeIdea(entrada());
  assert.equal(r.total, 0);
  assert.deepEqual(r.colores, []);
  assert.deepEqual(r.tamanos, []);
  assert.equal(r.medidas, null);
});

test("las piezas se cuentan por clase con su nombre en español y la técnica sale de lo que tiene", () => {
  const r = recetaDeIdea(entrada({ piezas: [globoSuelto(), globoSuelto(), globoSuelto(true)] }));
  assert.deepEqual(r.piezas, [{ nombre: "Globo suelto", cantidad: 3 }]);
  assert.ok(r.tecnicas.includes("Helio"));
});

test("un arco se dice «Armazón en arco», no «Armazón recto»", () => {
  const r = recetaDeIdea(entrada({ piezas: [arco()] }));
  assert.ok(r.tecnicas.includes("Armazón en arco"));
  assert.ok(!r.tecnicas.includes("Armazón recto"));
});

test("la técnica dice si lleva impresos de la tienda", () => {
  const tienda: ProductosDeItem["tienda"] = [{ seccion: "impresos", nombre: "Impreso", url: "u", cantidad: 3, detalle: "", piezas: [] }];
  const r = recetaDeIdea(entrada({ piezas: [globoSuelto()], productos: productos([], tienda) }));
  assert.ok(r.tecnicas.includes("Impresos"));
});

test("las medidas son la caja de las piezas puestas: un tubo que sobresale cuenta", () => {
  const r = recetaDeIdea(entrada({ cajas: [caja(0, 0, 30, 30, 0, 30), caja(-10, 0, 50, 100, 0, 5)] }));
  assert.equal(r.medidas?.anchoCm, 60);
  assert.equal(r.medidas?.altoCm, 100);
  assert.equal(r.medidas?.fondoCm, 30);
});

test("la unión de cajas abarca todas, y sin cajas no hay unión", () => {
  assert.equal(unirCajas([]), null);
  const u = unirCajas([caja(0, 0, 10, 10), caja(5, -5, 20, 3)]);
  assert.deepEqual(u?.min, { x: 0, y: -5, z: 0 });
  assert.deepEqual(u?.max, { x: 20, y: 10, z: 0 });
});

test("las ocasiones son las de la ficha, con su nombre", () => {
  const r = recetaDeIdea(entrada({ ocasiones: ["cumpleanos", "no-existe"] }));
  assert.ok(r.ocasiones.includes("Cumpleaños"));
  assert.ok(r.ocasiones.includes("no-existe"));
});

test("las piezas de un contenido de escena, de un conjunto o de una pieza suelta", () => {
  const pieza = globoSuelto();
  assert.deepEqual(piezasDeContenido({ tipo: "pieza", pieza, nombre: "x", sugerida: {} as never }), [pieza]);
  assert.deepEqual(piezasDeContenido({ tipo: "escena", escena: { sala: {} as never, nodos: [{ id: "a", nombre: "a", pieza, colocacion: {} as never }] } }), [pieza]);
});

/** Arma una idea del catálogo como lo hace la ficha y devuelve su receta. */
function recetaDelCatalogo(id: string) {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === id);
  assert.ok(item, `falta ${id} en la biblioteca`);
  const armada = armarEscena(escenaDeItem(item!), new Map());
  return recetaDeIdea({
    piezas: piezasDeContenido(item!.contenido),
    productos: productosDe(item!, armada),
    cajas: armada.porNodo.filter((n) => n.copias > 0).map((n) => n.caja),
    ocasiones: item!.ocasiones,
  });
}

test("el moño fucsia mide unos 40 cm de ancho por 32 de alto, con sus tubos", () => {
  const r = recetaDelCatalogo("decoracion:mono_fucsia");
  assert.ok(r.medidas, "sin medidas");
  assert.ok(Math.abs(r.medidas.anchoCm - 40) <= 2, `ancho ${r.medidas.anchoCm}`);
  assert.ok(Math.abs(r.medidas.altoCm - 32) <= 2, `alto ${r.medidas.altoCm}`);
});

test("la estrella dorada mide unos 21 × 20 cm", () => {
  const r = recetaDelCatalogo("decoracion:estrella_dorada");
  assert.ok(r.medidas, "sin medidas");
  assert.ok(Math.abs(r.medidas.anchoCm - 21) <= 2, `ancho ${r.medidas.anchoCm}`);
  assert.ok(Math.abs(r.medidas.altoCm - 20) <= 2, `alto ${r.medidas.altoCm}`);
});
