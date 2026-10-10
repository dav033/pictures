/**
 * `buscar_en_biblioteca` de la IA de escena con la búsqueda de la biblioteca en Postgres (REQ-002 paso 6),
 * sin red ni IA: la búsqueda se inyecta (`buscar`) y la bandera va como dependencia.
 *   npx tsx scripts/test/test-escena-ia-biblioteca-rag.ts
 * - bandera apagada: ni se llama a la búsqueda y el resultado es el de `aplicarHerramienta` de siempre;
 * - bandera encendida: los filtros nuevos llegan bien (ids de taxonomía, formatos y partes del glosario, medidas ±25 %,
 *   fuente, colores) y el resultado trae id, tipo, nombre, celebración y temática principales, medidas y por qué;
 * - respaldo: si la búsqueda falla, responde desde memoria o los argumentos no valen, responde la herramienta de siempre;
 * - esquema: la herramienta declara los filtros nuevos; en memoria solo la celebración filtra y el resto se avisa;
 * - contrato de la ruta: pasa por `aplicarHerramientaAsincrona`, registra la búsqueda y el sistema nombra los filtros.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DECLARACIONES_ESCENA, aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { aplicarHerramientaAsincrona, describirResultado, type DependenciasBibliotecaIA } from "../../src/lib/globos3d/escena-ia-biblioteca";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { EntradaBusqueda, RespuestaBusquedaTaller, ResultadoTaller } from "../../src/lib/taller/buscar";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const escena = escenaPredefinida("arco_organico_columnas_guirnalda");

function resultado(id: string, extra: Partial<ResultadoTaller> = {}): ResultadoTaller {
  return {
    id, tipo: "conjunto", nombre: `Item ${id}`, descripcion: "", origen: { tipo: null, titulo: null, url: null, foto: null },
    ocasiones: [], celebraciones: ["cumpleanos"], tematicas: ["unicornio"], tiposPieza: [], formatos: [], colores: [], partes: [], productos: [],
    medidas: { altoCm: 240, anchoCm: 180, fondoCm: null }, globos: 0, tubos: 0, propietario: null, repositorio: "sempertex", puntaje: 0.03,
    ramas: { fts: null, trigram: null, vector_texto: null, vector_imagen: null },
    razones: ["Las palabras de la consulta están en su nombre, celebración o ficha (puesto 1 por texto)"],
    ...extra,
  };
}
const respuesta = (resultados: ResultadoTaller[], extra: Partial<RespuestaBusquedaTaller> = {}): RespuestaBusquedaTaller =>
  ({ fuente: "rag", resultados, ids: resultados.map((r) => r.id), ramas: ["fts"], interpretacion: null, avisos: [], ...extra });

/** Una búsqueda falsa que apunta lo que le pidieron. */
function falsa(r: RespuestaBusquedaTaller | Error): { deps: DependenciasBibliotecaIA; pedidos: EntradaBusqueda[] } {
  const pedidos: EntradaBusqueda[] = [];
  return { pedidos, deps: { habilitado: true, buscar: async (e) => { pedidos.push(e); if (r instanceof Error) throw r; return r; } } };
}
const consultaOk = (h: Awaited<ReturnType<typeof aplicarHerramientaAsincrona>>) => {
  if (!h.resultado.ok) assert.fail(`se esperaba éxito y vino: ${h.resultado.error}`);
  assert.equal(h.resultado.consulta, true);
  assert.equal(h.resultado.escena, escena, "buscar no cambia la escena");
  return h.resultado.resumen;
};

(async () => {
  await prueba("bandera apagada: no se llama a la búsqueda y el resultado es el de aplicarHerramienta", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("x:1")]));
    for (const args of [{ texto: "arco orgánico" }, { texto: "columna orgánica", tipo: "conjunto" }, {}]) {
      const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", args, { ...deps, habilitado: false });
      assert.deepEqual(h.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", args));
      assert.equal(h.busqueda, null);
    }
    assert.equal(pedidos.length, 0);
  });

  await prueba("otras herramientas no pasan por la búsqueda, con la bandera encendida", async () => {
    const { deps, pedidos } = falsa(respuesta([]));
    const h = await aplicarHerramientaAsincrona(escena, "ver_escena", {}, deps);
    assert.deepEqual(h.resultado, aplicarHerramienta(escena, "ver_escena", {}));
    assert.equal(h.busqueda, null);
    assert.equal(pedidos.length, 0);
  });

  await prueba("filtros: celebración, temática, formato, parte, medidas ±25 %, fuente, tipo y colores llegan a buscarEnTaller", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("a:1")]));
    const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", {
      texto: "columna", celebracion: "quince años", tematica: "unicornio", formato: "R-24", parte: "hojas",
      alto_cm: 200, ancho_cm: 100, fuente: "referencias_dueno", tipo: "conjunto", tipo_pieza: "organico", colores: ["rosado"], limite: 5,
    }, deps);
    consultaOk(h);
    assert.equal(pedidos.length, 1);
    const e = pedidos[0]!;
    assert.equal(e.texto, "columna");
    assert.equal(e.limite, 5);
    const f = e.filtros!;
    assert.deepEqual(f.celebraciones, ["quince-anos"]);
    assert.deepEqual(f.tematicas, ["unicornio"]);
    assert.deepEqual(f.formatos, ["R-24"]);
    assert.deepEqual(f.partes, ["hojas"]);
    assert.deepEqual([f.altoMin, f.altoMax, f.anchoMin, f.anchoMax], [150, 250, 75, 125]);
    assert.deepEqual(f.fuente, ["referencia-dueno"]);
    assert.deepEqual(f.tipos, ["conjunto"]);
    assert.deepEqual(f.tiposPieza, ["organico"]);
    assert.ok(f.colores && f.colores.length > 0 && f.colores.every((c) => /^\d+$/.test(c)), `códigos de color: ${f.colores}`);
    assert.equal(h.busqueda?.fuente, "rag");
    assert.deepEqual(h.busqueda?.ids, ["a:1"]);
  });

  await prueba("fuentes pedibles → fuente.tipo guardado; «ocasion» antigua se canoniza y «general» no filtra", async () => {
    for (const [fuente, tipo] of [["ideas_sempertex", "idea-sempertex"], ["revista_celebra", "celebra"], ["bases_organicas", "referencia-web"]] as const) {
      const { deps, pedidos } = falsa(respuesta([]));
      await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { fuente }, deps);
      assert.deepEqual(pedidos[0]!.filtros!.fuente, [tipo]);
    }
    const a = falsa(respuesta([]));
    await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { texto: "arco", ocasion: "cumpleanos" }, a.deps);
    assert.deepEqual(a.pedidos[0]!.filtros!.celebraciones, ["cumpleanos"]);
    const b = falsa(respuesta([]));
    await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { texto: "arco", ocasion: "general" }, b.deps);
    assert.equal(b.pedidos[0]!.filtros!.celebraciones, undefined);
  });

  await prueba("lo que no se reconoce (celebración, temática, formato, parte) se busca como palabra y se avisa", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("a:1")]));
    const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { texto: "arco", celebracion: "festival marciano", tematica: "zzz", formato: "LOL-*", parte: "cosa rara" }, deps);
    const resumen = consultaOk(h);
    const e = pedidos[0]!;
    assert.equal(e.filtros!.celebraciones, undefined);
    assert.equal(e.filtros!.tematicas, undefined);
    assert.equal(e.filtros!.formatos, undefined);
    assert.equal(e.filtros!.partes, undefined);
    assert.match(e.texto ?? "", /arco.*festival marciano.*zzz.*LOL-\*.*cosa rara/);
    assert.match(resumen, /celebración «festival marciano» sin id conocido/);
  });

  await prueba("resultado para el modelo: una línea por item con id, tipo, nombre, celebración, temática, medidas y por qué (máx. 10)", async () => {
    const lista = Array.from({ length: 12 }, (_, i) => resultado(`z:${i}`, i === 0 ? { medidas: { altoCm: 240, anchoCm: 180, fondoCm: 60 } } : {}));
    const { deps } = falsa(respuesta(lista));
    const resumen = consultaOk(await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { texto: "arco" }, deps));
    const lineas = resumen.split("\n");
    assert.match(lineas[0]!, /^10 de la biblioteca \(ponlo con insertar_de_biblioteca/);
    assert.equal(lineas.filter((l) => l.startsWith("- ")).length, 10);
    assert.match(lineas[1]!, /^- z:0 · conjunto · «Item z:0» · celebración: Cumpleaños · temática: Unicornio · alto 240 × ancho 180 × fondo 60 cm · salió porque: Las palabras/);
    assert.ok(lineas.length <= 12, "pocas líneas para no llenar el contexto del modelo");
  });

  await prueba("la celebración y temática principales salen de la clasificación versionada cuando el item la tiene", () => {
    const l = describirResultado(resultado("base-organica:arco-cromado-negro-oro-plata", { celebraciones: ["navidad"], tematicas: ["unicornio"], medidas: { altoCm: null, anchoCm: null, fondoCm: null }, razones: [] }));
    assert.match(l, /celebración: Año nuevo/i);
    assert.match(l, /temática: Metálico/i);
    assert.doesNotMatch(l, / cm|salió porque/);
  });

  await prueba("sin resultados: dice los filtros aplicados y sugiere quitar los de formato, parte o medidas", async () => {
    const { deps } = falsa(respuesta([]));
    const r = consultaOk(await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", { texto: "arco", formato: "R-24", alto_cm: 300 }, deps));
    assert.match(r, /No hay nada en la biblioteca con eso \(filtros: .*formatos=R-24.*altoMin=225/);
    assert.match(r, /sin los filtros de formato, parte o medidas/);
  });

  await prueba("respaldo: si buscarEnTaller lanza, responde la herramienta en memoria de siempre y queda el motivo", async () => {
    const { deps } = falsa(new Error("vector de otro tamaño"));
    const args = { texto: "arco orgánico" };
    const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", args, deps);
    assert.deepEqual(h.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", args));
    assert.equal(h.busqueda?.fuente, "memoria");
    assert.match(h.busqueda?.motivo ?? "", /la búsqueda falló: vector de otro tamaño/);
    assert.ok((h.busqueda?.ids.length ?? 0) > 0, "los ids de memoria quedan en el registro");
  });

  await prueba("respaldo: si buscarEnTaller ya cayó a memoria (la base no respondió), responde la herramienta de siempre", async () => {
    const { deps } = falsa(respuesta([resultado("m:1")], { fuente: "memoria", avisos: ["La base de datos de la biblioteca no respondió; se buscó en memoria."] }));
    const args = { texto: "arco orgánico" };
    const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", args, deps);
    assert.deepEqual(h.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", args));
    assert.equal(h.busqueda?.fuente, "memoria");
    assert.match(h.busqueda?.motivo ?? "", /no respondió/);
  });

  await prueba("respaldo: argumentos inválidos o un color que no existe dan el mismo error de siempre, sin llamar a la búsqueda", async () => {
    const { deps, pedidos } = falsa(respuesta([resultado("x:1")]));
    for (const args of [{ limite: 99 }, { tipo: "nave" }, { colores: ["colorinexistente"] }, { fuente: "otra" }]) {
      const h = await aplicarHerramientaAsincrona(escena, "buscar_en_biblioteca", args, deps);
      assert.deepEqual(h.resultado, aplicarHerramienta(escena, "buscar_en_biblioteca", args));
      assert.equal(h.resultado.ok, false);
    }
    assert.equal(pedidos.length, 0);
  });

  await prueba("esquema: buscar_en_biblioteca declara los filtros nuevos y los de siempre", () => {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === "buscar_en_biblioteca")!;
    const props = Object.keys((d.parametersJsonSchema as { properties: Record<string, unknown> }).properties);
    for (const p of ["texto", "tipo", "ocasion", "colores", "tipo_pieza", "limite", "celebracion", "tematica", "formato", "parte", "alto_cm", "ancho_cm", "fuente"]) assert.ok(props.includes(p), `falta ${p}`);
  });

  await prueba("en memoria (bandera apagada) la celebración filtra como ocasión y los demás filtros avisan que no se aplican", () => {
    const sola = aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "arco", celebracion: "cumpleaños" });
    const conOcasion = aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "arco", ocasion: "cumpleanos" });
    assert.deepEqual(sola, conOcasion);
    const aviso = aplicarHerramienta(escena, "buscar_en_biblioteca", { texto: "arco", tematica: "unicornio", alto_cm: 200 });
    assert.ok(aviso.ok);
    if (aviso.ok) assert.match(aviso.resumen, /Sin efecto en esta búsqueda: tematica, alto_cm/);
  });

  await prueba("contrato de la ruta: pasa por aplicarHerramientaAsincrona, registra la búsqueda y el sistema nombra los filtros", () => {
    const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
    for (const re of [
      /import \{ aplicarHerramientaAsincrona \} from "@\/lib\/globos3d\/escena-ia-biblioteca"/,
      // REQ-013: la ruta le pasa a la búsqueda la visibilidad del catálogo para el RAG (`buscarVisible`).
      /await aplicarHerramientaAsincrona\(escena, nombre, llamada\.args \?\? \{\}, \{ buscar: \(entrada\) => buscarVisible\(entrada\) \}\)/,
      /busqueda: \{ fuente: busqueda\.fuente, ids: busqueda\.ids/,
      /celebracion, tematica, formato \(R-24…\), parte, alto_cm\/ancho_cm aproximados y fuente \(referencias_dueno, ideas_sempertex, revista_celebra, bases_organicas\)/,
    ]) assert.match(ruta, re);
    assert.doesNotMatch(ruta, /[^a-zA-Z]aplicarHerramienta\(/, "la ruta ya no llama a la versión síncrona directamente");
  });

  console.log(`\n${pruebas} pruebas OK`);
})().catch((error) => { console.error(error); process.exit(1); });
