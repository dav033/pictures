/**
 * Foto → escena con la IA (REQ-001 pasos 7 y 8). Sin red ni coste: Gemini se reemplaza por un generador de mentira.
 * - el esquema para Gemini no trae lo que rechaza (`$schema`, `additionalProperties`, `const`) y el prompt trae el oficio,
 *   los colores Sempertex y 3 lecturas de ejemplo que cumplen el esquema (y excluyen la foto que se evalúa);
 * - la lectura: válida a la primera, reintento con el error a la vista, piezas buenas salvadas, error si no hay ninguna;
 * - foto → escena: lectura de ejemplo compilada, plantillas (con la bandera apagada no hay), la búsqueda que falla solo avisa;
 * - la ruta `/api/escena-desde-foto`: sesión, tamaño, formato, imagen inválida, cupo, errores de la IA, respuesta;
 * - el agente: `modelar_desde_foto` declarada y despachada, la foto adjunta (sala vacía = se arma sola; con piezas = la
 *   herramienta), `sumar` con ids nuevos, tope de piezas, `/api/escena-ia` rechaza fotos malas antes de llamar al modelo;
 * - el cliente: cuerpo del pedido con y sin foto, validación del archivo, pegar/soltar.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-foto-a-escena.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import type { Content } from "@google/genai";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { PEDIDO_FOTO_POR_DEFECTO, construirCuerpoEscenaIA, mensajeDelPedido } from "@/lib/globos3d/cuerpo-escena-ia";
import { reiniciarCupoEscenaIA, tomarCupoEscenaIA, TOPE_POR_HORA } from "@/lib/globos3d/cupo-escena-ia";
import { SALA_INICIAL, type Escena } from "@/lib/globos3d/escena";
import { FotoCuerpoSchema, REGLAS_FOTO, aplicarModeladoDeFoto, prepararFotoAdjunta, type FotoPreparada } from "@/lib/globos3d/escena-ia-foto";
import { primerArchivoDeImagen, validarArchivoFoto } from "@/lib/globos3d/foto-cliente";
import { DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS, aplicarHerramienta } from "@/lib/globos3d/herramientas-escena";
import { MODELAR_DESDE_FOTO } from "@/lib/globos3d/herramientas-escena-foto";
import { SINONIMOS_DE_FONDO, idDeFondoConocido } from "@/lib/globos3d/fondos-sinonimos";
import { LecturaFotoSchema, type LecturaFoto } from "@/lib/globos3d/lectura-foto";
import { ErrorLecturaFoto, costeFlashUsd, esquemaLecturaParaGemini, leerFotoConIA, validarLectura, type Generacion, type PeticionLectura } from "@/lib/globos3d/leer-foto-ia";
import { compararLecturas, distanciaTrazos, familiaDeColor, siluetaDeTrazo } from "@/lib/globos3d/comparar-lecturas";
import { combinarEscenaDeFoto, modelarDesdeFoto, resumenParaAgente, type Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { construirPromptLectura, ejemplosDeLectura } from "@/lib/globos3d/prompt-lectura-foto";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { atenderEscenaDesdeFoto, type DependenciasEscenaDesdeFoto } from "@/lib/taller/escena-desde-foto";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";
import { plantillasParecidas } from "@/lib/taller/plantillas-foto";

configurarPersistenciaTelemetria(undefined);

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const LECTURA: LecturaFoto = REFERENCIAS_DUENO[1]!.lectura;
const FOTO = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" };
const USO = { entrada: 8000, salida: 1500, pensamiento: 500 };
const generacionDe = (texto: string): Generacion => ({ texto, uso: USO });
const buena = JSON.stringify(LECTURA);

/** Un generador de mentira que responde lo dado en orden y guarda lo que le pidieron. */
function generador(respuestas: string[]) {
  const peticiones: PeticionLectura[] = [];
  return { peticiones, generar: async (p: PeticionLectura): Promise<Generacion> => { peticiones.push({ ...p, contents: structuredClone(p.contents) }); return generacionDe(respuestas[Math.min(peticiones.length - 1, respuestas.length - 1)]!); } };
}

async function main() {
console.log("Esquema y prompt");
await prueba("el esquema para Gemini no trae $schema, additionalProperties, const ni maxItems", () => {
  const texto = JSON.stringify(esquemaLecturaParaGemini());
  for (const prohibido of ['"$schema"', '"additionalProperties"', '"const"', '"maxItems"']) assert.ok(!texto.includes(prohibido), `trae ${prohibido}`);
  assert.ok(texto.includes('"guirnalda_organica"') && texto.includes('"piezas"'));
});
await prueba("el prompt trae el oficio, los colores Sempertex y 3 lecturas de ejemplo válidas", () => {
  const p = construirPromptLectura();
  for (const clave of ["FRACCIÓN DEL ALTO", "guirnalda_organica", "columna_clasica", "nunca inventas", "como máximo 30 piezas", "Fashion Blanco", "orbe_flecos_dorado", "NUNCA agregues piezas"]) assert.ok(p.includes(clave), `falta «${clave}»`);
  const ejemplos = ejemplosDeLectura();
  assert.equal(ejemplos.length, 3);
  for (const e of ejemplos) { LecturaFotoSchema.parse(e.lectura); assert.ok(p.includes(JSON.stringify(e.lectura))); }
  assert.ok(p.length < 30_000, `prompt de ${p.length} caracteres`);
});
await prueba("al evaluar una foto de referencia, esa foto no va de ejemplo (y se reemplaza por otra)", () => {
  const sin = ejemplosDeLectura(["referencia:happy-birthday-azul-dorado-redondo"]);
  assert.equal(sin.length, 3);
  assert.ok(!sin.some((e) => e.id === "referencia:happy-birthday-azul-dorado-redondo"));
  assert.ok(!construirPromptLectura(["referencia:happy-birthday-azul-dorado-redondo"]).includes(JSON.stringify(LECTURA)));
});

console.log("Lectura con la IA");
await prueba("válida a la primera: una llamada, con la foto y el esquema, coste estimado", async () => {
  const g = generador([buena]);
  const r = await leerFotoConIA(FOTO, { generar: g.generar });
  assert.equal(r.intentos, 1);
  assert.equal(g.peticiones.length, 1);
  assert.deepEqual(r.lectura, LecturaFotoSchema.parse(LECTURA));
  assert.deepEqual(r.uso, USO);
  assert.equal(r.costeEstimadoUsd, costeFlashUsd(USO));
  assert.ok(r.costeEstimadoUsd > 0.005 && r.costeEstimadoUsd < 0.02, String(r.costeEstimadoUsd));
  const parte = g.peticiones[0]!.contents[0]!.parts![0]!;
  assert.equal(parte.inlineData?.mimeType, "image/jpeg");
  assert.ok(g.peticiones[0]!.sistema.includes("guirnalda_organica"));
});
await prueba("JSON roto → reintenta una vez mostrándole su error al modelo", async () => {
  const g = generador(["esto no es json", buena]);
  const r = await leerFotoConIA(FOTO, { generar: g.generar });
  assert.equal(r.intentos, 2);
  assert.deepEqual(r.uso, { entrada: 16000, salida: 3000, pensamiento: 1000 }, "suma los dos intentos");
  const turnos: Content[] = g.peticiones[1]!.contents;
  assert.equal(turnos.length, 3);
  assert.equal(turnos[1]!.role, "model");
  assert.match(turnos[2]!.parts![0]!.text!, /no cumple el esquema[\s\S]*no es JSON válido/);
});
await prueba("fuera de rango en el esquema → reintento; el error nombra el campo", async () => {
  const mala = { ...LECTURA, aspecto: 9 };
  const g = generador([JSON.stringify(mala), buena]);
  await leerFotoConIA(FOTO, { generar: g.generar });
  assert.match(g.peticiones[1]!.contents[2]!.parts![0]!.text!, /aspecto/);
});
await prueba("si tras el reintento quedan piezas buenas, se conservan y se anotan las descartadas", async () => {
  const mala = { ...LECTURA, piezas: [...LECTURA.piezas, { tipo: "globo", x: 5, y: 0.5, diametro: 0.1, en: "piso" }, { tipo: "unicornio" }] };
  const g = generador([JSON.stringify(mala)]);
  const r = await leerFotoConIA(FOTO, { generar: g.generar });
  assert.equal(r.intentos, 2);
  assert.equal(r.lectura.piezas.length, LECTURA.piezas.length);
  assert.equal(r.descartadas.length, 2);
  assert.match(r.descartadas.join(" "), /globo/);
});
await prueba("sin ninguna pieza válida → ErrorLecturaFoto «invalida»", async () => {
  const g = generador([JSON.stringify({ ...LECTURA, piezas: [{ tipo: "unicornio" }] })]);
  await assert.rejects(() => leerFotoConIA(FOTO, { generar: g.generar }), (e: unknown) => e instanceof ErrorLecturaFoto && e.causa === "invalida");
});
await prueba("el modelo que falla da ErrorLecturaFoto «modelo» (y no reintenta)", async () => {
  let llamadas = 0;
  await assert.rejects(() => leerFotoConIA(FOTO, { generar: async () => { llamadas += 1; throw new Error("503 caído"); } }), (e: unknown) => e instanceof ErrorLecturaFoto && e.causa === "modelo");
  assert.equal(llamadas, 1);
});
await prueba("validarLectura: JSON roto, lectura buena y parcial", () => {
  assert.equal(validarLectura("{").ok, false);
  assert.equal(validarLectura(buena).ok, true);
  const parcial = validarLectura(JSON.stringify({ ...LECTURA, piezas: [LECTURA.piezas[0], { tipo: "x" }] }));
  assert.ok(!parcial.ok && parcial.parcial?.lectura.piezas.length === 1);
});

await prueba("un id de fondo inventado se corrige o pasa a «otro» sin gastar la segunda lectura", async () => {
  const fondo = { tipo: "fondo", id: "Mesa de Postres", x: 0.3, yBase: 0.9, ancho: 0.3, alto: 0.2, colores: [{ nombre: "blanco", hex: "#ffffff", peso: 100, acabado: "mate" }] };
  const raro = { ...fondo, id: "carroza_de_cenicienta", x: 0.7, texto: "Asher" };
  const otroRaro = { ...fondo, id: "globo_gigante_de_unicornio", x: 0.9 };
  const g = generador([JSON.stringify({ ...LECTURA, piezas: [...LECTURA.piezas, fondo, raro, otroRaro] })]);
  const r = await leerFotoConIA(FOTO, { generar: g.generar });
  assert.equal(r.intentos, 1, "no hubo segunda lectura");
  assert.equal(g.peticiones.length, 1);
  assert.deepEqual(r.descartadas, []);
  const nuevas = r.lectura.piezas.slice(LECTURA.piezas.length);
  assert.equal(nuevas.length, 3);
  assert.equal(nuevas[0]!.tipo === "fondo" && nuevas[0]!.id, "mesa_postres");
  assert.ok(nuevas[1]!.tipo === "otro" && /carroza_de_cenicienta/.test(nuevas[1]!.descripcion) && /Asher/.test(nuevas[1]!.descripcion));
  assert.ok(nuevas[2]!.tipo === "otro" && /globo_gigante_de_unicornio/.test(nuevas[2]!.descripcion));
  const v = validarLectura(JSON.stringify({ ...LECTURA, piezas: [...LECTURA.piezas, fondo, raro, otroRaro] }));
  assert.ok(v.ok && v.correcciones.length === 3, JSON.stringify(v.correcciones));
});
await prueba("los ids de fondo del catálogo y los ya correctos no se tocan", () => {
  assert.equal(idDeFondoConocido("mesa_mantel"), "mesa_mantel");
  assert.equal(idDeFondoConocido("Pedestal"), "pedestales");
  assert.equal(idDeFondoConocido("Alfombra"), "alfombra_redonda");
  assert.equal(idDeFondoConocido("Cortina con luces"), "cortina_luces");
  assert.equal(idDeFondoConocido("nada_que_ver"), null);
  for (const destino of Object.values(SINONIMOS_DE_FONDO)) assert.ok(idDeFondoConocido(destino) === destino, `el sinónimo apunta a «${destino}», que no existe`);
  assert.equal(validarLectura(buena).ok && validarLectura(buena).correcciones.length, 0);
});

console.log("Foto → escena");
const plantillasFalsas = [{ id: "referencia:happy-birthday-azul-dorado-redondo", nombre: "Medio arco", parecido: 0.97 }, { id: "otra", nombre: "Otra", parecido: 0.71 }];
let modelado!: Modelado;
await prueba("lee, busca plantillas en paralelo y compila la lectura a escena", async () => {
  const g = generador([buena]);
  modelado = await modelarDesdeFoto(FOTO, { detectar: null, opciones: { generar: g.generar }, plantillas: async () => plantillasFalsas });
  assert.deepEqual(modelado.escena, compilarLectura(LECTURA).escena);
  assert.deepEqual(modelado.plantillas, plantillasFalsas);
  assert.ok(modelado.escena.nodos.length >= 5);
  assert.ok(modelado.omitidas.some((o) => /letrero de luz/.test(o)), "lo que no es del taller se anota");
  assert.equal(modelado.uso.intentos, 1);
});
await prueba("sin función de plantillas no hay plantillas; si la búsqueda falla solo deja un aviso", async () => {
  const g = generador([buena]);
  assert.deepEqual((await modelarDesdeFoto(FOTO, { detectar: null, opciones: { generar: g.generar } })).plantillas, []);
  const r = await modelarDesdeFoto(FOTO, { detectar: null, opciones: { generar: g.generar }, plantillas: async () => { throw new Error("base caída"); } });
  assert.deepEqual(r.plantillas, []);
  assert.match(r.avisos.join(" "), /base caída/);
});
await prueba("plantillasParecidas: bandera apagada → nada; encendida → id, nombre y similitud de imagen; memoria → nada", async () => {
  const embeber = async () => [0.1, 0.2];
  assert.deepEqual(await plantillasParecidas(new Uint8Array([1]), { habilitado: false, embeber }), []);
  const fila = (id: string, puntaje: number | null) => ({ id, nombre: `N-${id}`, ramas: { fts: null, trigram: null, vector_texto: null, vector_imagen: puntaje === null ? null : { rango: 1, puntaje } } });
  const buscar = async () => ({ fuente: "rag" as const, resultados: [fila("a", 0.98765), fila("b", null)] as never, ids: ["a", "b"], ramas: [], interpretacion: null, avisos: [] });
  assert.deepEqual(await plantillasParecidas(new Uint8Array([1]), { habilitado: true, embeber, buscar }), [{ id: "a", nombre: "N-a", parecido: 0.988 }, { id: "b", nombre: "N-b", parecido: null }]);
  const enMemoria = async () => ({ fuente: "memoria" as const, resultados: [fila("a", 1)] as never, ids: ["a"], ramas: [], interpretacion: null, avisos: [] });
  assert.deepEqual(await plantillasParecidas(new Uint8Array([1]), { habilitado: true, embeber, buscar: enMemoria }), []);
});
await prueba("el resumen para el agente: piezas, no armadas, plantillas con su id y el estado", () => {
  const t = resumenParaAgente(modelado, "YA SE ARMÓ en la escena.");
  for (const clave of ["guirnalda_organica", "ramo_helio", "No se arman", "referencia:happy-birthday-azul-dorado-redondo", "parecido 0.97", "Estado: YA SE ARMÓ", "azul marino"]) assert.ok(t.includes(clave), `falta «${clave}»`);
  assert.match(resumenParaAgente({ ...modelado, plantillas: [] }, "x"), /No hay plantillas/);
});

console.log("Ruta /api/escena-desde-foto");
const png = async (ancho: number, alto: number) => new Uint8Array(await sharp({ create: { width: ancho, height: alto, channels: 3, background: "#cc3366" } }).png().toBuffer());
const peticion = (campos: Record<string, Blob | string>, cabeceras: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return new Request("http://localhost/api/escena-desde-foto", { method: "POST", body: f, headers: cabeceras });
};
const dependencias = (extra: Partial<DependenciasEscenaDesdeFoto> = {}): DependenciasEscenaDesdeFoto => ({ autenticado: () => true, mismoOrigen: () => true, normalizar: normalizarFotoA, modelar: async () => modelado, ...extra });
const fotoValida = async () => new Blob([await png(40, 30)], { type: "image/png" });
await prueba("sesión: sin autenticar o de otro origen → 401", async () => {
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), dependencias({ autenticado: () => false }))).status, 401);
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), dependencias({ mismoOrigen: () => false }))).status, 401);
});
await prueba("validación: sin campo, vacía, de más de 6 MB, formato malo, imagen ilegible", async () => {
  reiniciarCupoEscenaIA();
  const estado = async (campos: Record<string, Blob | string>, cab?: Record<string, string>) => (await atenderEscenaDesdeFoto(peticion(campos, cab), dependencias())).status;
  assert.equal(await estado({ otro: "x" }), 400);
  assert.equal(await estado({ imagen: new Blob([], { type: "image/png" }) }), 400);
  assert.equal(await estado({ imagen: new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "image/png" }) }), 413);
  assert.equal(await estado({ imagen: await fotoValida() }, { "content-length": String(40 * 1024 * 1024) }), 413);
  assert.equal(await estado({ imagen: new Blob(["hola"], { type: "text/plain" }) }), 415);
  assert.equal(await estado({ imagen: new Blob(["no soy una imagen"], { type: "image/png" }) }), 400);
});
await prueba("respuesta: escena, lectura, notas, omitidas y plantillas [{id, nombre, parecido}]", async () => {
  reiniciarCupoEscenaIA();
  const r = await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), dependencias());
  assert.equal(r.status, 200);
  const cuerpo = await r.json() as Record<string, unknown>;
  for (const k of ["escena", "lectura", "notas", "omitidas", "plantillas", "uso"]) assert.ok(k in cuerpo, k);
  assert.deepEqual(cuerpo.plantillas, plantillasFalsas);
});
await prueba("la foto grande llega al modelo reducida a 1536 px", async () => {
  reiniciarCupoEscenaIA();
  let recibido: Uint8Array | null = null;
  await atenderEscenaDesdeFoto(peticion({ imagen: new Blob([await png(3000, 2000)], { type: "image/png" }) }), dependencias({ modelar: async (f) => { recibido = f.bytes; return modelado; } }));
  const meta = await sharp(recibido!).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(Math.max(meta.width!, meta.height!), 1536);
});
await prueba("errores de la IA: sin configurar → 503 y devuelve el cupo; no válida → 502; cuota → 429", async () => {
  reiniciarCupoEscenaIA();
  const con = (e: Error) => dependencias({ modelar: async () => { throw e; } });
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), con(new ErrorLecturaFoto("x", "sin_ia")))).status, 503);
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), con(new ErrorLecturaFoto("x", "invalida")))).status, 502);
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), con(new ErrorLecturaFoto("429 RESOURCE_EXHAUSTED", "modelo")))).status, 429);
  for (let i = 0; i < TOPE_POR_HORA - 2; i++) assert.ok(tomarCupoEscenaIA());
  assert.equal((await atenderEscenaDesdeFoto(peticion({ imagen: await fotoValida() }), dependencias())).status, 429, "el cupo se acabó");
});

console.log("Agente de escena");
const vacia: Escena = { sala: SALA_INICIAL, nodos: [] };
const conPiezas = compilarLectura(REFERENCIAS_DUENO[5]!.lectura).escena;
const profundidad = { normalizar: normalizarFotoA, modelar: async () => modelado };
const b64 = Buffer.from(await png(200, 150)).toString("base64");
await prueba("modelar_desde_foto está declarada y, sin foto, la herramienta contesta que no hay nada que modelar", () => {
  assert.ok(NOMBRES_HERRAMIENTAS.includes(MODELAR_DESDE_FOTO));
  const d = DECLARACIONES_ESCENA.find((x) => x.name === MODELAR_DESDE_FOTO);
  assert.ok(d && d.description.length > 30 && (d.parametersJsonSchema as { type?: string }).type === "object");
  assert.deepEqual((d!.parametersJsonSchema as { properties: { modo: { enum: string[] } } }).properties.modo.enum, ["reemplazar", "sumar"]);
  const r = aplicarHerramienta(vacia, MODELAR_DESDE_FOTO, { modo: "sumar" });
  assert.ok(!r.ok && /No hay foto adjunta/.test(r.error));
});
await prueba("el cuerpo acepta solo fotos jpeg/png/webp en base64", () => {
  assert.ok(FotoCuerpoSchema.safeParse({ mime: "image/jpeg", base64: b64 }).success);
  assert.ok(!FotoCuerpoSchema.safeParse({ mime: "image/gif", base64: b64 }).success);
  assert.ok(!FotoCuerpoSchema.safeParse({ mime: "image/jpeg", base64: "no es base64!!" + "x".repeat(120) }).success);
  assert.ok(!FotoCuerpoSchema.safeParse({ mime: "image/jpeg", base64: "A".repeat(9_000_000) }).success);
});
let adjunta!: FotoPreparada;
await prueba("sala vacía: la foto se arma sola (reemplazar) y el resumen dice que ya se armó", async () => {
  const r = await prepararFotoAdjunta({ mime: "image/png", base64: b64 }, vacia, profundidad, 150);
  assert.ok(r.ok);
  adjunta = r;
  assert.ok(r.aplicada);
  assert.deepEqual(r.escena, modelado.escena);
  assert.match(r.texto, /YA SE ARMÓ/);
  assert.match(r.resumenAccion ?? "", /Armé en la escena/);
  assert.equal(r.imagen.inlineData?.mimeType, "image/jpeg");
});
await prueba("sala con piezas: no se aplica; el modelo debe llamar modelar_desde_foto", async () => {
  const r = await prepararFotoAdjunta({ mime: "image/png", base64: b64 }, conPiezas, profundidad, 150);
  assert.ok(r.ok && !r.aplicada && r.escena === conPiezas && r.resumenAccion === null);
  assert.match(r.ok ? r.texto : "", /NO se aplicó/);
});
await prueba("foto mala: formato, tamaño, ilegible, IA sin configurar → estado HTTP sin llamar al modelo", async () => {
  let llamadas = 0;
  const deps = { normalizar: normalizarFotoA, modelar: async () => { llamadas += 1; return modelado; } };
  const estado = async (foto: { mime: string; base64: string }, d = deps) => { const r = await prepararFotoAdjunta(foto, vacia, d, 150); return r.ok ? 200 : r.status; };
  assert.equal(await estado({ mime: "image/gif", base64: b64 }), 415);
  assert.equal(await estado({ mime: "image/png", base64: Buffer.from("no soy una imagen ".repeat(10)).toString("base64") }), 400);
  assert.equal(llamadas, 0);
  assert.equal(await estado({ mime: "image/png", base64: b64 }, { ...deps, modelar: async () => { throw new ErrorLecturaFoto("x", "sin_ia"); } }), 503);
});
await prueba("aplicarModeladoDeFoto: reemplazar deja la foto; sumar agrega con ids nuevos; sin foto falla; tope de piezas", () => {
  const reemplazo = aplicarModeladoDeFoto(conPiezas, adjunta, { modo: "reemplazar" }, 150);
  assert.ok(reemplazo.ok && JSON.stringify(reemplazo.escena) === JSON.stringify(modelado.escena));
  const suma = aplicarModeladoDeFoto(conPiezas, adjunta, { modo: "sumar" }, 150);
  assert.ok(suma.ok);
  if (suma.ok) {
    assert.equal(suma.escena.nodos.length, conPiezas.nodos.length + modelado.escena.nodos.length);
    assert.equal(new Set(suma.escena.nodos.map((n) => n.id)).size, suma.escena.nodos.length, "ids únicos");
    assert.deepEqual(suma.escena.sala, conPiezas.sala, "sumar conserva la sala");
    assert.ok(!suma.consulta);
  }
  const lleno = aplicarModeladoDeFoto(conPiezas, adjunta, { modo: "sumar" }, conPiezas.nodos.length + 1);
  assert.ok(!lleno.ok && /pasaría de/.test(lleno.error));
  assert.ok(!aplicarModeladoDeFoto(conPiezas, null, { modo: "sumar" }, 150).ok);
  assert.ok(!aplicarModeladoDeFoto(conPiezas, adjunta, { modo: "mezclar" }, 150).ok);
});
await prueba("combinarEscenaDeFoto sumar: lo que colgaba de otra pieza de la foto sigue colgando con su id nuevo", () => {
  const base = compilarLectura(REFERENCIAS_DUENO[0]!.lectura).escena;
  const hijo = { ...base.nodos[0]!, id: "hijo", colocacion: { en: "sobre" as const, padreId: base.nodos[0]!.id, puntoCm: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, giroGrados: 0 } };
  const conHijo: Escena = { ...base, nodos: [...base.nodos, hijo] };
  const r = combinarEscenaDeFoto(conHijo, conHijo, "sumar", 150)!;
  const nuevoHijo = r.nodos.find((n) => n.id === "hijo-2")!;
  assert.equal(nuevoHijo.colocacion.en === "sobre" ? nuevoHijo.colocacion.padreId : "", `${base.nodos[0]!.id}-2`);
});
await prueba("las reglas de la foto para el agente: ya armada, no aplicada, nada inventado, plantillas", () => {
  for (const clave of ["YA SE ARMÓ", "NO se aplicó", "modelar_desde_foto", "NUNCA agregues piezas", "plantilla"]) assert.ok(REGLAS_FOTO.includes(clave), clave);
});
await prueba("/api/escena-ia rechaza una foto mala antes de llamar al modelo", async () => {
  process.env.GEMINI_API_KEY = "clave-de-prueba-sin-red";
  const { POST } = await import("@/app/api/escena-ia/route");
  reiniciarCupoEscenaIA();
  const pedir = (foto: unknown) => POST(new Request("http://localhost/api/escena-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ escena: vacia, mensaje: "como la foto", foto }) }));
  assert.equal((await pedir({ mime: "image/gif", base64: b64 })).status, 400, "el esquema no admite gif");
  assert.equal((await pedir({ mime: "image/png", base64: Buffer.from("no soy una imagen ".repeat(10)).toString("base64") })).status, 400, "ilegible");
});

console.log("Evaluación (comparar lecturas)");
await prueba("una lectura contra sí misma puntúa 100 % en las 13 referencias", () => {
  for (const r of REFERENCIAS_DUENO) { const c = compararLecturas(r.lectura, r.lectura); assert.equal(c.puntaje, 1, String(r.numero)); assert.equal(c.tipos.inventadas.length, 0); }
});
await prueba("piezas inventadas y faltantes se cuentan por tipo; las decoraciones por su cantidad", () => {
  const h = REFERENCIAS_DUENO[1]!.lectura;
  const sinRamo: LecturaFoto = { ...h, piezas: h.piezas.filter((p) => p.tipo !== "ramo_helio") };
  const c = compararLecturas(sinRamo, h);
  assert.deepEqual(c.tipos.faltantes, ["ramo_helio"]);
  assert.deepEqual(compararLecturas(h, sinRamo).tipos.inventadas, ["ramo_helio"]);
  assert.ok(c.puntaje < 1 && c.tipos.f1 < 1);
  const seis = REFERENCIAS_DUENO[3]!.lectura;
  const unaSola = { ...seis, piezas: seis.piezas.map((p) => (p.tipo === "decoracion" ? { ...p, cantidad: 1 } : p)) };
  const fusion = { ...seis, piezas: [...seis.piezas.filter((p) => p.tipo !== "decoracion"), { ...seis.piezas.find((p) => p.tipo === "decoracion")!, cantidad: seis.piezas.filter((p) => p.tipo === "decoracion").length }] } as LecturaFoto;
  assert.equal(compararLecturas(fusion, seis).tipos.f1, 1, "una de cantidad 6 = seis de cantidad 1");
  assert.ok(compararLecturas(unaSola, seis).tipos.f1 === 1, "seis piezas de cantidad 1 siguen siendo seis");
});
await prueba("colores: misma mezcla = 1; otra familia baja; el dorado cromado y el rojo se separan", () => {
  const h = REFERENCIAS_DUENO[5]!.lectura;
  const azul: LecturaFoto = { ...h, piezas: h.piezas.map((p) => ("colores" in p ? { ...p, colores: p.colores.map((c) => ({ ...c, nombre: "azul rey", hex: "#1f3c9c", acabado: "mate" as const })) } : p)) as LecturaFoto["piezas"] };
  assert.ok(compararLecturas(azul, h).colores.familia < 0.3);
  assert.equal(familiaDeColor({ nombre: "dorado", hex: "#c9a24e", acabado: "cromado" }), "dorado");
  assert.equal(familiaDeColor({ nombre: "rojo", hex: "#d61a1a", acabado: "mate" }), "rojo");
  assert.equal(familiaDeColor({ nombre: "azul marino", hex: "#1d2b5c", acabado: "mate" }), "azul");
  assert.equal(familiaDeColor({ nombre: "blush", hex: "#e8c4c4", acabado: "mate" }), "rosa");
  assert.equal(familiaDeColor({ nombre: "marfil", hex: "#efe8c8", acabado: "mate" }), "crema");
});
await prueba("siluetas: clase del recorrido de las 13 lecturas y distancia entre ejes", () => {
  const clase = (n: number) => REFERENCIAS_DUENO.find((r) => r.numero === n)!.lectura.piezas.flatMap((p) => (p.tipo === "guirnalda_organica" ? [siluetaDeTrazo(p.puntos)] : []));
  assert.deepEqual(clase(7), ["arco"]);
  assert.deepEqual(clase(9), ["arco"]);
  assert.deepEqual(clase(2), ["medio_arco"]);
  assert.deepEqual(clase(13), ["medio_arco"]);
  assert.deepEqual(clase(12), ["horizontal"]);
  assert.equal(siluetaDeTrazo([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.4 }, { x: 0.9, y: 0.1 }]), "colgante");
  assert.equal(distanciaTrazos([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }]), 0);
  assert.ok(Math.abs(distanciaTrazos([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0.1 }, { x: 1, y: 0.1 }]) - 0.1) < 1e-9);
});

console.log("Cliente");
await prueba("el cuerpo del pedido: sin foto no lleva el campo; con foto sí; historial y selección recortados", () => {
  const entrada = { escena: vacia, mensaje: "hola", historial: Array.from({ length: 9 }, (_, i) => ({ rol: "usuario" as const, texto: `t${i}` })), seleccion: { id: "a", nombre: "n".repeat(300) } };
  const sin = construirCuerpoEscenaIA(entrada) as { historial: unknown[]; seleccion: { nombre: string; raizSolitario: null } };
  assert.ok(!("foto" in sin));
  assert.equal(sin.historial.length, 6);
  assert.equal(sin.seleccion.nombre.length, 120);
  assert.deepEqual(construirCuerpoEscenaIA({ ...entrada, seleccion: null, foto: { mime: "image/jpeg", base64: "QUJD" } }).foto, { mime: "image/jpeg", base64: "QUJD" });
  assert.equal(construirCuerpoEscenaIA({ ...entrada, seleccion: null }).seleccion, null);
});
await prueba("solo con foto el pedido es el de siempre; sin texto ni foto, vacío", () => {
  const foto = { mime: "image/jpeg", base64: "QUJD" };
  assert.equal(mensajeDelPedido("  ", foto), PEDIDO_FOTO_POR_DEFECTO);
  assert.equal(mensajeDelPedido(" hazla en rosado ", foto), "hazla en rosado");
  assert.equal(mensajeDelPedido("  ", null), "");
});
await prueba("validarArchivoFoto y primerArchivoDeImagen (pegar y soltar)", () => {
  assert.equal(validarArchivoFoto({ type: "image/png", size: 1000 }), null);
  assert.match(validarArchivoFoto({ type: "application/pdf", size: 10 }) ?? "", /JPEG, PNG o WebP/);
  assert.match(validarArchivoFoto({ type: "image/jpeg", size: 0 }) ?? "", /vacía/);
  assert.match(validarArchivoFoto({ type: "image/jpeg", size: 26 * 1024 * 1024 }) ?? "", /25 MB/);
  const archivo = new File(["x"], "f.png", { type: "image/png" });
  assert.equal(primerArchivoDeImagen([{ kind: "string", type: "text/plain" }, { kind: "file", type: "image/png", getAsFile: () => archivo }] as never), archivo);
  assert.equal(primerArchivoDeImagen([archivo] as never), archivo);
  assert.equal(primerArchivoDeImagen([{ kind: "string", type: "text/plain" }] as never), null);
  assert.equal(primerArchivoDeImagen(null), null);
});

console.log(`test-foto-a-escena: ${pruebas} pruebas ok`);
}

main().catch((e) => { console.error(e); process.exit(1); });
