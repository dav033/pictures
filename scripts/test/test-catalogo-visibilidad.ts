/**
 * La visibilidad de los repositorios por superficie (REQ-013 fases 2 y 4, SPEC §7): la fila `catalogo_repos_<superficie>` de
 * `ajustes_runtime`, si no está `CATALOGO_REPOS_<SUPERFICIE>` y, si no, el `visiblePorDefecto` de cada manifiesto (también el de un
 * paquete `terceros/<slug>` cuando exista). El RAG ve solo Sempertex por defecto (las filas de mobiliario y escenografía de la fase 3
 * quedan invisibles). La guiada y el estudio, del cliente, nunca ven un repositorio sin precio salvo permiso explícito del dueño.
 * Sin coste, sin base.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-visibilidad.ts
 */
import assert from "node:assert/strict";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { catalogoPara, claveAjusteDeSuperficie, crearLectorVisibilidad, reposPorDefecto, reposVisibles, variableDeSuperficie } from "../../src/lib/catalogo/visibilidad";
import type { IdRepositorio, ManifiestoRepositorio, Superficie } from "../../src/lib/catalogo/tipos";

let pruebas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

async function conAvisos<T>(fn: () => T | Promise<T>): Promise<{ valor: T; avisos: string[]; errores: string[] }> {
  const avisos: string[] = [];
  const errores: string[] = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
  try {
    return { valor: await fn(), avisos, errores };
  } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

const SIN_ENTORNO = {};
const TODOS = "sempertex,mobiliario,escenografia";
const SUPERFICIES: Superficie[] = ["taller", "ia_taller", "foto", "rag", "estudio", "guiada"];

async function main(): Promise<void> {
  await prueba("por defecto, la tabla del SPEC §7 (de los manifiestos): el RAG, la guiada y el estudio solo ven Sempertex", () => {
    const esperado: Record<Superficie, string[]> = {
      taller: ["sempertex", "mobiliario", "escenografia"],
      ia_taller: ["sempertex", "mobiliario", "escenografia"],
      foto: ["sempertex", "mobiliario", "escenografia"],
      rag: ["sempertex"],
      estudio: ["sempertex"],
      guiada: ["sempertex"],
    };
    for (const [superficie, repos] of Object.entries(esperado) as Array<[Superficie, string[]]>) {
      assert.deepEqual(reposVisibles(superficie, SIN_ENTORNO), repos, superficie);
      assert.deepEqual(reposPorDefecto(superficie), repos, superficie);
    }
  });

  await prueba("la política sale de los manifiestos, también los de terceros", () => {
    const acme: ManifiestoRepositorio = { ...MANIFIESTOS.mobiliario, id: "terceros/acme", visiblePorDefecto: ["taller", "rag"] };
    const conAcme = [...Object.values(MANIFIESTOS), acme];
    assert.deepEqual(reposVisibles("rag", SIN_ENTORNO, conAcme), ["sempertex", "terceros/acme"], "su visiblePorDefecto cuenta");
    assert.deepEqual(reposVisibles("guiada", SIN_ENTORNO, conAcme), ["sempertex"]);
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "terceros/acme" }, conAcme), ["terceros/acme"], "con manifiesto, la variable lo acepta");
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "terceros/acme" }), ["sempertex"], "sin manifiesto (paquete no cargado) no existe");
  });

  await prueba("la variable de entorno manda: orden de los manifiestos, sin repetir, con espacios", () => {
    assert.equal(variableDeSuperficie("ia_taller"), "CATALOGO_REPOS_IA_TALLER");
    assert.equal(claveAjusteDeSuperficie("ia_taller"), "catalogo_repos_ia_taller");
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: " mobiliario , sempertex,mobiliario " }), ["sempertex", "mobiliario"]);
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "escenografia" }), ["escenografia"]);
    assert.deepEqual(reposVisibles("taller", { CATALOGO_REPOS_TALLER: "sempertex" }), ["sempertex"]);
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_TALLER: "mobiliario" }), ["sempertex"], "cada superficie lee solo su variable");
  });

  await prueba("la fila de ajustes_runtime manda sobre la variable y esta sobre el manifiesto", () => {
    assert.deepEqual(reposVisibles("rag", SIN_ENTORNO, undefined, "mobiliario,sempertex"), ["sempertex", "mobiliario"]);
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "escenografia" }, undefined, "mobiliario"), ["mobiliario"], "la fila gana a la variable");
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "escenografia" }, undefined, null), ["escenografia"], "sin fila, la variable");
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "escenografia" }, undefined, "  "), ["escenografia"], "fila vacía = sin fila");
  });

  await prueba("un id desconocido invalida la lista ENTERA (un error en el log, una vez) y vale el nivel siguiente: nunca una lista a medias", async () => {
    const { valor, avisos, errores } = await conAvisos(() => [
      reposVisibles("rag", { CATALOGO_REPOS_RAG: "sempertex,muebles" }),
      reposVisibles("rag", { CATALOGO_REPOS_RAG: "sempertex,muebles" }),
    ]);
    assert.deepEqual(valor, [["sempertex"], ["sempertex"]]);
    assert.deepEqual(avisos, []);
    assert.equal(errores.length, 1, errores.join("\n"));
    assert.match(errores[0]!, /\[catalogo\] CATALOGO_REPOS_RAG = «sempertex,muebles» se IGNORA ENTERA: «muebles» no es un repositorio conocido/);

    const errata = await conAvisos(() => reposVisibles("guiada", { CATALOGO_REPOS_GUIADA: "sempertx" }));
    assert.deepEqual(errata.valor, ["sempertex"], "una errata no vacía ni abre la superficie");
    assert.ok(errata.errores.some((a) => /«sempertx» no es un repositorio conocido/.test(a)), errata.errores.join("\n"));
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "  " }), ["sempertex"], "vacía = sin configurar");
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: ",," }), ["sempertex"]);

    const fila = await conAvisos(() => reposVisibles("rag", { CATALOGO_REPOS_RAG: "mobiliario" }, undefined, "mobliario"));
    assert.deepEqual(fila.valor, ["mobiliario"], "una fila con errata no tapa la variable: se pasa al siguiente nivel");
    assert.ok(fila.errores.some((a) => /catalogo_repos_rag \(ajustes_runtime\) = «mobliario»/.test(a)), fila.errores.join("\n"));
  });

  await prueba("una errata en parte de la lista no deja caer Sempertex: «sempertx,mobiliario,escenografia» (fila o variable) vale el nivel siguiente", async () => {
    const TODOS_CON_ERRATA = "sempertx,mobiliario,escenografia";
    const { valor, errores } = await conAvisos(() => ({
      soloFila: reposVisibles("rag", SIN_ENTORNO, undefined, TODOS_CON_ERRATA),
      filaYVariable: reposVisibles("rag", { CATALOGO_REPOS_RAG: "sempertex,mobiliario" }, undefined, TODOS_CON_ERRATA),
      soloVariable: reposVisibles("rag", { CATALOGO_REPOS_RAG: TODOS_CON_ERRATA }),
      taller: reposVisibles("taller", { CATALOGO_REPOS_TALLER: "mobiliario,escenografa" }),
    }));
    assert.deepEqual(valor.soloFila, ["sempertex"], "fila mala y sin variable: el manifiesto, que incluye Sempertex");
    assert.deepEqual(valor.filaYVariable, ["sempertex", "mobiliario"], "fila mala: vale la variable");
    assert.deepEqual(valor.soloVariable, ["sempertex"]);
    assert.deepEqual(valor.taller, ["sempertex", "mobiliario", "escenografia"], "tampoco queda «mobiliario» a secas");
    assert.equal(errores.length, 3, errores.join("\n"));
    assert.ok(errores.every((e) => /se IGNORA ENTERA/.test(e)));
  });

  await prueba("los ids valen en mayúsculas y con espacios: «Sempertex,mobiliario» y «SEMPERTEX, Mobiliario» son válidos y no avisan", async () => {
    const { valor, avisos, errores } = await conAvisos(() => ({
      capitalizada: reposVisibles("rag", SIN_ENTORNO, undefined, "Sempertex,mobiliario"),
      mayusculas: reposVisibles("rag", { CATALOGO_REPOS_RAG: "SEMPERTEX, Mobiliario" }),
      enLaFila: reposVisibles("rag", SIN_ENTORNO, undefined, " ESCENOGRAFIA , SempERtex "),
    }));
    assert.deepEqual(valor.capitalizada, ["sempertex", "mobiliario"]);
    assert.deepEqual(valor.mayusculas, ["sempertex", "mobiliario"]);
    assert.deepEqual(valor.enLaFila, ["sempertex", "escenografia"]);
    assert.deepEqual([...avisos, ...errores], []);
  });

  await prueba("sin entorno explícito lee process.env en cada llamada (cambia sin reiniciar)", () => {
    const antes = process.env.CATALOGO_REPOS_RAG;
    try {
      delete process.env.CATALOGO_REPOS_RAG;
      assert.deepEqual(reposVisibles("rag"), ["sempertex"]);
      process.env.CATALOGO_REPOS_RAG = "sempertex,escenografia";
      assert.deepEqual(reposVisibles("rag"), ["sempertex", "escenografia"]);
    } finally {
      if (antes === undefined) delete process.env.CATALOGO_REPOS_RAG;
      else process.env.CATALOGO_REPOS_RAG = antes;
    }
  });

  await prueba("la guiada y el estudio no ven un repositorio sin precio, venga la lista de la fila, de la variable o del manifiesto", async () => {
    for (const superficie of ["guiada", "estudio"] as const) {
      const variable = variableDeSuperficie(superficie);
      const { valor, avisos } = await conAvisos(() => ({
        porVariable: reposVisibles(superficie, { [variable]: TODOS }),
        porFila: reposVisibles(superficie, SIN_ENTORNO, undefined, TODOS),
        soloSinPrecio: reposVisibles(superficie, { [variable]: "mobiliario" }),
        filaSinPrecio: reposVisibles(superficie, SIN_ENTORNO, undefined, "escenografia,mobiliario"),
      }));
      assert.deepEqual(valor.porVariable, ["sempertex"], superficie);
      assert.deepEqual(valor.porFila, ["sempertex"], superficie);
      assert.deepEqual(valor.soloSinPrecio, ["sempertex"], `${superficie}: si no queda ninguno cotizable, el de por defecto`);
      assert.deepEqual(valor.filaSinPrecio, ["sempertex"], superficie);
      assert.ok(avisos.some((a) => /se descartan los repositorios sin precio/.test(a)), avisos.join("\n"));
    }
    const manifiestoDeMobiliarioConPrecio: ManifiestoRepositorio = { ...MANIFIESTOS.mobiliario, precio: { tipo: "lista-alquiler", archivo: "x.json", moneda: "COP", vigencia: "2026-10" } };
    const conLista = [MANIFIESTOS.sempertex, manifiestoDeMobiliarioConPrecio, MANIFIESTOS.escenografia];
    assert.deepEqual(reposVisibles("guiada", { CATALOGO_REPOS_GUIADA: TODOS }, conLista), ["sempertex", "mobiliario"], "con lista de alquiler sí se cotiza");
  });

  await prueba("CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE (apagada por defecto) deja ver lo que no se cotiza; las demás superficies no dependen de ella", () => {
    for (const valor of ["true", "1", "on", "TRUE"]) {
      assert.deepEqual(reposVisibles("guiada", { CATALOGO_REPOS_GUIADA: TODOS, CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: valor }), ["sempertex", "mobiliario", "escenografia"], valor);
    }
    for (const valor of ["false", "0", "", "si"]) {
      assert.deepEqual(reposVisibles("estudio", { CATALOGO_REPOS_ESTUDIO: TODOS, CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: valor }), ["sempertex"], `«${valor}» no la enciende`);
    }
    assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: TODOS }), ["sempertex", "mobiliario", "escenografia"], "el RAG no es del cliente");
    assert.deepEqual(reposVisibles("taller", SIN_ENTORNO), ["sempertex", "mobiliario", "escenografia"]);
  });

  await prueba("el lector con base: la fila de la superficie (su clave), el caché de 30 s, y con Neon caído o sin fila decide la variable", async () => {
    const reloj = { ms: 1_000 };
    const filas = new Map<string, string | null>([["catalogo_repos_rag", "sempertex,mobiliario"]]);
    const lecturas: string[] = [];
    let falla = false;
    let entorno: Record<string, string | undefined> = {};
    const leer = crearLectorVisibilidad({
      leerFila: async (clave) => { lecturas.push(clave); if (falla) throw new Error("Neon caído"); return filas.get(clave) ?? null; },
      entorno: () => entorno,
      ahora: () => reloj.ms,
    });

    assert.deepEqual(await leer("rag"), ["sempertex", "mobiliario"]);
    assert.deepEqual(await leer("ia_taller"), ["sempertex", "mobiliario", "escenografia"], "sin fila: el manifiesto");
    assert.deepEqual(lecturas, ["catalogo_repos_rag", "catalogo_repos_ia_taller"], "cada superficie lee su fila");

    filas.set("catalogo_repos_rag", "escenografia");
    assert.deepEqual(await leer("rag"), ["sempertex", "mobiliario"], "dentro de los 30 s no se vuelve a leer");
    assert.equal(lecturas.length, 2);
    reloj.ms += 30_000;
    assert.deepEqual(await leer("rag"), ["escenografia"], "vencido el caché se lee otra vez");

    falla = true;
    reloj.ms += 30_000;
    assert.deepEqual(await leer("rag"), ["escenografia"], "Neon caído: la última lectura buena");
    assert.deepEqual(await leer("taller"), ["sempertex", "mobiliario", "escenografia"], "sin lectura buena previa: el manifiesto");
    entorno = { CATALOGO_REPOS_TALLER: "sempertex" };
    reloj.ms += 30_000;
    assert.deepEqual(await leer("taller"), ["sempertex"], "sin lectura buena previa: la variable");

    falla = false;
    filas.clear();
    reloj.ms += 30_000;
    assert.deepEqual(await leer("rag"), ["sempertex"], "fila borrada: vuelve a hoy en 30 s");
  });

  await prueba("Neon lento: la visibilidad no espera más del plazo (sigue la variable o el manifiesto) y la fila llega para las siguientes", async () => {
    const reloj = { ms: 1_000 };
    let terminar: (valor: string | null) => void = () => undefined;
    let lecturas = 0;
    const leer = crearLectorVisibilidad({
      leerFila: () => { lecturas += 1; return new Promise<string | null>((resolver) => { terminar = resolver; }); },
      entorno: () => ({}),
      ahora: () => reloj.ms,
      plazoMs: 25,
    });
    const { valor, avisos } = await conAvisos(async () => {
      const inicio = Date.now();
      const repos = await leer("rag");
      return { repos, esperoMs: Date.now() - inicio };
    });
    assert.deepEqual(valor.repos, ["sempertex"], "sin lectura buena previa: la política por defecto");
    assert.ok(valor.esperoMs < 1_000, "esperó " + valor.esperoMs + " ms");
    assert.ok(avisos.some((a) => a.includes("catalogo_repos_rag tardó más de 25 ms")), avisos.join(" | "));
    assert.deepEqual(await leer("rag"), ["sempertex"], "dentro del caché no se espera de nuevo");
    assert.equal(lecturas, 1);

    terminar("sempertex,mobiliario,escenografia");
    await new Promise<void>((resolver) => setImmediate(resolver));
    assert.deepEqual(await leer("rag"), ["sempertex", "mobiliario", "escenografia"], "la lectura tardía dejó su valor");
    assert.equal(lecturas, 1);
  });

  await prueba("catalogoPara: lo que la superficie permite (ids cortos y calificados) y falla cerrado con lo desconocido", async () => {
    const guiada = await catalogoPara("guiada", async () => ["sempertex"]);
    assert.deepEqual(guiada.repositorios, ["sempertex"]);
    assert.ok(guiada.permite("sempertex") && !guiada.permite("mobiliario"));
    assert.ok(guiada.permiteId("idea:arco-organico-rosa") && guiada.permiteId("sempertex:idea:arco-organico-rosa"), "lo reclama Sempertex por su prefijo");
    assert.ok(!guiada.permiteId("silla_tiffany") && !guiada.permiteId("mobiliario:silla_tiffany"), "los muebles no");

    const ia = await catalogoPara("ia_taller", async () => ["mobiliario", "escenografia"] as IdRepositorio[]);
    assert.ok(ia.permiteId("silla_tiffany") && ia.permiteId("mobiliario:silla_tiffany") && ia.permiteId("escenografia:panel_redondo"));
    assert.ok(!ia.permiteId("sempertex:idea:x") && !ia.permiteId("idea:x"), "Sempertex no está");
    assert.ok(!ia.permiteId("escenografia:silla_tiffany"), "calificado con otro repositorio: no");
    assert.ok(!ia.permiteId("") && !ia.permiteId("no_existe"));

    const entradas = await ia.entradas();
    assert.equal(entradas.length, 28 + 25);
    assert.ok(entradas.every((e) => ia.permite(e.repositorio)));
    const soloEscenografia = await (await catalogoPara("foto", async () => ["escenografia"])).entradas();
    assert.equal(soloEscenografia.length, 25);

    for (const s of SUPERFICIES) assert.deepEqual((await catalogoPara(s, async (x) => reposVisibles(x, SIN_ENTORNO))).repositorios, reposPorDefecto(s), s);
  });

  console.log(`test-catalogo-visibilidad: ${pruebas} pruebas ok`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
