/**
 * REQ-013 fase 2: la búsqueda de la biblioteca del taller siempre filtra por repositorio de catálogo. Sin base ni red (pool falso):
 * - toda consulta a `taller_items` lleva la partición, una sola vez, en el CTE `filtrados` al que se unen todas las ramas;
 * - los visibles para el RAG se cruzan con los pedidos: nunca se amplían, y un cruce vacío es «nada»; los resuelven las rutas
 *   (`buscarVisible`, política del catálogo) y sin ellos la búsqueda ve solo Sempertex;
 * - si la base aún no tiene la columna (migración 034 sin aplicar, 42703) la búsqueda avisa una vez y busca como antes, sin caer a
 *   memoria;
 * - el respaldo en memoria aplica la misma regla.
 * La ejecución real (PGlite, antes y después de 034) está en `test-migracion-034.ts`.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-taller-buscar-repositorios.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { archivos, cerradura, SRC } from "./lib-cerradura-imports";
import { buscarEnTaller, REPOSITORIOS_SIN_POLITICA, repositoriosDeBusqueda, type DependenciasBuscar } from "../../src/lib/taller/buscar";
import { buscarVisible } from "../../src/lib/taller/buscar-visible";
import { construirConsultaBusqueda, SIN_REFUERZOS, type EntradaBusqueda, type ParticionRepositorios } from "../../src/lib/taller/buscar-sql";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { repositorioPorPrefijo } from "../../src/lib/catalogo/ids";

let casos = 0;
const ok = (nombre: string) => { casos += 1; console.log(`ok ${casos} - ${nombre}`); };
const vector = (valor = 0.01) => Array.from({ length: 768 }, () => valor);
const cuenta = (texto: string, parte: string) => texto.split(parte).length - 1;
const SOLO_SEMPERTEX: ParticionRepositorios = { repositorios: ["sempertex"], conColumna: true };
const filtradosDe = (texto: string) => texto.slice(texto.indexOf("filtrados AS"), texto.indexOf("\n),\n") + 3);

// Todas las formas de consulta: cada rama sola y juntas, con filtros, con escenas promovidas y con candidatos por medida.
const ENTRADAS: Array<[string, EntradaBusqueda, Parameters<typeof construirConsultaBusqueda>[3]?]> = [
  ["solo filtros", { filtros: { celebraciones: ["boda"] } }],
  ["texto", { texto: "arco dorado" }],
  ["texto + vector", { texto: "arco", vectorTexto: vector() }],
  ["foto", { vectorImagen: vector(0.2) }],
  ["las cuatro ramas", { texto: "x yy", vectorTexto: vector(), vectorImagen: vector(0.5), filtros: { propietario: "dueno-1" } }],
  ["sin promoción", { texto: "topiario" }, { promocionPadre: 0 }],
];

// --- el SQL ----------------------------------------------------------------------------------------------------------------
{
  for (const [nombre, entrada, ajuste] of ENTRADAS) {
    const refuerzos = nombre === "texto" ? { ...SIN_REFUERZOS, altoCm: 200, tiposPieza: ["arco"] } : SIN_REFUERZOS;
    const c = construirConsultaBusqueda(entrada, SOLO_SEMPERTEX, refuerzos, ajuste);
    const filtrados = filtradosDe(c.texto);
    assert.equal(cuenta(c.texto, "t.repositorio = ANY("), 1, `${nombre}: la partición, una vez`);
    assert.match(filtrados, /t\.repositorio = ANY\(\$\d+::text\[\]\)/, `${nombre}: dentro de filtrados`);
    // Cada lectura de `taller_items` fuera de filtrados se une a filtrados o a la fusión (que solo trae ids de filtrados).
    const lecturas = c.texto.replace(filtrados, "").split(/(?=JOIN taller_items t\b|FROM taller_items t\b)/).slice(1);
    for (const tramo of lecturas) assert.match(tramo.slice(0, 160), /taller_items t ON t\.id = (f|fu)\.id/, `${nombre}: ${tramo.slice(0, 80)}`);
    assert.ok(c.valores.some((v) => Array.isArray(v) && v.length === 1 && v[0] === "sempertex"), nombre);
    assert.match(c.texto, /t\.propietario, t\.repositorio,/, `${nombre}: cada resultado trae su repositorio`);
  }
  ok("toda consulta lleva la partición una vez, en filtrados, y devuelve el repositorio de cada fila");

  const varios = construirConsultaBusqueda({ texto: "silla" }, { repositorios: ["sempertex", "mobiliario"], conColumna: true });
  assert.ok(varios.valores.some((v) => Array.isArray(v) && v.join() === "sempertex,mobiliario"));
  const ninguno = construirConsultaBusqueda({ texto: "silla" }, { repositorios: [], conColumna: true });
  assert.ok(ninguno.valores.some((v) => Array.isArray(v) && v.length === 0), "lista vacía = ninguna fila (ANY de vacío), nunca «todas»");
  ok("la lista de repositorios va como parámetro; vacía no abre nada");

  // Fase 3 (AC-8): con un repositorio chico en la partición, las ramas vectoriales ordenan por `distancia + 0` (el HNSW no puede
  // servirlo: exactas); solo Sempertex conserva el orden por distancia de siempre. La ejecución está en `test-taller-repositorios-rag.ts`.
  const ambos = { texto: "silla", vectorTexto: vector(), vectorImagen: vector(0.5) };
  for (const repositorios of [["mobiliario"], ["sempertex", "mobiliario"], ["sempertex", "mobiliario", "escenografia"]] as const) {
    const c = construirConsultaBusqueda(ambos, { repositorios, conColumna: true });
    assert.equal(c.texto.match(/ORDER BY \(e\.vector <=> \$\d+::vector\) \+ 0, e\.item_id/g)?.length, 2, `${repositorios.join()}: las dos ramas vectoriales, exactas`);
    assert.equal(cuenta(c.texto, "ORDER BY e.vector <=>"), 0, repositorios.join());
  }
  const soloSempertex = construirConsultaBusqueda(ambos, SOLO_SEMPERTEX);
  assert.equal(cuenta(soloSempertex.texto, "ORDER BY e.vector <=>"), 2, "solo Sempertex: el orden por distancia de siempre");
  assert.equal(cuenta(soloSempertex.texto, ") + 0, e.item_id"), 0);
  ok("un repositorio chico en la partición vuelve exactas las ramas vectoriales; solo Sempertex, el SQL de siempre");

  const legado = construirConsultaBusqueda({ texto: "arco", vectorTexto: vector() }, { repositorios: ["sempertex"], conColumna: false });
  assert.ok(!/t\.repositorio/.test(legado.texto), "sin la columna no se nombra");
  assert.match(legado.texto, /'sempertex'::text AS repositorio/, "sin la columna, todo es Sempertex (R2)");
  assert.ok(!filtradosDe(legado.texto).includes("FALSE"));
  const actual = construirConsultaBusqueda({ texto: "arco", vectorTexto: vector() }, SOLO_SEMPERTEX);
  assert.equal(legado.texto.replace("'sempertex'::text AS repositorio", "t.repositorio"), actual.texto.replace(/\n {4}AND t\.repositorio = ANY\(\$1::text\[\]\)/, "").replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 1}`), "sin la columna, la consulta de antes de REQ-013");
  const legadoSinSempertex = construirConsultaBusqueda({ texto: "arco" }, { repositorios: ["mobiliario"], conColumna: false });
  assert.match(filtradosDe(legadoSinSempertex.texto), /\n {4}AND FALSE\n/, "sin la columna y sin Sempertex visible: nada");
  ok("sin la columna (034 sin aplicar): la consulta de antes si Sempertex es visible, ninguna fila si no");
}

// --- visibles × pedidos -------------------------------------------------------------------------------------------------------
{
  assert.deepEqual(repositoriosDeBusqueda(["sempertex"], undefined), ["sempertex"]);
  assert.deepEqual(repositoriosDeBusqueda(["sempertex"], []), ["sempertex"], "pedir nada = los visibles");
  assert.deepEqual(repositoriosDeBusqueda(["sempertex", "mobiliario"], ["mobiliario"]), ["mobiliario"]);
  assert.deepEqual(repositoriosDeBusqueda(["sempertex"], ["mobiliario"]), [], "pedir un invisible no lo abre");
  assert.deepEqual(repositoriosDeBusqueda(["sempertex"], ["inventado"]), []);
  ok("visibles × pedidos: nunca se amplía, el cruce vacío es vacío");
}

// --- buscarEnTaller con pool falso --------------------------------------------------------------------------------------------
type Llamada = { texto: string; valores: unknown[] };
function poolFalso(respuestas: Array<Array<Record<string, unknown>> | Error>): { obtenerPool: NonNullable<DependenciasBuscar["obtenerPool"]>; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    obtenerPool: () => ({
      query: (async (texto: string, valores: unknown[]) => {
        llamadas.push({ texto, valores });
        const r = respuestas[Math.min(llamadas.length, respuestas.length) - 1]!;
        if (r instanceof Error) throw r;
        return { rows: r, rowCount: r.length };
      }) as never,
    }),
  };
}
const fila = (id: string, extra: Record<string, unknown> = {}) => ({ id, tipo: "estructura", nombre: id, descripcion: "", ocasiones: [], puntaje: 0.02, rrf: 0.02, ...extra });
const sinEmbedding = async (): Promise<undefined> => undefined;
const columnaFaltante = () => Object.assign(new Error('column t.repositorio does not exist'), { code: "42703" });

async function capturarAvisos<T>(fn: () => Promise<T>): Promise<{ valor: T; avisos: string[] }> {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  try {
    return { valor: await fn(), avisos };
  } finally {
    console.warn = original;
  }
}

async function main(): Promise<void> {
  {
    const { obtenerPool, llamadas } = poolFalso([[fila("idea:a", { repositorio: "sempertex" }), fila("silla_tiffany", { repositorio: "mobiliario" }), fila("idea:viejo")]]);
    const r = await buscarEnTaller({ texto: "arco" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool });
    assert.ok(llamadas[0]!.valores.some((v) => Array.isArray(v) && v.join() === "sempertex"), "sin política resuelta, solo lo de antes de REQ-013 (falla cerrado)");
    assert.deepEqual(REPOSITORIOS_SIN_POLITICA, ["sempertex"]);
    assert.deepEqual(r.resultados.map((x) => x.repositorio), ["sempertex", "mobiliario", "sempertex"], "cada resultado con su repositorio; sin columna = Sempertex");

    const pedido = poolFalso([[]]);
    await buscarEnTaller({ texto: "silla", filtros: { repositorios: ["mobiliario"] } }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: pedido.obtenerPool });
    assert.ok(pedido.llamadas[0]!.valores.some((v) => Array.isArray(v) && v.length === 0), "pedir mobiliario sin verlo: ninguno, no todos");

    const visibles = poolFalso([[]]);
    await buscarEnTaller({ texto: "silla", filtros: { repositorios: ["mobiliario"] } }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: visibles.obtenerPool, repositoriosVisibles: () => ["sempertex", "mobiliario"] });
    assert.ok(visibles.llamadas[0]!.valores.some((v) => Array.isArray(v) && v.join() === "mobiliario"));
    ok("RAG: sin política, solo Sempertex; los pedidos se cruzan con los visibles; el repositorio sale en cada resultado");
  }

  {
    // Las rutas resuelven la política del catálogo (`buscarVisible` → `reposVisibles("rag")`) y se la pasan a la búsqueda.
    const antes = process.env.CATALOGO_REPOS_RAG;
    try {
      const porDefecto = poolFalso([[]]);
      delete process.env.CATALOGO_REPOS_RAG;
      await buscarVisible({ texto: "silla" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: porDefecto.obtenerPool });
      assert.ok(porDefecto.llamadas[0]!.valores.some((v) => Array.isArray(v) && v.join() === "sempertex"), "manifiestos: el RAG ve solo Sempertex");
      const conVariable = poolFalso([[]]);
      process.env.CATALOGO_REPOS_RAG = "sempertex,mobiliario";
      await buscarVisible({ texto: "silla" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: conVariable.obtenerPool });
      assert.ok(conVariable.llamadas[0]!.valores.some((v) => Array.isArray(v) && v.join() === "sempertex,mobiliario"), "la variable llega a la consulta");
    } finally {
      if (antes === undefined) delete process.env.CATALOGO_REPOS_RAG;
      else process.env.CATALOGO_REPOS_RAG = antes;
    }
    const raiz = path.resolve(__dirname, "..", "..");
    for (const archivo of ["src/app/api/taller/buscar/route.ts", "src/app/api/taller/buscar-foto/route.ts", "src/app/api/escena-ia/route.ts", "src/lib/taller/modelar-foto-real.ts"]) {
      assert.match(readFileSync(path.join(raiz, archivo), "utf8"), /buscarVisible\(/, `${archivo} busca con la visibilidad del catálogo`);
    }
    assert.ok(!cerradura(archivos(path.join(SRC, "lib", "globos3d"))).has(path.join(SRC, "lib", "taller", "buscar-visible.ts")), "el motor no alcanza la política");
    ok("las rutas (y modelar-foto-real) pasan reposVisibles(\"rag\"); el motor no la alcanza");
  }

  {
    const filas = [fila("idea:a"), fila("idea:b")];
    const { obtenerPool, llamadas } = poolFalso([columnaFaltante(), filas]);
    const { valor: r, avisos } = await capturarAvisos(() => buscarEnTaller({ texto: "arco", vectorTexto: vector() }, { habilitado: true, obtenerPool }));
    assert.equal(r.fuente, "rag", "sin la columna se sigue buscando en la base, no en memoria");
    assert.deepEqual(r.ids, ["idea:a", "idea:b"]);
    assert.deepEqual(r.avisos, [], "la respuesta es la de siempre");
    assert.equal(llamadas.length, 2, "un intento con la partición y uno sin ella");
    assert.match(llamadas[0]!.texto, /t\.repositorio = ANY/);
    assert.ok(!/t\.repositorio/.test(llamadas[1]!.texto), "el reintento no nombra la columna");
    assert.equal(avisos.length, 1);
    assert.match(avisos[0]!, /falta la columna taller_items\.repositorio \(migración 034 sin aplicar\)/);
    assert.match(avisos[0]!, /034_catalogo_repositorios\.sql/);

    const sinSempertex = poolFalso([columnaFaltante(), []]);
    const otro = await capturarAvisos(() => buscarEnTaller({ texto: "arco" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: sinSempertex.obtenerPool, repositoriosVisibles: () => ["mobiliario"] }));
    assert.equal(otro.valor.fuente, "rag");
    assert.match(sinSempertex.llamadas[1]!.texto, /AND FALSE/, "sin la columna todo es Sempertex: si no es visible, nada");
    assert.deepEqual(otro.avisos, [], "el aviso sale una vez por proceso");
    ok("migración 034 sin aplicar (42703): aviso claro (una vez por proceso) y la búsqueda de antes, en la base");

    const otraColumna = poolFalso([Object.assign(new Error('column "foo" does not exist'), { code: "42703" })]);
    const memoria = await capturarAvisos(() => buscarEnTaller({ texto: "arco" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: otraColumna.obtenerPool, memoria: () => [] }));
    assert.equal(memoria.valor.fuente, "memoria", "otro error de esquema: el respaldo de siempre");
    assert.equal(otraColumna.llamadas.length, 1);
    const reintentoFalla = poolFalso([columnaFaltante(), new Error("connection reset")]);
    const caida = await capturarAvisos(() => buscarEnTaller({ texto: "arco" }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: reintentoFalla.obtenerPool, memoria: () => [] }));
    assert.equal(caida.valor.fuente, "memoria", "si el reintento también falla, memoria con su aviso");
    ok("cualquier otro error (o un reintento fallido) cae a memoria como antes");
  }

  {
    const item = BIBLIOTECA_FABRICA.find((i) => i.tipo === "estructura")!;
    const memoria = () => [item];
    const hoy = await buscarEnTaller({ texto: "x" }, { habilitado: false, memoria });
    assert.deepEqual(hoy.ids, [item.id]);
    assert.equal(hoy.resultados[0]!.repositorio, "sempertex");
    const oculto = await buscarEnTaller({ texto: "x" }, { habilitado: false, memoria, repositoriosVisibles: () => ["mobiliario"] });
    assert.deepEqual(oculto.ids, [], "la memoria es Sempertex: si no es visible, nada");
    const pedidoOtro = await buscarEnTaller({ texto: "x", filtros: { repositorios: ["escenografia"] } }, { habilitado: false, memoria });
    assert.deepEqual(pedidoOtro.ids, []);
    const sinPrefijo = await buscarEnTaller({ texto: "x" }, { habilitado: false, memoria: () => [{ ...item, id: "sin-prefijo" }] });
    assert.deepEqual(sinPrefijo.ids, [], "un item sin repositorio conocido no sale");
    assert.ok(BIBLIOTECA_FABRICA.every((i) => repositorioPorPrefijo(i.id) === "sempertex"), "hoy toda la biblioteca de fábrica lleva prefijo de Sempertex");
    ok("memoria: la misma regla (Sempertex por prefijo), resultados de hoy intactos");
  }

  console.log(`\n${casos} casos ok`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
