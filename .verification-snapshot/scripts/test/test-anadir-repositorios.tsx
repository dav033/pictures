/**
 * El panel «Añadir» por repositorio (REQ-013 fase 5, T24, AC-11): la lógica pura y lo que pinta cada pieza, sin navegador, sin
 * red ni coste. El recorrido en un navegador de verdad (tres repositorios, añadir uno de cada uno, deshacer, la hoja del teléfono
 * a 390 px y la marcha atrás) está en `test-anadir-repositorios-ui.ts`.
 * - qué repositorios ofrece el selector, qué muestra cada elección y qué pasa si la lectura falla o la interfaz está apagada;
 * - `FondosYMuebles` con `repositorio`: Mobiliario trae sus grupos de sentarse y de mesa más «Mesa con sillas a medida»,
 *   Escenografía sus fondos y su decorado, juntos son los 51 de siempre, y cada uno se encuentra por su nombre dentro de su
 *   repositorio y no en el otro;
 * - la marcha atrás (sin `repositorio` ni procedencias) pinta lo de siempre: los cuatro grupos en el orden de `FONDOS_CATALOGO`;
 * - la procedencia (versión, licencia, por qué no cotiza) sale en el título de la tarjeta, bajo el repositorio y al añadir;
 * - los items guardados por el usuario van al repositorio de su contenido y la cuenta de cada repositorio suma lo fijo y lo guardado.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-anadir-repositorios.tsx   (sin --conditions=react-server: renderiza React)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FondosYMuebles, contarFondosYMuebles } from "../../src/components/tres-d/FondosYMuebles";
import { SelectorRepositorio } from "../../src/components/tres-d/SelectorRepositorio";
import {
  conteosPorRepositorio, eleccionVigente, itemsDelRepositorio, nombresDeRepositorios, opcionesDelSelector, procedenciaDe, procedenciaDeItem, procedenciasDeRepositorios, vistaDeAnadir,
  visiblesParaAnadir, type RepositorioDeAnadir,
} from "../../src/lib/catalogo/anadir-repositorios";
import { ASIGNACION_FONDOS, type RepositorioDeFondos } from "../../src/lib/catalogo/asignacion-fondos";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { construirRespuestaRepositorios } from "../../src/lib/catalogo/repositorios-publicos";
import type { RespuestaRepositorios } from "../../src/lib/catalogo/repositorios-api-tipos";
import type { IdRepositorio } from "../../src/lib/catalogo/tipos";
import { BIBLIOTECA_FABRICA, type ItemBiblioteca } from "../../src/lib/globos3d/biblioteca";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { entradaDeCatalogo, FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { piezaDeEntrada } from "../../src/lib/globos3d/mobiliario-pieza";
import type { Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
function prueba(nombre: string, fn: () => void): void {
  fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

const TODOS: readonly IdRepositorio[] = ["sempertex", "mobiliario", "escenografia"];
const respuesta = (visibles: readonly IdRepositorio[] = TODOS, ui = true): RespuestaRepositorios => construirRespuestaRepositorios({ manifiestos: Object.values(MANIFIESTOS), visibles, ui });

// ---------------------------------------------------------------------------------------------------------------------
// El selector y las vistas
// ---------------------------------------------------------------------------------------------------------------------

prueba("el selector ofrece los repositorios visibles en el orden de los manifiestos, con «Todos» si hay más de uno", () => {
  assert.deepEqual(visiblesParaAnadir(respuesta()), TODOS);
  assert.deepEqual(opcionesDelSelector(TODOS as readonly RepositorioDeAnadir[]), ["todos", "sempertex", "mobiliario", "escenografia"]);
  assert.deepEqual(visiblesParaAnadir(respuesta(["escenografia", "sempertex"])), ["sempertex", "escenografia"]);
  assert.deepEqual(opcionesDelSelector(["sempertex"]), ["sempertex"], "con uno solo no hay nada que juntar");
});

prueba("la marcha atrás deja el panel como siempre: interfaz apagada, lectura sin llegar o sin repositorio que pintar", () => {
  assert.equal(visiblesParaAnadir(respuesta(TODOS, false)), null, "ui: false");
  assert.equal(visiblesParaAnadir(null), null, "la lectura no llegó o falló");
  assert.equal(visiblesParaAnadir(respuesta([])), null, "ninguno visible");
  const soloTerceros = { ...respuesta([]), repositorios: [{ ...respuesta().repositorios[1]!, id: "terceros/acme" as IdRepositorio, visible: true }] };
  assert.equal(visiblesParaAnadir(soloTerceros), null, "un paquete de terceros todavía no se pinta (fase 7)");
});

prueba("una elección que ya no es visible vuelve a «Todos» (o al único que queda)", () => {
  const visibles: readonly RepositorioDeAnadir[] = ["sempertex", "escenografia"];
  assert.equal(eleccionVigente("mobiliario", visibles), "todos");
  assert.equal(eleccionVigente("escenografia", visibles), "escenografia");
  assert.equal(eleccionVigente("todos", visibles), "todos");
  assert.equal(eleccionVigente("todos", ["mobiliario"]), "mobiliario");
  assert.equal(eleccionVigente("sempertex", ["mobiliario"]), "mobiliario");
});

prueba("cada elección muestra lo que dice el SPEC §9", () => {
  const todos = TODOS as readonly RepositorioDeAnadir[];
  assert.deepEqual(vistaDeAnadir("todos", todos), { sempertex: true, fondos: ["mobiliario", "escenografia"], fondosEnUtileria: true }, "Todos = el panel de siempre");
  assert.deepEqual(vistaDeAnadir("sempertex", todos), { sempertex: true, fondos: [], fondosEnUtileria: false }, "Sempertex = sus cuatro pestañas, sin los fondos y muebles");
  assert.deepEqual(vistaDeAnadir("mobiliario", todos), { sempertex: false, fondos: ["mobiliario"], fondosEnUtileria: false });
  assert.deepEqual(vistaDeAnadir("escenografia", todos), { sempertex: false, fondos: ["escenografia"], fondosEnUtileria: false });
  assert.deepEqual(vistaDeAnadir("todos", ["sempertex", "escenografia"]), { sempertex: true, fondos: ["escenografia"], fondosEnUtileria: true }, "lo que el Taller no ve no se pinta");
  assert.deepEqual(vistaDeAnadir("todos", ["mobiliario", "escenografia"]), { sempertex: false, fondos: ["mobiliario", "escenografia"], fondosEnUtileria: true });
});

// ---------------------------------------------------------------------------------------------------------------------
// FondosYMuebles por repositorio
// ---------------------------------------------------------------------------------------------------------------------

const escena: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
const dibujar = (propiedades: { filtro?: string; repositorio?: RepositorioDeFondos; procedencias?: Partial<Record<RepositorioDeFondos, string>> } = {}) =>
  renderToStaticMarkup(createElement(FondosYMuebles, { escena, onEscena: () => {}, ...propiedades }));

/** Los nombres de las tarjetas (los botones de la rejilla), en el orden en que salen. */
function tarjetas(html: string): string[] {
  return [...html.matchAll(/<button[^>]*title="[^"]*"[^>]*>.*?<span>([^<]*)<\/span><\/button>/g)].map((m) => m[1]!.replace(/&#x27;/g, "'"));
}
const titulosDeGrupo = (html: string) => [...html.matchAll(/<h4 class="[^"]*">([^<]*)<\/h4>/g)].map((m) => m[1]!);

const CONJUNTO = "Mesa con sillas a medida";
/** El oráculo de lo que había: cada entrada de `FONDOS_CATALOGO` en el grupo que dice su `grupo` (sin `grupo`, «fondo»), en el orden de los grupos. */
const GRUPOS = [["fondo", "Fondos y tapetes"], ["asiento", "Sillas y asientos"], ["mesa", "Mesas"], ["decorado", "Decorado de pie"]] as const;
function esperado(repositorio?: RepositorioDeFondos): { titulos: string[]; nombres: string[] } {
  const titulos: string[] = [];
  const nombres: string[] = [];
  for (const [grupo, titulo] of GRUPOS) {
    const delGrupo = FONDOS_CATALOGO.filter((f) => (f.grupo ?? "fondo") === grupo && (!repositorio || ASIGNACION_FONDOS.get(f.id) === repositorio)).map((f) => f.nombre);
    if (grupo === "mesa" && (!repositorio || repositorio === "mobiliario")) delGrupo.push(CONJUNTO);
    if (!delGrupo.length) continue;
    titulos.push(titulo);
    nombres.push(...delGrupo);
  }
  return { titulos, nombres };
}
const esperadoDeSiempre = () => esperado();

prueba("sin repositorio ni procedencias (la marcha atrás) pinta lo de siempre: cuatro grupos, los 51 en el orden del catálogo y la mesa con sillas", () => {
  const html = dibujar();
  const { titulos, nombres } = esperadoDeSiempre();
  assert.deepEqual(titulosDeGrupo(html), titulos);
  assert.deepEqual(tarjetas(html), nombres);
  assert.equal(nombres.length, FONDOS_CATALOGO.length + 1);
  assert.ok(html.includes('aria-label="Fondos y muebles"'));
  assert.ok(html.includes("Fondos y muebles <span") && html.includes("no son globos: no cotizan"));
  assert.ok(!html.includes("procedencia-repositorio") && !html.includes("Procedencia"), "nada de procedencia sin pedirla");
  assert.equal(dibujar({ repositorio: undefined, procedencias: undefined }), html, "undefined = no pasarlo");
});

/** El dorado de la marcha atrás: sha256 del HTML de `FondosYMuebles` sin repositorio, el que pintaba `origin/main` 8955d367 (comparado byte a byte antes de tocarlo). */
const DORADO_DE_SIEMPRE: ReadonlyArray<readonly [filtro: string, sha256: string]> = [
  ["", "6adb32ba6bc63a9bc2d8686c08fd5f6aa3db5d9328a91ff1f5d93fdd370c9f87"],
  ["panel", "f0d70943c70e33ce4a670a615eac489ffb448efe473707889072c8563e5bb979"],
  ["mesa con sillas", "629c123af2950a2c6a30904e731cc1a408a810a69c76cf26ff9697bf7232fa6b"],
];

prueba("la marcha atrás: «Fondos y muebles» sin repositorio es byte a byte el HTML de antes de la fase 5", () => {
  for (const [filtro, esperadoSha] of DORADO_DE_SIEMPRE) {
    assert.equal(createHash("sha256").update(dibujar({ filtro })).digest("hex"), esperadoSha, `filtro «${filtro}»: cambió lo que pinta sin repositorio`);
  }
});

const delRepositorio = (repositorio: RepositorioDeFondos) => FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === repositorio);

prueba("Mobiliario: los grupos de sentarse y de mesa más «Mesa con sillas a medida»; nada de fondos ni decorado", () => {
  const html = dibujar({ repositorio: "mobiliario" });
  assert.deepEqual(titulosDeGrupo(html), ["Sillas y asientos", "Mesas"]);
  assert.deepEqual(tarjetas(html), esperado("mobiliario").nombres, "el orden de siempre dentro de cada grupo, y la mesa con sillas al final de Mesas");
  assert.equal(tarjetas(html).length, delRepositorio("mobiliario").length + 1);
  assert.ok(html.includes('aria-label="Mobiliario"'));
  assert.deepEqual(delRepositorio("mobiliario").map((f) => f.grupo), delRepositorio("mobiliario").map((f) => (f.grupo === "asiento" ? "asiento" : "mesa")), "solo asiento y mesa");
});

prueba("Escenografía: fondos y decorado; ni sillas ni mesas ni el conjunto", () => {
  const html = dibujar({ repositorio: "escenografia" });
  assert.deepEqual(titulosDeGrupo(html), ["Fondos y tapetes", "Decorado de pie"]);
  assert.deepEqual(tarjetas(html), esperado("escenografia").nombres);
  assert.equal(tarjetas(html).length, delRepositorio("escenografia").length);
  assert.ok(!html.includes(CONJUNTO));
  assert.ok(html.includes('aria-label="Escenografía"'));
});

prueba("AC-11: Mobiliario trae 26 (más los 2 generadores en la tarjeta de la mesa con sillas), Escenografía 25 y juntos son los 51", () => {
  assert.equal(delRepositorio("mobiliario").length, 26, "mobiliario");
  assert.equal(delRepositorio("escenografia").length, 25, "escenografía");
  assert.equal(delRepositorio("mobiliario").length + delRepositorio("escenografia").length, FONDOS_CATALOGO.length);
  assert.equal(contarFondosYMuebles("", "mobiliario"), 27, "26 tarjetas + la de la mesa con sillas a medida");
  assert.equal(contarFondosYMuebles("", "escenografia"), 25);
  assert.equal(contarFondosYMuebles(""), 52, "sin repositorio, los de siempre: 51 + 1");
  assert.deepEqual(
    [...tarjetas(dibujar({ repositorio: "mobiliario" })), ...tarjetas(dibujar({ repositorio: "escenografia" }))].sort(),
    esperadoDeSiempre().nombres.sort(), "entre los dos están todas las tarjetas de siempre, una vez cada una");
});

prueba("AC-11: cada entrada se encuentra por su nombre dentro de su repositorio y no en el otro", () => {
  const otro = (r: RepositorioDeFondos): RepositorioDeFondos => (r === "mobiliario" ? "escenografia" : "mobiliario");
  for (const repositorio of ["mobiliario", "escenografia"] as const) {
    for (const f of delRepositorio(repositorio)) {
      const dentro = tarjetas(dibujar({ repositorio, filtro: f.nombre }));
      assert.ok(dentro.includes(f.nombre), `«${f.nombre}» no se encuentra en ${repositorio}`);
      assert.ok(!tarjetas(dibujar({ repositorio: otro(repositorio), filtro: f.nombre })).includes(f.nombre), `«${f.nombre}» salió también en ${otro(repositorio)}`);
      assert.equal(contarFondosYMuebles(f.nombre, repositorio), dentro.length, `la cuenta de «${f.nombre}» no es la de lo pintado`);
    }
  }
  assert.equal(dibujar({ repositorio: "escenografia", filtro: "tiffany" }), "", "una búsqueda sin resultados no pinta la sección");
  assert.deepEqual(tarjetas(dibujar({ repositorio: "mobiliario", filtro: "mesa con sillas" })).includes(CONJUNTO), true);
  assert.ok(!tarjetas(dibujar({ repositorio: "escenografia", filtro: "mesa con sillas" })).includes(CONJUNTO));
});

prueba("dentro de un repositorio la búsqueda acota: «silla», «mesa» y «fondo» solo encuentran lo que lo dice en su nombre o su descripción", () => {
  const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const esperadas = (repositorio: RepositorioDeFondos, palabra: string) => delRepositorio(repositorio).filter((f) => sinTildes(`${f.nombre} ${f.descripcion}`).includes(palabra)).map((f) => f.nombre);
  for (const [repositorio, palabra] of [["mobiliario", "silla"], ["mobiliario", "mesa"], ["escenografia", "fondo"], ["mobiliario", "fondo"], ["escenografia", "silla"], ["escenografia", "mesa"]] as const) {
    const propias = esperadas(repositorio, palabra);
    const conjunto = repositorio === "mobiliario" && (palabra === "silla" || palabra === "mesa") ? [CONJUNTO] : [];
    const halladas = tarjetas(dibujar({ repositorio, filtro: palabra }));
    assert.deepEqual([...halladas].sort(), [...propias, ...conjunto].sort(), `«${palabra}» en ${repositorio}: solo lo que lo trae en su nombre o descripción`);
    assert.equal(contarFondosYMuebles(palabra, repositorio), halladas.length, `«${palabra}» en ${repositorio}: la cuenta es la de lo pintado`);
    assert.ok(halladas.length < delRepositorio(repositorio).length + conjunto.length + (repositorio === "mobiliario" ? 1 : 0), `«${palabra}» en ${repositorio}: acota (${halladas.length} de ${delRepositorio(repositorio).length})`);
  }
  assert.ok(tarjetas(dibujar({ repositorio: "mobiliario", filtro: "silla" })).length < 27 && tarjetas(dibujar({ repositorio: "mobiliario", filtro: "mesa" })).length < 27 && tarjetas(dibujar({ repositorio: "escenografia", filtro: "fondo" })).length < 25, "ninguna de las tres devuelve el repositorio entero");
  assert.equal(tarjetas(dibujar({ filtro: "silla" })).length, tarjetas(dibujar()).length, "sin repositorio (Todos y la marcha atrás) las palabras de siempre siguen encontrándolo todo");
});

prueba("la procedencia sale bajo el repositorio y en el título de cada tarjeta, y no en las de otro repositorio", () => {
  const manifiestos = respuesta();
  const procedencias = procedenciasDeRepositorios(manifiestos);
  const html = dibujar({ repositorio: "mobiliario", procedencias });
  assert.ok(html.includes(`data-testid="procedencia-repositorio">${procedencias.mobiliario}</p>`), "bajo el título del repositorio");
  assert.match(procedencias.mobiliario!, /^Mobiliario v\S+ · licencia propia: Equipo demo-decoracion · no cotiza \(aún no hay lista de alquiler de mobiliario\)$/);
  assert.match(procedencias.sempertex!, /^Sempertex v\S+ · licencia de la marca socia: Sempertex$/);
  const silla = entradaDeCatalogo("silla_tiffany")!;
  assert.ok(html.includes(`title="${silla.descripcion} ${procedencias.mobiliario}.`), "en la ayuda de la tarjeta");
  const todos = dibujar({ procedencias });
  assert.ok(todos.includes(`title="${silla.descripcion} ${procedencias.mobiliario}.`) && todos.includes(`${procedencias.escenografia}.`), "sin repositorio, cada tarjeta lleva la de su repositorio");
  assert.ok(!todos.includes("procedencia-repositorio"), "sin repositorio no hay línea bajo el título");
});

// ---------------------------------------------------------------------------------------------------------------------
// El selector pintado
// ---------------------------------------------------------------------------------------------------------------------

prueba("el selector pinta una opción por repositorio con su cuenta, marca la elegida y nombra con el manifiesto", () => {
  const conteos = conteosPorRepositorio([]);
  const html = renderToStaticMarkup(createElement(SelectorRepositorio, {
    opciones: opcionesDelSelector(TODOS as readonly RepositorioDeAnadir[]), eleccion: "mobiliario", onElegir: () => {}, nombres: nombresDeRepositorios(respuesta()), conteos,
  }));
  const botones = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*><span[^>]*>([^<]*)<\/span><span[^>]*>(\d+)<\/span><\/button>/g)].map((m) => [m[2], m[1], Number(m[3])]);
  assert.deepEqual(botones, [["Todos", "false", conteos.sempertex + conteos.mobiliario + conteos.escenografia], ["Sempertex", "false", 0], ["Mobiliario", "true", 27], ["Escenografía", "false", 25]]);
  assert.ok(html.includes('role="group" aria-label="Repositorio"'));
  assert.ok(html.includes("min-h-11"), "44 px de alto para el dedo");
});

// ---------------------------------------------------------------------------------------------------------------------
// La biblioteca por repositorio
// ---------------------------------------------------------------------------------------------------------------------

const propio = (id: string, ...piezas: Pieza[]): ItemBiblioteca => ({
  id, tipo: "utileria", nombre: id, descripcion: "", ocasiones: [], propio: true,
  contenido: { tipo: "escena", escena: { sala: structuredClone(SALA_INICIAL), nodos: piezas.map((pieza, i) => ({ id: `n${i}`, nombre: `Pieza ${i}`, pieza, colocacion: { en: "piso" as const, xCm: i * 50, zCm: 0, giroGrados: 0 } })) } },
});
const mueble = (id: string): Pieza => piezaDeEntrada(entradaDeCatalogo(id)!);
const deSempertex = (): Pieza => {
  for (const item of BIBLIOTECA_FABRICA) if (item.contenido.tipo === "pieza" && item.contenido.pieza.tipo !== "escenografia") return item.contenido.pieza;
  throw new Error("la biblioteca de fábrica no trae ninguna pieza suelta que no sea escenografía");
};

const sillas = propio("propio:sillas", mueble("silla_tiffany"), mueble("mesa_redonda"));
const fondo = propio("propio:fondo", mueble("panel_redondo"));
const mezclaDeFondos = propio("propio:mezcla-de-fondos", mueble("silla_tiffany"), mueble("panel_redondo"));
const conGlobos = propio("propio:con-globos", mueble("silla_tiffany"), deSempertex());
const fabrica = BIBLIOTECA_FABRICA.slice(0, 5);
const guardados = [...fabrica, sillas, fondo, mezclaDeFondos, conGlobos];

prueba("lo de fábrica es de Sempertex y lo guardado va al repositorio de su contenido: solo muebles, mobiliario; solo fondos, escenografía; con algo de Sempertex, Sempertex", () => {
  assert.deepEqual(itemsDelRepositorio(guardados, "sempertex").map((i) => i.id), [...fabrica.map((i) => i.id), "propio:con-globos"]);
  assert.deepEqual(itemsDelRepositorio(guardados, "mobiliario").map((i) => i.id), ["propio:sillas", "propio:mezcla-de-fondos"], "una mezcla de mueble y fondo es del primero");
  assert.deepEqual(itemsDelRepositorio(guardados, "escenografia").map((i) => i.id), ["propio:fondo"]);
});

prueba("una escena guardada que solo trae muebles sigue saliendo en Sempertex → Ideas; una pieza guardada de solo muebles, no", () => {
  const escenaDeMuebles: ItemBiblioteca = { ...sillas, id: "propio:escena-de-muebles", tipo: "escena", nombre: "Mi salón" };
  const lista = [...fabrica, sillas, escenaDeMuebles];
  assert.deepEqual(itemsDelRepositorio(lista, "sempertex").map((i) => i.id), [...fabrica.map((i) => i.id), "propio:escena-de-muebles"], "la escena es una idea");
  assert.deepEqual(itemsDelRepositorio(lista, "mobiliario").map((i) => i.id), ["propio:sillas"], "la pieza de muebles es de Mobiliario");
  assert.equal(procedenciaDeItem(escenaDeMuebles, respuesta()), procedenciaDe(respuesta().repositorios[0]!), "y su ficha dice Sempertex");
  assert.deepEqual(conteosPorRepositorio(lista), { sempertex: fabrica.length + 1, mobiliario: 27 + 1, escenografia: 25 });
});

prueba("«Todos» con todo visible devuelve la misma lista, sin copiarla (el panel de siempre no paga nada)", () => {
  assert.equal(itemsDelRepositorio(guardados, "todos"), guardados);
  assert.equal(itemsDelRepositorio(guardados, "todos", TODOS as readonly RepositorioDeAnadir[]), guardados);
});

prueba("«Todos» junta solo lo de los repositorios que el Taller ve: lo de uno oculto ni sale ni cuenta", () => {
  const sinSempertex = itemsDelRepositorio(guardados, "todos", ["mobiliario", "escenografia"]).map((i) => i.id);
  assert.deepEqual(sinSempertex, ["propio:sillas", "propio:fondo", "propio:mezcla-de-fondos"], "ni la fábrica ni lo guardado con globos");
  assert.deepEqual(itemsDelRepositorio(guardados, "todos", ["sempertex", "escenografia"]).map((i) => i.id), [...fabrica.map((i) => i.id), "propio:fondo", "propio:con-globos"]);
  const conteos = conteosPorRepositorio(guardados);
  const html = renderToStaticMarkup(createElement(SelectorRepositorio, { opciones: ["todos", "mobiliario", "escenografia"], eleccion: "todos", onElegir: () => {}, nombres: nombresDeRepositorios(null), conteos }));
  assert.ok(html.includes(`>${conteos.mobiliario + conteos.escenografia}</span></button>`), "la cuenta de «Todos» suma solo las opciones que se ofrecen");
  assert.ok(!html.includes(`>${conteos.sempertex + conteos.mobiliario + conteos.escenografia}<`), "sin la de Sempertex");
});

prueba("la cuenta de cada repositorio suma lo fijo del catálogo y lo que le toca de la biblioteca", () => {
  const vacio = conteosPorRepositorio([]);
  assert.deepEqual(vacio, { sempertex: 0, mobiliario: 27, escenografia: 25 }, "mobiliario 26 + la tarjeta de los 2 generadores; escenografía 25 (AC-11)");
  assert.equal(vacio.mobiliario, contarFondosYMuebles("", "mobiliario"), "el selector y las tarjetas cuentan lo mismo (Mobiliario)");
  assert.equal(vacio.escenografia, contarFondosYMuebles("", "escenografia"), "el selector y las tarjetas cuentan lo mismo (Escenografía)");
  assert.deepEqual(conteosPorRepositorio(guardados), { sempertex: fabrica.length + 1, mobiliario: 27 + 2, escenografia: 25 + 1 });
  const total = conteosPorRepositorio(BIBLIOTECA_FABRICA);
  assert.equal(total.sempertex, BIBLIOTECA_FABRICA.length, "toda la fábrica es de Sempertex");
});

prueba("la procedencia dice versión, licencia con su titular y, si no se vende, por qué no se cotiza", () => {
  const [sempertex, mobiliario, escenografia] = respuesta().repositorios;
  assert.equal(procedenciaDe(sempertex!), `Sempertex v${MANIFIESTOS.sempertex.version} · licencia de la marca socia: Sempertex`);
  assert.equal(procedenciaDe(mobiliario!), `Mobiliario v${MANIFIESTOS.mobiliario.version} · licencia propia: Equipo demo-decoracion · no cotiza (aún no hay lista de alquiler de mobiliario)`);
  assert.match(procedenciaDe(escenografia!), /^Escenografía v\S+ · licencia propia: .+ · no cotiza \(.+\)$/);
  assert.deepEqual(nombresDeRepositorios(null), { sempertex: "Sempertex", mobiliario: "Mobiliario", escenografia: "Escenografía" }, "sin lectura, los nombres de siempre");
});

prueba("la ficha de un item dice de qué repositorio es y su licencia, solo con la interfaz encendida", () => {
  const encendida = respuesta();
  const [sempertex, mobiliario, escenografia] = encendida.repositorios;
  assert.equal(procedenciaDeItem(fabrica[0]!, encendida), procedenciaDe(sempertex!));
  assert.equal(procedenciaDeItem(sillas, encendida), procedenciaDe(mobiliario!), "lo guardado de solo muebles es de Mobiliario");
  assert.equal(procedenciaDeItem(fondo, encendida), procedenciaDe(escenografia!));
  assert.equal(procedenciaDeItem(sillas, respuesta(TODOS, false)), null, "interfaz apagada: la ficha es la de siempre");
  assert.equal(procedenciaDeItem(sillas, null), null, "lectura sin llegar o fallida");
});

console.log(`test-anadir-repositorios: ${pruebas} pruebas ok`);
