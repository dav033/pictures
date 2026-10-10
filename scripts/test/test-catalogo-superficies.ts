/**
 * Las superficies del catálogo (REQ-013 fase 4, AC-9): lo que el cliente nunca ve y lo que la IA del taller sí puede pedir. Sin coste ni
 * red: la búsqueda es falsa y el «modelo» es un guion.
 * - el producto guiado (los 46 casos dorados del motor) arma solo estructuras de globos: ninguna pieza que no sea de Sempertex;
 * - la guiada y el estudio ven solo Sempertex pase lo que pase con la fila, la variable o la lista: lo que no se cotiza solo con el
 *   permiso del dueño; y su catálogo no trae ni una entrada de otro repositorio;
 * - con las banderas apagadas la IA del taller declara lo de siempre, byte a byte, y sus búsquedas no se acotan;
 * - frases del dueño con un modelo falso: «busca sillas tiffany» con el filtro `mobiliario` devuelve solo muebles y se puede poner la
 *   silla; «arco orgánico dorado» con `sempertex` no trae el arco metálico de la escenografía.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-superficies.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ASIGNACION_FONDOS } from "../../src/lib/catalogo/asignacion-fondos";
import { declaracionesIA, politicaDe, politicaIA, type PoliticaIA } from "../../src/lib/catalogo/herramientas-ia";
import { aplicarHerramientaIA } from "../../src/lib/catalogo/herramientas-ia-aplicar";
import { repositorioDeIdLocal } from "../../src/lib/catalogo/indice";
import type { IdRepositorio } from "../../src/lib/catalogo/tipos";
import { catalogoPara, crearLectorVisibilidad, reposVisibles, variableDeSuperficie } from "../../src/lib/catalogo/visibilidad";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { DECLARACIONES_ESCENA } from "../../src/lib/globos3d/herramientas-escena";
import { armarDesdeEspec } from "../../src/lib/globos3d/motor/v1";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import type { EntradaBusqueda, RespuestaBusquedaTaller, ResultadoTaller } from "../../src/lib/taller/buscar";
import { todosLosCasos } from "../lib/casos-motor-guiada";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const TODOS: IdRepositorio[] = ["sempertex", "mobiliario", "escenografia"];
const CLIENTE = ["guiada", "estudio"] as const;

async function conEntorno<T>(valores: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(valores).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(valores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ----------------------------------------------------------------------------------------------------------
// Una búsqueda falsa con las reglas de la real: filtro duro por repositorio y palabras en el nombre
// ----------------------------------------------------------------------------------------------------------

function fila(id: string, repositorio: IdRepositorio, nombre: string): ResultadoTaller {
  return {
    id, tipo: repositorio === "sempertex" ? "estructura" : "mueble", nombre, descripcion: "", origen: { tipo: null, titulo: null, url: null, foto: null },
    ocasiones: [], celebraciones: [], tematicas: [], tiposPieza: [], formatos: [], colores: [], partes: [], productos: [],
    medidas: { altoCm: null, anchoCm: null, fondoCm: null }, globos: 0, tubos: 0, propietario: null, repositorio, puntaje: 0.03,
    ramas: { fts: null, trigram: null, vector_texto: null, vector_imagen: null }, razones: ["Las palabras de la consulta están en su nombre"],
  };
}
const FILAS: ResultadoTaller[] = [
  fila("idea:arco-organico-dorado", "sempertex", "Arco orgánico dorado"),
  fila("idea:sillas-con-globos", "sempertex", "Sillas tiffany decoradas con globos"),
  fila("silla_tiffany", "mobiliario", "Silla Tiffany"),
  fila("sofa", "mobiliario", "Sofá de tres cuerpos"),
  fila("arco_metalico", "escenografia", "Arco metálico dorado"),
  fila("panel_redondo", "escenografia", "Panel redondo"),
];
const plano = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const raiz = (p: string) => p.replace(/s$/, "");

/** El RAG de verdad filtra por `repositorio = ANY(visibles ∩ pedidos)`: aquí, lo mismo sobre la lista. */
function ragFalso(visibles: readonly IdRepositorio[]): { buscar: (e: EntradaBusqueda) => Promise<RespuestaBusquedaTaller>; pedidos: EntradaBusqueda[] } {
  const pedidos: EntradaBusqueda[] = [];
  return {
    pedidos,
    buscar: async (entrada) => {
      pedidos.push(entrada);
      const pedidosRepos = entrada.filtros?.repositorios;
      const permitidos = visibles.filter((id) => !pedidosRepos || pedidosRepos.includes(id));
      const palabras = plano(entrada.texto ?? "").split(/\s+/).filter(Boolean).map(raiz);
      const resultados = FILAS.filter((f) => permitidos.includes(f.repositorio) && palabras.every((p) => plano(f.nombre).includes(p)));
      return { fuente: "rag", resultados, ids: resultados.map((r) => r.id), ramas: ["fts"], interpretacion: null, avisos: [] };
    },
  };
}

/** Un modelo de guion: lee las declaraciones que recibió y pide el repositorio solo si la herramienta lo declara. */
function modeloFalso(politica: PoliticaIA, texto: string, repositorio: IdRepositorio) {
  const declarada = declaracionesIA(DECLARACIONES_ESCENA, politica).find((d) => d.name === "buscar_en_biblioteca")!;
  const conRepositorio = "repositorio" in ((declarada.parametersJsonSchema.properties ?? {}) as Record<string, unknown>);
  return { texto, ...(conRepositorio ? { repositorio } : {}) };
}

const idsDe = (resumen: string) => [...resumen.matchAll(/^- (\S+) ·/gm)].map((m) => m[1]!);

async function main(): Promise<void> {
  await prueba("los 46 casos dorados de la guiada arman solo estructuras de globos: ninguna pieza de mobiliario ni de escenografía", () => {
    const casos = todosLosCasos();
    assert.equal(casos.length, 28 + 18);
    for (const caso of casos) {
      const piezasEspec = new Set(caso.espec.piezas.map((p) => p.id));
      const { armada } = armarDesdeEspec(caso.espec);
      const ajenas = armada.piezas.map((p) => p.id).filter((id) => !piezasEspec.has(id));
      assert.deepEqual(ajenas, [], `${caso.id}: el motor sacó piezas que la espec no pidió`);
      for (const pieza of caso.espec.piezas) {
        assert.ok((ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(pieza.oficial), `${caso.id}/${pieza.id}`);
        assert.equal(ASIGNACION_FONDOS.get(pieza.oficial), undefined, `${caso.id}: «${pieza.oficial}» es del catálogo de muebles`);
        assert.notEqual(repositorioDeIdLocal(pieza.oficial), "mobiliario");
        assert.notEqual(repositorioDeIdLocal(pieza.oficial), "escenografia");
      }
    }
  });

  await prueba("la guiada y el estudio ven solo Sempertex: con la lista abierta en la variable, en la fila y en los dos, y con el RAG abierto", async () => {
    for (const superficie of CLIENTE) {
      const variable = variableDeSuperficie(superficie);
      const abierta = TODOS.join(",");
      assert.deepEqual(reposVisibles(superficie, { [variable]: abierta }), ["sempertex"], `${superficie}: variable`);
      assert.deepEqual(reposVisibles(superficie, {}, undefined, abierta), ["sempertex"], `${superficie}: fila`);
      assert.deepEqual(reposVisibles(superficie, { [variable]: "mobiliario" }, undefined, "escenografia"), ["sempertex"], `${superficie}: solo sin precio`);
      const lector = crearLectorVisibilidad({ leerFila: async () => abierta, entorno: () => ({ [variable]: abierta, CATALOGO_REPOS_RAG: abierta }) });
      assert.deepEqual(await lector(superficie), ["sempertex"], `${superficie}: el lector con base`);
    }
    await conEntorno({ CATALOGO_REPOS_RAG: TODOS.join(","), CATALOGO_REPOS_GUIADA: TODOS.join(","), CATALOGO_REPOS_ESTUDIO: TODOS.join(","), CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: undefined }, async () => {
      assert.deepEqual(reposVisibles("rag"), TODOS);
      assert.deepEqual(reposVisibles("guiada"), ["sempertex"]);
      assert.deepEqual(reposVisibles("estudio"), ["sempertex"]);
    });
  });

  await prueba("lo que el cliente no puede cotizar solo se abre con el permiso explícito del dueño", async () => {
    for (const superficie of CLIENTE) {
      const variable = variableDeSuperficie(superficie);
      for (const permiso of ["true", "1", "on"]) assert.deepEqual(reposVisibles(superficie, { [variable]: TODOS.join(","), CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: permiso }), TODOS, `${superficie} ${permiso}`);
      for (const permiso of [undefined, "", "false", "0", "no", "si"]) assert.deepEqual(reposVisibles(superficie, { [variable]: TODOS.join(","), CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE: permiso }), ["sempertex"], `${superficie} «${permiso}»`);
    }
  });

  await prueba("el catálogo de la guiada y del estudio no trae ni una entrada de otro repositorio, y no deja pasar un mueble por su id", async () => {
    for (const superficie of CLIENTE) {
      const catalogo = await catalogoPara(superficie, async (s) => reposVisibles(s, { [variableDeSuperficie(s)]: TODOS.join(",") }));
      assert.deepEqual(catalogo.repositorios, ["sempertex"]);
      const entradas = await catalogo.entradas();
      assert.ok(entradas.length > 500, `${superficie}: ${entradas.length} entradas`);
      assert.deepEqual([...new Set(entradas.map((e) => e.repositorio))], ["sempertex"]);
      for (const id of ["silla_tiffany", "mobiliario:silla_tiffany", "panel_redondo", "escenografia:panel_redondo", "mesa_param"]) assert.equal(catalogo.permiteId(id), false, `${superficie}: ${id}`);
      assert.equal(catalogo.permiteId("idea:arco-organico-rosa-dorado"), true);
    }
  });

  await prueba("con las banderas apagadas la IA del taller declara lo de siempre (la misma lista) y su búsqueda no se acota", async () => {
    await conEntorno({ CATALOGO_FILTRO_IA: undefined, CATALOGO_REPOS_RAG: undefined, CATALOGO_REPOS_IA_TALLER: undefined }, async () => {
      const politica = await politicaIA();
      assert.equal(politica.filtro, false);
      assert.equal(declaracionesIA(DECLARACIONES_ESCENA, politica), DECLARACIONES_ESCENA);
      const rag = ragFalso(politica.busqueda);
      const modelo = modeloFalso(politica, "sillas tiffany", "mobiliario");
      assert.equal("repositorio" in modelo, false, "el modelo no ve el parámetro: no lo pide");
      const h = await aplicarHerramientaIA(escenaPredefinida("arco_organico_columnas_guirnalda"), "buscar_en_biblioteca", modelo, politica, { buscar: rag.buscar, habilitado: true });
      assert.ok(h.resultado.ok);
      assert.equal(rag.pedidos[0]!.filtros?.repositorios, undefined);
      assert.deepEqual(idsDe(h.resultado.ok ? h.resultado.resumen : ""), ["idea:sillas-con-globos"], "el RAG solo ve Sempertex: la silla no aparece");
    });
  });

  const escena = escenaPredefinida("arco_organico_columnas_guirnalda");
  const abierta = politicaDe({ filtro: true, ia: TODOS, rag: TODOS });

  await prueba("«busca sillas tiffany» con el filtro mobiliario devuelve solo muebles; sin filtro, también lo de Sempertex; y la silla se pone", async () => {
    const rag = ragFalso(abierta.busqueda);
    const deps = { buscar: rag.buscar, habilitado: true };
    const modelo = modeloFalso(abierta, "sillas tiffany", "mobiliario");
    assert.equal(modelo.repositorio, "mobiliario", "con la bandera, el modelo ve el parámetro");
    const filtrada = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", modelo, abierta, deps);
    assert.ok(filtrada.resultado.ok);
    const ids = idsDe(filtrada.resultado.ok ? filtrada.resultado.resumen : "");
    assert.deepEqual(ids, ["silla_tiffany"]);
    assert.ok(ids.every((id) => ASIGNACION_FONDOS.get(id) === "mobiliario"));
    assert.deepEqual(rag.pedidos[0]!.filtros?.repositorios, ["mobiliario"]);

    const sinFiltro = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "sillas tiffany" }, abierta, deps);
    assert.deepEqual(idsDe(sinFiltro.resultado.ok ? sinFiltro.resultado.resumen : "").sort(), ["idea:sillas-con-globos", "silla_tiffany"]);

    const puesta = await aplicarHerramientaIA(escena, "insertar_de_biblioteca", { id: ids[0]!, donde: { en: "piso", x_cm: -80, z_cm: 60 } }, abierta, deps);
    assert.ok(puesta.resultado.ok, JSON.stringify(puesta.resultado));
    const silla = puesta.resultado.escena.nodos.at(-1)!;
    assert.equal(silla.pieza.tipo === "escenografia" ? silla.pieza.mueble?.id : null, "silla_tiffany");
    assert.equal(puesta.resultado.escena.nodos.length, escena.nodos.length + 1);
  });

  await prueba("«arco orgánico dorado» con el filtro sempertex trae el arco de globos y no el arco metálico de la escenografía", async () => {
    const rag = ragFalso(abierta.busqueda);
    const deps = { buscar: rag.buscar, habilitado: true };
    const filtrada = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", modeloFalso(abierta, "arco dorado", "sempertex"), abierta, deps);
    assert.deepEqual(idsDe(filtrada.resultado.ok ? filtrada.resultado.resumen : ""), ["idea:arco-organico-dorado"]);
    const todos = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "arco dorado" }, abierta, deps);
    assert.deepEqual(idsDe(todos.resultado.ok ? todos.resultado.resumen : "").sort(), ["arco_metalico", "idea:arco-organico-dorado"]);
    const escenografia = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "arco dorado", repositorio: "escenografia" }, abierta, deps);
    assert.deepEqual(idsDe(escenografia.resultado.ok ? escenografia.resultado.resumen : ""), ["arco_metalico"]);
  });

  await prueba("con el RAG de Sempertex solo, pedir mobiliario no abre nada: el error lo dice y no se busca", async () => {
    const solo = politicaDe({ filtro: true, ia: TODOS, rag: ["sempertex"] });
    const rag = ragFalso(solo.busqueda);
    const h = await aplicarHerramientaIA(escena, "buscar_en_biblioteca", { texto: "sillas tiffany", repositorio: "mobiliario" }, solo, { buscar: rag.buscar, habilitado: true });
    assert.ok(!h.resultado.ok && /Los de esta búsqueda: sempertex\./.test(h.resultado.error));
    assert.equal(rag.pedidos.length, 0);
  });

  await prueba("las declaraciones no pueden dejar a la IA sin sus herramientas de siempre al quitar un repositorio", () => {
    const sinNada = declaracionesIA(DECLARACIONES_ESCENA, politicaDe({ filtro: false, ia: ["sempertex"], rag: ["sempertex"] }));
    const sha = (d: readonly unknown[]) => createHash("sha256").update(JSON.stringify(d)).digest("hex");
    const conservadas = sinNada.map((d) => d.name);
    assert.deepEqual(conservadas, DECLARACIONES_ESCENA.map((d) => d.name).filter((n) => !["agregar_mobiliario", "agregar_mesas", "cambiar_sillas", "cambiar_mesas"].includes(n)));
    const comunes = DECLARACIONES_ESCENA.filter((d) => conservadas.includes(d.name));
    assert.equal(sha(sinNada), sha(comunes), "las demás, sin tocar");
  });

  console.log(`test-catalogo-superficies: ${pruebas} pruebas ok`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
