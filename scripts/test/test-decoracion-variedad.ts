/**
 * Variedad de la decoración (REQ-008, pedido del dueño: «siempre que le pido una decoración va a la misma: un arco, dos columnas y la
 * misma guirnalda»). Por el camino de las herramientas, sin IA ni red:
 * - un banco de 8 pedidos (safari, Frozen, XV, graduación, Halloween, boda boho, bautizo, corporativo) da 8 composiciones distintas, ninguna
 *   es la plantilla de partida, todo queda dentro de la sala y el mismo pedido da siempre lo mismo;
 * - la plantilla de partida sin tocar se reemplaza (y se dice); una escena que el usuario ya trabajó se conserva;
 * - editar («agrega», «recolorea») sigue siendo CRUD: no rehace nada;
 * - el taller nuevo abre vacío y el prompt distingue editar de diseñar.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-decoracion-variedad.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { esPlantillaSinTocar, escenaPredefinida, ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { composicionDe } from "../../src/lib/globos3d/salon-composicion";
import { coloresDePieza } from "../../src/lib/globos3d/herramientas-escena-recolor";
import { conSalaNueva } from "../../src/lib/globos3d/salon-techos";
import { cuelgaDeTecho } from "../../src/lib/globos3d/herramientas-escena-techo-zona";
import { leerGuardada } from "../../src/components/tres-d/guardado-escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { vivas } from "../../src/lib/globos3d/salon-registro";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(`${nombre} ${JSON.stringify(args)}: ${r.error}`);
  return r;
};

type Pedido = { etiqueta: string; args: Record<string, unknown> };
const BANCO: readonly Pedido[] = [
  { etiqueta: "baby shower safari", args: { tipo_evento: "baby_shower", tematica: "safari" } },
  { etiqueta: "cumpleaños Frozen", args: { tipo_evento: "cumpleanos", tematica: "Frozen", colores: ["azul", "plateado"] } },
  { etiqueta: "XV años rosa y dorado", args: { tipo_evento: "quince", colores: ["rosa", "dorado"] } },
  { etiqueta: "graduación azul", args: { tipo_evento: "graduacion", colores: ["azul"], texto: "2026" } },
  { etiqueta: "Halloween", args: { tipo_evento: "halloween" } },
  { etiqueta: "boda boho", args: { tipo_evento: "boda", tematica: "boho" } },
  { etiqueta: "bautizo", args: { tipo_evento: "bautizo", colores: ["blanco"] } },
  { etiqueta: "corporativo", args: { tipo_evento: "corporativo", colores: ["azul", "blanco"] } },
];

const decoracion = (args: Record<string, unknown>, base: Escena = vacia()) => herramienta(base, "planificar_evento", { alcance: "solo_decoracion", ...args });
/** Qué estructuras lleva: los nombres de sus piezas anotadas en el salón, sin el lado ni el número («Columna alta del fondo (izquierda)» = «Columna alta del fondo»). */
const firma = (e: Escena): string => [...new Set(vivas(e).filter((v) => v.info.rol === "adorno").map((v) => v.nodo.nombre.replace(/\s*\(.*\)$/, "").replace(/\s+(izquierdo|derecho)?\s*\d*$/, "")))].sort().join(" + ");

const resultados = BANCO.map((p) => ({ ...p, ...decoracion(p.args) }));

prueba("8 pedidos distintos dan 8 composiciones distintas (ni dos con el mismo conjunto de estructuras)", () => {
  for (const r of resultados) console.log(`    ${r.etiqueta}: ${firma(r.escena)}`);
  const firmas = resultados.map((r) => firma(r.escena));
  assert.equal(new Set(firmas).size, BANCO.length, `se repiten: ${firmas.join(" | ")}`);
});

prueba("ninguna reusa la plantilla de partida (ni sus piezas ni sus ids), y todo queda dentro de la sala", () => {
  const plantillas = ESCENAS_PREDEFINIDAS.flatMap((p) => p.escena.nodos);
  const piezas = new Set(plantillas.map((n) => JSON.stringify(n.pieza)));
  const ids = new Set(plantillas.map((n) => n.id));
  for (const r of resultados) {
    for (const n of r.escena.nodos) {
      assert.ok(!piezas.has(JSON.stringify(n.pieza)), `${r.etiqueta}: ${n.id} es una pieza de la plantilla`);
      assert.ok(!ids.has(n.id), `${r.etiqueta}: ${n.id} es un id de la plantilla`);
    }
    const sala = r.escena.sala;
    for (const n of armarEscena(r.escena).porNodo.filter((x) => x.copias > 0)) {
      assert.ok(n.caja.min.x >= -sala.anchoCm / 2 - 5 && n.caja.max.x <= sala.anchoCm / 2 + 5, `${r.etiqueta}: ${n.id} sale de la sala a lo ancho`);
      assert.ok(n.caja.min.z >= -sala.fondoCm / 2 - 5 && n.caja.max.z <= sala.fondoCm / 2 + 5, `${r.etiqueta}: ${n.id} sale de la sala a lo largo`);
      assert.ok(n.caja.max.y <= sala.altoCm + 1, `${r.etiqueta}: ${n.id} pasa el techo`);
    }
  }
});

prueba("el mismo pedido da siempre lo mismo, y cambiar el tema o los colores cambia el resultado", () => {
  for (const p of BANCO.slice(0, 3)) assert.deepEqual(decoracion(p.args).escena, decoracion(p.args).escena, p.etiqueta);
  const base = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }).escena;
  assert.notDeepEqual(base, decoracion({ tipo_evento: "cumpleanos", tematica: "princesas" }).escena);
  assert.notDeepEqual(base, decoracion({ tipo_evento: "cumpleanos", tematica: "safari", colores: ["rojo", "negro"] }).escena);
});

prueba("la temática manda sobre la ocasión: safari = palmeras, princesas = castillo, boho = guirnalda a lo ancho", () => {
  assert.match(firma(resultados[0]!.escena), /Palmera|Árbol/);
  assert.match(firma(decoracion({ tipo_evento: "cumpleanos", tematica: "princesas" }).escena), /Castillo/);
  assert.match(firma(resultados[5]!.escena), /Guirnalda orgánica a lo ancho/);
  assert.match(firma(resultados[4]!.escena), /Columna alta/);
  assert.ok(resultados[4]!.escena.nodos.some((n) => n.nombre === "Techo del fondo de fotos"), "Halloween lleva globos en el techo");
});

prueba("el mismo pedido sin tema: una boda sigue siendo el arco clásico; las demás ocasiones varían con el pedido", () => {
  assert.equal(composicionDe({ tipo: "boda" }).fondo, "arco_columnas");
  const fondos = new Set(["rojo", "azul", "rosa", "verde", "morado", "naranja", "amarillo", "negro"].map((c) => composicionDe({ tipo: "cumpleanos", colores: [c] }).fondo));
  assert.ok(fondos.size >= 3, `solo ${[...fondos].join(", ")}`);
});

prueba("la biblioteca aporta ideas reales a los pedidos con tema, como piezas editables", () => {
  const conIdeas = resultados.filter((r) => /Idea de la biblioteca/.test(r.resumen));
  console.log(`    con ideas de la biblioteca: ${conIdeas.map((r) => r.etiqueta).join(", ") || "ninguna"}`);
  assert.ok(conIdeas.length >= 2, "al menos dos pedidos traen ideas de la biblioteca");
  for (const r of conIdeas) {
    const ideas = vivas(r.escena).filter((v) => v.info.rol === "adorno" && !v.nodo.id.startsWith("salon-"));
    assert.ok(ideas.length >= 1 && ideas.length <= 12, `${r.etiqueta}: ${ideas.length} piezas de ideas`);
  }
});

prueba("la plantilla de partida sin tocar se reemplaza (y se dice); si el usuario la tocó, se conserva", () => {
  const plantilla = escenaPredefinida("arco_organico_columnas_guirnalda");
  assert.ok(esPlantillaSinTocar(plantilla));
  assert.ok(!esPlantillaSinTocar(vacia()));
  const r = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }, plantilla);
  for (const n of plantilla.nodos) assert.ok(!r.escena.nodos.some((x) => x.id === n.id), `sigue ${n.id} de la plantilla`);
  assert.match(r.resumen, /plantilla de partida sin tocar/);
  assert.ok(r.escena.nodos.length > 0);

  const tocada: Escena = { ...plantilla, nodos: plantilla.nodos.map((n, i) => (i === 0 && n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: n.colocacion.xCm + 30 } } : n)) };
  assert.ok(!esPlantillaSinTocar(tocada));
  const conservada = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }, tocada);
  for (const n of tocada.nodos) assert.deepEqual(conservada.escena.nodos.find((x) => x.id === n.id)?.pieza, n.pieza, `${n.id} se perdió`);
  assert.doesNotMatch(conservada.resumen, /plantilla de partida sin tocar/);
});

prueba("editar sigue siendo CRUD: agregar y recolorear no rehacen ni quitan nada de lo que había", () => {
  const plantilla = escenaPredefinida("arco_organico_columnas_guirnalda");
  const agregada = herramienta(plantilla, "agregar_pieza", { tipo: "columna_organica", colores: ["verde"], donde: { en: "piso", x_cm: 200, z_cm: 0 } }).escena;
  assert.equal(agregada.nodos.length, plantilla.nodos.length + 1);
  for (const n of plantilla.nodos) assert.deepEqual(agregada.nodos.find((x) => x.id === n.id)?.colocacion, n.colocacion);
  const coloreada = herramienta(plantilla, "recolorear_escena", { colores: ["rojo", "negro"] }).escena;
  assert.deepEqual(coloreada.nodos.map((n) => n.id), plantilla.nodos.map((n) => n.id));
});

prueba("el taller nuevo abre con la sala vacía (las plantillas siguen en «Empezar de una plantilla») y el prompt distingue editar de diseñar", () => {
  const taller = readFileSync(new URL("../../src/components/tres-d/Taller3D.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(taller, /useHistorialEscena\(\(\) => guardadaAlAbrir\?\.escena \?\? escenaPredefinida/);
  assert.match(taller, /guardadaAlAbrir\?\.escena \?\? \{ sala: structuredClone\(SALA_INICIAL\), nodos: \[\] \}/);
  assert.match(taller, /Empezar de una plantilla/);
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /EDITAR/);
  assert.match(ruta, /DISEÑAR/);
  assert.match(ruta, /plantilla con que abría el taller sin tocar/);
  assert.doesNotMatch(ruta, /fondo de fotos con arco/);
  assert.match(ruta, /variante \+ 1/);
  assert.match(ruta, /ajustar_salon \(más o menos invitados: las mesas nuevas reciben solas/);
  assert.match(ruta, /Nunca contestes «hazme una decoración» solo recoloreando/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Hallazgos de la revisión antagónica
// ---------------------------------------------------------------------------------------------------------------------

/** Las piezas del fondo que vienen de la biblioteca (no las armó la composición: sus ids no empiezan por «salon-»). */
const ideasDe = (e: Escena) => vivas(e).filter((v) => v.info.rol === "adorno" && !v.nodo.id.startsWith("salon-") && !v.nodo.id.startsWith("techo-zona-")).map((v) => v.nodo);

prueba("A1: las ideas de la biblioteca van en los colores del evento y, con tema, solo si coinciden con el tema", () => {
  const graduacion = decoracion({ tipo_evento: "graduacion", colores: ["azul"], texto: "2026" });
  const ideas = ideasDe(graduacion.escena);
  assert.ok(ideas.length >= 1, "la graduación trae ideas de la biblioteca");
  const codigos = new Set(ideas.flatMap((n) => coloresDePieza(n.pieza, "uso").map((c) => c.codigo)));
  const propios = new Set(vivas(graduacion.escena).filter((v) => v.nodo.id.startsWith("salon-fondo-pared")).flatMap((v) => coloresDePieza(v.nodo.pieza, "uso").map((c) => c.codigo)));
  assert.ok(codigos.size >= 1 && [...codigos].every((c) => propios.has(c)), `colores de las ideas ${[...codigos].join(",")} fuera de los del evento ${[...propios].join(",")}`);
  const safari = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" });
  assert.equal(ideasDe(safari.escena).length, 0, "la biblioteca no tiene safari: no se rellena con lo de la ocasión (arcos de corazones neón)");
  assert.match(safari.resumen, /no tiene ideas de «safari»/);
});

prueba("A1: un rincón dice qué pasó con las ideas, no las pierde en silencio", () => {
  const rincon = herramienta(vacia(), "planificar_evento", { tipo_evento: "quince", alcance: "rincon", invitados: 20, colores: ["rosa", "dorado"] });
  assert.match(rincon.resumen, /Idea de la biblioteca|no cupo|no cabe|no tiene ideas|Ninguna idea/);
});

prueba("A2: solo la plantilla con que abría el taller cuenta como «sin tocar»; una plantilla elegida a propósito se conserva", () => {
  for (const p of ESCENAS_PREDEFINIDAS.filter((x) => x.id !== "arco_organico_columnas_guirnalda")) {
    assert.ok(!esPlantillaSinTocar(escenaPredefinida(p.id)), p.id);
    const r = decoracion({ tipo_evento: "cumpleanos", tematica: "safari" }, escenaPredefinida(p.id));
    for (const n of p.escena.nodos) assert.deepEqual(r.escena.nodos.find((x) => x.id === n.id)?.pieza, n.pieza, `${p.id}: se perdió ${n.id}`);
    assert.doesNotMatch(r.resumen, /plantilla de partida sin tocar/);
  }
});

prueba("A3: «dame otra opción» (variante) cambia la composición, la misma variante repite, y una boda también varía", () => {
  const fondos = [0, 1, 2, 3].map((v) => composicionDe({ tipo: "boda", variante: v }).fondo);
  assert.equal(fondos[0], "arco_columnas");
  assert.equal(new Set(fondos).size, 4, fondos.join(","));
  const boda = (variante: number) => decoracion({ tipo_evento: "boda", variante });
  assert.notEqual(firma(boda(0).escena), firma(boda(1).escena));
  assert.deepEqual(boda(2).escena, boda(2).escena);
  const safari = (variante: number) => firma(decoracion({ tipo_evento: "cumpleanos", tematica: "safari", variante }).escena);
  assert.notEqual(safari(0), safari(1));
  assert.notEqual(safari(1), safari(2));
});

prueba("A4: el texto sale en letras de foil en cualquier composición, con acentos y ñ, y avisa si se recorta", () => {
  for (const [texto, esperado] of [["Sofía", "SOFIA"], ["José", "JOSE"], ["Begoña", "BEGONA"], ["Ana Lu", "ANALU"]] as const) {
    for (const [tipo, tematica] of [["boda", undefined], ["cumpleanos", "safari"], ["cumpleanos", "Frozen"], ["graduacion", undefined], ["baby_shower", "princesas"]] as const) {
      const r = decoracion({ tipo_evento: tipo, tematica, texto });
      const letras = r.escena.nodos.find((n) => n.nombre === "Letras de foil");
      assert.ok(letras && letras.pieza.tipo === "metalizado", `${texto} en ${tipo} ${tematica ?? ""}: sin letras`);
      assert.equal(letras.pieza.tipo === "metalizado" && letras.pieza.metalizado.forma.tipo === "letras" ? letras.pieza.metalizado.forma.texto : "", esperado);
      if (/[íéñ]/.test(texto)) assert.match(r.resumen, /sin acentos/);
    }
  }
  assert.match(decoracion({ tipo_evento: "boda", texto: "María José Hernández" }).resumen, /recortado a 12/);
  assert.match(decoracion({ tipo_evento: "boda", texto: "!!!" }).resumen, /no puse letras/);
});

prueba("A6: abrir el taller con la plantilla antigua sin tocar guardada da la sala vacía; lo trabajado se conserva", () => {
  const guardado: Record<string, string> = {};
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => guardado[k] ?? null, setItem: (k: string, v: string) => { guardado[k] = v; } } };
  const poner = (escena: Escena) => { guardado["taller3d:escena:v1"] = JSON.stringify({ nombre: "x", escena }); };
  poner(escenaPredefinida("arco_organico_columnas_guirnalda"));
  assert.equal(leerGuardada(), null);
  poner(escenaPredefinida("pared_fondo_columnas"));
  assert.ok(leerGuardada());
  const tocada = escenaPredefinida("arco_organico_columnas_guirnalda");
  poner({ ...tocada, nodos: tocada.nodos.slice(1) });
  assert.ok(leerGuardada());
});

prueba("A8: al bajar el alto de la sala, los techos de zona se vuelven a colgar y no quedan a la altura de la cabeza", () => {
  const boda = decoracion({ tipo_evento: "boda", alcance: "salon", invitados: 100, colores: ["blanco", "dorado"] }).escena;
  const techo = boda.nodos.find((n) => n.id.startsWith("techo-zona-"))!;
  const antes = techo.colocacion.en === "techo" ? techo.colocacion.cuelgaCm : -1;
  assert.ok(boda.sala.altoCm > 400 && antes > 0, `cuelga ${antes} en una sala de ${boda.sala.altoCm}`);
  const baja = conSalaNueva(boda, { ...boda.sala, altoCm: 300 });
  const despues = baja.nodos.find((n) => n.id === techo.id)!.colocacion;
  const { min, max } = armarPieza(techo.pieza).caja;
  assert.ok(despues.en === "techo" && despues.cuelgaCm === Math.round(cuelgaDeTecho(300, max.y - min.y)) && despues.cuelgaCm < antes);
  assert.ok(despues.en === "techo" && 300 - despues.cuelgaCm - (max.y - min.y) >= 0, "la pieza no sale del piso");
  const igual = conSalaNueva(boda, { ...boda.sala, anchoCm: boda.sala.anchoCm + 100 });
  assert.deepEqual(igual.nodos, boda.nodos, "sin cambio de alto no toca nada");
});

console.log(`\n${pruebas} pruebas pasaron`);
