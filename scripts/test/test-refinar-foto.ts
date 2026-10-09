/**
 * Refinado contra la foto y mezcla de tamaños (REQ-001 paso 9). Sin red ni coste: Gemini se reemplaza por un modelo de mentira.
 * - la mezcla leída de la foto (escalones con diámetro medido) → formatos con la escala de la foto, con `tamanos` como antes
 *   si no hay mezcla; el compilador la cumple (grandes, medianos y chicos) y engorda el cuerpo para que quepan los grandes;
 * - el encuadre de la foto y la cámara 3D que la mira (el alto de la foto llena el cuadro; el piso queda en y = 0);
 * - el reporte de diferencias del modelo (parseo) y la decisión de seguir o parar, con las rondas topadas;
 * - el cuerpo de una ronda (esquema, tope de rondas, foto y refinar no van juntos) y el bucle del navegador (parar al
 *   detener, al fallar, sin lectura, deshacer por ronda, sin pasar de 2 rondas);
 * - la ruta `/api/escena-ia` con `refinar`: las dos imágenes en el primer mensaje, la herramienta de reporte y sin la de modelar,
 *   la respuesta con la decisión de la ronda; y la respuesta de la primera vez trae la lectura y el encuadre.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-refinar-foto.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import * as THREE from "three";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { camaraDeFoto } from "@/components/tres-d/camara-foto";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { construirCuerpoRefinar } from "@/lib/globos3d/cuerpo-escena-ia";
import { encuadreDeLectura, medidasCaptura, pisoDeLectura, salaParaFoto } from "@/lib/globos3d/encuadre-foto";
import { HERRAMIENTAS_REFINAR, MAX_PASOS_REFINAR, REPORTAR_COMPARACION, RefinarCuerpoSchema, aplicarReporte, declaracionesDeRefinado, prepararRefinado, reglasDeRonda, textoDeRefinado } from "@/lib/globos3d/escena-ia-refinar";
import { DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS } from "@/lib/globos3d/herramientas-escena";
import { armarEscena, type Escena } from "@/lib/globos3d/escena";
import { LecturaFotoSchema, type LecturaFoto, type MezclaLeida } from "@/lib/globos3d/lectura-foto";
import { escalonesDe, distanciaEscalones, globosOrganicosPorFormato } from "@/lib/globos3d/mezcla-escena";
import { grosorMinimoDePesos, pesosDeLectura, pesosDeMezclaLeida, traeMezcla } from "@/lib/globos3d/mezcla-lectura";
import { construirPromptLectura } from "@/lib/globos3d/prompt-lectura-foto";
import { MAX_RONDAS_REFINAR, decidirRonda, reporteDe, type ReporteComparacion, type ResultadoRonda } from "@/lib/globos3d/refinado-ronda";
import { refinarConFoto, resumenDeRefinado, type DependenciasRefinado, type RespuestaRonda } from "@/lib/globos3d/refinar-foto-cliente";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { reiniciarCupoEscenaIA } from "@/lib/globos3d/cupo-escena-ia";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";

configurarPersistenciaTelemetria(undefined);

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const ref = (n: number) => REFERENCIAS_DUENO.find((r) => r.numero === n)!;
const LECTURA_7: LecturaFoto = ref(7).lectura;

async function main() {
console.log("Mezcla de tamaños leída");
await prueba("el diámetro medido decide el formato con la escala de la foto (0,2 de 260 cm = 52 cm = R-24; 0,1 = 26 cm = R-12)", () => {
  const m: MezclaLeida = { grandes: 40, medianos: 30, chicos: 30, diametroGrande: 0.2, diametroMediano: 0.1, diametroChico: 0.05 };
  assert.deepEqual(pesosDeMezclaLeida(m, 260), { "R-24": 0.4, "R-12": 0.3, "R-5": 0.3 });
  // La misma foto con otra escala (la foto mide 150 cm de alto): los mismos diámetros dan globos menores.
  assert.deepEqual(pesosDeMezclaLeida(m, 150), { "R-12": 0.4, "R-5": 0.6 });
});
await prueba("sin diámetros, cada escalón usa sus formatos de siempre y los pesos suman 1", () => {
  const w = pesosDeMezclaLeida({ grandes: 50, medianos: 30, chicos: 20, diametroGrande: 0.2 }, 260);
  assert.deepEqual(w, { "R-24": 0.5, "R-12": 0.3, "R-9": 0.12, "R-5": 0.08 });
  assert.ok(Math.abs(Object.values(w).reduce((s, x) => s + x, 0) - 1) < 1e-9);
});
await prueba("la mezcla manda sobre tamanos; sin mezcla, tamanos como antes; sin nada, la de partida del trazo", () => {
  const m: MezclaLeida = { grandes: 100, medianos: 0, chicos: 0, diametroGrande: 0.2 };
  assert.deepEqual(pesosDeLectura({ tamanos: { "R-5": 100 }, mezcla: m }, 260), { "R-24": 1 });
  assert.deepEqual(pesosDeLectura({ tamanos: { "R-12": 30, "R-5": 10 } }, 260), { "R-12": 0.75, "R-5": 0.25 });
  assert.ok(Object.keys(pesosDeLectura({ tamanos: {} }, 260)).length >= 4);
  assert.equal(traeMezcla({ tamanos: {} }), false);
  assert.equal(traeMezcla({ tamanos: { "R-5": 1 } }), true);
  assert.equal(traeMezcla({ tamanos: {}, mezcla: m }), true);
});
await prueba("el grosor mínimo es el del mayor formato con al menos 10 % de los globos", () => {
  assert.equal(grosorMinimoDePesos({ "R-24": 0.15, "R-12": 0.85 }), 60);
  assert.equal(grosorMinimoDePesos({ "R-24": 0.05, "R-12": 0.95 }), 32, "5 % de R-24 no manda: manda el R-12");
  assert.equal(grosorMinimoDePesos({}), null);
});
await prueba("el esquema acepta la lectura con y sin mezcla, y rechaza diámetros imposibles", () => {
  assert.ok(LecturaFotoSchema.safeParse(LECTURA_7).success);
  const sin = structuredClone(LECTURA_7);
  for (const p of sin.piezas) if (p.tipo === "guirnalda_organica") { delete p.mezcla; p.tamanos = { "R-24": 20, "R-12": 80 }; }
  assert.ok(LecturaFotoSchema.safeParse(sin).success, "las lecturas de antes siguen valiendo");
  const mala = structuredClone(LECTURA_7);
  for (const p of mala.piezas) if (p.tipo === "guirnalda_organica" && p.mezcla) p.mezcla.diametroGrande = 3;
  assert.ok(!LecturaFotoSchema.safeParse(mala).success);
});
await prueba("el prompt enseña a medir la mezcla y los ejemplos la traen", () => {
  const prompt = construirPromptLectura();
  for (const clave of ["diametroGrande", "grandes", "no los copies"]) assert.ok(prompt.includes(clave), clave);
  assert.ok(prompt.includes('"mezcla":{"grandes"'), "al menos un ejemplo con mezcla");
});

console.log("Compilador");
await prueba("las 5 fotos con mezcla armadas por el compilador cumplen el reparto leído (distancia < 0,15)", () => {
  for (const n of [4, 7, 9, 12, 13]) {
    const { lectura } = ref(n);
    const compilada = compilarLectura(lectura);
    const hecho = escalonesDe(globosOrganicosPorFormato(compilada.escena));
    const meta = lectura.piezas.filter((p) => p.tipo === "guirnalda_organica" || p.tipo === "columna_organica").map((p) => escalonesDe(pesosDeLectura(p as never, lectura.escala.altoImagenCm)))[0]!;
    assert.ok(distanciaEscalones(hecho, meta) < 0.15, `${n}: ${JSON.stringify(hecho)} contra ${JSON.stringify(meta)}`);
  }
});
await prueba("antes de la mezcla una guirnalda con 35 % de grandes salía con 2 %: ahora sale con ≥ 30 %", () => {
  const delgada = structuredClone(LECTURA_7);
  for (const p of delgada.piezas) if (p.tipo === "guirnalda_organica") { p.puntos = p.puntos.map((q) => ({ ...q, grosor: 0.12 })); }
  const compilada = compilarLectura(delgada);
  const e = escalonesDe(globosOrganicosPorFormato(compilada.escena));
  assert.ok(e.grandes >= 0.3, `grandes ${e.grandes}`);
  assert.ok(compilada.notas.some((n) => /se engrosó/.test(n)), "avisa que engrosó el cuerpo");
});
await prueba("una lectura sin mezcla ni tamanos se compila como siempre (mezcla de partida)", () => {
  const vieja = structuredClone(LECTURA_7);
  for (const p of vieja.piezas) if (p.tipo === "guirnalda_organica") { delete p.mezcla; p.tamanos = {}; }
  const c = compilarLectura(vieja);
  assert.equal(c.omitidas.length, 1, "solo lo que no es del taller");
  assert.ok(Object.keys(globosOrganicosPorFormato(c.escena)).length >= 4);
});

await prueba("un foil de la foto va por delante de la pared (no tapado por los globos de la guirnalda)", () => {
  const foil = compilarLectura(LECTURA_7).escena.nodos.find((n) => n.pieza.tipo === "metalizado")!;
  assert.equal(foil.colocacion.en, "libre");
  if (foil.colocacion.en === "libre") assert.ok(foil.colocacion.zCm > -250 + 40, "delante de la pared del fondo");
});

/** Una lectura como la que devuelve Gemini de la foto 07 (sin piso a la vista), de una corrida real. */
const LECTURA_GEMINI_07: LecturaFoto = {
  resumen: "Guirnalda orgánica verde y durazno en arco sobre la pared, con monstera y un «love» de foil.", aspecto: 1, escala: { altoImagenCm: 220, referencia: "carrito de servicio de 80 cm" }, pisoY: null, sala: { pared: "#efeeea", piso: "#d8d4cc" },
  piezas: [
    { tipo: "guirnalda_organica", puntos: [{ x: 0.11, y: 0.31, grosor: 0.28 }, { x: 0.28, y: 0.22, grosor: 0.3 }, { x: 0.52, y: 0.25, grosor: 0.24 }, { x: 0.75, y: 0.32, grosor: 0.28 }, { x: 0.9, y: 0.55, grosor: 0.32 }], tamanos: {}, mezcla: { grandes: 35, medianos: 40, chicos: 25, diametroGrande: 0.22, diametroMediano: 0.14, diametroChico: 0.06 }, racimos: 0.5, follaje: ["monstera"], colores: [{ nombre: "verde esmeralda", hex: "#0f5a38", peso: 50, acabado: "brillante" }, { nombre: "durazno", hex: "#f1d3b3", peso: 50, acabado: "mate" }] },
    { tipo: "metalizado", texto: "love", cursiva: true, x: 0.46, y: 0.51, alto: 0.28, colores: [{ nombre: "oro rosa", hex: "#e09d73", peso: 100, acabado: "cromado" }] },
    { tipo: "otro", descripcion: "carrito dorado con botella y piñas" },
  ],
};
await prueba("regresión: una guirnalda de la foto queda ARRIBA en la pared (a su altura de la foto), con la lectura a mano y con una de Gemini sin piso", () => {
  for (const [nombre, lectura] of [["a mano 07", LECTURA_7], ["Gemini 07 sin pisoY", LECTURA_GEMINI_07]] as const) {
    const c = compilarLectura(lectura);
    const guirnaldaNodo = c.escena.nodos.find((n) => n.pieza.tipo === "organico")!;
    assert.equal(guirnaldaNodo.colocacion.en, "pared", nombre);
    const alturaCm = guirnaldaNodo.colocacion.en === "pared" ? guirnaldaNodo.colocacion.alturaCm : -1;
    assert.ok(alturaCm >= 50, `${nombre}: la guirnalda no queda en el piso de la pared (alturaCm ${alturaCm})`);
    const caja = armarEscena(c.escena).porNodo.find((n) => n.id === guirnaldaNodo.id)!.caja;
    assert.ok((caja.min.y + caja.max.y) / 2 > c.escena.sala.altoCm / 2, `${nombre}: el centro de la guirnalda en la mitad de arriba (${Math.round((caja.min.y + caja.max.y) / 2)} de ${c.escena.sala.altoCm})`);
    const foil = c.escena.nodos.find((n) => n.pieza.tipo === "metalizado")!;
    assert.ok(foil.colocacion.en === "libre" && foil.colocacion.yCm >= 60, `${nombre}: el foil cuelga a media pared`);
  }
});

console.log("Encuadre y cámara");
await prueba("el encuadre de la lectura: escala, proporción y altura del centro de la imagen sobre el piso", () => {
  assert.deepEqual(encuadreDeLectura(LECTURA_7), { aspecto: 0.97, altoCm: 260, centroYCm: 143 });
  assert.deepEqual(medidasCaptura(0.97, 1024), { ancho: 993, alto: 1024 });
  assert.deepEqual(medidasCaptura(1.5, 1024), { ancho: 1024, alto: 683 });
  const sala = salaParaFoto(compilarLectura(LECTURA_7).escena.sala, encuadreDeLectura(LECTURA_7));
  assert.deepEqual(sala.mostrar, { piso: true, fondo: true, laterales: false, techo: false });
  assert.ok(sala.anchoCm >= 260 * 0.97 * 1.6 && sala.altoCm >= 143 + 130);
});
await prueba("sin piso visible: lo apoyado manda; si solo cuelga de la pared, el piso queda a 1,4 m bajo la cámara (no en lo más bajo de la guirnalda)", () => {
  const sinPiso = { ...LECTURA_7, pisoY: null };
  const piso = pisoDeLectura(sinPiso);
  assert.ok(Math.abs(piso - (0.5 + 140 / 260)) < 1e-9, `piso ${piso}`);
  const compilada = compilarLectura(sinPiso);
  const nodo = compilada.escena.nodos.find((n) => n.pieza.tipo === "organico")!;
  const caja = armarEscena(compilada.escena).porNodo.find((n) => n.id === nodo.id)!.caja;
  assert.ok(caja.min.y > 60, `la guirnalda no toca el piso: ${caja.min.y}`);
  const conColumna: LecturaFoto = { ...LECTURA_7, pisoY: null, piezas: [...LECTURA_7.piezas, { tipo: "columna_clasica", x: 0.9, yBase: 0.95, yArriba: 0.4, colores: [{ nombre: "blanco", hex: "#ffffff", peso: 100, acabado: "mate" }] }] };
  assert.equal(pisoDeLectura(conColumna), 0.95, "el pie de la columna es el piso");
  assert.equal(pisoDeLectura(LECTURA_7), 1.05, "el piso leído manda");
});
await prueba("la cámara de la foto mira de frente: el alto de la foto llena el cuadro y el piso cae en la línea del piso", () => {
  const e = encuadreDeLectura(LECTURA_7);
  const camara = camaraDeFoto(e, { fondoCm: 500 });
  assert.equal(camara.aspect, e.aspecto);
  const plano = -250 + 40;
  const ndc = (xCm: number, yCm: number) => new THREE.Vector3(xCm * 0.01, yCm * 0.01, plano * 0.01).project(camara);
  assert.ok(Math.abs(ndc(0, e.centroYCm + e.altoCm / 2).y - 1) < 1e-3, "el borde de arriba de la foto");
  assert.ok(Math.abs(ndc(0, e.centroYCm - e.altoCm / 2).y + 1) < 1e-3, "el borde de abajo");
  assert.ok(Math.abs(ndc(0, 0).y - (1.05 - 0.5) * -2 * -1) < 1e-2 || Math.abs(ndc(0, 0).y - (-(1.05 - 0.5) * 2)) < 1e-2, "el piso (y = 0) cae donde la lectura puso el piso");
  assert.ok(Math.abs(ndc(0.5 * e.aspecto * e.altoCm, e.centroYCm).x - 1) < 1e-3, "el borde derecho");
});

console.log("Reporte y rondas");
const diferencia = (significativa: boolean, aspecto = "mezcla_tamanos") => ({ aspecto, descripcion: "en la foto ~35 % son R-24, en la captura casi ninguno", significativa });
await prueba("reporteDe valida el esquema del modelo y rechaza lo que no cumple", () => {
  assert.equal(reporteDe({ diferencias: [diferencia(true)] })?.diferencias.length, 1);
  assert.equal(reporteDe({ diferencias: [] })?.diferencias.length, 0);
  assert.equal(reporteDe({ diferencias: [{ ...diferencia(true), aspecto: "color" }] }), null);
  assert.equal(reporteDe({ diferencias: [{ aspecto: "colores", descripcion: "x", significativa: true }] }), null, "descripción muy corta");
  assert.equal(reporteDe({}), null);
  assert.equal(reporteDe("nada"), null);
});
await prueba("aplicarReporte guarda el reporte y no cambia la escena; uno malo es un error del modelo", () => {
  const escena = compilarLectura(LECTURA_7).escena;
  const reportes: ReporteComparacion[] = [];
  const r = aplicarReporte(escena, { diferencias: [diferencia(true), diferencia(false, "colores")] }, reportes);
  assert.ok(r.ok && r.consulta && r.escena === escena && /2 diferencias, 1 significativas/.test(r.resumen));
  assert.equal(reportes.length, 1);
  const vacio = aplicarReporte(escena, { diferencias: [] }, reportes);
  assert.ok(vacio.ok && /sin diferencias/.test(vacio.resumen) && /termina/.test(vacio.resumen));
  const malo = aplicarReporte(escena, { diferencias: "x" }, reportes);
  assert.ok(!malo.ok && (reportes.length as number) === 2);
});
await prueba("decidirRonda: sigue si hay diferencias significativas y cambios; para sin diferencias, sin cambios o en la última ronda", () => {
  const con = (n: number): ReporteComparacion => ({ diferencias: Array.from({ length: n }, () => diferencia(true) as ReporteComparacion["diferencias"][number]) });
  const sin: ReporteComparacion = { diferencias: [diferencia(false) as ReporteComparacion["diferencias"][number]] };
  assert.deepEqual(decidirRonda(1, [con(3)], 4), { ronda: 1, diferencias: con(3).diferencias, significativas: 3, cambios: 4, terminar: false, motivo: "continua" });
  assert.equal(decidirRonda(1, [sin], 0).motivo, "sin_diferencias");
  assert.equal(decidirRonda(1, [{ diferencias: [] }], 0).terminar, true);
  assert.equal(decidirRonda(1, [con(2)], 0).motivo, "sin_cambios");
  assert.equal(decidirRonda(MAX_RONDAS_REFINAR, [con(2)], 5).motivo, "ultima_ronda");
  assert.equal(decidirRonda(1, [], 3).motivo, "continua", "si no reportó pero cambió algo, otra ronda");
  assert.equal(decidirRonda(1, [], 0).motivo, "sin_cambios");
  assert.equal(decidirRonda(1, [sin, con(5)], 5).motivo, "sin_diferencias", "manda el primer reporte (el de comparar, no el de repasar)");
});
await prueba("las reglas de la ronda dicen qué comparar, reportar primero, corregir con las herramientas y no inventar", () => {
  const r = reglasDeRonda(2);
  for (const clave of [REPORTAR_COMPARACION, "mezcla_tamanos", "silueta", "grosor", "colores", "ajustar_tamanos", "NUNCA agregues piezas", "ronda 2 de 2"]) assert.ok(r.includes(clave), clave);
  assert.ok(MAX_PASOS_REFINAR < 12);
  assert.equal(MAX_RONDAS_REFINAR, 2);
});

await prueba("las herramientas de la ronda existen, son las de corregir y pesan la mitad que todas", () => {
  for (const n of HERRAMIENTAS_REFINAR) assert.ok(NOMBRES_HERRAMIENTAS.includes(n), n);
  const nombres = declaracionesDeRefinado(DECLARACIONES_ESCENA).map((d) => d.name);
  assert.ok(nombres.includes(REPORTAR_COMPARACION) && nombres.includes("ajustar_tamanos") && nombres.includes("cambiar_pieza") && nombres.includes("recolorear_escena"));
  for (const fuera of ["modelar_desde_foto", "preguntar_usuario", "usar_preset", "buscar_en_biblioteca", "insertar_de_biblioteca"]) assert.ok(!nombres.includes(fuera), fuera);
  const peso = (ds: ReadonlyArray<unknown>) => JSON.stringify(ds).length;
  assert.ok(peso(declaracionesDeRefinado(DECLARACIONES_ESCENA)) < peso(DECLARACIONES_ESCENA) * 0.6);
});

console.log("Cuerpo de la ronda");
const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c0a080" } }).jpeg().toBuffer();
const b64 = jpeg.toString("base64");
const escena7 = compilarLectura(LECTURA_7).escena;
const cuerpoValido = { ronda: 1, foto: { mime: "image/jpeg", base64: b64 }, captura: { mime: "image/jpeg", base64: b64 }, lectura: LECTURA_7 };
await prueba("RefinarCuerpoSchema: acepta una ronda válida; rechaza la ronda 3, la captura que no es JPEG y la lectura inventada", () => {
  assert.ok(RefinarCuerpoSchema.safeParse(cuerpoValido).success);
  assert.ok(RefinarCuerpoSchema.safeParse({ ...cuerpoValido, ronda: 2 }).success);
  assert.ok(!RefinarCuerpoSchema.safeParse({ ...cuerpoValido, ronda: 3 }).success, "máximo 2 rondas");
  assert.ok(!RefinarCuerpoSchema.safeParse({ ...cuerpoValido, ronda: 0 }).success);
  assert.ok(!RefinarCuerpoSchema.safeParse({ ...cuerpoValido, captura: { mime: "image/png", base64: b64 } }).success);
  assert.ok(!RefinarCuerpoSchema.safeParse({ ...cuerpoValido, lectura: { ...LECTURA_7, piezas: [] } }).success);
});
await prueba("construirCuerpoRefinar arma el pedido: escena, foto, captura, lectura, sin historial ni selección", () => {
  const c = construirCuerpoRefinar({ escena: escena7, ronda: 2, foto: { mime: "image/jpeg", base64: b64 }, captura: { mime: "image/jpeg", base64: "Y2E=" }, lectura: LECTURA_7 });
  assert.deepEqual(Object.keys(c).sort(), ["escena", "historial", "mensaje", "refinar", "seleccion"]);
  assert.deepEqual(c.historial, []);
  assert.equal(c.seleccion, null);
  assert.equal((c.refinar as { ronda: number }).ronda, 2);
  assert.match(String(c.mensaje), /ronda 2/);
});
await prueba("prepararRefinado: una sola foto y una captura, con la lectura, la escala y ver_escena en el texto", async () => {
  const p = await prepararRefinado(RefinarCuerpoSchema.parse(cuerpoValido), escena7, normalizarFotoA);
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.partes.filter((x) => x.inlineData).length, 2, "dos imágenes");
    const texto = p.partes[0]!.text!;
    for (const clave of ["Ronda 1 de 2", "Escala: la foto mide 260 cm", "Piezas leídas", "guirnalda_organica", "ver_escena", "guirnalda-organica"]) assert.ok(texto.includes(clave), clave);
    assert.equal(texto, textoDeRefinado(1, LECTURA_7, escena7));
  }
  const rota = await prepararRefinado(RefinarCuerpoSchema.parse({ ...cuerpoValido, captura: { mime: "image/jpeg", base64: Buffer.from("no soy una imagen ".repeat(10)).toString("base64") } }), escena7, normalizarFotoA);
  assert.ok(!rota.ok && rota.status === 400);
});

console.log("Bucle del navegador");
const resultadoRonda = (ronda: number, terminar: boolean, motivo: ResultadoRonda["motivo"]): ResultadoRonda => ({ ronda, diferencias: [], significativas: 2, cambios: 1, terminar, motivo });
const cambio = { herramienta: "ajustar_tamanos", resumen: "R-24: 1 → 13", consulta: false };
const consulta = { herramienta: "ver_escena", resumen: "ver", consulta: true };
/** Una escena distinta por ronda (para ver qué se aplicó). */
const escenaN = (n: number): Escena => ({ ...escena7, sala: { ...escena7.sala, anchoCm: 600 + n } });
function depsDe(respuestas: Array<RespuestaRonda | { error: string }>, extra: Partial<DependenciasRefinado> = {}) {
  const pedidos: Array<Record<string, unknown>> = [];
  const capturadas: Escena[] = [];
  const progreso: number[] = [];
  const deps: DependenciasRefinado = {
    capturar: async (e) => { capturadas.push(e); return { mime: "image/jpeg", base64: "Y2E=" }; },
    pedir: async (cuerpo) => { pedidos.push(cuerpo); const r = respuestas[pedidos.length - 1]!; return "error" in r ? { ok: false, error: r.error } : { ok: true, datos: r }; },
    alProgreso: (p) => progreso.push(p.ronda),
    signal: new AbortController().signal,
    ...extra,
  };
  return { deps, pedidos, capturadas, progreso };
}
const entrada = { escena: escenaN(0), foto: { mime: "image/jpeg", base64: b64 }, lectura: LECTURA_7, encuadre: encuadreDeLectura(LECTURA_7) };
await prueba("dos rondas con cambios: cada una captura la escena de ahora, guarda su «antes» para deshacer y para en la segunda", async () => {
  const { deps, pedidos, capturadas, progreso } = depsDe([
    { escena: escenaN(1), respuesta: "subí los R-24", acciones: [consulta, cambio], refinar: resultadoRonda(1, false, "continua") },
    { escena: escenaN(2), respuesta: "ajusté el grosor", acciones: [cambio], refinar: resultadoRonda(2, true, "ultima_ronda") },
  ]);
  const aplicadas: number[] = [];
  const r = await refinarConFoto(entrada, { ...deps, alRonda: (h) => aplicadas.push(h.ronda) });
  assert.equal(r.motivo, "ultima_ronda");
  assert.deepEqual(progreso, [1, 2]);
  assert.deepEqual(aplicadas, [1, 2]);
  assert.equal(r.rondas.length, 2);
  assert.equal(r.rondas[0]!.antes.sala.anchoCm, 600, "deshacer la ronda 1 vuelve a la escena armada");
  assert.equal(r.rondas[1]!.antes.sala.anchoCm, 601, "deshacer la ronda 2 vuelve a la de la ronda 1");
  assert.equal(r.escena.sala.anchoCm, 602);
  assert.deepEqual(capturadas.map((e) => e.sala.anchoCm), [600, 601], "cada ronda captura la escena de ahora");
  assert.deepEqual(pedidos.map((p) => (p.refinar as { ronda: number }).ronda), [1, 2]);
  assert.equal((pedidos[0]!.escena as Escena).sala.anchoCm, 600);
  assert.equal(r.rondas[0]!.cambios.length, 1, "solo los cambios, no las consultas");
});
await prueba("para en la primera ronda si el servidor dice que ya se ve igual; sin cambios no hay nada que deshacer", async () => {
  const { deps, pedidos } = depsDe([{ escena: escenaN(0), respuesta: "ya se ve como la foto", acciones: [consulta], refinar: { ...resultadoRonda(1, true, "sin_diferencias"), significativas: 0, cambios: 0 } }]);
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "sin_diferencias");
  assert.equal(r.rondas.length, 0);
  assert.equal(pedidos.length, 1);
  assert.match(resumenDeRefinado(r), /ya se ve igual/);
});
await prueba("nunca pasa de 2 rondas aunque el servidor siempre diga «continúa»", async () => {
  const siempre: RespuestaRonda = { escena: escenaN(1), respuesta: "más", acciones: [cambio], refinar: resultadoRonda(1, false, "continua") };
  const { deps, pedidos } = depsDe([siempre, siempre, siempre]);
  const r = await refinarConFoto(entrada, deps);
  assert.equal(pedidos.length, 2);
  assert.equal(r.motivo, "ultima_ronda");
  const una = depsDe([siempre, siempre], { maxRondas: 1 });
  await refinarConFoto(entrada, una.deps);
  assert.equal(una.pedidos.length, 1);
  const otra = depsDe([siempre, siempre, siempre], { maxRondas: 9 });
  await refinarConFoto(entrada, otra.deps);
  assert.equal(otra.pedidos.length, 2, "el tope de rondas no se salta");
});
await prueba("detener antes de la captura, durante el pedido o después: lo hecho se queda y lo que llega tarde no se aplica", async () => {
  const control = new AbortController();
  const antes = depsDe([], { signal: (control.abort(), control.signal) });
  assert.equal((await refinarConFoto(entrada, antes.deps)).motivo, "detenido");
  assert.equal(antes.pedidos.length, 0);
  const c2 = new AbortController();
  const durante = depsDe([{ escena: escenaN(1), respuesta: "x", acciones: [cambio], refinar: resultadoRonda(1, false, "continua") }], { signal: c2.signal, pedir: async () => { c2.abort(); return { ok: true, datos: { escena: escenaN(1), respuesta: "x", acciones: [cambio], refinar: resultadoRonda(1, false, "continua") } }; } });
  const aplicadas: number[] = [];
  const r = await refinarConFoto(entrada, { ...durante.deps, alRonda: (h) => aplicadas.push(h.ronda) });
  assert.equal(r.motivo, "detenido");
  assert.deepEqual(aplicadas, [], "la ronda que llegó después de detener no se aplica");
  assert.equal(r.escena.sala.anchoCm, 600);
  const c3 = new AbortController();
  const entre = depsDe([{ escena: escenaN(1), respuesta: "x", acciones: [cambio], refinar: resultadoRonda(1, false, "continua") }], { signal: c3.signal, alRonda: () => c3.abort() });
  const r3 = await refinarConFoto(entrada, entre.deps);
  assert.equal(r3.motivo, "detenido");
  assert.equal(r3.rondas.length, 1, "la ronda 1 ya estaba aplicada y se queda");
  assert.equal(entre.pedidos.length, 1);
  assert.match(resumenDeRefinado(r3), /Detuve/);
});
await prueba("un error de la ronda o de la captura para el bucle y conserva lo ya hecho; sin lectura ni encuadre no empieza", async () => {
  const ok1: RespuestaRonda = { escena: escenaN(1), respuesta: "x", acciones: [cambio], refinar: resultadoRonda(1, false, "continua") };
  const fallo = await refinarConFoto(entrada, depsDe([ok1, { error: "La IA no tiene cuota disponible ahora." }]).deps);
  assert.equal(fallo.motivo, "error");
  assert.equal(fallo.rondas.length, 1);
  assert.equal(fallo.escena.sala.anchoCm, 601);
  assert.match(resumenDeRefinado(fallo), /Corregí 1 ronda, pero no pude seguir comparando con la foto: La IA no tiene cuota/);
  const sinCaptura = await refinarConFoto(entrada, depsDe([], { capturar: async () => { throw new Error("WebGL no disponible"); } }).deps);
  assert.equal(sinCaptura.motivo, "error");
  assert.match(sinCaptura.error ?? "", /WebGL/);
  assert.equal((await refinarConFoto({ ...entrada, encuadre: null }, depsDe([]).deps)).motivo, "sin_lectura");
  assert.equal((await refinarConFoto({ ...entrada, lectura: null }, depsDe([]).deps)).motivo, "sin_lectura");
});

console.log("Ruta /api/escena-ia");
process.env.GEMINI_API_KEY = "clave-de-prueba-sin-red";
const fetchOriginal = globalThis.fetch;
type ParteRest = { text?: string; inlineData?: unknown; functionResponse?: unknown };
/** Lo que llega a Gemini por REST: el mensaje, el sistema, las herramientas y si pide JSON con esquema (la lectura de la foto). */
type Peticion = { contents: Array<{ role: string; parts: ParteRest[] }>; systemInstruction: { parts: Array<{ text: string }> }; tools?: Array<{ functionDeclarations: Array<{ name: string }> }>; generationConfig?: { responseJsonSchema?: unknown } };
const sistemaDe = (p: Peticion) => p.systemInstruction.parts.map((x) => x.text).join("");
const nombresDe = (p: Peticion) => (p.tools ?? []).flatMap((t) => t.functionDeclarations.map((d) => d.name));
const respuestaRest = (partes: Array<Record<string, unknown>>) => ({ candidates: [{ content: { role: "model", parts: partes }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 200, thoughtsTokenCount: 100 } });
/** Gemini de mentira por `fetch`: responde en orden lo que dice el guion (o lo que diga `segun`) y guarda lo que le pidieron. */
function modeloDeMentira(guion: Array<Array<Record<string, unknown>>>, segun?: (p: Peticion) => Array<Record<string, unknown>> | null) {
  const peticiones: Peticion[] = [];
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!url.includes("generativelanguage.googleapis.com")) return fetchOriginal(entrada, init);
    const p = JSON.parse(String(init?.body)) as Peticion;
    peticiones.push(p);
    const partes = segun?.(p) ?? guion[Math.min(peticiones.length - 1, guion.length - 1)]!;
    return new Response(JSON.stringify(respuestaRest(partes)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return peticiones;
}
const { POST } = await import("@/app/api/escena-ia/route");
const pedirRuta = (cuerpo: Record<string, unknown>) => POST(new Request("http://localhost/api/escena-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }));
const cuerpoRuta = (extra: Record<string, unknown>) => ({ escena: escena7, mensaje: "Compara la escena con la foto (ronda 1).", historial: [], seleccion: null, ...extra });
try {
  await prueba("una ronda con diferencias: el modelo recibe las dos imágenes y la herramienta de reporte, corrige y la respuesta dice que sigue", async () => {
    reiniciarCupoEscenaIA();
    const peticiones = modeloDeMentira([
      [{ functionCall: { name: REPORTAR_COMPARACION, args: { diferencias: [diferencia(true)] } } }, { functionCall: { name: "ajustar_tamanos", args: { id: "guirnalda-organica", cambios: [{ formato: "R-24", accion: "mas" }] } } }],
      [{ text: "Faltaban R-24: subí su cantidad." }],
    ]);
    const r = await pedirRuta(cuerpoRuta({ refinar: cuerpoValido }));
    assert.equal(r.status, 200);
    const datos = await r.json() as { escena: Escena; acciones: Array<{ herramienta: string; consulta: boolean }>; refinar: ResultadoRonda; foto?: unknown };
    assert.equal(peticiones.length, 2);
    const primera = peticiones[0]!;
    assert.equal(primera.contents.length, 1, "sin historial: solo el mensaje de la ronda");
    assert.equal(primera.contents[0]!.parts.filter((p) => p.inlineData).length, 2, "foto y captura juntas");
    assert.ok(primera.contents[0]!.parts[0]!.text!.includes("Ronda 1 de 2"));
    const nombres = nombresDe(primera);
    assert.ok(nombres.includes(REPORTAR_COMPARACION) && nombres.includes("ajustar_tamanos"));
    assert.ok(!nombres.includes("modelar_desde_foto") && !nombres.includes("preguntar_usuario") && !nombres.includes("buscar_en_biblioteca"));
    assert.ok(sistemaDe(primera).includes("COMPARACIÓN CON LA FOTO") && sistemaDe(primera).includes("ronda 1 de 2"));
    assert.ok(!sistemaDe(primera).includes("FOTO ADJUNTA"));
    assert.equal(datos.refinar.ronda, 1);
    assert.equal(datos.refinar.significativas, 1);
    assert.equal(datos.refinar.terminar, false);
    assert.equal(datos.refinar.motivo, "continua");
    assert.equal(datos.refinar.cambios, 1);
    assert.ok(datos.acciones.some((a) => a.herramienta === "ajustar_tamanos" && !a.consulta));
    const antes = globosOrganicosPorFormato(escena7)["R-24"] ?? 0, despues = globosOrganicosPorFormato(datos.escena)["R-24"] ?? 0;
    assert.ok(despues > antes, `R-24 ${antes} → ${despues}`);
  });
  await prueba("una ronda sin diferencias significativas: no cambia nada y la respuesta manda parar", async () => {
    reiniciarCupoEscenaIA();
    modeloDeMentira([[{ functionCall: { name: REPORTAR_COMPARACION, args: { diferencias: [diferencia(false, "colores")] } } }], [{ text: "Ya se ve como la foto." }]]);
    const datos = await (await pedirRuta(cuerpoRuta({ refinar: { ...cuerpoValido, ronda: 2 } }))).json() as { escena: Escena; refinar: ResultadoRonda };
    assert.deepEqual(datos.escena, escena7);
    assert.equal(datos.refinar.terminar, true);
    assert.equal(datos.refinar.motivo, "sin_diferencias");
  });
  await prueba("foto y refinar juntos, la ronda 3 o una captura rota se rechazan antes de llamar al modelo", async () => {
    reiniciarCupoEscenaIA();
    const peticiones = modeloDeMentira([[{ text: "no debería llamarse" }]]);
    assert.equal((await pedirRuta(cuerpoRuta({ refinar: cuerpoValido, foto: { mime: "image/jpeg", base64: b64 } }))).status, 400);
    assert.equal((await pedirRuta(cuerpoRuta({ refinar: { ...cuerpoValido, ronda: 3 } }))).status, 400);
    assert.equal((await pedirRuta(cuerpoRuta({ refinar: { ...cuerpoValido, captura: { mime: "image/jpeg", base64: Buffer.from("no soy una imagen ".repeat(10)).toString("base64") } } }))).status, 400);
    assert.equal(peticiones.length, 0);
  });
  await prueba("con la sala ya con piezas, el primer paso del modelo es aplicar la foto (no armarla él con agregar_pieza) y lo leído queda arriba; la respuesta permite comparar", async () => {
    reiniciarCupoEscenaIA();
    const peticiones = modeloDeMentira([], (p) => {
      if (p.generationConfig?.responseJsonSchema !== undefined) return [{ text: JSON.stringify(LECTURA_GEMINI_07) }];
      const yaLlamo = p.contents.some((c) => c.parts.some((x) => x.functionResponse));
      return yaLlamo ? [{ text: "Listo, armé la foto." }] : [{ functionCall: { name: "modelar_desde_foto", args: { modo: "reemplazar" } } }];
    });
    const r = await pedirRuta({ escena: escena7, mensaje: "arma esta decoración de la foto en la pared del fondo", historial: [], seleccion: null, foto: { mime: "image/jpeg", base64: b64 } });
    assert.equal(r.status, 200);
    const datos = await r.json() as { escena: Escena; foto: { aplicada: boolean; lectura: LecturaFoto; encuadre: { aspecto: number } } };
    const delModelo = peticiones.filter((p) => p.generationConfig?.responseJsonSchema === undefined);
    const forzada = (delModelo[0] as unknown as { toolConfig?: { functionCallingConfig?: { mode?: string; allowedFunctionNames?: string[] } } }).toolConfig?.functionCallingConfig;
    assert.equal(forzada?.mode, "ANY");
    assert.deepEqual(forzada?.allowedFunctionNames, ["modelar_desde_foto", "preguntar_usuario"]);
    assert.equal((delModelo[1] as unknown as { toolConfig?: unknown }).toolConfig, undefined, "solo el primer paso es forzado");
    assert.ok(sistemaDe(delModelo[0]!).includes("NUNCA armes tú la decoración") && sistemaDe(delModelo[0]!).includes("NO muevas"));
    assert.equal(datos.foto.aplicada, true, "la barra puede arrancar la comparación");
    assert.equal(datos.foto.lectura.pisoY, null);
    const organica = datos.escena.nodos.find((n) => n.pieza.tipo === "organico")!;
    assert.ok(organica.colocacion.en === "pared" && organica.colocacion.alturaCm >= 50, "arriba en la pared");
  });
  await prueba("con la sala vacía no se fuerza nada (ya se armó sola) y la respuesta permite comparar", async () => {
    reiniciarCupoEscenaIA();
    const peticiones = modeloDeMentira([], (p) => [{ text: p.generationConfig?.responseJsonSchema !== undefined ? JSON.stringify(LECTURA_7) : "Listo." }]);
    await pedirRuta({ escena: { sala: escena7.sala, nodos: [] }, mensaje: "como la foto", historial: [], seleccion: null, foto: { mime: "image/jpeg", base64: b64 } });
    assert.ok(peticiones.every((p) => (p as unknown as { toolConfig?: unknown }).toolConfig === undefined));
  });
  await prueba("armar desde la foto devuelve la lectura y el encuadre para comparar después (y que se armó)", async () => {
    reiniciarCupoEscenaIA();
    const vacia: Escena = { sala: escena7.sala, nodos: [] };
    // La lectura de la foto la hace Gemini (visión, JSON con esquema): aquí se responde con la lectura de ejemplo.
    const peticiones = modeloDeMentira([], (p) => [{ text: p.generationConfig?.responseJsonSchema !== undefined ? JSON.stringify(LECTURA_7) : "Listo, armé la guirnalda." }]);
    const r = await pedirRuta({ escena: vacia, mensaje: "Arma esta decoración como la de la foto.", historial: [], seleccion: null, foto: { mime: "image/jpeg", base64: b64 } });
    assert.equal(r.status, 200);
    const datos = await r.json() as { escena: Escena; foto: { aplicada: boolean; lectura: LecturaFoto; encuadre: unknown } };
    assert.equal(datos.foto.aplicada, true);
    assert.ok(LecturaFotoSchema.safeParse(datos.foto.lectura).success);
    assert.deepEqual(datos.foto.encuadre, { aspecto: 0.97, altoCm: 260, centroYCm: 143 });
    assert.ok(datos.escena.nodos.length >= 1);
    const sistema = sistemaDe(peticiones[peticiones.length - 1]!);
    assert.ok(sistema.includes("2 rondas automáticas"), "el modelo sabe que la comparación viene después");
  });
} finally {
  globalThis.fetch = fetchOriginal;
}

console.log(`\ntest-refinar-foto: ${pruebas} pruebas ok`);
}

main().catch((e) => { console.error(e); process.exit(1); });
