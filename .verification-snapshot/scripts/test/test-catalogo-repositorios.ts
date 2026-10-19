/**
 * Los repositorios de catálogo como vistas (REQ-013, fase 1: AC-3, AC-5, AC-6, AC-12). Sin coste: ninguna IA ni red.
 * - importar el registro no carga ningún repositorio;
 * - los manifiestos cumplen su esquema; la tabla de asignación cubre `FONDOS_CATALOGO` y los dos generadores, sin sobrantes, y
 *   casa con el grupo de cada entrada;
 * - cada entrada de la biblioteca de fábrica, de lo derivado de sus escenas y de `FONDOS_CATALOGO` está en exactamente un
 *   repositorio, en el orden de hoy; cada carga cumple el esquema de su clase;
 * - el índice de ids locales es inyectivo y `resolverEntrada(idLocal) === resolverEntrada(idCalificado)` para todas;
 * - el índice liviano (`indice.ts`, sin cargadores) da el mismo repositorio que los cargadores;
 * - las piezas de las escenas de Sempertex son de Sempertex o de un repositorio que su manifiesto declara en `depende`;
 * - un derivado inventado no agranda la memoria del resolutor.
 * La huella y el lock de cada repositorio los vigila `test-catalogo-lock`.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-repositorios.ts
 */
import assert from "node:assert/strict";
import { repositorio, repositoriosCargados, resolverEntrada } from "../../src/lib/catalogo/registro";
import { ASIGNACION_FONDOS, GENERADORES_MOBILIARIO } from "../../src/lib/catalogo/asignacion-fondos";
import { crearEntrada } from "../../src/lib/catalogo/construir";
import { ManifiestoSchema, problemasDeEntrada } from "../../src/lib/catalogo/esquemas";
import { REPOSITORIOS_FUNDADORES, idCalificado } from "../../src/lib/catalogo/ids";
import { calificar, repositorioDeIdLocal, repositorioDeItem, repositorioDePieza } from "../../src/lib/catalogo/indice";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import type { EntradaCatalogo, Repositorio } from "../../src/lib/catalogo/repositorio";
import { PROCEDENCIA_TALLER } from "../../src/lib/catalogo/repositorios/fondos";
import { resolutorDeDerivados } from "../../src/lib/catalogo/repositorios/sempertex/entradas-biblioteca";
import { bibliotecaVisible } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { BIBLIOTECA_FABRICA, indexarEscena, type ContenidoItem } from "../../src/lib/globos3d/biblioteca";
import { FONDOS_CATALOGO, type MuebleCatalogo } from "../../src/lib/globos3d/fondos-escenografia";
import { LIMITES_MESA } from "../../src/lib/globos3d/mobiliario-conjunto-tipos";
import type { Pieza } from "../../src/lib/globos3d/piezas";

const cargadosAlImportar = repositoriosCargados();

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { const t = Date.now(); fn(); pruebas += 1; console.log(`  ✓ ${nombre} (${Date.now() - t} ms)`); };
const repo = (id: (typeof REPOSITORIOS_FUNDADORES)[number]): Repositorio => repositorio(id)!;
const ids = (lista: readonly EntradaCatalogo[]) => lista.map((e) => e.idLocal);

prueba("importar el registro no carga ningún repositorio (D-001)", () => assert.deepEqual(cargadosAlImportar, []));

prueba("los manifiestos cumplen su esquema y su id es su clave", () => {
  for (const id of REPOSITORIOS_FUNDADORES) {
    const m = ManifiestoSchema.safeParse(MANIFIESTOS[id]);
    assert.ok(m.success, `${id}: ${m.error?.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    assert.equal(MANIFIESTOS[id].id, id);
    for (const d of MANIFIESTOS[id].depende) assert.ok((REPOSITORIOS_FUNDADORES as readonly string[]).includes(d), `${id} depende de ${d}`);
  }
});

prueba("la tabla de asignación cubre el catálogo y los generadores, sin sobrantes, y casa con el grupo", () => {
  const esperados = [...FONDOS_CATALOGO.map((f) => f.id), ...GENERADORES_MOBILIARIO];
  assert.deepEqual([...ASIGNACION_FONDOS.keys()].sort(), [...esperados].sort(), "ids sin asignar o asignados de más");
  for (const f of FONDOS_CATALOGO) assert.equal(ASIGNACION_FONDOS.get(f.id), f.grupo === "asiento" || f.grupo === "mesa" ? "mobiliario" : "escenografia", f.id);
});

prueba("mobiliario y escenografía son el catálogo en su orden: 26 + 2 generadores y 25", () => {
  const mobiliario = repo("mobiliario").entradas(), escenografia = repo("escenografia").entradas();
  assert.deepEqual(ids(mobiliario), [...FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === "mobiliario").map((f) => f.id), ...GENERADORES_MOBILIARIO]);
  assert.deepEqual(ids(escenografia), FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === "escenografia").map((f) => f.id));
  assert.equal(mobiliario.filter((e) => e.clase !== "generador").length, 26);
  assert.equal(escenografia.length, 25);
  const generador = mobiliario.find((e) => e.idLocal === "mesa_param");
  assert.ok(generador?.clase === "generador" && generador.dato.id === "mesa_param" && generador.dato.limites === LIMITES_MESA);
  for (const e of [...mobiliario, ...escenografia]) if (e.clase !== "generador") assert.equal(e.dato, FONDOS_CATALOGO.find((f) => f.id === e.idLocal), `${e.idLocal}: la carga es la entrada misma`);
});

prueba("Sempertex lista la biblioteca de fábrica en su orden, con el item mismo como carga", () => {
  const items = repo("sempertex").entradas().filter((e) => e.clase === "item-biblioteca");
  assert.deepEqual(ids(items), BIBLIOTECA_FABRICA.map((i) => i.id));
  items.forEach((e, k) => assert.equal(e.dato, BIBLIOTECA_FABRICA[k]));
  const porClase = new Map<string, number>();
  for (const e of repo("sempertex").entradas()) porClase.set(e.clase, (porClase.get(e.clase) ?? 0) + 1);
  console.log(`    sempertex: ${[...porClase].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  for (const clase of MANIFIESTOS.sempertex.clases) assert.ok((porClase.get(clase) ?? 0) > 0, `sin entradas de ${clase}`);
  const guiadas = repo("sempertex").entradas().flatMap((e) => (e.clase === "decoracion-guiada" ? [e.dato.id] : []));
  assert.deepEqual(guiadas, bibliotecaVisible().map((d) => d.id), "las decoraciones de la vista guiada son las visibles (nunca las de ejemplo)");
});

const todas = () => REPOSITORIOS_FUNDADORES.flatMap((id) => repo(id).entradas());

prueba("cada carga cumple el esquema de su clase y cada clase está declarada en su manifiesto", () => {
  const problemas = todas().flatMap(problemasDeEntrada);
  assert.deepEqual(problemas.slice(0, 10), [], `${problemas.length} problemas`);
  for (const e of todas()) assert.ok(MANIFIESTOS[e.repositorio as (typeof REPOSITORIOS_FUNDADORES)[number]].clases.includes(e.clase), `${e.id}: clase ${e.clase} no declarada`);
});

prueba("el índice de ids locales es inyectivo y las dos formas dan la misma entrada", () => {
  const vistos = new Set<string>();
  for (const e of todas()) {
    assert.ok(!vistos.has(e.idLocal), `${e.idLocal} repetido`);
    vistos.add(e.idLocal);
    assert.ok(!/^(sempertex|mobiliario|escenografia):|^terceros\//.test(e.idLocal), `${e.idLocal} empieza como un id calificado`);
    assert.equal(repositorioDeIdLocal(e.idLocal), e.repositorio, e.idLocal);
    assert.equal(calificar(e.idLocal), e.id);
    assert.equal(e.id, idCalificado(e.repositorio, e.idLocal));
    assert.equal(resolverEntrada(e.idLocal), e, e.idLocal);
    assert.equal(resolverEntrada(e.id), e, e.id);
  }
  assert.equal(resolverEntrada("mobiliario:panel_redondo"), undefined, "calificado con el repositorio equivocado");
  assert.equal(resolverEntrada("no_existe"), undefined);
  assert.equal(calificar("no_existe"), undefined);
});

const piezasDe = (c: ContenidoItem): Pieza[] =>
  c.tipo === "pieza" ? [c.pieza] : c.tipo === "conjunto" ? [c.conjunto.raiz.pieza, ...c.conjunto.hijos.map((h) => h.pieza)] : c.escena.nodos.map((n) => n.pieza);

prueba("las piezas de lo de fábrica son de Sempertex o de lo que su manifiesto declara en depende", () => {
  const permitidos = new Set(["sempertex", ...MANIFIESTOS.sempertex.depende]);
  const fuera: string[] = [];
  for (const item of BIBLIOTECA_FABRICA) for (const p of piezasDe(item.contenido)) {
    const r = repositorioDePieza(p);
    if (!r || !permitidos.has(r)) fuera.push(`${item.id}: ${p.tipo === "escenografia" ? p.mueble?.id : p.tipo} → ${r}`);
  }
  assert.deepEqual(fuera.slice(0, 10), [], `${fuera.length} piezas fuera`);
});

prueba("lo derivado de cada escena es de Sempertex y se resuelve en las dos formas", () => {
  let derivados = 0;
  for (const item of BIBLIOTECA_FABRICA) {
    if (item.contenido.tipo !== "escena") continue;
    for (const d of indexarEscena(item)) {
      derivados += 1;
      assert.equal(repositorioDeItem(d), "sempertex", d.id);
      const corta = resolverEntrada(d.id), larga = resolverEntrada(`sempertex:${d.id}`);
      assert.ok(corta && corta === larga && corta.clase === "item-biblioteca" && corta.dato.id === d.id && corta.nombre === d.nombre, d.id);
    }
  }
  console.log(`    ${derivados} derivados`);
});

prueba("repositorio de una pieza y de un item guardado por el usuario (R2)", () => {
  const mueble = (id: string): Pieza => ({ tipo: "escenografia", elementos: [], mueble: { id } });
  assert.equal(repositorioDePieza(mueble("silla_tiffany")), "mobiliario");
  assert.equal(repositorioDePieza(mueble("mobiliario:silla_tiffany")), "mobiliario");
  assert.equal(repositorioDePieza(mueble("escenografia:silla_tiffany")), undefined, "calificado con otro repositorio");
  assert.equal(repositorioDePieza(mueble("panel_redondo")), "escenografia");
  assert.equal(repositorioDePieza(mueble("mesa_param")), "mobiliario");
  assert.equal(repositorioDePieza(mueble("ya_no_existe")), undefined);
  assert.equal(repositorioDePieza({ tipo: "escenografia", elementos: [] }), "sempertex");
  const propio = (pieza: Pieza) => ({ id: "propio-1", tipo: "estructura" as const, nombre: "x", descripcion: "", ocasiones: [], propio: true, contenido: { tipo: "pieza" as const, pieza, nombre: "x", sugerida: { en: "piso" as const, xCm: 0, zCm: 0, giroGrados: 0 } } });
  assert.equal(repositorioDeItem(propio(mueble("silla_tiffany"))), "mobiliario");
  const globo = BIBLIOTECA_FABRICA.find((i) => i.id.startsWith("decoracion:"))!;
  assert.equal(repositorioDeItem({ ...propio(mueble("x")), contenido: globo.contenido }), "sempertex");
  assert.equal(repositorioDeItem({ ...propio(mueble("silla_tiffany")), tipo: "escena" }), "sempertex", "una escena guardada es una idea de Sempertex aunque solo traiga muebles");
});

prueba("las comprobaciones muerden: esquema del manifiesto y carga de una clase", () => {
  assert.ok(!ManifiestoSchema.safeParse({ ...MANIFIESTOS.mobiliario, version: "1.0.1" }).success, "versión sin su línea de historial");
  assert.ok(!ManifiestoSchema.safeParse({ ...MANIFIESTOS.mobiliario, depende: ["mobiliario"] }).success, "depende de sí mismo");
  const silla = FONDOS_CATALOGO.find((f): f is MuebleCatalogo => f.id === "silla_tiffany" && f.clase === "mueble")!;
  const rota = crearEntrada("mobiliario", { clase: "mueble", idLocal: "silla_rota", nombre: "x", descripcion: "x", procedencia: PROCEDENCIA_TALLER, dato: () => ({ ...silla, colores: ["dorado"] }) });
  assert.ok(problemasDeEntrada(rota).some((p) => p.includes("colores")), "un color que no es #rrggbb");
});

prueba("un derivado inventado no agranda la memoria del resolutor; uno de verdad la usa una vez", () => {
  const memoria = new Map<string, ReadonlyMap<string, EntradaCatalogo>>();
  const resolver = resolutorDeDerivados(memoria);
  for (let k = 0; k < 500; k++) assert.equal(resolver(`idea:inventada-${k}~n${k}`), undefined);
  assert.equal(resolver("escena:no-existe~n1"), undefined);
  assert.equal(memoria.size, 0);
  const escena = BIBLIOTECA_FABRICA.find((i) => i.contenido.tipo === "escena" && indexarEscena(i).length > 0)!;
  const derivado = indexarEscena(escena)[0]!;
  assert.equal(resolver(derivado.id)?.idLocal, derivado.id);
  assert.equal(resolver(`${escena.id}~nodo-inventado`), undefined);
  assert.equal(memoria.size, 1);
});

console.log(`test-catalogo-repositorios: ${pruebas} pruebas ok`);
