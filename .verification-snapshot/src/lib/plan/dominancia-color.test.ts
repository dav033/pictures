import assert from "node:assert/strict";
import test from "node:test";
import { coloresPorDominancia, medirDominanciaColor, medirDominanciaElemento, type MuestraPixeles } from "./dominancia-color";

/** Lienzo de un solo color, del tamaño que se pida. */
function liso(ancho: number, alto: number, [r, g, b]: [number, number, number]): MuestraPixeles {
  const rgb = new Uint8Array(ancho * alto * 3);
  for (let i = 0; i < ancho * alto; i += 1) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { ancho, alto, rgb };
}

/** Mitad izquierda de un color, mitad derecha de otro. */
function mitades(ancho: number, alto: number, izquierda: [number, number, number], derecha: [number, number, number]): MuestraPixeles {
  const muestra = liso(ancho, alto, izquierda);
  for (let y = 0; y < alto; y += 1) {
    for (let x = Math.floor(ancho / 2); x < ancho; x += 1) {
      const base = (y * ancho + x) * 3;
      muestra.rgb[base] = derecha[0];
      muestra.rgb[base + 1] = derecha[1];
      muestra.rgb[base + 2] = derecha[2];
    }
  }
  return muestra;
}

const ROJO: [number, number, number] = [0xd3, 0x2f, 0x2f];
const AZUL: [number, number, number] = [0x1f, 0x4f, 0xbf];
const BLANCO: [number, number, number] = [0xff, 0xff, 0xff];
/** Verde oliva de un prado en sombra, no el verde saturado que vende el catálogo. */
const CESPED: [number, number, number] = [0x4f, 0x66, 0x38];
/** El verde del catálogo, para contrastar con el anterior. */
const VERDE_CATALOGO: [number, number, number] = [0x2e, 0x9d, 0x57];
/** El gris de una pared de estudio: el fondo que se colaba en cada medición. */
const GRIS_PARED: [number, number, number] = [0x8e, 0x92, 0x95];

test("un lienzo del hex nominal se clasifica como ese color y nada más", () => {
  const medicion = medirDominanciaColor(liso(64, 64, ROJO));
  assert.deepEqual(
    medicion.dominantes.map((entrada) => entrada.color),
    ["rojo"],
  );
  assert.equal(medicion.dominantes[0]?.participacion, 1);
  assert.equal(medicion.sinClasificar, 0);
});

test("la participacion es la fraccion real de pixeles, no el orden de lectura", () => {
  const medicion = medirDominanciaColor(mitades(64, 64, AZUL, ROJO));
  const porColor = new Map(medicion.dominantes.map((entrada) => [entrada.color, entrada.participacion]));
  assert.equal(porColor.size, 2);
  assert.ok(Math.abs((porColor.get("rojo") ?? 0) - 0.5) < 0.02, `rojo=${porColor.get("rojo")}`);
  assert.ok(Math.abs((porColor.get("azul") ?? 0) - 0.5) < 0.02, `azul=${porColor.get("azul")}`);
});

test("la caja restringe la medida a su region", () => {
  // El arco ocupa la mitad derecha; medir la foto entera diria 50/50, y por eso
  // `colores_referencia` se mide por elemento y no por foto.
  const muestra = mitades(64, 64, AZUL, ROJO);
  const medicion = medirDominanciaColor(muestra, { x: 0.5, y: 0, width: 0.5, height: 1 });
  assert.deepEqual(
    medicion.dominantes.map((entrada) => entrada.color),
    ["rojo"],
  );
});

test("un prado no es un globo verde", () => {
  // La discriminacion que justifica `DELTA_E_CLASIFICACION`: con un radio mas
  // ancho toda foto de exteriores reportaria verde como color dominante. El
  // verde oliva de un prado en sombra esta a dE 34 del verde del catalogo.
  assert.deepEqual(medirDominanciaColor(liso(64, 64, CESPED)).dominantes, []);
  assert.equal(medirDominanciaColor(liso(64, 64, CESPED)).sinClasificar, 1);
  assert.deepEqual(
    medirDominanciaColor(liso(64, 64, VERDE_CATALOGO)).dominantes.map((entrada) => entrada.color),
    ["verde"],
  );
});

test("un pixel blanco es blanco y no lo decide el desempate alfabetico", () => {
  // `blanco`, `transparente` y `multicolor` comparten el hex #ffffff. Las dos
  // ultimas no son tonos y estan fuera de la clasificacion.
  const medicion = medirDominanciaColor(liso(32, 32, BLANCO));
  assert.deepEqual(
    medicion.dominantes.map((entrada) => entrada.color),
    ["blanco"],
  );
});

test("un color por debajo del minimo es ruido y no entra", () => {
  const muestra = liso(100, 100, AZUL);
  // Un 1 % de pixeles rojos: menos que `PARTICIPACION_MINIMA`.
  for (let i = 0; i < 100; i += 1) {
    muestra.rgb[i * 3] = ROJO[0];
    muestra.rgb[i * 3 + 1] = ROJO[1];
    muestra.rgb[i * 3 + 2] = ROJO[2];
  }
  assert.deepEqual(
    medirDominanciaColor(muestra).dominantes.map((entrada) => entrada.color),
    ["azul"],
  );
});

test("una imagen vacia no mide nada en vez de fallar", () => {
  const medicion = medirDominanciaColor({ ancho: 0, alto: 0, rgb: new Uint8Array(0) });
  assert.equal(medicion.pixelesMedidos, 0);
  assert.deepEqual(medicion.dominantes, []);
});

test("una caja diminuta mide el pixel que cubre, no cero", () => {
  // `reference_bbox` esta acotada a 0..1 con ancho > 0, asi que una caja nunca
  // cae del todo fuera: el recorte siempre deja al menos un pixel y medirlo es
  // la respuesta correcta.
  const medicion = medirDominanciaColor(liso(16, 16, ROJO), { x: 0.99, y: 0.99, width: 0.001, height: 0.001 });
  assert.equal(medicion.pixelesMedidos, 1);
  assert.deepEqual(
    medicion.dominantes.map((entrada) => entrada.color),
    ["rojo"],
  );
});

test("coloresPorDominancia recorta respetando el orden medido", () => {
  const medicion = medirDominanciaColor(mitades(64, 64, AZUL, ROJO));
  assert.equal(coloresPorDominancia(medicion, 1).length, 1);
  assert.deepEqual(coloresPorDominancia(medicion, 5), medicion.dominantes.map((entrada) => entrada.color));
});

test("la medida es reproducible: dos corridas identicas dan el mismo numero", () => {
  const muestra = mitades(128, 96, AZUL, ROJO);
  assert.deepEqual(medirDominanciaColor(muestra), medirDominanciaColor(muestra));
});

test("el fondo no cuenta como color de la decoracion", () => {
  // La regresion que motivo `medirDominanciaElemento`: la caja de un elemento es
  // un rectangulo alrededor del arco, y buena parte de ese rectangulo es pared.
  // En la primera corrida medida `gris` salio dominante en tres de cuatro fotos
  // con 32-48 % y el QA visual cayo de 2/4 a 1/4.
  const ancho = 100;
  const alto = 100;
  const muestra = liso(ancho, alto, GRIS_PARED);
  // Globos rojos solo dentro de la caja, sobre el mismo fondo gris.
  for (let y = 25; y < 75; y += 1) {
    for (let x = 25; x < 75; x += 1) {
      if ((x + y) % 3 !== 0) continue;
      const base = (y * ancho + x) * 3;
      muestra.rgb[base] = ROJO[0];
      muestra.rgb[base + 1] = ROJO[1];
      muestra.rgb[base + 2] = ROJO[2];
    }
  }
  const caja = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const crudo = medirDominanciaColor(muestra, caja).dominantes.map((e) => e.color);
  assert.ok(crudo.includes("gris"), `la medida cruda si ve el fondo: ${JSON.stringify(crudo)}`);
  assert.deepEqual(
    medirDominanciaElemento(muestra, caja).dominantes.map((e) => e.color),
    ["rojo"],
  );
});

test("un color presente dentro y fuera por igual es del sitio, no de la pieza", () => {
  const muestra = liso(80, 80, GRIS_PARED);
  const medicion = medirDominanciaElemento(muestra, { x: 0.3, y: 0.3, width: 0.4, height: 0.4 });
  // Todo es fondo: el filtro se lo llevaria todo, y devolver vacio se leeria
  // como "esta pieza no tiene color". Devuelve la medida cruda.
  assert.deepEqual(medicion.dominantes.map((e) => e.color), ["gris"]);
});

test("una caja que ocupa casi todo el encuadre apaga el filtro", () => {
  // Sin fuera suficiente no hay con que contrastar, y el filtro se apaga en vez
  // de inventarse un numero.
  const muestra = mitades(64, 64, AZUL, ROJO);
  const caja = { x: 0, y: 0, width: 0.95, height: 0.95 };
  assert.deepEqual(
    medirDominanciaElemento(muestra, caja).dominantes.map((e) => e.color).sort(),
    medirDominanciaColor(muestra, caja).dominantes.map((e) => e.color).sort(),
  );
});

test("las participaciones del elemento se renormalizan y suman ~1", () => {
  const ancho = 100;
  const muestra = liso(ancho, 100, GRIS_PARED);
  for (let y = 20; y < 80; y += 1) {
    for (let x = 20; x < 80; x += 1) {
      const base = (y * ancho + x) * 3;
      const color = x < 50 ? ROJO : AZUL;
      muestra.rgb[base] = color[0];
      muestra.rgb[base + 1] = color[1];
      muestra.rgb[base + 2] = color[2];
    }
  }
  const medicion = medirDominanciaElemento(muestra, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
  const total = medicion.dominantes.reduce((suma, e) => suma + e.participacion, 0);
  assert.ok(Math.abs(total - 1) < 0.02, `suman ${total}`);
});
