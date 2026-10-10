/**
 * La visibilidad de los repositorios por superficie (REQ-013 fase 2, SPEC §7): `CATALOGO_REPOS_<SUPERFICIE>` y, si no está, el
 * `visiblePorDefecto` de cada manifiesto (también el de un paquete `terceros/<slug>` cuando exista). El RAG ve solo Sempertex por
 * defecto (las filas de mobiliario y escenografía de la fase 3 quedan invisibles). Sin coste, sin base.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-visibilidad.ts
 */
import assert from "node:assert/strict";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { reposPorDefecto, reposVisibles, variableDeSuperficie } from "../../src/lib/catalogo/visibilidad";
import type { ManifiestoRepositorio, Superficie } from "../../src/lib/catalogo/tipos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

function conAvisos<T>(fn: () => T): { valor: T; avisos: string[] } {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  try {
    return { valor: fn(), avisos };
  } finally {
    console.warn = original;
  }
}

const SIN_ENTORNO = {};

prueba("por defecto, la tabla del SPEC §7 (de los manifiestos): el RAG, la guiada y el estudio solo ven Sempertex", () => {
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

prueba("la política sale de los manifiestos, también los de terceros", () => {
  const acme: ManifiestoRepositorio = { ...MANIFIESTOS.mobiliario, id: "terceros/acme", visiblePorDefecto: ["taller", "rag"] };
  const conAcme = [...Object.values(MANIFIESTOS), acme];
  assert.deepEqual(reposVisibles("rag", SIN_ENTORNO, conAcme), ["sempertex", "terceros/acme"], "su visiblePorDefecto cuenta");
  assert.deepEqual(reposVisibles("guiada", SIN_ENTORNO, conAcme), ["sempertex"]);
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "terceros/acme" }, conAcme), ["terceros/acme"], "con manifiesto, la variable lo acepta");
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "terceros/acme" }), ["sempertex"], "sin manifiesto (paquete no cargado) no existe");
});

prueba("la variable de entorno manda: orden de los manifiestos, sin repetir, con espacios", () => {
  assert.equal(variableDeSuperficie("ia_taller"), "CATALOGO_REPOS_IA_TALLER");
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: " mobiliario , sempertex,mobiliario " }), ["sempertex", "mobiliario"]);
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "escenografia" }), ["escenografia"]);
  assert.deepEqual(reposVisibles("taller", { CATALOGO_REPOS_TALLER: "sempertex" }), ["sempertex"]);
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_TALLER: "mobiliario" }), ["sempertex"], "cada superficie lee solo su variable");
});

prueba("ids desconocidos: se ignoran con un aviso (una vez); si no queda ninguno, la política por defecto", () => {
  const { valor, avisos } = conAvisos(() => [
    reposVisibles("rag", { CATALOGO_REPOS_RAG: "sempertex,muebles" }),
    reposVisibles("rag", { CATALOGO_REPOS_RAG: "sempertex,muebles" }),
  ]);
  assert.deepEqual(valor, [["sempertex"], ["sempertex"]]);
  assert.equal(avisos.length, 1, avisos.join("\n"));
  assert.match(avisos[0]!, /CATALOGO_REPOS_RAG: se ignoran repositorios sin manifiesto \(muebles\)/);

  const errata = conAvisos(() => reposVisibles("guiada", { CATALOGO_REPOS_GUIADA: "sempertx" }));
  assert.deepEqual(errata.valor, ["sempertex"], "una errata no vacía ni abre la superficie");
  assert.ok(errata.avisos.some((a) => /no nombra ningún repositorio conocido/.test(a)), errata.avisos.join("\n"));
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: "  " }), ["sempertex"], "vacía = sin configurar");
  assert.deepEqual(reposVisibles("rag", { CATALOGO_REPOS_RAG: ",," }), ["sempertex"]);
});

prueba("sin entorno explícito lee process.env en cada llamada (cambia sin reiniciar)", () => {
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

console.log(`test-catalogo-visibilidad: ${pruebas} pruebas ok`);
