/**
 * El catálogo en las herramientas de la IA de escena (REQ-013 fase 4, AC-4): qué declara la IA según los repositorios que ve y cómo
 * se aplica lo que pide. Sin coste ni red: la búsqueda es falsa y el modelo no existe.
 * - por defecto (todo visible, sin `CATALOGO_FILTRO_IA`) las declaraciones son `DECLARACIONES_ESCENA` mismas, byte a byte;
 * - con `CATALOGO_FILTRO_IA`: +1 024 B como mucho, 0 valores de enumeración nuevos, `repositorio` es un texto;
 * - sin mobiliario o escenografía la IA no ve sus muebles ni (mobiliario) sus herramientas de mesas, y el servidor lo hace cumplir;
 * - `buscar_en_biblioteca` con `repositorio` acota la búsqueda; `insertar_de_biblioteca` acepta ambos ids y pone muebles del catálogo;
 * - la lectura de fotos ofrece solo los fondos de los repositorios visibles; con todos, el prompt es el de siempre.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-herramientas-ia.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { declaracionesIA, herramientaDeclarada, parsearRepositorio, politicaDe, politicaIA, reglaCatalogoIA, type PoliticaIA } from "../../src/lib/catalogo/herramientas-ia";
import { aplicarHerramientaIA, type DependenciasAplicarIA } from "../../src/lib/catalogo/herramientas-ia-aplicar";
import type { IdRepositorio } from "../../src/lib/catalogo/tipos";
import { aplicarHerramientaAsincrona } from "../../src/lib/globos3d/escena-ia-biblioteca";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { acotarFondosLeidos, fondosParaFoto } from "../../src/lib/globos3d/fondos-foto";
import { DECLARACIONES_ESCENA, aplicarHerramienta, type DeclaracionHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { esquemaMobiliarioPara } from "../../src/lib/globos3d/herramientas-escena-mobiliario";
import { paraGoogleSchema } from "../../src/lib/ia/nucleo/esquema-google";
import type { LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { esquemaLecturaParaGemini } from "../../src/lib/globos3d/leer-foto-ia";
import { construirPromptLectura } from "../../src/lib/globos3d/prompt-lectura-foto";
import type { EntradaBusqueda, RespuestaBusquedaTaller, ResultadoTaller } from "../../src/lib/taller/buscar";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const TODOS: IdRepositorio[] = ["sempertex", "mobiliario", "escenografia"];
const MAXIMO_DECLARACIONES_BYTES = 120 * 1024;
const MARGEN_BYTES = 1024;

const hoy = politicaDe({ filtro: false, ia: TODOS, rag: ["sempertex"] });
const abierta = politicaDe({ filtro: true, ia: TODOS, rag: TODOS });

const bytesDe = (d: readonly unknown[]) => d.reduce<number>((suma, x) => suma + Buffer.byteLength(JSON.stringify(x)), 0);
const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");
type Nodo = Record<string, unknown>;
const enumeraciones = (d: unknown): number => {
  let n = 0;
  const recorrer = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(recorrer); return; }
    if (x && typeof x === "object") { const o = x as Nodo; if (Array.isArray(o.enum)) n += o.enum.length; Object.values(o).forEach(recorrer); }
  };
  recorrer(d);
  return n;
};
const nombres = (d: readonly { name: string }[]) => d.map((x) => x.name);
const declaracion = (d: readonly DeclaracionHerramienta[], nombre: string) => d.find((x) => x.name === nombre);
const propiedades = (d: { parametersJsonSchema: Record<string, unknown> } | undefined) => (d?.parametersJsonSchema.properties ?? {}) as Record<string, Nodo>;
const idsMobiliario = (d: readonly DeclaracionHerramienta[]) => propiedades(declaracion(d, "agregar_mobiliario")).id?.enum as string[];

const escena = escenaPredefinida("arco_organico_columnas_guirnalda");

function resultado(id: string, repositorio: IdRepositorio, extra: Partial<ResultadoTaller> = {}): ResultadoTaller {
  return {
    id, tipo: repositorio === "sempertex" ? "conjunto" : "mueble", nombre: `Item ${id}`, descripcion: "", origen: { tipo: null, titulo: null, url: null, foto: null },
    ocasiones: [], celebraciones: [], tematicas: [], tiposPieza: [], formatos: [], colores: [], partes: [], productos: [],
    medidas: { altoCm: null, anchoCm: null, fondoCm: null }, globos: 0, tubos: 0, propietario: null, repositorio, puntaje: 0.03,
    ramas: { fts: null, trigram: null, vector_texto: null, vector_imagen: null }, razones: ["Las palabras de la consulta están en su nombre"], ...extra,
  };
}
const respuesta = (resultados: ResultadoTaller[], extra: Partial<RespuestaBusquedaTaller> = {}): RespuestaBusquedaTaller =>
  ({ fuente: "rag", resultados, ids: resultados.map((r) => r.id), ramas: ["fts"], interpretacion: null, avisos: [], ...extra });

function falsa(r: RespuestaBusquedaTaller, habilitado = true): { deps: DependenciasAplicarIA; pedidos: EntradaBusqueda[] } {
  const pedidos: EntradaBusqueda[] = [];
  return { pedidos, deps: { habilitado, buscar: async (e) => { pedidos.push(e); return r; } } };
}

async function main(): Promise<void> {
  await prueba("por defecto las declaraciones son DECLARACIONES_ESCENA: la misma lista, los mismos bytes", () => {
    assert.equal(declaracionesIA(DECLARACIONES_ESCENA, hoy), DECLARACIONES_ESCENA);
    const guardadas = JSON.parse(readFileSync(new URL("./dorado/identidad-catalogo.json", import.meta.url), "utf8")) as Record<string, string>;
    assert.equal(sha(JSON.stringify(declaracionesIA(DECLARACIONES_ESCENA, hoy))), guardadas.declaracionesEscena);
    for (const rag of [[], ["sempertex"], TODOS] as IdRepositorio[][]) assert.equal(declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: TODOS, rag })), DECLARACIONES_ESCENA, `rag=${rag}`);
    const subconjunto = DECLARACIONES_ESCENA.filter((d) => d.name !== "modelar_desde_foto");
    assert.equal(declaracionesIA(subconjunto, hoy), subconjunto, "cualquier subconjunto (el refinado) vuelve tal cual");
  });

  await prueba("CATALOGO_FILTRO_IA: buscar_en_biblioteca declara repositorio (texto con los visibles); a lo más +1 024 B, 0 enumeraciones nuevas, total dentro del tope", () => {
    const con = declaracionesIA(DECLARACIONES_ESCENA, abierta);
    const delta = bytesDe(con) - bytesDe(DECLARACIONES_ESCENA);
    console.log(`    declaraciones: ${bytesDe(DECLARACIONES_ESCENA)} B con las banderas apagadas, ${bytesDe(con)} B con CATALOGO_FILTRO_IA (+${delta} B), ${enumeraciones(DECLARACIONES_ESCENA)} y ${enumeraciones(con)} valores de enumeración`);
    assert.ok(delta > 0 && delta <= MARGEN_BYTES, `+${delta} B`);
    assert.ok(bytesDe(con) <= MAXIMO_DECLARACIONES_BYTES, `${bytesDe(con)} B`);
    assert.equal(enumeraciones(con), enumeraciones(DECLARACIONES_ESCENA), "ninguna enumeración nueva");
    assert.deepEqual(nombres(con), nombres(DECLARACIONES_ESCENA), "mismas herramientas, mismo orden");
    const cambiadas = con.filter((d, i) => JSON.stringify(d) !== JSON.stringify(DECLARACIONES_ESCENA[i]));
    assert.deepEqual(nombres(cambiadas), ["buscar_en_biblioteca"]);

    const base = propiedades(declaracion(DECLARACIONES_ESCENA, "buscar_en_biblioteca"));
    const nueva = propiedades(declaracion(con, "buscar_en_biblioteca"));
    assert.deepEqual(Object.keys(nueva), [...Object.keys(base), "repositorio"]);
    for (const clave of Object.keys(base)) assert.equal(JSON.stringify(nueva[clave]), JSON.stringify(base[clave]), clave);
    assert.equal(nueva.repositorio!.type, "string");
    assert.equal(nueva.repositorio!.enum, undefined, "un texto, no una enumeración");
    for (const id of TODOS) assert.match(String(nueva.repositorio!.description), new RegExp(id));
    assert.ok(!((declaracion(con, "buscar_en_biblioteca")!.parametersJsonSchema.required ?? []) as string[]).includes("repositorio"));
    assert.equal(declaracion(con, "buscar_en_biblioteca")!.description, declaracion(DECLARACIONES_ESCENA, "buscar_en_biblioteca")!.description);

    const soloSempertex = propiedades(declaracion(declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex"] })), "buscar_en_biblioteca"));
    assert.ok(String(soloSempertex.repositorio!.description).includes("sempertex") && !String(soloSempertex.repositorio!.description).includes("mobiliario"), "lista los que la búsqueda puede devolver");
    const sinNada = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: true, ia: ["mobiliario"], rag: ["sempertex"] }));
    assert.equal(propiedades(declaracion(sinNada, "buscar_en_biblioteca")).repositorio, undefined, "sin dónde buscar no hay qué filtrar");
  });

  await prueba("la política decide con la intersección de ia_taller y rag (la IA solo busca donde ve y donde el RAG devuelve)", () => {
    assert.deepEqual(politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex", "mobiliario"] }).busqueda, ["sempertex", "mobiliario"]);
    assert.deepEqual(politicaDe({ filtro: true, ia: ["sempertex", "escenografia"], rag: TODOS }).busqueda, ["sempertex", "escenografia"]);
    assert.deepEqual(politicaDe({ filtro: false, ia: TODOS, rag: ["sempertex"] }).busqueda, ["sempertex"]);
  });

  await prueba("sin mobiliario la IA no lista sus muebles ni declara sus mesas; sin escenografía, no lista los suyos; sin ninguno, sin agregar_mobiliario", () => {
    const base = idsMobiliario(DECLARACIONES_ESCENA);
    assert.equal(base.length, FONDOS_CATALOGO.length);
    const MESAS = ["agregar_mesas", "cambiar_sillas", "cambiar_mesas"];
    assert.ok(MESAS.every((m) => nombres(DECLARACIONES_ESCENA).includes(m)));

    const sinMobiliario = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: ["sempertex", "escenografia"], rag: ["sempertex"] }));
    const ids = idsMobiliario(sinMobiliario);
    assert.equal(ids.length, 25);
    assert.deepEqual(ids, base.filter((id) => ids.includes(id)), "mismo orden");
    assert.ok(!ids.includes("silla_tiffany") && ids.includes("panel_redondo"));
    assert.ok(MESAS.every((m) => !nombres(sinMobiliario).includes(m)), "sin mobiliario no hay herramientas de mesas");
    assert.equal(nombres(sinMobiliario).length, DECLARACIONES_ESCENA.length - MESAS.length);
    assert.deepEqual(nombres(sinMobiliario), nombres(DECLARACIONES_ESCENA).filter((n) => !MESAS.includes(n)), "el resto, en su orden");
    assert.ok(String(propiedades(declaracion(sinMobiliario, "agregar_mobiliario")).id!.description).includes("panel_redondo:"));
    assert.ok(!String(propiedades(declaracion(sinMobiliario, "agregar_mobiliario")).id!.description).includes("silla_tiffany:"));
    assert.ok(bytesDe(sinMobiliario) < bytesDe(DECLARACIONES_ESCENA));

    const sinEscenografia = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: ["sempertex", "mobiliario"], rag: ["sempertex"] }));
    const soloMuebles = idsMobiliario(sinEscenografia);
    assert.equal(soloMuebles.length, 26);
    assert.ok(soloMuebles.includes("silla_tiffany") && !soloMuebles.includes("panel_redondo"));
    assert.ok(MESAS.every((m) => nombres(sinEscenografia).includes(m)), "las mesas son de mobiliario");

    const sinNinguno = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: ["sempertex"], rag: ["sempertex"] }));
    assert.ok(!nombres(sinNinguno).includes("agregar_mobiliario") && MESAS.every((m) => !nombres(sinNinguno).includes(m)));
    assert.ok(nombres(sinNinguno).includes("insertar_de_biblioteca") && nombres(sinNinguno).includes("agregar_pieza"), "lo demás se queda");
  });

  await prueba("rehacer agregar_mobiliario con todo el catálogo da los bytes de la declaración de siempre; y el cálculo se guarda por conjunto de visibles", () => {
    const completo = paraGoogleSchema(z.toJSONSchema(esquemaMobiliarioPara(FONDOS_CATALOGO), { target: "draft-7" }));
    assert.equal(JSON.stringify(completo), JSON.stringify(declaracion(DECLARACIONES_ESCENA, "agregar_mobiliario")!.parametersJsonSchema));
    const politica = politicaDe({ filtro: false, ia: ["sempertex", "escenografia"], rag: ["sempertex"] });
    const a = declaracionesIA(DECLARACIONES_ESCENA, politica);
    const b = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: ["escenografia", "sempertex"], rag: TODOS }));
    assert.equal(declaracion(a, "agregar_mobiliario")!.parametersJsonSchema, declaracion(b, "agregar_mobiliario")!.parametersJsonSchema, "misma referencia: no se recalcula");
    const subconjunto = DECLARACIONES_ESCENA.filter((d) => ["agregar_mobiliario", "ver_escena"].includes(d.name));
    assert.deepEqual(nombres(declaracionesIA(subconjunto, politica)), ["ver_escena", "agregar_mobiliario"].sort((x, y) => nombres(subconjunto).indexOf(x) - nombres(subconjunto).indexOf(y)));
  });

  await prueba("parsearRepositorio: uno de los visibles (sin importar mayúsculas ni espacios); si no, un error que lista los que sí", () => {
    assert.deepEqual(parsearRepositorio(" Mobiliario ", ["sempertex", "mobiliario"]), { ok: true, repositorio: "mobiliario" });
    assert.deepEqual(parsearRepositorio("sempertex", ["sempertex"]), { ok: true, repositorio: "sempertex" });
    const oculto = parsearRepositorio("mobiliario", ["sempertex"]);
    assert.ok(!oculto.ok && /no está disponible/.test(oculto.error) && /sempertex/.test(oculto.error), JSON.stringify(oculto));
    for (const raro of ["muebles", "", "  ", 3, null, undefined, {}]) {
      const r = parsearRepositorio(raro, ["sempertex", "mobiliario"]);
      assert.ok(!r.ok && /sempertex, mobiliario/.test(r.error), `${String(raro)}: ${JSON.stringify(r)}`);
    }
    assert.ok(!parsearRepositorio("terceros/acme", ["sempertex"]).ok, "un tercero no cargado no existe");
  });

  await prueba("aplicar con la política por defecto es lo de siempre: la búsqueda, y el mobiliario sin restricciones", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("idea:a", "sempertex")]));
    for (const args of [{ texto: "arco" }, { texto: "arco", repositorio: "mobiliario" }, {}]) {
      const propio = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", args, hoy, deps);
      const de_siempre = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", args, deps);
      assert.deepEqual(propio, de_siempre);
    }
    for (const pedido of pedidos) assert.equal(pedido.filtros?.repositorios, undefined, "sin la bandera la búsqueda no se acota");
    for (const [nombre, args] of [["agregar_mobiliario", { id: "silla_tiffany" }], ["agregar_mobiliario", { id: "panel_redondo" }], ["agregar_mesas", { cantidad: 2 }], ["ver_escena", {}]] as const) {
      const propio = await aplicarHerramientaIA(escena, nombre, args, hoy, deps);
      assert.deepEqual(propio.resultado, aplicarHerramienta(escena, nombre, args), nombre);
    }
  });

  await prueba("buscar_en_biblioteca con repositorio acota la búsqueda a ese repositorio; sin él, no", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("silla_tiffany", "mobiliario"), resultado("sofa", "mobiliario")]));
    const h = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "sillas tiffany", repositorio: "mobiliario" }, abierta, deps);
    assert.ok(h.resultado.ok && h.resultado.consulta, JSON.stringify(h.resultado));
    assert.deepEqual(pedidos[0]!.filtros?.repositorios, ["mobiliario"]);
    assert.equal(pedidos[0]!.texto, "sillas tiffany");
    assert.match(h.resultado.ok ? h.resultado.resumen : "", /silla_tiffany · mueble/);
    assert.deepEqual(h.busqueda?.ids, ["silla_tiffany", "sofa"]);
    assert.equal(h.resultado.ok && h.resultado.escena, escena, "buscar no cambia la escena");

    await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "arco", repositorio: " Sempertex " }, abierta, deps);
    assert.deepEqual(pedidos[1]!.filtros?.repositorios, ["sempertex"]);
    await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "arco" }, abierta, deps);
    assert.equal(pedidos[2]!.filtros?.repositorios, undefined, "sin repositorio: todos los visibles");
    assert.equal(pedidos.length, 3);
  });

  await prueba("un repositorio que no existe o que la búsqueda no ve es un error que lista los que sí, sin buscar", async () => {
    const { deps, pedidos } = falsa(respuesta([]));
    const solo = politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex"] });
    for (const repositorio of ["mobiliario", "muebles", 7]) {
      const h = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "silla", repositorio }, solo, deps);
      assert.ok(!h.resultado.ok && /Los de esta búsqueda: sempertex\./.test(h.resultado.error), JSON.stringify(h.resultado));
    }
    assert.equal(pedidos.length, 0);
  });

  await prueba("un repositorio que no es Sempertex solo se busca en la base: si respondió la memoria o está apagada, se dice (no se devuelve Sempertex)", async () => {
    const memoria = falsa(respuesta([resultado("idea:a", "sempertex")], { fuente: "memoria", avisos: ["La base de datos de la biblioteca no respondió; se buscó en memoria."] }));
    const enMemoria = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "silla", repositorio: "mobiliario" }, abierta, memoria.deps);
    assert.ok(!enMemoria.resultado.ok && /No pude buscar en «mobiliario»/.test(enMemoria.resultado.error) && /agregar_mobiliario/.test(enMemoria.resultado.error));
    const apagada = falsa(respuesta([]), false);
    const sinBase = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "silla", repositorio: "escenografia" }, abierta, apagada.deps);
    assert.ok(!sinBase.resultado.ok && /No pude buscar en «escenografia»/.test(sinBase.resultado.error));
    assert.equal(apagada.pedidos.length, 0);
    const sempertex = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "arco organico", repositorio: "sempertex" }, abierta, apagada.deps);
    assert.deepEqual(sempertex.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "arco organico" }), "Sempertex sí tiene respaldo en memoria");
  });

  await prueba("insertar_de_biblioteca: el id de Sempertex vale corto y calificado; los desconocidos dan el error de siempre", async () => {
    const { deps } = falsa(respuesta([]));
    const corto = "idea:arco-organico-rosa-dorado";
    const base = aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "arco orgánico", limite: 1 });
    assert.ok(base.ok);
    const id = (base.ok ? /^- (\S+) ·/m.exec(base.resumen)?.[1] : undefined) ?? corto;
    const a = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id }, hoy, deps);
    const b = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: `sempertex:${id}` }, hoy, deps);
    assert.ok(a.resultado.ok, JSON.stringify(a.resultado));
    assert.deepEqual(b.resultado, a.resultado, "calificado = corto");
    for (const nada of ["no_existe", "idea:no-existe", "mobiliario:no_existe", "", "sempertex:no-hay"]) {
      const h = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: nada }, abierta, deps);
      assert.deepEqual(h.resultado, aplicarHerramienta(escena, "insertar_de_biblioteca", { id: nada }), `«${nada}»`);
    }
  });

  await prueba("insertar_de_biblioteca con un id de mobiliario o escenografía que la búsqueda ve lo pone como agregar_mobiliario (corto o calificado)", async () => {
    const { deps } = falsa(respuesta([]));
    for (const id of ["silla_tiffany", "mobiliario:silla_tiffany"]) {
      const h = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id, nombre: "Silla del centro", donde: { en: "piso", x_cm: 120, z_cm: 40, giro_grados: 90 } }, abierta, deps);
      assert.ok(h.resultado.ok && !h.resultado.consulta, JSON.stringify(h.resultado));
      const nuevo = h.resultado.escena.nodos.at(-1)!;
      assert.equal(h.resultado.escena.nodos.length, escena.nodos.length + 1);
      assert.equal(nuevo.nombre, "Silla del centro");
      assert.equal(nuevo.pieza.tipo === "escenografia" ? nuevo.pieza.mueble?.id : null, "silla_tiffany", "se guarda el id corto");
      assert.deepEqual(h.resultado.escena, aplicarHerramienta(escena, "agregar_mobiliario", { id: "silla_tiffany", nombre: "Silla del centro", x_cm: 120, z_cm: 40, giro_grados: 90 }).escena);
    }
    const pared = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: "escenografia:cortina_flecos", donde: { en: "pared", a_lo_largo_cm: 50, altura_cm: 10 } }, abierta, deps);
    assert.ok(pared.resultado.ok, JSON.stringify(pared.resultado));
    assert.deepEqual(pared.resultado.escena, aplicarHerramienta(escena, "agregar_mobiliario", { id: "cortina_flecos", a_lo_largo_cm: 50, altura_cm: 10 }).escena);

    for (const [id, donde, esperado] of [
      ["mesa_param", undefined, /generador.*agregar_mesas/],
      ["silla_tiffany", { en: "techo" }, /piso o en la pared del fondo/],
      ["silla_tiffany", { en: "ancla", padre_id: "x" }, /piso o en la pared del fondo/],
      ["panel_redondo", { en: "pared", pared: "izquierda" }, /piso o en la pared del fondo/],
      ["escenografia:silla_tiffany", undefined, /No hay ningún item/],
    ] as const) {
      const h = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id, ...(donde ? { donde } : {}) }, abierta, deps);
      assert.ok(!h.resultado.ok && esperado.test(h.resultado.error), `${id}: ${JSON.stringify(h.resultado)}`);
    }
  });

  await prueba("un mueble que la búsqueda no ve no se inserta: el error es el de siempre", async () => {
    const { deps } = falsa(respuesta([]));
    for (const politica of [hoy, politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex", "escenografia"] })]) {
      const h = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: "silla_tiffany" }, politica, deps);
      assert.deepEqual(h.resultado, aplicarHerramienta(escena, "insertar_de_biblioteca", { id: "silla_tiffany" }));
      assert.ok(!h.resultado.ok && /No hay ningún item «silla_tiffany»/.test(h.resultado.error));
    }
    const conEscenografia = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: "panel_redondo" }, politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex", "escenografia"] }), deps);
    assert.ok(conEscenografia.resultado.ok, "la escenografía sí, si la búsqueda la ve");
  });

  await prueba("el servidor hace cumplir lo que no se declara: muebles de un repositorio oculto y herramientas de mesas sin mobiliario", async () => {
    const { deps } = falsa(respuesta([]));
    const sinMobiliario: PoliticaIA = politicaDe({ filtro: false, ia: ["sempertex", "escenografia"], rag: ["sempertex"] });
    const silla = await aplicarHerramientaIA(escena, "agregar_mobiliario", { id: "silla_tiffany" }, sinMobiliario, deps);
    assert.ok(!silla.resultado.ok && /«silla_tiffany» no está disponible: el repositorio «mobiliario»/.test(silla.resultado.error), JSON.stringify(silla.resultado));
    const calificada = await aplicarHerramientaIA(escena, "agregar_mobiliario", { id: "mobiliario:silla_tiffany" }, sinMobiliario, deps);
    assert.ok(!calificada.resultado.ok && /«silla_tiffany» no está disponible/.test(calificada.resultado.error));
    const panel = await aplicarHerramientaIA(escena, "agregar_mobiliario", { id: "panel_redondo" }, sinMobiliario, deps);
    assert.ok(panel.resultado.ok, "la escenografía sigue");
    for (const nombre of ["agregar_mesas", "cambiar_sillas", "cambiar_mesas"]) {
      const h = await aplicarHerramientaIA(escena, nombre, {}, sinMobiliario, deps);
      assert.ok(!h.resultado.ok && /no está disponible/.test(h.resultado.error), `${nombre}: ${JSON.stringify(h.resultado)}`);
      assert.equal(herramientaDeclarada(sinMobiliario, nombre), false);
    }
    const sinNinguno = politicaDe({ filtro: false, ia: ["sempertex"], rag: ["sempertex"] });
    const nada = await aplicarHerramientaIA(escena, "agregar_mobiliario", { id: "panel_redondo" }, sinNinguno, deps);
    assert.ok(!nada.resultado.ok && /no está disponible/.test(nada.resultado.error));
    const libre = await aplicarHerramientaIA(escena, "agregar_mobiliario", { id: "no_existe_en_ningun_lado" }, sinMobiliario, deps);
    assert.deepEqual(libre.resultado, aplicarHerramienta(escena, "agregar_mobiliario", { id: "no_existe_en_ningun_lado" }), "un id desconocido da el error de siempre");
  });

  await prueba("un error de la petición (argumentos que no valen, un color que no existe) en otro repositorio se devuelve tal cual, no como «la base no respondió»", async () => {
    const MALOS = [{ limite: 99 }, { tipo: "nave" }, { colores: ["colorinexistente"] }, { fuente: "otra" }];
    const encendida = falsa(respuesta([]));
    const apagada = falsa(respuesta([]), false);
    for (const args of MALOS) for (const repositorio of ["mobiliario", "escenografia"]) for (const { deps } of [encendida, apagada]) {
      const h = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "silla", ...args, repositorio }, abierta, deps);
      assert.deepEqual(h.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "silla", ...args }), `${JSON.stringify(args)} en ${repositorio}`);
      assert.ok(!h.resultado.ok && !/No pude buscar/.test(h.resultado.error), JSON.stringify(h.resultado));
    }
    assert.equal(encendida.pedidos.length, 0, "ni siquiera se busca");
    assert.equal(apagada.pedidos.length, 0);
  });

  await prueba("la regla del catálogo para el sistema: una frase, solo con el filtro y solo si la búsqueda que recibe el modelo trae repositorio", () => {
    assert.equal(reglaCatalogoIA(hoy, DECLARACIONES_ESCENA), "", "por defecto el sistema no cambia");
    assert.equal(reglaCatalogoIA(politicaDe({ filtro: false, ia: TODOS, rag: TODOS }), DECLARACIONES_ESCENA), "", "sin el filtro, aunque el RAG vea todo");
    const declaradas = declaracionesIA(DECLARACIONES_ESCENA, abierta);
    const regla = reglaCatalogoIA(abierta, declaradas);
    assert.match(regla, /^\n\nCATÁLOGO: si el pedido es de mobiliario/);
    assert.match(regla, /pásale repositorio \(sempertex, mobiliario, escenografia\)/);
    assert.match(regla, /mezclan tipos/);
    assert.equal(regla.trim().split("\n").length, 1, "una sola frase, sin saltos");
    assert.ok(regla.endsWith("."));
    const sinMobiliario = politicaDe({ filtro: true, ia: ["sempertex", "escenografia"], rag: TODOS });
    assert.match(reglaCatalogoIA(sinMobiliario, declaracionesIA(DECLARACIONES_ESCENA, sinMobiliario)), /\(sempertex, escenografia\)/, "solo los que se pueden pedir");
    assert.equal(reglaCatalogoIA(abierta, DECLARACIONES_ESCENA), "", "la búsqueda declarada no trae repositorio: no se le pide");
    assert.equal(reglaCatalogoIA(abierta, declaradas.filter((d) => d.name !== "buscar_en_biblioteca")), "", "una ronda que no declara la búsqueda");
    const soloSempertex = politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex"] });
    assert.equal(reglaCatalogoIA(soloSempertex, declaracionesIA(DECLARACIONES_ESCENA, soloSempertex)), "", "con solo Sempertex no hay a dónde mandar al modelo");
  });

  await prueba("politicaIA lee las visibilidades ia_taller y rag y la bandera, y cambia con el entorno", async () => {
    const claves = ["CATALOGO_REPOS_IA_TALLER", "CATALOGO_REPOS_RAG", "CATALOGO_FILTRO_IA"] as const;
    const antes = Object.fromEntries(claves.map((c) => [c, process.env[c]]));
    try {
      for (const c of claves) delete process.env[c];
      assert.deepEqual(await politicaIA(), { filtro: false, ia: TODOS, busqueda: ["sempertex"] });
      process.env.CATALOGO_REPOS_RAG = TODOS.join(",");
      process.env.CATALOGO_REPOS_IA_TALLER = "sempertex,mobiliario";
      process.env.CATALOGO_FILTRO_IA = "true";
      assert.deepEqual(await politicaIA(), { filtro: true, ia: ["sempertex", "mobiliario"], busqueda: ["sempertex", "mobiliario"] });
    } finally {
      for (const c of claves) { if (antes[c] === undefined) delete process.env[c]; else process.env[c] = antes[c]; }
    }
  });

  await prueba("lectura de fotos: sin acotar o con todos los repositorios es FONDOS_CATALOGO mismo; el prompt y el esquema de siempre", () => {
    assert.equal(fondosParaFoto(undefined), FONDOS_CATALOGO);
    assert.equal(fondosParaFoto(TODOS), FONDOS_CATALOGO);
    assert.equal(fondosParaFoto(["mobiliario", "escenografia"]), FONDOS_CATALOGO, "Sempertex no pone fondos");
    const guardadas = JSON.parse(readFileSync(new URL("./dorado/identidad-catalogo.json", import.meta.url), "utf8")) as Record<string, string>;
    assert.equal(sha(construirPromptLectura()), guardadas.promptLectura);
    assert.equal(sha(construirPromptLectura([], fondosParaFoto(TODOS))), guardadas.promptLectura);
  });

  await prueba("lectura de fotos: sin mobiliario el prompt ofrece solo los fondos de escenografía (en su orden) y lo dice; la lectura no los arma", () => {
    const escenografia = fondosParaFoto(["sempertex", "escenografia"]);
    assert.equal(escenografia.length, 25);
    assert.deepEqual(escenografia.map((f) => f.id), FONDOS_CATALOGO.map((f) => f.id).filter((id) => escenografia.some((f) => f.id === id)));
    const prompt = construirPromptLectura([], escenografia);
    const seccion = /FONDOS DEL CATÁLOGO \(tipo "fondo"\): (.*)/.exec(prompt)?.[1] ?? "";
    assert.ok(seccion.includes("panel_redondo:") && !seccion.includes("silla_tiffany:") && !seccion.includes("mesa_imperial:"), seccion.slice(0, 200));
    assert.match(seccion, /solo existen los fondos de esta lista/);
    assert.ok(prompt.length < construirPromptLectura().length);
    assert.equal(fondosParaFoto(["sempertex"]).length, 0);
    assert.match(construirPromptLectura([], fondosParaFoto(["sempertex"])), /FONDOS DEL CATÁLOGO \(tipo "fondo"\):  \(solo existen/);

    const color = { nombre: "blanco", hex: "#ffffff", peso: 100, acabado: "mate" as const };
    const lectura: LecturaFoto = {
      resumen: "Una silla y un panel", aspecto: 1, escala: { altoImagenCm: 300, referencia: "puerta" }, pisoY: null, sala: { pared: "#ffffff", piso: "#cccccc" },
      piezas: [
        { tipo: "fondo", id: "silla_tiffany", x: 0.3, yBase: 0.9, ancho: 0.1, alto: 0.2, colores: [color] },
        { tipo: "fondo", id: "panel_redondo", x: 0.6, yBase: 0.9, ancho: 0.3, alto: 0.5, colores: [color] },
        { tipo: "otro", descripcion: "dulces" },
      ],
    };
    const acotada = acotarFondosLeidos(lectura, escenografia);
    assert.deepEqual(acotada.lectura.piezas.map((p) => p.tipo === "fondo" ? p.id : p.tipo), ["otro", "panel_redondo", "otro"]);
    assert.deepEqual(acotada.lectura.piezas[0], { tipo: "otro", descripcion: "silla_tiffany (no disponible en el catálogo)" });
    assert.match(acotada.descartadas[0]!, /Pieza 1 \(fondo silla_tiffany\)/);
    assert.equal(acotada.descartadas.length, 1);
    const igual = acotarFondosLeidos(lectura, FONDOS_CATALOGO);
    assert.equal(igual.lectura, lectura, "con la lista completa la lectura vuelve tal cual");
    assert.deepEqual(igual.descartadas, []);
  });

  await prueba("el esquema de la lectura no depende de la visibilidad (la lista de fondos va en el prompt)", () => {
    const guardadas = JSON.parse(readFileSync(new URL("./dorado/identidad-catalogo.json", import.meta.url), "utf8")) as Record<string, string>;
    // La lista de fondos va en el prompt, no en el esquema: más de 20 valores de enumeración se quitan al adaptarlo a Gemini.
    assert.equal(sha(JSON.stringify(esquemaLecturaParaGemini())), guardadas.esquemaLecturaGemini);
  });

  await prueba("contrato de la ruta: declara con la política y aplica con ella; la lectura de fotos recibe la visibilidad de foto", () => {
    const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8");
    const escenaIa = leer("src/app/api/escena-ia/route.ts");
    assert.match(escenaIa, /const politica = await politicaIA\(\);/);
    assert.match(escenaIa, /sistema: `\$\{SISTEMA\}\\n\\n\$\{REGLAS_AGENTE\}\$\{reglasExtra\}\$\{reglaCatalogoIA\(politica, declaraciones\)\}`/);
    assert.match(escenaIa, /declaracionesIA\([\s\S]*politica\)/);
    assert.match(escenaIa, /aplicarHerramientaIA\(escena, nombre, llamada\.args \?\? \{\}, politica,/);
    assert.match(leer("src/lib/taller/modelar-foto-real.ts"), /reposVisiblesVigentes\("foto"\)/);
    assert.match(leer("src/lib/taller/modelar-foto-real.ts"), /opciones: \{ signal, repositoriosFoto \}/);
  });

  console.log(`test-catalogo-herramientas-ia: ${pruebas} pruebas ok`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
