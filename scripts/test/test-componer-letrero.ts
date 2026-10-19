import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { cajaLetreroEnCaptura } from "../../src/components/tres-d/caja-letrero-captura";
import { CajaLetreroFotoV1Schema, CajasLetreroFotoV1Schema } from "../../src/lib/globos3d/render-imagen-contrato-v1";
import { composicionLetreroHabilitada, conservarLetrerosEnFoto, validarCapturaConLetreros } from "../../src/lib/globos3d/componer-letrero";

const cajas = CajasLetreroFotoV1Schema.parse([{ x: 0.25, y: 0.25, ancho: 0.5, alto: 0.5 }]);
const imagenesPromesa = Promise.all([
  readFile(new URL("./fixtures/componer-letrero/captura.svg", import.meta.url)).then((svg) => sharp(svg).png().toBuffer()),
  readFile(new URL("./fixtures/componer-letrero/foto-flux.svg", import.meta.url)).then((svg) => sharp(svg).png().toBuffer()),
]);

test("la bandera queda apagada salvo true explícito", () => {
  assert.equal(composicionLetreroHabilitada({}), false);
  assert.equal(composicionLetreroHabilitada({ RENDER_3D_SIGN_COMPOSITING_ENABLED: "false" }), false);
  assert.equal(composicionLetreroHabilitada({ RENDER_3D_SIGN_COMPOSITING_ENABLED: "true" }), true);
});

test("el contrato v1 rechaza cajas desbordadas, vacías y propiedades no declaradas", () => {
  assert.equal(CajaLetreroFotoV1Schema.safeParse({ x: 0.8, y: 0, ancho: 0.3, alto: 0.2 }).success, false);
  assert.equal(CajaLetreroFotoV1Schema.safeParse({ x: 0, y: 0, ancho: 0, alto: 0.2 }).success, false);
  assert.equal(CajaLetreroFotoV1Schema.safeParse({ x: 0, y: 0, ancho: 0.2, alto: 0.2, admin: true }).success, false);
  assert.equal(CajasLetreroFotoV1Schema.safeParse(Array.from({ length: 51 }, () => ({ x: 0, y: 0, ancho: 0.1, alto: 0.1 }))).success, false);
});

test("la caja proyectada se transforma al recorte final y descarta rótulos fuera del frustum", () => {
  const puntos = [
    { x: -0.5, y: 0.5, z: 0 },
    { x: 0.5, y: 0.5, z: 0 },
    { x: -0.5, y: -0.5, z: 0 },
    { x: 0.5, y: -0.5, z: 0 },
  ];
  assert.deepEqual(cajaLetreroEnCaptura(puntos, {
    ladoFuente: 100, escala: 1, desplazamientoX: 0, desplazamientoY: 0, anchoSalida: 100, altoSalida: 100,
  }), { x: 0.21, y: 0.21, ancho: 0.58, alto: 0.58 });
  assert.equal(cajaLetreroEnCaptura([{ x: 0, y: 0, z: 1.2 }], {
    ladoFuente: 100, escala: 1, desplazamientoX: 0, desplazamientoY: 0, anchoSalida: 100, altoSalida: 100,
  }), null);
  assert.equal(cajaLetreroEnCaptura([{ x: -0.2, y: 0.2, z: 0 }, { x: 0.2, y: -0.2, z: -1.2 }], {
    ladoFuente: 100, escala: 1, desplazamientoX: 0, desplazamientoY: 0, anchoSalida: 100, altoSalida: 100,
  }), null, "omite un rótulo recortado por near/far y evita restaurar una caja parcial");
});

test("compone el rótulo del visor con feathering y conserva intacto lo que queda fuera", async () => {
  const [captura, flux] = await imagenesPromesa;
  const imagenFlux = { mime: "image/png", base64: flux.toString("base64") };
  const dimensiones = await validarCapturaConLetreros(captura, cajas);
  assert.deepEqual(dimensiones, { width: 128, height: 96 });
  const resultado = await conservarLetrerosEnFoto({ imagen: imagenFlux, captura, cajas, habilitada: true });
  assert.equal(resultado.estado, "compuesta");
  if (resultado.estado !== "compuesta") return;

  const imagen = await sharp(Buffer.from(resultado.imagen.base64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const indice = (y * imagen.info.width + x) * 4;
    return [...imagen.data.subarray(indice, indice + 3)];
  };
  assert.deepEqual(pixel(64, 48), [224, 16, 32], "el centro del rótulo queda igual a la captura 3D");
  assert.deepEqual(pixel(16, 16), [16, 16, 16], "el resto de la foto FLUX no cambia");
  assert.deepEqual(pixel(32, 48), [16, 16, 16], "el borde exterior conserva la foto FLUX");
  assert.ok(pixel(33, 48)[0]! > 16 && pixel(33, 48)[0]! < 224, "el borde interior se mezcla con suavidad");
});

test("con la bandera apagada devuelve la foto FLUX sin decodificar ni componer", async () => {
  const imagenFlux = { mime: "image/png", base64: "Zmx1eA==" };
  const resultado = await conservarLetrerosEnFoto({ imagen: imagenFlux, captura: Buffer.from("invalid"), cajas, habilitada: false });
  assert.deepEqual(resultado, { estado: "sin_cambio", imagen: imagenFlux });
});

test("un fallo de composición es visible y conserva la foto FLUX original", async () => {
  const [captura] = await imagenesPromesa;
  const imagenRota = { mime: "image/png", base64: Buffer.from("not an image").toString("base64") };
  const resultado = await conservarLetrerosEnFoto({ imagen: imagenRota, captura, cajas, habilitada: true });
  assert.equal(resultado.estado, "fallo");
  assert.deepEqual(resultado.imagen, imagenRota);
  if (resultado.estado === "fallo") assert.equal(resultado.causa.length > 0, true);
});

test("rechaza cajas que no cubren al menos dos píxeles antes de generar", async () => {
  const [captura] = await imagenesPromesa;
  await assert.rejects(
    validarCapturaConLetreros(captura, [{ x: 0.1, y: 0.1, ancho: 0.001, alto: 0.01 }]),
  );
});
