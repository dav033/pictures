/**
 * presentationMode (Customer Journey, informe 05/05b). Determinista: sin proveedor, red ni base de datos.
 *
 * - Política: solo el texto exacto "true" enciende; es inmutable; nada fuera del módulo lee la variable.
 * - Equivalencia con el modo APAGADO en cada punto de aplicación (puerta de R16, creatividad, ambiente,
 *   prompt de imagen): el resultado es el de antes.
 * - Con el modo ENCENDIDO se cumplen las restricciones (R16 y R23).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { traducirErrorServidor } from "../../src/lib/errores-ui/traducir-error-servidor";
import { buildImagePrompt } from "../../src/lib/ia/uzume/build-image-prompt";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { NIVELES_CREATIVIDAD, perfilCreatividad } from "../../src/lib/ia/escena/creatividad";
import { ambienteDeFiesta, type NivelAmbiente } from "../../src/lib/ia/uzume/ambiente-fiesta";
import type { SceneryElement, SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import {
  bloqueoPorGeneracionSinReferencia,
  CODIGO_GENERACION_SIN_REFERENCIA,
  esGeneracionDeCero,
  INTERPRETACION_DE_CERO,
  leerPoliticaDePresentacion,
  NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO,
  nivelAmbienteConPolitica,
  nivelCreatividadConPolitica,
  nivelesSinAmbientacion,
  politicaDePresentacion,
  PRESENTATION_MODE_ENV,
  type SenalesDeBase,
} from "../../src/lib/presentacion/modo-presentacion";

const APAGADA = politicaDePresentacion(undefined);
const ENCENDIDA = politicaDePresentacion("true");

// --- 1. Solo "true" enciende ---------------------------------------------------------------------
assert.equal(PRESENTATION_MODE_ENV, "PRESENTATION_MODE_ENABLED");
assert.equal(ENCENDIDA.activo, true);
for (const valor of [undefined, null, "", " ", "1", "0", "TRUE", "True", "yes", "on", "si", "sí", " true", "true ", "true\n", "false", "tru", "enabled"]) {
  const politica = politicaDePresentacion(valor);
  assert.equal(politica.activo, false, `el valor ${JSON.stringify(valor)} no debe activar el modo`);
  assert.deepEqual(politica, APAGADA, `el valor ${JSON.stringify(valor)} debe dar la política apagada`);
}
assert.deepEqual(APAGADA, { activo: false, bloquearGeneracionSinReferencia: false, catalogoCerrado: false });
assert.deepEqual(ENCENDIDA, { activo: true, bloquearGeneracionSinReferencia: true, catalogoCerrado: true });

// Inmutable: ni escribir ni añadir campos.
assert.ok(Object.isFrozen(APAGADA) && Object.isFrozen(ENCENDIDA));
assert.throws(() => { (APAGADA as { activo: boolean }).activo = true; }, TypeError);
assert.throws(() => { (ENCENDIDA as { catalogoCerrado: boolean }).catalogoCerrado = false; }, TypeError);
assert.equal(APAGADA.activo, false);

// --- 2. El lector de entorno -----------------------------------------------------------------------
function conEntorno<T>(valor: string | undefined, fn: () => T): T {
  const previo = process.env[PRESENTATION_MODE_ENV];
  if (valor === undefined) delete process.env[PRESENTATION_MODE_ENV]; else process.env[PRESENTATION_MODE_ENV] = valor;
  try {
    return fn();
  } finally {
    if (previo === undefined) delete process.env[PRESENTATION_MODE_ENV]; else process.env[PRESENTATION_MODE_ENV] = previo;
  }
}
assert.equal(conEntorno(undefined, leerPoliticaDePresentacion).activo, false, "ausente = apagado");
assert.equal(conEntorno("", leerPoliticaDePresentacion).activo, false, "vacío = apagado");
assert.equal(conEntorno("1", leerPoliticaDePresentacion).activo, false, "\"1\" no activa");
assert.equal(conEntorno("TRUE", leerPoliticaDePresentacion).activo, false, "\"TRUE\" no activa");
assert.equal(conEntorno("yes", leerPoliticaDePresentacion).activo, false, "\"yes\" no activa");
assert.equal(conEntorno("true", leerPoliticaDePresentacion).activo, true, "\"true\" activa");
assert.equal(conEntorno(undefined, leerPoliticaDePresentacion).activo, false, "el entorno se restauró");

// --- 3. Un solo dueño: nadie más nombra la variable ----------------------------------------------------
function archivosDe(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) archivosDe(ruta, salida);
    else if (/\.(?:ts|tsx|mts|cts|js|mjs)$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}
const raiz = path.resolve(__dirname, "../..");
const dueno = path.resolve(raiz, "src/lib/presentacion/modo-presentacion.ts");
const lectoresAjenos = archivosDe(path.join(raiz, "src"))
  .filter((ruta) => path.resolve(ruta) !== dueno)
  .filter((ruta) => /PRESENTATION_MODE_ENABLED|PRESENTATION_MODE_ENV/.test(readFileSync(ruta, "utf8")));
assert.deepEqual(lectoresAjenos, [], "solo modo-presentacion.ts puede nombrar la variable de entorno");

// --- 4. R16: la puerta de «generación de cero» --------------------------------------------------------------
const BANDERAS = ["fotoDeReferencia", "piezaPrediseniadaDeCatalogo", "fotoDelEspacio", "imagenPrevia"] as const;
const combinaciones: SenalesDeBase[] = [];
for (let mascara = 0; mascara < 16; mascara += 1) {
  combinaciones.push({
    fotoDeReferencia: Boolean(mascara & 1),
    piezaPrediseniadaDeCatalogo: Boolean(mascara & 2),
    fotoDelEspacio: Boolean(mascara & 4),
    imagenPrevia: Boolean(mascara & 8),
  });
}
assert.equal(combinaciones.length, 16);
for (const senales of combinaciones) {
  // Equivalencia: apagado nunca bloquea, sean cuales sean las señales.
  assert.equal(bloqueoPorGeneracionSinReferencia(APAGADA, senales), null, `apagado no bloquea (${JSON.stringify(senales)})`);
}
// Encendido: bloquea exactamente cuando ninguna señal que la interpretación reconoce está presente.
const reconocida = (senales: SenalesDeBase): boolean =>
  (INTERPRETACION_DE_CERO.fotoDeReferenciaCuentaComoBase && senales.fotoDeReferencia) ||
  (INTERPRETACION_DE_CERO.piezaPrediseniadaDeCatalogoCuentaComoBase && senales.piezaPrediseniadaDeCatalogo) ||
  (INTERPRETACION_DE_CERO.fotoDelEspacioCuentaComoBase && senales.fotoDelEspacio) ||
  (INTERPRETACION_DE_CERO.imagenPreviaCuentaComoBase && senales.imagenPrevia);
for (const senales of combinaciones) {
  const bloqueo = bloqueoPorGeneracionSinReferencia(ENCENDIDA, senales);
  assert.equal(bloqueo === null, reconocida(senales), `encendido: bloqueo incorrecto para ${JSON.stringify(senales)}`);
  assert.equal(esGeneracionDeCero(senales), !reconocida(senales));
  if (bloqueo) assert.ok(bloqueo.startsWith(`${CODIGO_GENERACION_SIN_REFERENCIA}:`), "el mensaje lleva el código estable");
}
// La interpretación por defecto (supuesto documentado): sin nada = de cero; la foto del espacio sola, también.
const nada: SenalesDeBase = { fotoDeReferencia: false, piezaPrediseniadaDeCatalogo: false, fotoDelEspacio: false, imagenPrevia: false };
assert.ok(bloqueoPorGeneracionSinReferencia(ENCENDIDA, nada));
assert.ok(bloqueoPorGeneracionSinReferencia(ENCENDIDA, { ...nada, fotoDelEspacio: true }), "la foto del espacio no es una decoración de referencia");
assert.equal(bloqueoPorGeneracionSinReferencia(ENCENDIDA, { ...nada, fotoDeReferencia: true }), null);
assert.equal(bloqueoPorGeneracionSinReferencia(ENCENDIDA, { ...nada, piezaPrediseniadaDeCatalogo: true }), null);
assert.equal(bloqueoPorGeneracionSinReferencia(ENCENDIDA, { ...nada, imagenPrevia: true }), null);
assert.equal(BANDERAS.length, 4);
// El bloqueo llega al cliente con un código estable y una frase propia, no como ERROR_INTERNO.
const uiError = traducirErrorServidor(new Error(bloqueoPorGeneracionSinReferencia(ENCENDIDA, nada) ?? ""), "00000000-0000-4000-8000-000000000001");
assert.equal(uiError.code, "ADJUNTO_INVALIDO");
assert.equal(uiError.detalles_dev?.codigo_origen, CODIGO_GENERACION_SIN_REFERENCIA);
assert.match(uiError.mensaje_usuario, /foto de referencia/);

// --- 5. R23: creatividad -----------------------------------------------------------------------------------------
// Apagado: el nivel es el de siempre.
for (const nivel of NIVELES_CREATIVIDAD) assert.equal(nivelCreatividadConPolitica(nivel, APAGADA), nivel);
// Encendido: nunca pasa del techo y los niveles bajos no cambian.
for (const nivel of NIVELES_CREATIVIDAD) {
  const efectivo = nivelCreatividadConPolitica(nivel, ENCENDIDA);
  assert.equal(efectivo, Math.min(nivel, NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO));
  const perfil = perfilCreatividad(efectivo);
  assert.deepEqual(perfil.imagen.ambientacion, [], `el nivel efectivo ${efectivo} no añade ambientación`);
  assert.deepEqual(perfil.pistasPrompt, [], `el nivel efectivo ${efectivo} no añade pistas de estilo al caption`);
}
// El techo es el mayor nivel sin ambientación en la tabla (no un número suelto), y el siguiente sí añade.
const sinAmbientacion = nivelesSinAmbientacion();
assert.equal(NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO, Math.max(...sinAmbientacion));
for (const nivel of NIVELES_CREATIVIDAD.filter((n) => n > NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO)) {
  const perfil = perfilCreatividad(nivel);
  assert.ok(perfil.imagen.ambientacion.length > 0 || perfil.pistasPrompt.length > 0, `el nivel ${nivel} por encima del techo debe añadir algo`);
}

// --- 6. R23: props de ambiente ---------------------------------------------------------------------------------
const NIVELES_AMBIENTE: readonly NivelAmbiente[] = ["ninguno", "minimo", "completo"];
for (const nivel of NIVELES_AMBIENTE) {
  assert.equal(nivelAmbienteConPolitica(nivel, APAGADA), nivel, "apagado: el ambiente pedido pasa tal cual");
  assert.equal(nivelAmbienteConPolitica(nivel, ENCENDIDA), "ninguno", "encendido: sin props de ambiente");
  assert.deepEqual(ambienteDeFiesta(nivelAmbienteConPolitica(nivel, ENCENDIDA)).props, []);
}
assert.ok(ambienteDeFiesta(nivelAmbienteConPolitica("completo", APAGADA)).props.length > 0, "apagado conserva los props");

// --- 7. R23: exclusiones en el prompt de imagen --------------------------------------------------------------
const sceneSpec = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "CATALOG_01",
    name: "guirnalda orgánica de globos rojos",
    category: "balloon_structure",
    source_type: "catalog_backed",
    required: true,
    quantity: { mode: "exact", min: 12, max: 12 },
    target_bbox: { x: 0.15, y: 0.12, width: 0.7, height: 0.7 },
    depth_layer: 10,
    resolved_colors: ["rojo"],
    identity_constraints: [],
    relationships: [],
  }],
  positive_prompt: { required_elements: ["guirnalda orgánica de globos rojos"], composition: ["one focal installation"], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default" },
} as unknown as SceneSpec;
const contexto = buildVisualContext({ userRequest: "cumpleaños con globos rojos" });
const base = { sceneSpec, visualContext: contexto };
const lineaCerrado = /\n- CLOSED CATALOG: [^\n]*/;

const sinParametro = buildImagePrompt(base);
// Equivalencia con el modo apagado: sin el parámetro, con `false` y con la política apagada es byte a byte lo mismo.
assert.equal(buildImagePrompt({ ...base, catalogoCerrado: false }), sinParametro);
assert.equal(buildImagePrompt({ ...base, catalogoCerrado: APAGADA.catalogoCerrado }), sinParametro);
assert.doesNotMatch(sinParametro, /CLOSED CATALOG/);

// Encendido: añade UNA línea de exclusión en MUST NOT INCLUDE y nada más.
const cerrado = buildImagePrompt({ ...base, catalogoCerrado: ENCENDIDA.catalogoCerrado });
assert.notEqual(cerrado, sinParametro);
assert.equal((cerrado.match(/CLOSED CATALOG/g) ?? []).length, 1);
assert.equal(cerrado.replace(lineaCerrado, ""), sinParametro, "la única diferencia es la línea de exclusión");
assert.match(cerrado, /MUST NOT INCLUDE\n- No decorative object absent from the automatic element allowlist\.\n- CLOSED CATALOG: /);
assert.match(cerrado, /pennant or bunting banners/);
assert.match(cerrado, /toys or toy vehicles/);
assert.match(cerrado, /Sempertex does not sell/);
assert.doesNotMatch(cerrado, /PRESERVED SCENE CONTEXT kept from the customer's own photo\.\n/, "sin escenografía no hay excepción");
// El mismo texto de exclusión no introduce diámetros ni colores que el verificador de coherencia pudiera leer.
assert.equal([...cerrado.matchAll(/(\d+(?:\.\d+)?)-inch/g)].length, [...sinParametro.matchAll(/(\d+(?:\.\d+)?)-inch/g)].length);

// Con escenografía conservada de la foto del cliente, la exclusión conserva esa excepción (y el modo apagado sigue igual).
const escenografia: SceneryElement[] = [{ element_id: "SCENERY_01", name: "wooden bench", category: "furniture", target_bbox: { x: 0.1, y: 0.6, width: 0.2, height: 0.3 }, depth_layer: 5 }];
const conEscenografiaApagado = buildImagePrompt({ ...base, scenography: escenografia });
const conEscenografiaCerrado = buildImagePrompt({ ...base, scenography: escenografia, catalogoCerrado: true });
assert.equal(buildImagePrompt({ ...base, scenography: escenografia, catalogoCerrado: false }), conEscenografiaApagado);
assert.match(conEscenografiaCerrado, /CLOSED CATALOG: [^\n]*other than the PRESERVED SCENE CONTEXT kept from the customer's own photo\./);
assert.equal(conEscenografiaCerrado.replace(lineaCerrado, ""), conEscenografiaApagado);

console.log("test-presentation-mode: OK");
