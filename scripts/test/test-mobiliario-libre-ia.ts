/**
 * REQ-012 «Mobiliario libre» (2/3): las herramientas de la IA y lo que cuentan. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-mobiliario-libre-ia.ts
 * - agregar_mesas / cambiar_sillas / cambiar_mesas: «6 mesas de 4 sillas», todas, algunas o una; el resumen y la verificación dicen lo que HAY;
 * - lo que está sobre la tapa se queda en ella al cambiar la mesa; superficieSuperior da la tapa;
 * - lo de antes sigue igual: mesa_redonda_sillas y mesa_imperial_sillas arman idénticas, las escenas viejas cargan, y pasan a editables;
 * - lista de compra, descripción para FLUX y declaraciones (tope de 120 KB) cuentan las mesas y sillas de verdad.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { productosDe, itemDeEscena } from "../../src/lib/globos3d/biblioteca";
import { aceptaDecoraciones } from "../../src/lib/globos3d/lienzo-escena";
import { armarEscena, duplicarNodo, escenaEnIngles, girarNodo, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { REGLAS_AGENTE } from "../../src/lib/globos3d/escena-ia-agente";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { DECLARACIONES_ESCENA, MAX_NODOS, NOMBRES_HERRAMIENTAS, aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { mesaDePedido, mesaDePieza, sillasDePieza } from "../../src/lib/globos3d/mobiliario-conjunto";
import { contarMobiliario, esConjuntoFijo, pasarAConjunto } from "../../src/lib/globos3d/mobiliario-conjunto-escena";
import { DISPOSICIONES, TIPOS_MESA, TIPOS_SILLA } from "../../src/lib/globos3d/mobiliario-conjunto-tipos";
import { superficieDeMesa } from "../../src/lib/globos3d/mobiliario-mesas-param";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { puntoEnSuperficie, superficieSuperior } from "../../src/lib/globos3d/mobiliario-superficie";
import { verificarCambios } from "../../src/lib/globos3d/verificacion-escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { caja, centro, cerca, cuantas, falla, fin, llamar, mesas, nodo, prueba, salaGrande, sillasDe } from "./lib-test-mobiliario-libre";

// ----------------------------------------------------------------------------------------------------------
// La IA: «6 mesas de 4 sillas»
// ----------------------------------------------------------------------------------------------------------

prueba("«6 mesas de 4 sillas»: 6 mesas y 6 grupos de 4, el resumen dice lo que hay y nada queda encimado", () => {
  const r = llamar(salaGrande(), "agregar_mesas", { cantidad: 6, sillas_por_mesa: 4 });
  assert.equal(mesas(r.escena).length, 6);
  assert.equal(r.escena.nodos.length, 12);
  for (const m of mesas(r.escena)) assert.equal(cuantas(r.escena, m.id), 4);
  assert.match(r.resumen, /6 mesas redondas Ø150 cm/);
  assert.match(r.resumen, /4 sillas Tiffany cada una \(24 sillas en total\)/);
  assert.deepEqual(contarMobiliario(r.escena), { mesas: 6, sillas: 24 });
  // Las mesas no se pisan entre sí.
  const cajas = mesas(r.escena).map((m) => caja(r.escena, m.id));
  for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) {
    const a = cajas[i]!, b = cajas[j]!;
    assert.ok(a.max.x <= b.min.x || b.max.x <= a.min.x || a.max.z <= b.min.z || b.max.z <= a.min.z, "dos mesas encimadas");
  }
  const lectura = llamar(r.escena, "ver_escena", {});
  assert.match(lectura.resumen, /4 sillas Tiffany en el grupo sillas-mesa-redonda/);
  assert.match(lectura.resumen, /Mesa redonda Ø150 cm · tapa a 75 cm · mantel hasta el piso/);
  // Las 6 mesas caben en la sala y las sillas no se salen de ella.
  const sala = r.escena.sala;
  for (const n of r.escena.nodos) {
    const c = caja(r.escena, n.id);
    assert.ok(c.min.x >= -sala.anchoCm / 2 && c.max.x <= sala.anchoCm / 2 && c.min.z >= -sala.fondoCm / 2 && c.max.z <= sala.fondoCm / 2, `${n.id} fuera de la sala`);
  }
});

prueba("agregar_mesas: tipos, medidas, mantel, colores, camino, preset y el aviso de lo que no cabe", () => {
  const r = llamar(salaGrande(), "agregar_mesas", { tipo: "ovalada", ancho_cm: 280, fondo_cm: 120, alto_cm: 78, mantel: "corto", color_mantel: "azul marino", color_patas: "negro", camino: "dorado", sillas_por_mesa: 12, tipo_silla: "ghost", disposicion: "dos_lados" });
  const m = mesaDePieza(r.escena.nodos[0]!.pieza)!;
  assert.deepEqual([m.tipo, m.anchoCm, m.fondoCm, m.altoCm, m.mantel, m.colorMantel, m.colorPatas, m.camino], ["ovalada", 280, 120, 78, "corto", "#1f3366", "#1c1c1c", "#d6b25a"]);
  const s = sillasDePieza(r.escena.nodos[1]!.pieza)!;
  assert.equal(s.tipo, "ghost");
  assert.equal(s.disposicion, "dos_lados");
  assert.match(r.resumen, /1 mesa ovalada 280×120 cm \(78 cm de alto, mantel corto\), \d+ sillas ghost \(acrílicas\) \(dos lados\)/);
  assert.equal(s.colorCojin, null);
  // Preset = redonda de 150 con 8 Tiffany (lo de antes, ahora editable); lo que se pide manda sobre el preset.
  const p = llamar(salaGrande(), "agregar_mesas", { preset: "redonda_8" });
  assert.equal(mesaDePieza(p.escena.nodos[0]!.pieza)!.anchoCm, 150);
  assert.equal(cuantas(p.escena, p.escena.nodos[0]!.id), 8);
  assert.equal(cuantas(llamar(salaGrande(), "agregar_mesas", { preset: "imperial_10" }).escena, "mesa-rectangular"), 10);
  assert.equal(cuantas(llamar(salaGrande(), "agregar_mesas", { preset: "redonda_8", sillas_por_mesa: 6 }).escena, "mesa-redonda"), 6);
  // No caben: las que caben y la nota con el número real.
  const justa = llamar(salaGrande(), "agregar_mesas", { tipo: "cuadrada", ancho_cm: 90, sillas_por_mesa: 10 });
  assert.match(justa.resumen, /4 sillas Tiffany \(4 sillas en total\)/);
  assert.match(justa.resumen, /solo caben 4 sillas Tiffany .*pediste 10.*puse 4/);
  // Errores y avisos.
  assert.match(llamar(salaGrande(), "agregar_mesas", { tipo: "cuadrada", fondo_cm: 200, camino: "rojo", sillas_por_mesa: 2, mirando_a: "fondo" }).resumen, /no lleva fondo aparte/);
  assert.match(llamar(salaGrande(), "agregar_mesas", { tipo: "media_luna", camino: "rojo" }).resumen, /camino de mesa no va en mesa media luna/);
  assert.ok(falla(salaGrande(), "agregar_mesas", { tipo: "hexagonal" }).length > 0);
  assert.ok(falla(salaGrande(), "agregar_mesas", { sillas_por_mesa: 100 }).length > 0);
});

prueba("agregar_mesas respeta el tope de piezas: no pasa de MAX_NODOS y lo dice; la sala llena también se avisa", () => {
  const lleno: Escena = { ...salaGrande(), nodos: Array.from({ length: MAX_NODOS - 5 }, (_, i): NodoEscena => ({ id: `g${i}`, nombre: "globo", pieza: { tipo: "globo", formatoId: "R-12", infladoCm: 30, codigo: "005" }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } })) };
  const r = llamar(lleno, "agregar_mesas", { cantidad: 10, sillas_por_mesa: 4 });
  assert.equal(mesas(r.escena).length, 2);
  assert.ok(r.escena.nodos.length <= MAX_NODOS);
  assert.match(r.resumen, /Pediste 10 mesas pero solo caben 2/);
  assert.match(falla({ ...lleno, nodos: [...lleno.nodos, ...Array.from({ length: 5 }, (_, i): NodoEscena => ({ ...lleno.nodos[0]!, id: `h${i}` }))] }, "agregar_mesas", {}), /máximo/);
  const chica: Escena = { sala: { ...SALA_INICIAL, anchoCm: 400, fondoCm: 300 }, nodos: [] };
  assert.match(llamar(chica, "agregar_mesas", { cantidad: 12, sillas_por_mesa: 8 }).resumen, /se salen de la sala/);
});

prueba("cambiar_sillas: todas las mesas, una sola, varias; cantidad, tipo, disposición y color; 0 las quita; lo que no caben se avisa", () => {
  const base = llamar(salaGrande(), "agregar_mesas", { cantidad: 4, sillas_por_mesa: 4 }).escena;
  const ids = mesas(base).map((m) => m.id);
  // Todas: a 6 crossback.
  const todas = llamar(base, "cambiar_sillas", { cantidad: 6, tipo_silla: "crossback" });
  for (const id of ids) { assert.equal(cuantas(todas.escena, id), 6); assert.equal(sillasDePieza(sillasDe(todas.escena, id)!.pieza)!.tipo, "crossback"); }
  assert.match(todas.resumen, /4 mesas redondas Ø150 cm.*6 sillas crossback cada una \(24 sillas en total\)/);
  assert.equal(todas.escena.nodos.length, base.nodos.length, "cambiar sillas no suma piezas");
  // Una sola (por el id de la mesa o el de sus sillas): las demás no se tocan.
  const una = llamar(base, "cambiar_sillas", { ids: [ids[1]!], cantidad: 7 });
  assert.deepEqual(ids.map((id) => cuantas(una.escena, id)), [4, 7, 4, 4]);
  assert.match(una.resumen, /1 mesa redonda.*7 sillas Tiffany \(7 sillas en total\)/);
  assert.equal(cuantas(llamar(base, "cambiar_sillas", { ids: [sillasDe(base, ids[2]!)!.id], cantidad: 2 }).escena, ids[2]!), 2);
  const varias = llamar(base, "cambiar_sillas", { ids: [ids[0]!, ids[3]!], disposicion: "un_lado" });
  assert.deepEqual(ids.map((id) => sillasDePieza(sillasDe(varias.escena, id)!.pieza)!.disposicion), ["un_lado", "alrededor", "alrededor", "un_lado"]);
  assert.deepEqual(ids.map((id) => cuantas(varias.escena, id)), [4, 4, 4, 4], "cambiar solo la disposición conserva la cantidad");
  // Quitar.
  const sin = llamar(una.escena, "cambiar_sillas", { cantidad: 0 });
  assert.equal(sin.escena.nodos.length, 4);
  assert.match(sin.resumen, /Quité las sillas.*sin sillas \(0 sillas en total\)/);
  assert.deepEqual(contarMobiliario(sin.escena), { mesas: 4, sillas: 0 });
  // Poner sillas a mesas sin ellas.
  assert.equal(cuantas(llamar(sin.escena, "cambiar_sillas", { ids: [ids[0]!], cantidad: 5, tipo_silla: "plegable" }).escena, ids[0]!), 5);
  assert.match(llamar(sin.escena, "cambiar_sillas", { tipo_silla: "banca" }).resumen, /no tenían sillas/);
  // Demasiadas: las que caben y lo dice con el número real.
  const mucho = llamar(base, "cambiar_sillas", { cantidad: 40 });
  assert.match(mucho.resumen, /solo caben 13 sillas Tiffany/);
  assert.equal(cuantas(mucho.escena, ids[0]!), 13);
  assert.match(mucho.resumen, /\(52 sillas en total\)/);
  assert.match(falla(base, "cambiar_sillas", { ids: ["no-existe"], cantidad: 2 }), /no-existe/);
  assert.match(falla(base, "cambiar_sillas", {}), /ningún cambio/);
  assert.match(falla(salaGrande(), "cambiar_sillas", { cantidad: 3 }), /agregar_mesas/);
});

prueba("el color y el cojín de las sillas, y «frente al escenario» según hacia dónde mira la mesa", () => {
  const base = llamar(salaGrande(), "agregar_mesas", { sillas_por_mesa: 6 }).escena;
  const roja = sillasDePieza(sillasDe(llamar(base, "cambiar_sillas", { color_silla: "rojo", color_cojin: "ninguno" }).escena, "mesa-redonda")!.pieza)!;
  assert.equal(roja.colorEstructura, "#b3262d");
  assert.equal(roja.colorCojin, null);
  const frente = llamar(base, "cambiar_sillas", { disposicion: "frente", mirando_a: "fondo", cantidad: 4 });
  assert.ok(sillasDePieza(sillasDe(frente.escena, "mesa-redonda")!.pieza)!.puestos.every((p) => p.z > 0), "mirando al fondo se sientan del lado del frente");
  const derecha = llamar(base, "cambiar_sillas", { disposicion: "frente", mirando_a: "derecha", cantidad: 4 });
  assert.ok(sillasDePieza(sillasDe(derecha.escena, "mesa-redonda")!.pieza)!.puestos.every((p) => p.x < 0), "mirando a la derecha se sientan a la izquierda");
  // Con la mesa girada 90°, «mirando al fondo» sigue siendo el fondo de la sala.
  const girada = llamar(girarNodo(base, "mesa-redonda", 90), "cambiar_sillas", { disposicion: "frente", mirando_a: "fondo", cantidad: 4 }).escena;
  const mundo = armarEscena(girada);
  const m = centro(mundo.porNodo.find((n) => n.id === "mesa-redonda")!.caja), s = centro(mundo.porNodo.find((n) => n.id === "sillas-mesa-redonda")!.caja);
  assert.ok(s.z - m.z > 40, "en el mundo las sillas siguen del lado del frente de la sala");
});

prueba("cambiar_mesas: el tipo y la medida cambian, las sillas se vuelven a repartir y lo que hay encima se queda en la tapa", () => {
  const base = llamar(salaGrande(), "agregar_mesas", { cantidad: 2, sillas_por_mesa: 8, x_cm: 0 }).escena;
  const ids = mesas(base).map((m) => m.id);
  // Un centro de mesa suelto sobre la primera (como lo pone la base de pastel) y otro `sobre` ella.
  const conPastel = llamar(base, "agregar_mobiliario", { id: "base_pastel" }).escena;
  const pastel = conPastel.nodos.find((n) => n.id === "base-pastel")!;
  assert.ok(pastel.colocacion.en === "libre" && Math.abs(pastel.colocacion.yCm - 75) < 1.5, JSON.stringify(pastel.colocacion));
  const duenia = mesas(conPastel).find((m) => { const c = caja(conPastel, m.id), p = pastel.colocacion; return p.en === "libre" && Math.abs(p.xCm - centro(c).x) < 2 && Math.abs(p.zCm - centro(c).z) < 2; })!;
  const rect = llamar(conPastel, "cambiar_mesas", { ids: [duenia.id], tipo: "rectangular", ancho_cm: 300, fondo_cm: 100, alto_cm: 90 });
  const m = mesaDePieza(nodo(rect.escena, duenia.id).pieza)!;
  assert.deepEqual([m.tipo, m.anchoCm, m.fondoCm, m.altoCm], ["rectangular", 300, 100, 90]);
  assert.equal(cuantas(rect.escena, duenia.id), 8, "las sillas siguen: 8");
  assert.match(rect.resumen, /1 mesa rectangular 300×100 cm \(90 cm de alto, mantel hasta el piso\), 8 sillas Tiffany \(8 sillas en total\)/);
  const nuevo = rect.escena.nodos.find((n) => n.id === "base-pastel")!;
  assert.ok(nuevo.colocacion.en === "libre" && Math.abs(nuevo.colocacion.yCm - 90) < 1.5, `el pastel sube con la tapa: ${JSON.stringify(nuevo.colocacion)}`);
  const sup = superficieSuperior(nodo(rect.escena, duenia.id), armarEscena(rect.escena))!;
  assert.ok(nuevo.colocacion.en === "libre" && puntoEnSuperficie(sup, nuevo.colocacion.xCm, nuevo.colocacion.zCm), "…y sigue sobre la tapa");
  // Un tipo con otra forma: el pastel va al centro útil de la tapa nueva.
  const luna = llamar(conPastel, "cambiar_mesas", { ids: [duenia.id], tipo: "media_luna", ancho_cm: 150 });
  const supLuna = superficieSuperior(nodo(luna.escena, duenia.id), armarEscena(luna.escena))!;
  const pl = luna.escena.nodos.find((n) => n.id === "base-pastel")!.colocacion;
  assert.ok(pl.en === "libre" && puntoEnSuperficie(supLuna, pl.xCm, pl.zCm), "sobre la media luna");
  assert.match(luna.resumen, /solo caben 6 sillas Tiffany/, "la media luna de 1,5 m no tiene lugar para 8: lo dice con el número real");
  assert.equal(cuantas(luna.escena, duenia.id), 6);
  // Volver a una redonda grande recupera las 8 pedidas (se acuerda de lo pedido, no de lo que cupo).
  assert.equal(cuantas(llamar(luna.escena, "cambiar_mesas", { ids: [duenia.id], tipo: "redonda", ancho_cm: 200 }).escena, duenia.id), 8);
  // Todas las mesas; el mantel y los colores; el camino; las otras mesas no se tocan con ids.
  const todas = llamar(base, "cambiar_mesas", { mantel: "ninguno", color_mantel: "madera", camino: "dorado" });
  assert.ok(ids.every((id) => mesaDePieza(nodo(todas.escena, id).pieza)!.mantel === "ninguno" && mesaDePieza(nodo(todas.escena, id).pieza)!.camino === "#d6b25a"));
  assert.match(todas.resumen, /2 mesas redondas Ø150 cm \(75 cm de alto, sin mantel\), 8 sillas Tiffany cada una \(16 sillas en total\)/);
  assert.equal(mesaDePieza(nodo(llamar(base, "cambiar_mesas", { ids: [ids[0]!], ancho_cm: 200 }).escena, ids[1]!).pieza)!.anchoCm, 150);
  assert.match(falla(base, "cambiar_mesas", {}), /ningún cambio/);
  // El nombre sigue a la medida.
  assert.equal(nodo(llamar(base, "cambiar_mesas", { ids: [ids[0]!], ancho_cm: 200 }).escena, ids[0]!).nombre, "Mesa redonda Ø200 1");
});

prueba("lo que se pide al revés se dice claro: cambiar_pieza sobre una mesa o sus sillas manda a las herramientas nuevas", () => {
  const base = llamar(salaGrande(), "agregar_mesas", { sillas_por_mesa: 4 }).escena;
  assert.match(falla(base, "cambiar_pieza", { id: "mesa-redonda", ancho_cm: 200 }), /cambiar_mesas/);
  assert.match(falla(base, "cambiar_pieza", { id: "sillas-mesa-redonda", colores: ["rojo"] }), /cambiar_sillas/);
  assert.ok(aplicarHerramienta(base, "cambiar_pieza", { id: "mesa-redonda", nombre: "Mesa de honor" }).ok, "renombrar sí");
  const q = llamar(base, "quitar_pieza", { id: "mesa-redonda" });
  assert.equal(q.escena.nodos.length, 0);
  assert.match(q.resumen, /grupo de sillas \(sillas-mesa-redonda\)/);
  assert.deepEqual(llamar(base, "quitar_pieza", { id: "sillas-mesa-redonda" }).escena.nodos.map((n) => n.id), ["mesa-redonda"]);
});

// ----------------------------------------------------------------------------------------------------------
// Verificación, lista de compra y descripción: lo real
// ----------------------------------------------------------------------------------------------------------

prueba("la verificación automática dice las mesas y sillas de verdad; la lista de compra suma las sillas, no las piezas", () => {
  const vacia = salaGrande();
  const r = llamar(vacia, "agregar_mesas", { cantidad: 6, sillas_por_mesa: 4 });
  assert.match(verificarCambios(vacia, r.escena), /mobiliario \(leído de las piezas\): mesas 0 → 6, sillas 0 → 24/);
  const mas = llamar(r.escena, "cambiar_sillas", { cantidad: 6 });
  assert.match(verificarCambios(r.escena, mas.escena), /mesas 6 → 6, sillas 24 → 36/);
  const item = itemDeEscena({ id: "x", nombre: "Boda", ocasiones: [], escena: mas.escena });
  const lista = productosDe(item).escenografia;
  assert.equal(lista.find((l) => l.nombre === "Silla Tiffany")?.cantidad, 36);
  assert.equal(lista.find((l) => l.nombre === "Mesa redonda Ø150")?.cantidad, 6);
});

prueba("la descripción para FLUX cuenta cada mesa y silla con su tipo y medida, no un 8 ni un nombre", () => {
  const r = llamar(salaGrande(), "agregar_mesas", { cantidad: 6, sillas_por_mesa: 4, tipo_silla: "crossback", color_silla: "madera", ancho_cm: 180 });
  const texto = escenaEnIngles(r.escena, armarEscena(r.escena));
  assert.match(texto, /30 party props/);
  assert.match(texto, /6 × round banquet table 180 cm in diameter with a floor-length tablecloth/);
  assert.match(texto, /24 × wooden crossback chair/);
  assert.doesNotMatch(texto, /eight|ten Tiffany/);
  const ovalada = llamar(salaGrande(), "agregar_mesas", { tipo: "ovalada", mantel: "ninguno", sillas_por_mesa: 0 });
  assert.match(escenaEnIngles(ovalada.escena, armarEscena(ovalada.escena)), /oval banquet table 240 cm long and 120 cm wide with a bare .* top/);
});

// ----------------------------------------------------------------------------------------------------------
// La superficie de arriba
// ----------------------------------------------------------------------------------------------------------

prueba("superficieSuperior: alto de la tapa, centro útil y radio de cada mesa (también las del catálogo), en el mundo", () => {
  const redonda = llamar(salaGrande(), "agregar_mesas", { ancho_cm: 160, alto_cm: 80, x_cm: 100, z_cm: -50 }).escena;
  const s = superficieSuperior(redonda.nodos[0]!, armarEscena(redonda))!;
  cerca(s.altoCm, 80, 0.1, "alto");
  cerca(s.centro.x, 100, 1, "x");
  cerca(s.centro.z, -50, 1, "z");
  cerca(s.radioUtilCm, 80, 2, "radio");
  assert.ok(puntoEnSuperficie(s, 150, -50) && !puntoEnSuperficie(s, 200, -50));
  // Girada y con otra forma: el centro útil de una U no es el centro de su caja, pero sí cae sobre la tapa.
  const u = girarNodo(llamar(salaGrande(), "agregar_mesas", { tipo: "u", x_cm: 0, z_cm: 0 }).escena, "mesa-u", 90);
  const su = superficieSuperior(u.nodos[0]!, armarEscena(u))!;
  assert.ok(puntoEnSuperficie(su, su.centro.x, su.centro.z), "el centro útil está sobre la tapa");
  assert.ok(su.radioUtilCm > 20 && su.radioUtilCm <= 35.5);
  const luna = mesaDePedido({ tipo: "media_luna", anchoCm: 180 });
  assert.ok(superficieDeMesa(luna).radioUtilCm > 30);
  // Una mesa del catálogo (por su caja) y lo que no es mesa.
  const catalogo: Escena = { ...salaGrande(), nodos: [{ id: "m", nombre: "Mesa", pieza: piezaDeMueble(muebleDe("mesa_imperial_mantel")!), colocacion: { en: "piso", xCm: 40, zCm: 0, giroGrados: 0 } }, { id: "s", nombre: "Silla", pieza: piezaDeMueble(muebleDe("silla_tiffany")!), colocacion: { en: "piso", xCm: -200, zCm: 0, giroGrados: 0 } }] };
  const sc = superficieSuperior(catalogo.nodos[0]!, armarEscena(catalogo))!;
  cerca(sc.altoCm, 75, 1, "alto del catálogo");
  cerca(sc.centro.x, 40, 1, "x del catálogo");
  assert.equal(superficieSuperior(catalogo.nodos[1]!, armarEscena(catalogo)), null);
});

// ----------------------------------------------------------------------------------------------------------
// Lo de antes
// ----------------------------------------------------------------------------------------------------------

const huella = (id: string) => { const a = armarPieza(piezaDeMueble(muebleDe(id)!)); return `${(a.solidos ?? []).length}:${createHash("sha1").update(JSON.stringify(a.solidos)).digest("hex").slice(0, 16)}`; };

prueba("mesa_redonda_sillas y mesa_imperial_sillas arman idénticas a como armaban (huella fija) y las escenas viejas cargan sin avisos", () => {
  assert.equal(huella("mesa_redonda_sillas"), "138:976efe8723286291");
  assert.equal(huella("mesa_imperial_sillas"), "175:8c396b6d98278fb5");
  assert.equal(huella("silla_tiffany"), "17:94d7e238e12c3947");
  const vieja: Escena = {
    ...salaGrande(),
    nodos: [
      { id: "a", nombre: "Mesa redonda con 8 sillas", pieza: piezaDeMueble(muebleDe("mesa_redonda_sillas")!), colocacion: { en: "piso", xCm: -200, zCm: 0, giroGrados: 0 } },
      { id: "b", nombre: "Mesa imperial con 10 sillas", pieza: piezaDeMueble(muebleDe("mesa_imperial_sillas")!), colocacion: { en: "piso", xCm: 250, zCm: 0, giroGrados: 20 } },
    ],
  };
  const guardada = EscenaSchema.parse(JSON.parse(JSON.stringify(vieja)));
  assert.deepEqual(armarEscena(guardada).avisos, []);
  assert.deepEqual(contarMobiliario(guardada), { mesas: 2, sillas: 18 });
  // La escena nueva también viaja por el esquema, y lo malo no pasa.
  const nueva = llamar(salaGrande(), "agregar_mesas", { cantidad: 2, sillas_por_mesa: 6, tipo: "u" }).escena;
  const viaje = EscenaSchema.parse(JSON.parse(JSON.stringify(nueva)));
  assert.equal(armarEscena(viaje).avisos.length, 0);
  assert.equal(JSON.stringify(viaje), JSON.stringify(nueva));
  const mala = JSON.parse(JSON.stringify(nueva)) as Escena;
  (mala.nodos[0]!.pieza as { mueble: { mesa: { tipo: string } } }).mueble.mesa.tipo = "hexagonal";
  assert.ok(!EscenaSchema.safeParse(mala).success, "una mesa con un tipo que no existe no pasa");
  // agregar_mobiliario sigue poniendo la pieza fija (una sola) y avisa de la herramienta nueva.
  const fija = llamar(salaGrande(), "agregar_mobiliario", { id: "mesa_redonda_sillas" });
  assert.equal(fija.escena.nodos.length, 1);
  assert.match(fija.resumen, /conjunto fijo de 8 sillas.*cambiar_sillas.*agregar_mesas/);
});

prueba("un conjunto fijo pasa a mesa con sillas editables, en su sitio y con sus colores, al tocar sus sillas", () => {
  const vieja: Escena = {
    ...salaGrande(),
    nodos: [
      { id: "a", nombre: "Mesa redonda con 8 sillas", pieza: piezaDeMueble(muebleDe("mesa_redonda_sillas")!, { anchoCm: 270, fondoCm: 270, altoCm: 90, colores: ["#112233", "#445566", "#778899"] }), colocacion: { en: "piso", xCm: -200, zCm: 30, giroGrados: 15 } },
      { id: "b", nombre: "Mesa imperial con 10 sillas", pieza: piezaDeMueble(muebleDe("mesa_imperial_sillas")!), colocacion: { en: "piso", xCm: 250, zCm: 0, giroGrados: 0 } },
    ],
  };
  assert.ok(vieja.nodos.every(esConjuntoFijo));
  const pasada = pasarAConjunto(vieja, "a")!;
  assert.equal(pasada.nodos.length, 3);
  const m = mesaDePieza(nodo(pasada, "a").pieza)!;
  assert.deepEqual([m.tipo, m.anchoCm, m.colorMantel], ["redonda", 150, "#112233"]);
  assert.deepEqual(nodo(pasada, "a").colocacion, { en: "piso", xCm: -200, zCm: 30, giroGrados: 15 });
  const s = sillasDePieza(sillasDe(pasada, "a")!.pieza)!;
  assert.deepEqual([s.tipo, s.puestos.length, s.colorEstructura, s.colorCojin], ["tiffany", 8, "#445566", "#778899"]);
  // La caja del conjunto de antes y la de ahora coinciden (la mesa y las sillas ocupan lo mismo).
  const antes = caja(vieja, "a"), ahora = armarEscena(pasada);
  const juntas = { min: { x: Math.min(...["a", "sillas-a"].map((id) => ahora.porNodo.find((n) => n.id === id)!.caja.min.x)), z: 0 }, max: { x: Math.max(...["a", "sillas-a"].map((id) => ahora.porNodo.find((n) => n.id === id)!.caja.max.x)), z: 0 } };
  cerca(juntas.max.x - juntas.min.x, antes.max.x - antes.min.x, 6, "ancho del conjunto");
  // Con la herramienta: cambiar_sillas lo pasa solo.
  const r = llamar(vieja, "cambiar_sillas", { ids: ["b"], cantidad: 6 });
  assert.match(r.resumen, /era un conjunto fijo/);
  assert.equal(cuantas(r.escena, "b"), 6);
  assert.ok(esConjuntoFijo(nodo(r.escena, "a")), "el otro no se tocó");
  const todas = llamar(vieja, "cambiar_sillas", { cantidad: 4, tipo_silla: "ghost" });
  assert.ok(todas.escena.nodos.every((n) => !esConjuntoFijo(n)));
  assert.deepEqual(contarMobiliario(todas.escena), { mesas: 2, sillas: 8 });
  assert.equal(cuantas(llamar(vieja, "cambiar_mesas", { ids: ["b"], tipo: "ovalada" }).escena, "b"), 10);
});

// ----------------------------------------------------------------------------------------------------------
// Declaraciones, indicaciones y el taller
// ----------------------------------------------------------------------------------------------------------

prueba("las sillas no se sueltan de su mesa: mover, girar, deslizar y decorar van a la mesa; una mesa nueva no cae sobre las sillas; el tope de piezas se respeta", () => {
  const base = llamar(salaGrande(), "agregar_mesas", { sillas_por_mesa: 6, x_cm: 0, z_cm: 0 }).escena;
  const movida = llamar(base, "mover_pieza", { id: "sillas-mesa-redonda", donde: { en: "piso", x_cm: 200, z_cm: 0 } });
  assert.deepEqual(movida.escena.nodos.find((n) => n.id === "sillas-mesa-redonda")!.colocacion, base.nodos.find((n) => n.id === "sillas-mesa-redonda")!.colocacion, "las sillas siguen `sobre` su mesa");
  assert.equal(nodo(movida.escena, "mesa-redonda").colocacion.en === "piso" && (nodo(movida.escena, "mesa-redonda").colocacion as { xCm: number }).xCm, 200, "se movió la mesa");
  const girada = llamar(base, "girar_pieza", { id: "sillas-mesa-redonda", grados: 90 });
  assert.equal((nodo(girada.escena, "mesa-redonda").colocacion as { giroGrados: number }).giroGrados, 90);
  const armada = armarEscena(base);
  assert.equal(aceptaDecoraciones(nodo(base, "sillas-mesa-redonda"), armada.porNodo.find((n) => n.id === "sillas-mesa-redonda")), false, "no se cuelga nada de unas sillas");
  // Una mesa nueva sin sitio pedido no cae sobre las sillas de la que ya está.
  const dos = llamar(base, "agregar_mesas", { sillas_por_mesa: 6 }).escena;
  const nuevas = mesas(dos).filter((m) => m.id !== "mesa-redonda");
  assert.equal(nuevas.length, 1);
  for (const n of dos.nodos.filter((x) => x.id !== "mesa-redonda" && x.id !== "sillas-mesa-redonda" && (x.id.includes("redonda-2")))) {
    const a = caja(dos, n.id), b = caja(dos, "sillas-mesa-redonda");
    assert.ok(a.max.x <= b.min.x || b.max.x <= a.min.x || a.max.z <= b.min.z || b.max.z <= a.min.z, `${n.id} cae sobre las sillas de la mesa que ya estaba`);
  }
  // El tope: duplicar una mesa con sillas sin lugar para las dos piezas no hace nada; la herramienta lo dice.
  const casi: Escena = { ...base, nodos: [...base.nodos, ...Array.from({ length: MAX_NODOS - base.nodos.length - 1 }, (_, i): NodoEscena => ({ id: `g${i}`, nombre: "globo", pieza: { tipo: "globo", formatoId: "R-12", infladoCm: 30, codigo: "005" }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }))] };
  assert.equal(casi.nodos.length, MAX_NODOS - 1);
  assert.equal(duplicarNodo(casi, "mesa-redonda"), casi);
  assert.match(falla(casi, "duplicar_pieza", { id: "mesa-redonda" }), /máximo/);
  // Duplicar unas sillas con un padre que no es mesa no entra en bucle.
  const raro: Escena = { ...base, nodos: base.nodos.map((n) => (n.id === "sillas-mesa-redonda" ? { ...n, colocacion: { ...n.colocacion, padreId: "sillas-mesa-redonda" } as NodoEscena["colocacion"] } : n)) };
  assert.equal(duplicarNodo(raro, "sillas-mesa-redonda"), raro);
});

prueba("pasar un conjunto fijo a editable dice si se pierden sillas", () => {
  const chico: Escena = { ...salaGrande(), nodos: [{ id: "b", nombre: "Imperial", pieza: piezaDeMueble(muebleDe("mesa_imperial_sillas")!, { anchoCm: 144, fondoCm: 150, altoCm: 90, colores: ["#ffffff", "#d6b25a", "#f4efe4"] }), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  const notas: string[] = [];
  const pasada = pasarAConjunto(chico, "b", notas)!;
  assert.ok(cuantas(pasada, "b") < 10 && notas.some((n) => /solo caben/.test(n)), notas.join(" | "));
  assert.match(llamar(chico, "cambiar_sillas", { ids: ["b"], cantidad: 10 }).resumen, /solo caben/);
});

prueba("las tres herramientas están declaradas y compactas; todas las declaraciones caben en 120 KB", () => {
  for (const n of ["agregar_mesas", "cambiar_sillas", "cambiar_mesas"]) assert.ok(NOMBRES_HERRAMIENTAS.includes(n), n);
  const propias = DECLARACIONES_ESCENA.filter((d) => ["agregar_mesas", "cambiar_sillas", "cambiar_mesas"].includes(d.name));
  assert.equal(propias.length, 3);
  const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
  assert.ok(bytes(propias) < 9 * 1024, `las 3 pesan ${bytes(propias)} B`);
  assert.ok(bytes(DECLARACIONES_ESCENA) < 120 * 1024, `todas pesan ${bytes(DECLARACIONES_ESCENA)} B`);
  const agregar = JSON.stringify(propias.find((d) => d.name === "agregar_mesas"));
  for (const t of [...TIPOS_MESA, ...TIPOS_SILLA, ...DISPOSICIONES]) assert.ok(agregar.includes(t), `falta ${t}`);
  const prompt = REGLAS_AGENTE;
  assert.match(prompt, /agregar_mesas/);
  assert.match(prompt, /«Mesas de N personas» = N sillas por mesa/);
  assert.match(prompt, /sillas_por_mesa/);
});


fin("test-mobiliario-libre-ia");
