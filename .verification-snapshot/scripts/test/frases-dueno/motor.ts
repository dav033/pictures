/**
 * Motor del corpus de frases del dueño: un modelo SIMULADO (guion de llamadas por frase) que pasa por lo mismo que `/api/escena-ia`:
 * validación del argumento contra el esquema que ve el modelo (la declaración de la herramienta), `aplicarHerramientaIA` (política del
 * catálogo y herramientas), avisos para el usuario, verificación automática y `conHonestidad` sobre la respuesta final.
 *
 * Sin red, sin coste, sin IA. Las invariantes valen para cada frase: piezas dentro del sala, colores reales del catálogo, escena que arma
 * sin avisos, ids únicos, tope de piezas, ningún problema nuevo, y «agrega» suma sin quitar ni tocar lo que había.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { EntradaBusqueda, RespuestaBusquedaTaller, ResultadoTaller } from "../../../src/lib/taller/buscar";
import { DECLARACIONES_ESCENA } from "../../../src/lib/globos3d/herramientas-escena";
import { aplicarHerramientaIA } from "../../../src/lib/catalogo/herramientas-ia-aplicar";
import { politicaDe } from "../../../src/lib/catalogo/herramientas-ia";
import { armarEscena, type Escena, type NodoEscena } from "../../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../../src/lib/globos3d/escenas-presets";
import { MAX_NODOS } from "../../../src/lib/globos3d/limites-escena";
import { coloresDePieza } from "../../../src/lib/globos3d/herramientas-escena-recolor";
import { referenciaPorCodigo } from "../../../src/lib/plan/referencia-sempertex";
import { problemasNuevos } from "../../../src/lib/globos3d/problemas-escena";
import { conHonestidad, fallosPendientes, objetivoDe, type Intento } from "../../../src/lib/globos3d/honestidad-respuesta";
import { verificarCambios } from "../../../src/lib/globos3d/verificacion-escena";
import type { AvisoUsuario } from "../../../src/lib/globos3d/avisos-usuario";

export type Args = Record<string, unknown>;
/** Los argumentos pueden depender de la escena del momento (un id que acaba de nacer, un ancho mayor que el actual). */
export type Llamada = { herramienta: string; args: Args | ((escena: Escena) => Args) };
export type Vuelta = Llamada[];

export type Area = "salon" | "organico" | "tamanos" | "colores" | "foil-letras" | "biblioteca" | "mover" | "honestidad";

export type LlamadaHecha = { herramienta: string; args: Args; ok: boolean; resumen: string; error: string; consulta: boolean; avisos: readonly AvisoUsuario[] };

export type Contexto = {
  antes: Escena;
  despues: Escena;
  llamadas: LlamadaHecha[];
  /** Lo que la herramienta le pidió a la búsqueda de la biblioteca (los filtros que armó con los argumentos del modelo). */
  busquedas: EntradaBusqueda[];
  /** La respuesta final tal como la entrega el servidor: el texto del modelo más «Ojo, no todo salió…» / «Aviso: …». */
  respuesta: string;
  /** La verificación automática de la última vuelta que cambió la escena (la que recibe el modelo). */
  verificacion: string;
};

export type Caso = {
  area: Area;
  frase: string;
  /** Una escena predefinida, o «salon-armado» (la guardada con un salón de 30 invitados ya armado), o «vacia». */
  base: string;
  vueltas: Vuelta[];
  /** Lo que el modelo diría al final; por defecto una frase optimista (la honestidad la agrega el servidor). */
  textoModelo?: string;
  /** Las llamadas de este caso fallan A PROPÓSITO (el pedido no se puede) con este mensaje, y la escena queda intacta. */
  rechazo?: RegExp;
  /** «Agrega»: lo que había queda tal cual (nada se quita ni se toca). Por defecto sí; `false` para los que cambian lo existente. */
  sumaSola?: boolean;
  /** Piezas de `antes` que este pedido sí puede tocar aunque `sumaSola` esté activo. */
  tocables?: readonly string[];
  /** Los ids que devuelve la búsqueda de la biblioteca (RAG simulado); sin ella `buscar_en_biblioteca` no se usa. */
  biblioteca?: readonly string[];
  /** Los argumentos del modelo se salen del esquema A PROPÓSITO (un pedido absurdo): el esquema y la herramienta los rechazan los dos. */
  fueraDeEsquema?: boolean;
  /** El pedido deja piezas fuera de la sala A PROPÓSITO de la herramienta (que lo avisa): la invariante de la sala no aplica. */
  fueraDeSala?: boolean;
  /** Lo propio de la frase: tipos, cantidades, colores, medidas y avisos concretos. */
  comprobar: (ctx: Contexto) => void;
  /** Defecto conocido y grande: la frase NO funciona hoy; la razón queda en el informe. Si pasa, la prueba exige quitar la marca. */
  fallaEsperada?: string;
  /** Con `fallaEsperada`: el mensaje con el que tiene que seguir fallando (si falla por otra cosa, es otro defecto y la prueba cae). */
  fallaCon?: RegExp;
};

// ----------------------------------------------------------------------------------------------------------
// Modelo simulado
// ----------------------------------------------------------------------------------------------------------

const esquemas = new Map(DECLARACIONES_ESCENA.map((d) => [d.name, z.fromJSONSchema(d.parametersJsonSchema as Parameters<typeof z.fromJSONSchema>[0])]));

/** El argumento cumple el esquema que ve el modelo (lo mismo que Gemini valida al llamar la función). */
export function validarContraEsquema(herramienta: string, args: Args): string | null {
  const esquema = esquemas.get(herramienta);
  if (!esquema) return `la herramienta «${herramienta}» no está declarada`;
  const r = esquema.safeParse(args);
  return r.success ? null : r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
}

/** El salón armado con `armar_salon` (30 invitados) y guardado: las frases sobre un salón parten de él sin armarlo otra vez. */
export const SALON_ARMADO: Escena = JSON.parse(readFileSync(new URL("../fixtures/escena-salon-armado.json", import.meta.url), "utf8")) as Escena;
const POLITICA = politicaDe({ filtro: false, ia: ["sempertex", "mobiliario", "escenografia"], rag: [] });

export function escenaDeBase(base: string): Escena {
  if (base === "salon-armado") return structuredClone(SALON_ARMADO);
  if (base === "vacia") return { ...escenaPredefinida("arco_organico_columnas_guirnalda"), nodos: [] };
  return escenaPredefinida(base);
}

/** Un resultado de la búsqueda de la biblioteca, tal como lo devuelve el RAG (solo el id y el nombre importan para la herramienta). */
function resultadoDeBiblioteca(id: string): ResultadoTaller {
  return {
    id, tipo: "estructura", nombre: id, descripcion: "", origen: { tipo: null, titulo: null, url: null, foto: null }, ocasiones: [], celebraciones: [], tematicas: [], tiposPieza: [], formatos: [], colores: [], partes: [], productos: [],
    medidas: { altoCm: null, anchoCm: null, fondoCm: null }, globos: 0, tubos: 0, propietario: null, repositorio: "sempertex", puntaje: 0.03,
    ramas: { fts: null, trigram: null, vector_texto: null, vector_imagen: null }, razones: ["salió en la búsqueda simulada"],
  };
}

async function aplicar(escena: Escena, herramienta: string, args: Args, biblioteca: readonly string[] | undefined, busquedas: EntradaBusqueda[]) {
  // Sin red. Con `biblioteca` la búsqueda responde como el RAG con esos ids (el modelo elige uno y lo inserta de verdad); sin ella, el RAG está apagado
  // (como con TALLER_RAG_ENABLED apagado) y buscar_en_biblioteca leería el índice completo en memoria (~30 s): ninguna frase lo necesita.
  const buscar = async (entrada: EntradaBusqueda): Promise<RespuestaBusquedaTaller> => {
    if (!biblioteca) throw new Error("la prueba no usa la red");
    busquedas.push(entrada);
    return { fuente: "rag", resultados: biblioteca.map(resultadoDeBiblioteca), ids: [...biblioteca], ramas: ["fts"], interpretacion: null, avisos: [] };
  };
  return aplicarHerramientaIA(escena, herramienta, args, POLITICA, { buscar, habilitado: biblioteca !== undefined });
}

const TEXTO_OPTIMISTA = "Listo, ya quedó como lo pediste.";

/** Corre el guion: el modelo pide, el servidor aplica, la escena avanza. Devuelve todo lo que la prueba necesita para comprobar. */
export async function correrCaso(caso: Caso): Promise<Contexto> {
  const antes = escenaDeBase(caso.base);
  let escena = antes;
  const llamadas: LlamadaHecha[] = [];
  const busquedas: EntradaBusqueda[] = [];
  const intentos: Intento[] = [];
  const avisos: AvisoUsuario[] = [];
  let verificacion = "";
  for (const vuelta of caso.vueltas) {
    const antesDeVuelta = escena;
    for (const llamada of vuelta) {
      const args = typeof llamada.args === "function" ? llamada.args(escena) : llamada.args;
      const incumple = validarContraEsquema(llamada.herramienta, args);
      if (caso.fueraDeEsquema) assert.notEqual(incumple, null, `el esquema de ${llamada.herramienta} tenía que rechazar estos argumentos`);
      else assert.equal(incumple, null, `el modelo mandó argumentos que el esquema de ${llamada.herramienta} no acepta: ${incumple}`);
      const hecho = await aplicar(escena, llamada.herramienta, args, caso.biblioteca, busquedas);
      const r = hecho.resultado;
      llamadas.push({
        herramienta: llamada.herramienta, args, ok: r.ok, resumen: r.ok ? r.resumen : "", error: r.ok ? "" : r.error,
        consulta: r.ok && r.consulta, avisos: r.ok ? r.avisos ?? [] : [],
      });
      intentos.push({ herramienta: llamada.herramienta, ok: r.ok, objetivo: objetivoDe(args, llamada.herramienta), ...(r.ok ? {} : { error: r.error }) });
      if (r.ok) { escena = r.escena; avisos.push(...(r.avisos ?? [])); }
    }
    if (escena !== antesDeVuelta) verificacion = verificarCambios(antesDeVuelta, escena);
  }
  const respuesta = conHonestidad(caso.textoModelo ?? TEXTO_OPTIMISTA, fallosPendientes(intentos), problemasNuevos(antes, escena), avisos);
  return { antes, despues: escena, llamadas, busquedas, respuesta, verificacion };
}

// ----------------------------------------------------------------------------------------------------------
// Invariantes que valen para toda frase
// ----------------------------------------------------------------------------------------------------------

const TOLERANCIA_CM = 6;

/** Los nodos nuevos o cambiados entre dos escenas (lo que el pedido tocó). */
function tocados(antes: Escena, despues: Escena): NodoEscena[] {
  const previos = new Map(antes.nodos.map((n) => [n.id, JSON.stringify(n)]));
  return despues.nodos.filter((n) => previos.get(n.id) !== JSON.stringify(n));
}

/** Lo que tiene que cumplir cualquier escena que salga de una frase que sí se pudo hacer. */
export function invariantes(caso: Caso, ctx: Contexto): void {
  const { antes, despues } = ctx;
  const ids = despues.nodos.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids de pieza repetidos");
  assert.ok(despues.nodos.length <= MAX_NODOS, `la escena pasa el tope de ${MAX_NODOS} piezas (${despues.nodos.length})`);
  assert.deepEqual(problemasNuevos(antes, despues), [], "el pedido dejó decoraciones dentro o debajo de una mesa");
  assert.ok(ctx.llamadas.every((l) => l.ok), `una herramienta falló: ${ctx.llamadas.filter((l) => !l.ok).map((l) => `${l.herramienta}: ${l.error}`).join(" | ")}`);

  const armada = armarEscena(despues);
  assert.deepEqual(armada.avisos, [], "la escena no arma limpia");
  const { anchoCm, fondoCm, altoCm } = despues.sala;
  const cambiados = new Set(tocados(antes, despues).map((n) => n.id));
  for (const n of armada.porNodo) {
    if (!cambiados.has(n.id) || caso.fueraDeSala) continue;
    const { min, max } = n.caja;
    if (!Number.isFinite(min.x + max.x + min.y + max.y + min.z + max.z)) continue;
    const dentro = min.x >= -anchoCm / 2 - TOLERANCIA_CM && max.x <= anchoCm / 2 + TOLERANCIA_CM
      && min.z >= -fondoCm / 2 - TOLERANCIA_CM && max.z <= fondoCm / 2 + TOLERANCIA_CM
      && min.y >= -TOLERANCIA_CM && max.y <= altoCm + TOLERANCIA_CM;
    assert.ok(dentro, `«${n.nombre}» (${n.id}) sale de la sala: x ${Math.round(min.x)}…${Math.round(max.x)}, z ${Math.round(min.z)}…${Math.round(max.z)}, y ${Math.round(min.y)}…${Math.round(max.y)} (sala ${anchoCm}×${fondoCm}×${altoCm})`);
  }
  for (const n of despues.nodos) {
    if (!cambiados.has(n.id)) continue;
    for (const c of coloresDePieza(n.pieza, "uso")) assert.ok(referenciaPorCodigo(c.codigo), `«${n.nombre}» (${n.id}) trae el color ${c.codigo}, que no está en el catálogo Sempertex`);
  }

  if (caso.sumaSola !== false) {
    for (const previo of antes.nodos) {
      if (caso.tocables?.includes(previo.id)) continue;
      const ahora = despues.nodos.find((n) => n.id === previo.id);
      assert.ok(ahora, `«agrega» quitó la pieza ${previo.id}`);
      assert.deepEqual(ahora, previo, `«agrega» cambió la pieza ${previo.id} sin que se pidiera`);
    }
  }
}

/** Un pedido que no se puede: toda llamada falla con el mensaje esperado, la escena queda intacta y la respuesta final lo dice. */
export function invarianteDeRechazo(caso: Caso, ctx: Contexto): void {
  assert.ok(caso.rechazo);
  assert.ok(ctx.llamadas.length > 0, "el guion no llama a ninguna herramienta");
  for (const l of ctx.llamadas) {
    assert.equal(l.ok, false, `${l.herramienta} tenía que rechazar el pedido y respondió: ${l.resumen}`);
    assert.match(l.error, caso.rechazo, `el rechazo de ${l.herramienta} no explica lo esperado: ${l.error}`);
    assert.ok(l.error.length > 20, "el rechazo no explica nada");
  }
  assert.deepEqual(ctx.despues, ctx.antes, "un rechazo dejó la escena cambiada");
  assert.match(ctx.respuesta, /No pude/, "el modelo dijo «Listo» y el servidor no agregó el «No pude: …»");
}

/** Corre una frase completa: guion, invariantes y comprobaciones propias. */
export async function probarCaso(caso: Caso): Promise<void> {
  const ctx = await correrCaso(caso);
  if (caso.rechazo) { invarianteDeRechazo(caso, ctx); caso.comprobar(ctx); return; }
  invariantes(caso, ctx);
  caso.comprobar(ctx);
}

export const llamar = (herramienta: string, args: Args | ((escena: Escena) => Args)): Llamada => ({ herramienta, args });

// ----------------------------------------------------------------------------------------------------------
// Ayudas para las comprobaciones
// ----------------------------------------------------------------------------------------------------------

export const nodoDe = (escena: Escena, id: string): NodoEscena => escena.nodos.find((n) => n.id === id) ?? assert.fail(`falta la pieza ${id}`);
export const nuevosDe = (ctx: Contexto): NodoEscena[] => ctx.despues.nodos.filter((n) => !ctx.antes.nodos.some((m) => m.id === n.id));
export const unicoNuevo = (ctx: Contexto): NodoEscena => {
  const nuevos = nuevosDe(ctx);
  assert.equal(nuevos.length, 1, `se esperaba UNA pieza nueva y hay ${nuevos.length}: ${nuevos.map((n) => n.id).join(", ")}`);
  return nuevos[0]!;
};

/** Los globos de una pieza por formato y color, como los arma el taller. */
export function inventarioDe(escena: Escena, id: string): { total: number; porFormato: Map<string, number>; porColor: Map<string, number> } {
  const pieza = nodoDe(escena, id).pieza;
  const porFormato = new Map<string, number>();
  const porColor = new Map<string, number>();
  let total = 0;
  for (const c of coloresDePieza(pieza, "uso")) {
    total += c.cantidad;
    porColor.set(c.codigo, c.cantidad);
  }
  for (const m of armarEscena({ ...escena, nodos: [nodoDe(escena, id)] }).materiales) {
    porFormato.set(m.formatoId, (porFormato.get(m.formatoId) ?? 0) + m.cantidad);
  }
  return { total, porFormato, porColor };
}

/** Lo que mide una pieza armada en el mundo (cm): ancho en x, alto en y y fondo en z. */
export function medidasDe(escena: Escena, id: string): { anchoCm: number; altoCm: number; fondoCm: number } {
  const armado = armarEscena(escena).porNodo.find((n) => n.id === id) ?? assert.fail(`falta la pieza ${id}`);
  const { min, max } = armado.cajaLocal ?? armado.caja;
  return { anchoCm: max.x - min.x, altoCm: max.y - min.y, fondoCm: max.z - min.z };
}

/** La parte de `codigo` (en %) sobre el total de globos de la pieza. */
export function porcentajeDeColor(escena: Escena, id: string, codigo: string): number {
  const { total, porColor } = inventarioDe(escena, id);
  return total ? (100 * (porColor.get(codigo) ?? 0)) / total : 0;
}

export const globosDeFormato = (escena: Escena, id: string, formato: string): number => inventarioDe(escena, id).porFormato.get(formato) ?? 0;

/** Los códigos de color de una pieza que dependen del dato (sin armar): los que dejó la herramienta al crearla o recolorearla. */
export function codigosDe(escena: Escena, id: string): string[] {
  return coloresDePieza(nodoDe(escena, id).pieza, "uso").map((c) => c.codigo);
}
