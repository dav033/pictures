/**
 * REQ-002: búsqueda de la biblioteca del taller. Sin base de datos ni red: se prueba la FORMA del SQL por combinación de
 * filtros, el camino de respaldo en memoria (bandera apagada y pool que falla, con un pool falso) y los refuerzos del glosario.
 * No hay analizador de SQL de Postgres en node_modules (pgsql-ast-parser, pg-query, pglite), así que la sintaxis se vigila
 * con comprobaciones estructurales (paréntesis, marcadores, palabras clave); la ejecución real queda para una base con 028.
 * Run: npx tsx scripts/test/test-taller-buscar.ts
 */
import assert from "node:assert/strict";
import {
  AFINADO_POR_DEFECTO,
  BONO_REFUERZO,
  CANDIDATOS_MAXIMO,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  PESOS_RAMA,
  SIN_REFUERZOS,
  consultaTsOr,
  construirConsultaBusqueda,
  fusionarAfinado,
  limiteSeguro,
  patronLike,
  type ConsultaBusqueda,
  type EntradaBusqueda,
} from "../../src/lib/taller/buscar-sql";
import { buscarEnTaller, refuerzosDeConsulta, refuerzosDeInterpretacion, type DependenciasBuscar } from "../../src/lib/taller/buscar";
import { PALABRAS_DE_FUENTE, entenderConsulta } from "../../src/lib/taller/entender-consulta";
import { interpretarTerminos } from "../../src/lib/globos3d/glosario-taller";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { RRF_K } from "../../src/lib/rag/retrieval/rrf";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

const vector = (valor = 0.01) => Array.from({ length: 768 }, () => valor);

/** Revisiones estructurales del SQL (sin analizador): marcadores, paréntesis y cadenas balanceados, sin basura de plantilla. */
function sqlSano(c: ConsultaBusqueda): void {
  const usados = new Set([...c.texto.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.deepEqual([...usados].sort((a, b) => a - b), c.valores.map((_, i) => i + 1), `marcadores ≠ valores:\n${c.texto}`);
  const sinCadenas = c.texto.replace(/'[^']*'/g, "S");
  assert.ok(!sinCadenas.includes("'"), "comillas sin cerrar");
  let profundidad = 0;
  for (const ch of sinCadenas) {
    if (ch === "(") profundidad += 1;
    if (ch === ")") profundidad -= 1;
    assert.ok(profundidad >= 0, "paréntesis de cierre de más");
  }
  assert.equal(profundidad, 0, "paréntesis sin cerrar");
  assert.ok(!/undefined|NaN|\[object|\$\{/.test(c.texto), "restos de plantilla");
  assert.match(c.texto, /^WITH filtrados AS MATERIALIZED \(/);
  assert.match(c.texto, /ORDER BY s\.puntaje DESC, s\.id\nLIMIT \$\d+::integer$/);
  assert.equal((c.texto.match(/^WITH /gm) ?? []).length, 1);
}

/** Los CTE de ramas (entre `filtrados` y `ramas`) y el CTE `filtrados`, separados. */
function partes(c: ConsultaBusqueda): { filtrados: string; ramas: Record<string, string> } {
  const filtrados = c.texto.slice(c.texto.indexOf("filtrados AS"), c.texto.indexOf("\n),\n") + 3);
  const ramas: Record<string, string> = {};
  for (const r of c.ramas) {
    const desde = c.texto.indexOf(`\n${r} AS (`) === -1 ? c.texto.indexOf(`,\n${r} AS (`) : c.texto.indexOf(`\n${r} AS (`);
    assert.ok(desde >= 0, `falta la rama ${r}`);
    ramas[r] = c.texto.slice(desde, c.texto.indexOf("\n)", desde) + 2);
  }
  return { filtrados, ramas };
}

const cuenta = (texto: string, parte: string) => texto.split(parte).length - 1;

// --- ramas según la entrada -----------------------------------------------------------------------------------
{
  const vacia = construirConsultaBusqueda({});
  sqlSano(vacia);
  assert.deepEqual(vacia.ramas, ["filtro"]);
  assert.deepEqual(vacia.valores, [AFINADO_POR_DEFECTO.candidatos, 12], "porRama (candidatos afinados) y limite (12)");
  assert.match(vacia.texto, /t\.propietario IS NULL/, "sin propietario: solo lo de fábrica");
  assert.ok(!/to_tsquery|<=>|similarity/.test(vacia.texto));
  ok("sin texto ni vectores: rama filtro, solo fábrica, límite por defecto");

  const texto = construirConsultaBusqueda({ texto: "columna dorada con uvas" });
  sqlSano(texto);
  assert.deepEqual(texto.ramas, ["fts", "trigram"]);
  assert.equal(texto.valores[1], "columna | dorada | con | uvas", "OR de palabras para to_tsquery");
  assert.equal(texto.valores[2], "columna dorada con uvas");
  assert.match(texto.texto, /to_tsquery\('spanish_unaccent', \$2::text\)/);
  assert.match(texto.texto, /word_similarity/);
  ok("solo texto: ramas fts + trigram");

  const vt = construirConsultaBusqueda({ texto: "arco", vectorTexto: vector() });
  sqlSano(vt);
  assert.deepEqual(vt.ramas, ["fts", "trigram", "vector_texto"]);
  const v = vt.valores.find((x) => typeof x === "string" && x.startsWith("[0.01,"));
  assert.ok(v, "el vector va como literal pgvector");
  assert.match(vt.texto, /e\.modalidad = 'texto' AND e\.modelo = \$\d+::text/);
  assert.match(vt.texto, /1 - \(e\.vector <=> \$\d+::vector\)/);
  assert.ok(vt.valores.includes("gemini-embedding-2"));
  ok("texto + vector de texto: rama vector_texto con modalidad texto");

  const vi = construirConsultaBusqueda({ vectorImagen: vector(0.02) });
  sqlSano(vi);
  assert.deepEqual(vi.ramas, ["vector_imagen"], "solo foto: ni fts ni trigram ni filtro");
  assert.match(vi.texto, /e\.modalidad <> 'texto'/, "calza con el HNSW parcial de imágenes");
  assert.match(vi.texto, /MAX\(puntaje\) AS puntaje/, "foto y render del mismo item: gana la mejor");
  ok("solo foto: rama vector_imagen");

  const todo = construirConsultaBusqueda({ texto: "x yy", vectorTexto: vector(), vectorImagen: vector(0.5) });
  sqlSano(todo);
  assert.deepEqual(todo.ramas, ["fts", "trigram", "vector_texto", "vector_imagen"]);
  assert.equal(todo.valores.filter((x) => x === "gemini-embedding-2").length, 1, "el modelo es un solo parámetro compartido");
  ok("las cuatro ramas: el modelo se parametriza una vez");

  const sinPalabras = construirConsultaBusqueda({ texto: "! ? a" });
  sqlSano(sinPalabras);
  assert.deepEqual(sinPalabras.ramas, ["trigram"], "sin palabras útiles para to_tsquery, queda el trigram");
  assert.equal(consultaTsOr("¡Cumpleaños de Niño! a 15"), "cumpleaños | de | niño | 15", "solo letras y números, minúsculas");
  ok("consultaTsOr limpia signos y descarta palabras de una letra");
}

// --- fusión RRF -----------------------------------------------------------------------------------------------
{
  const c = construirConsultaBusqueda({ texto: "arco", vectorTexto: vector() });
  assert.ok(c.texto.includes(`SUM(peso / (${RRF_K} + rango))`), "misma fórmula y k que rrf.ts");
  assert.ok(c.texto.includes(`${PESOS_RAMA.fts}::float8 AS peso FROM fts`));
  assert.ok(c.texto.includes(`${PESOS_RAMA.trigram}::float8 AS peso FROM trigram`));
  assert.match(c.texto, /MIN\(rango\) FILTER \(WHERE rama = 'vector_texto'\) AS rango_vector_texto/);
  assert.match(c.texto, /MAX\(puntaje\) FILTER \(WHERE rama = 'fts'\) AS puntaje_fts/);
  const cteRamas = c.texto.slice(c.texto.indexOf("ramas AS ("), c.texto.indexOf("fusion AS ("));
  assert.equal(cuenta(cteRamas, "UNION ALL"), 2, "una unión por cada par de ramas");
  ok("fusión: Σ peso/(k+rango) con rangos y puntajes por rama");
}

// --- filtros duros en TODAS las ramas ----------------------------------------------------------------------------
{
  const entrada: EntradaBusqueda = {
    texto: "guirnalda",
    vectorTexto: vector(),
    vectorImagen: vector(0.3),
    filtros: {
      tipos: ["estructura", "conjunto"], tiposPieza: ["guirnalda_organica"], celebraciones: ["graduacion"], tematicas: ["boho"],
      formatos: ["R-24"], partes: ["ramas"], colores: ["570"], altoMin: 100, altoMax: 300, anchoMin: 50, anchoMax: 400,
      fuente: ["idea-sempertex"], propietario: "dueno-1",
    },
  };
  const c = construirConsultaBusqueda(entrada);
  sqlSano(c);
  const { filtrados, ramas } = partes(c);
  for (const fragmento of [
    "t.activo", "(t.propietario IS NULL OR t.propietario = ", "t.tipo = ANY(", "t.fuente_tipo = ANY(", "t.tipos_pieza && ", "t.celebraciones && ",
    "t.tematicas && ", "t.formatos && ", "t.partes && ", "t.colores && ", "t.alto_cm >= ", "t.alto_cm <= ", "t.ancho_cm >= ", "t.ancho_cm <= ",
  ]) {
    assert.ok(filtrados.includes(fragmento), `el CTE filtrados debe tener ${fragmento}`);
    assert.equal(cuenta(c.texto, fragmento), 1, `${fragmento} aparece una sola vez (se aplica en filtrados, no se duplica)`);
  }
  for (const [nombre, texto] of Object.entries(ramas)) {
    assert.match(texto, /(JOIN|FROM) filtrados f/, `la rama ${nombre} se une a filtrados`);
  }
  assert.deepEqual(c.valores.slice(0, 3), ["dueno-1", ["estructura", "conjunto"], ["idea-sempertex"]], "los filtros son los primeros parámetros");
  assert.ok(c.valores.includes(300) && c.valores.includes(50));
  ok("todos los filtros duros: una vez en filtrados y todas las ramas se unen a ella");

  const propios = construirConsultaBusqueda({ filtros: { propietario: "dueno-1", soloPropios: true } });
  sqlSano(propios);
  assert.match(propios.texto, /t\.propietario = \$1::text/);
  assert.ok(!propios.texto.includes("t.propietario IS NULL"));
  assert.throws(() => construirConsultaBusqueda({ filtros: { soloPropios: true } }), /propietario/);
  const vacios = construirConsultaBusqueda({ filtros: { tipos: [], formatos: ["  ", ""], celebraciones: ["a", "a"] } });
  sqlSano(vacios);
  assert.deepEqual(vacios.valores.slice(0, 1), [["a"]], "listas vacías no filtran; repetidos se unifican");
  ok("propietario: fábrica + dueño, solo propios, y listas vacías ignoradas");
}

// --- límite y vectores ---------------------------------------------------------------------------------------------
{
  assert.equal(limiteSeguro(undefined), LIMITE_POR_DEFECTO);
  assert.equal(limiteSeguro(Number.NaN), LIMITE_POR_DEFECTO);
  assert.equal(limiteSeguro(0), 1);
  assert.equal(limiteSeguro(500), LIMITE_MAXIMO);
  assert.equal(limiteSeguro(7.9), 7);
  const c = construirConsultaBusqueda({ limite: 500 });
  assert.equal(c.limite, 50);
  assert.deepEqual(c.valores, [Math.min(CANDIDATOS_MAXIMO, Math.max(AFINADO_POR_DEFECTO.candidatos, 150)), 50], "candidatos por rama: al menos los afinados, 3 × límite y como mucho el tope");
  assert.deepEqual(construirConsultaBusqueda({ limite: 500 }, undefined, { candidatos: 1000 }).valores, [CANDIDATOS_MAXIMO, 50], "el tope de candidatos no se pasa");
  assert.throws(() => construirConsultaBusqueda({ vectorTexto: [1, 2, 3] }), /768/);
  assert.throws(() => construirConsultaBusqueda({ vectorImagen: vector().map((n, i) => (i === 0 ? Infinity : n)) }), /no finitos/);
  ok("límite acotado a 1…50 y vectores validados");
}

// --- refuerzos del glosario ------------------------------------------------------------------------------------------
{
  const interp = interpretarTerminos("columna link-o-loon dorada con ramas");
  const refuerzos = refuerzosDeInterpretacion(interp);
  assert.deepEqual(refuerzos.formatos, ["LOL-*"], "«link-o-loon» → familia LOL-*");
  assert.ok(refuerzos.partes.includes("ramas"));
  assert.ok(refuerzos.tiposPieza.includes("columna"));
  assert.ok(refuerzos.colores.includes("570"));
  const c = construirConsultaBusqueda({ texto: "columna link-o-loon dorada con ramas" }, refuerzos);
  sqlSano(c);
  assert.ok(c.valores.some((x) => Array.isArray(x) && x.length === 1 && x[0] === "LOL-%"), "la familia va como patrón LIKE");
  assert.match(c.texto, /x\.f LIKE ANY\(\$\d+::text\[\]\)/);
  assert.match(c.texto, /AS refuerzo_formatos/);
  assert.match(c.texto, /AS refuerzo_partes/);
  assert.ok(c.texto.includes(`THEN ${BONO_REFUERZO} ELSE 0`), "bono fijo");
  assert.ok(!/t\.formatos &&/.test(c.texto), "los refuerzos NO son filtros duros");
  assert.match(c.texto, /fu\.rrf \+ CASE WHEN/);
  const sin = construirConsultaBusqueda({ texto: "hola" });
  assert.ok(!sin.texto.includes("refuerzo_"), "sin refuerzos, ninguna columna extra");
  assert.equal(patronLike("LOL-*"), "LOL-%");
  assert.equal(patronLike("R_5%"), "R\\_5\\%");
  assert.ok(BONO_REFUERZO < 1 / (RRF_K + 1), "un refuerzo pesa menos que un primer puesto");
  ok("glosario → refuerzos suaves (bono, no filtro): link-o-loon da LOL-%");
}

// --- refuerzos de la taxonomía, la fuente y la medida (entender-consulta) ----------------------------------------------------
{
  const entendido = entenderConsulta("una columna de 2 metros de la revista Celebra para grado");
  const refuerzos = refuerzosDeConsulta(interpretarTerminos("una columna de 2 metros de la revista Celebra para grado"), entendido);
  assert.deepEqual(refuerzos.celebraciones, ["graduacion"]);
  assert.deepEqual(refuerzos.fuentes, ["celebra"]);
  assert.equal(refuerzos.altoCm, 200);
  assert.ok(refuerzos.nombresPieza?.includes("columna"), "la pieza pedida se compara con el nombre");
  assert.ok(refuerzos.palabrasExtra?.includes("graduacion"), "las palabras de la taxonomía se suman al texto");

  const c = construirConsultaBusqueda({ texto: "columna de 2 metros para grado" }, refuerzos);
  sqlSano(c);
  for (const columna of ["refuerzo_celebraciones", "refuerzo_fuentes", "refuerzo_medida", "refuerzo_nombre_pieza"]) assert.ok(c.texto.includes(`AS ${columna}`), columna);
  assert.match(c.texto, /t\.celebraciones && \$\d+::text\[\]/);
  assert.match(c.texto, /t\.fuente_tipo = ANY\(\$\d+::text\[\]\)/);
  assert.match(c.texto, /GREATEST\(0, 1 - ABS\(t\.alto_cm - \$\d+::numeric\) \/ \$\d+::numeric\)/, "la medida puntúa por cercanía, no por igualdad");
  assert.ok(!/t\.ancho_cm - /.test(c.texto), "sin ancho pedido, no se mide el ancho");
  assert.ok(c.valores.includes(200) && c.valores.includes(30), "medida pedida y su tolerancia (15 %, mínimo 25 cm)");
  assert.ok(c.valores.some((x) => typeof x === "string" && /graduacion/.test(x) && x.includes(" | ")), "el OR del texto lleva la palabra de la taxonomía");
  assert.match(c.texto, /lower\(unaccent\(t\.nombre\)\) ~ ANY/);
  assert.ok(c.valores.some((x) => Array.isArray(x) && x.includes("\\ycolumna")), "el nombre se compara por palabra completa");
  assert.ok(!/t\.celebraciones &&.*\nAND/.test(c.texto) && !partes(c).filtrados.includes("celebraciones"), "ninguno es filtro duro");

  assert.match(c.texto, /WHERE m\.cercania > 0 ORDER BY m\.cercania DESC, m\.id LIMIT 40/, "los más cercanos a la medida entran aunque el texto no los traiga");
  assert.match(c.texto, /lower\(unaccent\(t\.nombre\)\) ~ ANY\(\$\d+::text\[\]\) OR t\.tipos_pieza && \$\d+::text\[\]/, "pero solo de la pieza pedida");
  const sinInyeccion = construirConsultaBusqueda({ texto: "columna" }, refuerzos, { candidatosMedida: 0, promocionPadre: 0 });
  assert.ok(!sinInyeccion.texto.includes("candidatos AS"), "sin promoción ni inyección de medida no hay candidatos extra");

  assert.ok(!refuerzos.nombresResto?.some((p) => PALABRAS_DE_FUENTE.has(p)), "«revista» y «Celebra» nombran la fuente, no la pieza");
  const comunion = refuerzosDeConsulta(interpretarTerminos("primera comunión con cruz"), entenderConsulta("primera comunión con cruz"));
  assert.ok(comunion.nombresResto?.includes("cruz"), "lo que el glosario no reconoce («cruz») es lo distintivo: se busca en el nombre");
  const conResto = construirConsultaBusqueda({ texto: "primera comunión con cruz" }, comunion);
  sqlSano(conResto);
  assert.match(conResto.texto, /AS refuerzo_nombre_resto/);
  assert.ok(conResto.valores.some((x) => Array.isArray(x) && x.includes("\\ycruz")));
  assert.ok(!construirConsultaBusqueda({ texto: "arco" }, SIN_REFUERZOS).texto.includes("refuerzo_nombre"), "sin palabras distintivas, sin refuerzo");

  const ancho = construirConsultaBusqueda({ texto: "arco" }, { ...SIN_REFUERZOS, anchoCm: 400 });
  assert.match(ancho.texto, /t\.ancho_cm - /);
  assert.ok(ancho.valores.includes(60), "400 cm de ancho → tolerancia de 60 cm");
  assert.equal(consultaTsOr("arco dorado", ["quince", "arco"]), "arco | dorado | quince", "las palabras extra se suman sin repetir");
  assert.equal(consultaTsOr("a", ["x"]), null, "las palabras de una letra no cuentan");
  ok("taxonomía, fuente y medida: refuerzos suaves con cercanía, palabras extra y nombre de la pieza");
}

// --- fragmentos: agrupar bajo su escena --------------------------------------------------------------------------------
{
  const c = construirConsultaBusqueda({ texto: "topiario", vectorTexto: vector() });
  sqlSano(c);
  assert.match(c.texto, /\ncandidatos AS \(/, "la escena entera entra aunque ninguna rama la traiga");
  assert.match(c.texto, /split_part\(x\.id, '~', 1\)/);
  assert.match(c.texto, /JOIN filtrados f ON f\.id = e.id/, "la escena que se agrega pasa los filtros duros");
  assert.match(c.texto, /xt\.tipo <> 'utileria'/, "la utilería (platos, banderines) no es parte de un globo: no se agrupa");
  assert.match(c.texto, /\(position\('~' in t\.id\) > 0 AND t\.tipo <> 'utileria'\) AS es_fragmento/);
  assert.match(c.texto, /power\(0\.7::float8, h\.puesto\)/, "cada fragmento pierde puntaje según su puesto en la familia");
  assert.match(c.texto, /GREATEST\(h\.puntaje_base, 0\.8::float8 \* COALESCE\(h\.mejor_fragmento, 0\)\)/, "la escena hereda del mejor fragmento");
  assert.match(c.texto, /FROM candidatos fu\n/);

  const sinAgrupar = construirConsultaBusqueda({ texto: "topiario" }, undefined, { promocionPadre: 0, factorHermano: 1 });
  sqlSano(sinAgrupar);
  assert.ok(!sinAgrupar.texto.includes("candidatos AS"), "sin promoción no hay escenas agregadas");
  assert.match(sinAgrupar.texto, /FROM fusion fu\n/);
  assert.match(sinAgrupar.texto, /power\(1::float8, h\.puesto\)/, "con factor 1 los fragmentos no pierden nada");

  const filtro = construirConsultaBusqueda({ filtros: { celebraciones: ["halloween"] } });
  sqlSano(filtro);
  assert.deepEqual(filtro.ramas, ["filtro"]);
  assert.match(filtro.texto, /FROM candidatos fu/, "también al explorar solo por filtros");
  ok("fragmentos: familia por split_part(id, '~'), escena heredera, utilería exenta, afinable");
}

// --- afinado ---------------------------------------------------------------------------------------------------------------
{
  const mezcla = fusionarAfinado({ pesos: { vector_texto: 3 } as typeof AFINADO_POR_DEFECTO.pesos, bonos: { medida: 9 } as typeof AFINADO_POR_DEFECTO.bonos });
  assert.equal(mezcla.pesos.vector_texto, 3);
  assert.equal(mezcla.pesos.fts, AFINADO_POR_DEFECTO.pesos.fts, "lo que no se pasa queda como estaba");
  assert.equal(mezcla.bonos.medida, 9);
  assert.equal(mezcla.bonos.fuentes, AFINADO_POR_DEFECTO.bonos.fuentes);
  const c = construirConsultaBusqueda({ texto: "arco", vectorTexto: vector() }, undefined, { pesos: { vector_texto: 3 } as typeof AFINADO_POR_DEFECTO.pesos });
  assert.ok(c.texto.includes("3::float8 AS peso FROM vector_texto"), "el peso de la rama sale del afinado");
  assert.equal(AFINADO_POR_DEFECTO.pesos.vector_texto > AFINADO_POR_DEFECTO.pesos.trigram, true, "el vector pesa más que el trigram");
  assert.ok(AFINADO_POR_DEFECTO.factorHermano > 0 && AFINADO_POR_DEFECTO.factorHermano <= 1);
  assert.ok(AFINADO_POR_DEFECTO.promocionPadre >= 0 && AFINADO_POR_DEFECTO.promocionPadre <= 1);
  ok("afinado: se mezcla con los valores por defecto y llega al SQL");
}

// --- respuesta con pool falso: camino RAG ------------------------------------------------------------------------------
type Llamada = { texto: string; valores: unknown[] };
function poolFalso(filas: Array<Record<string, unknown>>, fallo?: Error): { obtenerPool: NonNullable<DependenciasBuscar["obtenerPool"]>; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    obtenerPool: () => ({
      query: (async (texto: string, valores: unknown[]) => {
        llamadas.push({ texto, valores });
        if (fallo) throw fallo;
        return { rows: filas, rowCount: filas.length };
      }) as never,
    }),
  };
}

const FILA = {
  id: "idea:columna-uvas", tipo: "estructura", nombre: "Columna con uvas", descripcion: "d", fuente_tipo: "idea-sempertex", fuente_titulo: "Sempertex", fuente_url: "https://e.test", foto_url: null,
  ocasiones: ["graduacion"], celebraciones: ["graduacion"], tematicas: [], tipos_pieza: ["columna"], formatos: ["LOL-660"], colores: ["570"], partes: ["ramas"], productos: [],
  alto_cm: "240", ancho_cm: 60, fondo_cm: null, globos: 35, tubos: 0, propietario: null,
  puntaje: 0.0301, rrf: 0.0219, rango_fts: "1", puntaje_fts: 0.4, rango_trigram: "3", puntaje_trigram: 0.52, refuerzo_formatos: true, refuerzo_partes: false, refuerzo_tipos: true,
};

const FORMA_RAIZ = ["avisos", "fuente", "ids", "interpretacion", "ramas", "resultados"];

/** Las pruebas nunca llaman a Gemini: sin vector de consulta salvo donde se prueba a propósito. */
const sinEmbedding = async (): Promise<undefined> => undefined;

async function main(): Promise<void> {
  {
    const { obtenerPool, llamadas } = poolFalso([FILA]);
    const r = await buscarEnTaller({ texto: "columna link-o-loon", filtros: { celebraciones: ["graduacion"] } }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool });
    assert.equal(llamadas.length, 1, "una sola sentencia, un solo viaje");
    assert.equal(r.fuente, "rag");
    assert.deepEqual(Object.keys(r).sort(), FORMA_RAIZ);
    assert.deepEqual(r.ids, ["idea:columna-uvas"]);
    assert.deepEqual(r.ramas, ["fts", "trigram"]);
    const item = r.resultados[0]!;
    assert.equal(item.medidas.altoCm, 240, "NUMERIC llega como texto y se vuelve número");
    assert.deepEqual(item.ramas.fts, { rango: 1, puntaje: 0.4 });
    assert.deepEqual(item.ramas.trigram, { rango: 3, puntaje: 0.52 });
    assert.equal(item.ramas.vector_texto, null);
    assert.equal(item.origen.url, "https://e.test");
    assert.ok(item.razones.some((x) => /palabras de la consulta/.test(x)));
    assert.ok(item.razones.some((x) => /formatos pedidos \(LOL-\*\)/.test(x)), "razón del refuerzo de formato");
    assert.ok(item.razones.some((x) => /Cumple los filtros: celebraciones/.test(x)));
    assert.ok(!item.razones.some((x) => /partes pedidas/.test(x)), "refuerzo apagado no se explica");
    assert.deepEqual(r.interpretacion?.formatos, ["LOL-*"]);
    assert.deepEqual(r.avisos, []);
    assert.ok(llamadas[0]!.texto.startsWith("WITH filtrados"));
    ok("RAG: una consulta, filas → forma de respuesta con razones y refuerzos");
  }

  // Respaldo en memoria
  const real = BIBLIOTECA_FABRICA.find((i) => i.tipo === "estructura" || i.tipo === "conjunto") ?? BIBLIOTECA_FABRICA[0]!;
  const palabra = real.nombre.split(/\s+/).find((p) => p.length > 4) ?? real.nombre;
  const memoriaFalsa = (filtro: { limite?: number }) => (filtro.limite === 0 ? [] : [real]);
  {
    const { obtenerPool, llamadas } = poolFalso([FILA]);
    const r = await buscarEnTaller({ texto: palabra, filtros: { formatos: ["R-24"], altoMin: 100 }, vectorTexto: vector() }, { habilitado: false, obtenerPool, memoria: memoriaFalsa });
    assert.equal(llamadas.length, 0, "bandera apagada: el pool ni se toca");
    assert.equal(r.fuente, "memoria");
    assert.deepEqual(Object.keys(r).sort(), FORMA_RAIZ, "misma forma que la respuesta RAG");
    assert.deepEqual(Object.keys(r.resultados[0]!).sort(), Object.keys((await buscarEnTaller({}, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: poolFalso([FILA]).obtenerPool })).resultados[0]!).sort(), "mismo ítem en ambas");
    assert.deepEqual(r.ids, [real.id]);
    assert.ok(r.avisos.some((a) => /ignora estos filtros: formatos, alto mínimo/.test(a)));
    assert.ok(r.avisos.some((a) => /no usa vectores/.test(a)));
    assert.deepEqual(r.ramas, []);
    ok("bandera apagada: memoria, sin tocar el pool, misma forma y avisos de filtros ignorados");
  }
  {
    const { obtenerPool, llamadas } = poolFalso([], new Error("connection refused"));
    const avisosConsola: unknown[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => { avisosConsola.push(a); };
    try {
      const r = await buscarEnTaller({ texto: palabra }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool, memoria: memoriaFalsa });
      assert.equal(llamadas.length, 1);
      assert.equal(r.fuente, "memoria", "la base falló: respaldo");
      assert.deepEqual(r.ids, [real.id]);
      assert.ok(r.avisos.some((a) => /no respondió/.test(a)));
      assert.ok(!JSON.stringify(r).includes("connection refused"), "el error crudo no sale en la respuesta");
      assert.equal(avisosConsola.length, 1);
    } finally {
      console.warn = warn;
    }
    const sinPool = await buscarEnTaller({ texto: palabra }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: () => { throw new Error("DATABASE_URL no está configurada"); }, memoria: memoriaFalsa });
    assert.equal(sinPool.fuente, "memoria");
    ok("la base falla (consulta o pool): memoria con aviso, sin filtrar el error");
  }
  {
    const r = await buscarEnTaller({ texto: palabra, limite: 3 }, { habilitado: false });
    assert.equal(r.fuente, "memoria");
    assert.ok(r.resultados.length <= 3);
    for (const x of r.resultados) assert.ok(x.puntaje > 0 && x.puntaje < 1 / RRF_K + 1e-9);
    assert.deepEqual(Object.keys(r).sort(), FORMA_RAIZ);
    const filtrada = await buscarEnTaller({ filtros: { fuente: ["no-existe"] } }, { habilitado: false, memoria: memoriaFalsa });
    assert.deepEqual(filtrada.ids, [], "la fuente sí se filtra en memoria");
    const entrada = await buscarEnTaller({ vectorTexto: [1, 2] }, { habilitado: false });
    assert.equal(entrada.fuente, "memoria", "apagada, ni siquiera se valida el vector");
    await assert.rejects(buscarEnTaller({ vectorTexto: [1, 2] }, { habilitado: true, embeberConsulta: sinEmbedding, obtenerPool: poolFalso([]).obtenerPool }), /768/, "encendida, un vector malo es error de quien llama (no cae a memoria)");
    ok("memoria real (biblioteca de fábrica): límite, puntajes, filtro de fuente y vector inválido");
  }

  {
    // Encendida y sin vector: se pide el embedding de la consulta y entra la rama vectorial de texto; si falla, solo léxica.
    const conVector = poolFalso([FILA]);
    const pedidos: string[] = [];
    const r = await buscarEnTaller({ texto: "columna dorada" }, { habilitado: true, obtenerPool: conVector.obtenerPool, embeberConsulta: async (t) => { pedidos.push(t); return Array.from({ length: 768 }, () => 0.01); } });
    assert.deepEqual(pedidos, ["columna dorada"]);
    assert.ok(r.ramas.includes("vector_texto"), `ramas: ${r.ramas.join(",")}`);
    const sinVector = await buscarEnTaller({ texto: "columna dorada" }, { habilitado: true, obtenerPool: poolFalso([FILA]).obtenerPool, embeberConsulta: async () => { throw new Error("gemini caído"); } });
    assert.equal(sinVector.fuente, "rag");
    assert.ok(!sinVector.ramas.includes("vector_texto"));
    ok("embedding de la consulta: entra la rama vectorial; si Gemini falla, sigue léxica en la base");
  }

  console.log(`\n${casos} casos ok`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
