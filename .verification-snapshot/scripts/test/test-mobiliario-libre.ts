/**
 * REQ-012 «Mobiliario libre» (1/3): mesas, sillas, perímetro y conjunto. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-mobiliario-libre.ts
 * - las 8 mesas paramétricas y las 7 sillas arman como escenografía, apoyadas, con las medidas pedidas, mantel (piso, corto, ninguno) y camino;
 * - las sillas salen del perímetro REAL: radio parejo en la redonda, 4+4+1+1 en la imperial, cada disposición donde debe, sin encimarse; si no caben todas, las que caben y la nota;
 * - la mesa y sus sillas son dos piezas que se mueven, giran, duplican y quitan juntas; el grupo de sillas es UNA pieza (300 sillas, 60 piezas) y se junta en pocas mallas.
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { crearEscenografiaVisor } from "../../src/components/tres-d/escenografia-visor";
import { duplicarPieza, eliminarPieza } from "../../src/lib/globos3d/editor-solitario";
import { armarEscena, duplicarNodo, girarNodo, moverNodo, quitarNodo, type Escena } from "../../src/lib/globos3d/escena";
import { MAX_NODOS } from "../../src/lib/globos3d/limites-escena";
import { armarConjuntoMesa, mesaDePedido, sillasDePieza, sillasParaMesa } from "../../src/lib/globos3d/mobiliario-conjunto";
import { contarMobiliario } from "../../src/lib/globos3d/mobiliario-asientos-mesa";
import { SOMBRA_FALDA, sombrear } from "../../src/lib/globos3d/escenografia";
import { DISPOSICIONES, TIPOS_MESA, TIPOS_SILLA, type TipoMesa } from "../../src/lib/globos3d/mobiliario-conjunto-tipos";
import { armarMesa } from "../../src/lib/globos3d/mobiliario-mesas-param";
import { repartirSillas } from "../../src/lib/globos3d/mobiliario-perimetro";
import { elementosDeEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { SILLAS } from "../../src/lib/globos3d/mobiliario-sillas-param";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { caja, centro, cerca, cuantas, dist, fin, llamar, medidas, mesas, prueba, salaGrande, sillasDe } from "./lib-test-mobiliario-libre";

// ----------------------------------------------------------------------------------------------------------
// Mesas
// ----------------------------------------------------------------------------------------------------------

prueba("las 8 mesas paramétricas arman sin globos, apoyadas en el piso, con su alto y sus medidas", () => {
  assert.equal(TIPOS_MESA.length, 8);
  const pedidos: Array<[TipoMesa, { anchoCm?: number; fondoCm?: number; altoCm?: number }, number, number]> = [
    ["redonda", { anchoCm: 180 }, 180, 180], ["cuadrada", { anchoCm: 100 }, 100, 100], ["rectangular", { anchoCm: 300, fondoCm: 100 }, 300, 100], ["ovalada", { anchoCm: 260, fondoCm: 130 }, 260, 130],
    ["coctel", {}, 60, 60], ["media_luna", { anchoCm: 200 }, 200, 100], ["serpentina", { anchoCm: 240, fondoCm: 60 }, 235, 105], ["u", { anchoCm: 600, fondoCm: 500 }, 600, 500],
  ];
  for (const [tipo, pedido, ancho, fondo] of pedidos) {
    const m = mesaDePedido({ tipo, ...pedido });
    const pieza = armarPieza({ tipo: "escenografia", elementos: [], mueble: { id: "mesa_param", mesa: m } });
    assert.equal(pieza.globos.length, 0, tipo);
    assert.equal(pieza.materiales.length, 0, `${tipo} no cotiza`);
    const r = medidas({ tipo: "escenografia", elementos: [], mueble: { id: "mesa_param", mesa: m } });
    cerca(r.y0, 0, 0.6, `${tipo} apoyada`);
    cerca(r.alto, m.altoCm, 2.5, `${tipo} alto`);
    // La serpentina mide lo que ocupa su S (su recorrido es el ancho pedido): solo se exige que sea una mesa de ese orden.
    cerca(r.ancho, ancho, Math.max(ancho * 0.14, 8), `${tipo} ancho`);
    cerca(r.fondo, fondo, Math.max(fondo * 0.14, 8), `${tipo} fondo`);
  }
});

prueba("el mantel (piso, corto, ninguno), su color y el camino cambian lo que se arma", () => {
  const cuenta = (m: Parameters<typeof mesaDePedido>[0]) => armarMesa(mesaDePedido(m)).length;
  for (const tipo of ["redonda", "rectangular", "ovalada"] as const) {
    const piso = armarMesa(mesaDePedido({ tipo, mantel: "piso", colorMantel: "#112233" }));
    const corto = armarMesa(mesaDePedido({ tipo, mantel: "corto", colorMantel: "#112233" }));
    const ninguno = armarMesa(mesaDePedido({ tipo, mantel: "ninguno", colorMantel: "#112233", colorPatas: "#445566" }));
    // La falda cae a la sombra de la tapa y el reborde y el dobladillo son un poco más oscuros (para que se lea la forma); la tapa lleva el color pedido.
    const tonos = ["#112233", sombrear("#112233", SOMBRA_FALDA), sombrear("#112233", 0.85)];
    assert.ok(piso.some((e) => e.hex === "#112233") && piso.every((e) => tonos.includes(e.hex)), `${tipo}: el mantel hasta el piso es del color pedido (la falda, apenas más oscura)`);
    assert.ok(corto.some((e) => e.hex !== "#112233"), `${tipo}: el mantel corto deja ver las patas`);
    assert.ok(ninguno.some((e) => e.hex === "#445566") && ninguno.some((e) => e.hex === "#112233"), `${tipo}: sin mantel hay tapa y patas de sus colores`);
    // El mantel corto deja las patas a la vista; el de piso las tapa.
    const bajo = (els: ReturnType<typeof armarMesa>) => Math.min(...armarEscenografiaMinY(els));
    assert.ok(bajo(piso) <= 0.5 && bajo(corto) <= 0.5, `${tipo} toca el piso`);
    assert.equal(cuenta({ tipo, camino: "#aa0000" }), cuenta({ tipo }) + (tipo === "redonda" ? 1 : 3), `${tipo}: el camino suma su tira${tipo === "redonda" ? "" : " y lo que cuelga de las cabeceras"}`);
  }
  assert.equal(cuenta({ tipo: "media_luna", camino: "#aa0000" }), cuenta({ tipo: "media_luna" }), "el camino no va en la media luna");
});

function armarEscenografiaMinY(els: ReturnType<typeof armarMesa>): number[] {
  return els.map((e) => (e.forma === "caja" ? e.centro.y - e.tamano.y / 2 : e.forma === "cilindro" ? e.base.y : (e.en?.origen.y ?? 0)));
}

// ----------------------------------------------------------------------------------------------------------
// Sillas
// ----------------------------------------------------------------------------------------------------------

prueba("las 7 sillas arman apoyadas con su alto; el cojín y el color son lo pedido y las acrílicas no llevan cojín", () => {
  assert.equal(TIPOS_SILLA.length, 7);
  const mesa = mesaDePedido({ tipo: "redonda" });
  for (const tipo of TIPOS_SILLA) {
    const r = sillasParaMesa(mesa, { cantidad: 1, tipo, colorEstructura: "#336699", colorCojin: "#ffcc00" });
    assert.ok(r.sillas, tipo);
    const pieza: Pieza = { tipo: "escenografia", elementos: [], mueble: { id: "sillas_param", sillas: r.sillas! } };
    const els = elementosDeEscenografia(pieza as Extract<Pieza, { tipo: "escenografia" }>);
    assert.ok(els.length >= 6, `${tipo}: ${els.length} sólidos`);
    const hexes = new Set(els.map((e) => e.hex));
    assert.ok(hexes.has("#336699"), `${tipo}: lleva el color pedido`);
    assert.equal(hexes.has("#ffcc00"), Boolean(SILLAS[tipo].cojin), `${tipo}: el cojín solo donde el tipo lo lleva`);
    if (tipo === "ghost") assert.ok(els.every((e) => e.acabado === "acrilico"), "la ghost es de acrílico");
    const sin = sillasParaMesa(mesa, { cantidad: 1, tipo, colorEstructura: "#336699", colorCojin: null }).sillas!;
    assert.equal(sin.colorCojin, null, `${tipo} sin cojín`);
    const m = medidas({ tipo: "escenografia", elementos: [], mueble: { id: "sillas_param", sillas: { ...r.sillas!, puestos: [{ x: 0, z: 0, giroGrados: 0 }] } } });
    cerca(m.y0, 0, 0.6, `${tipo} apoyada`);
    cerca(m.alto, SILLAS[tipo].altoCm, SILLAS[tipo].altoCm * 0.1, `${tipo} alto`);
  }
  // Cambiar de tipo sin decir color toma los colores del tipo nuevo.
  const tiffany = sillasParaMesa(mesa, { cantidad: 4 }).sillas!;
  const crossback = sillasParaMesa(mesa, { cantidad: 4, tipo: "crossback" }, tiffany).sillas!;
  assert.equal(crossback.colorEstructura, SILLAS.crossback.estructura);
  assert.equal(sillasParaMesa(mesa, { cantidad: 4, colorEstructura: "#00aa00" }, tiffany).sillas!.colorCojin, tiffany.colorCojin, "el mismo tipo conserva el cojín");
});

// ----------------------------------------------------------------------------------------------------------
// El perímetro
// ----------------------------------------------------------------------------------------------------------

prueba("redonda Ø150 con 8: mismo radio, parejas y mirando a la mesa; el radio sale de la mesa y de la silla", () => {
  const m = mesaDePedido({ tipo: "redonda", anchoCm: 150 });
  const r = repartirSillas(m, { tipo: "tiffany", cantidad: 8, disposicion: "alrededor" });
  assert.equal(r.puestos.length, 8);
  const radios = r.puestos.map((p) => Math.hypot(p.x, p.z));
  cerca(Math.max(...radios) - Math.min(...radios), 0, 1.2, "radio parejo");
  cerca(radios[0]!, 75 + 7 + 22.5 + 6, 1.5, "radio = mesa + vuelo del mantel + media silla + aire");
  const ang = r.puestos.map((p) => Math.atan2(p.x, p.z)).sort((a, b) => a - b);
  const pasos = ang.map((a, i) => (i ? a - ang[i - 1]! : a + 2 * Math.PI - ang[7]!));
  cerca(Math.max(...pasos) - Math.min(...pasos), 0, 0.08, "ángulos parejos");
  for (const p of r.puestos) {
    const hacia = (Math.atan2(-p.x, -p.z) * 180) / Math.PI;
    cerca(((p.giroGrados - hacia + 540) % 360) - 180, 0, 3, "mira al centro");
  }
  // Una mesa más grande o una silla más ancha cambian el radio y lo que cabe (no es un 8 fijo).
  const grande = repartirSillas(mesaDePedido({ tipo: "redonda", anchoCm: 240 }), { tipo: "tiffany", cantidad: 8, disposicion: "alrededor" });
  assert.ok(Math.hypot(grande.puestos[0]!.x, grande.puestos[0]!.z) > radios[0]! + 40);
  assert.ok(grande.capacidad > r.capacidad);
  assert.ok(repartirSillas(m, { tipo: "banca", cantidad: 40, disposicion: "alrededor" }).capacidad < r.capacidad, "las bancas ocupan más");
});

prueba("imperial 240×90 con 10: 4 + 4 + una en cada cabecera; cada disposición va donde debe", () => {
  const m = mesaDePedido({ tipo: "rectangular", anchoCm: 240, fondoCm: 90 });
  const todas = repartirSillas(m, { tipo: "tiffany", cantidad: 10, disposicion: "alrededor" }).puestos;
  assert.equal(todas.filter((p) => p.z > 40).length, 4);
  assert.equal(todas.filter((p) => p.z < -40).length, 4);
  assert.equal(todas.filter((p) => Math.abs(p.x) > 130).length, 2);
  for (const p of todas.filter((q) => Math.abs(q.z) > 40)) assert.ok(Math.abs(p.giroGrados) < 1 || Math.abs(Math.abs(p.giroGrados) - 180) < 1, "derechas por los lados largos");
  const lado = repartirSillas(m, { tipo: "tiffany", cantidad: 4, disposicion: "un_lado" }).puestos;
  assert.ok(lado.length === 4 && lado.every((p) => p.z > 40), "un_lado: todas del mismo lado");
  const dos = repartirSillas(m, { tipo: "tiffany", cantidad: 8, disposicion: "dos_lados" }).puestos;
  assert.ok(dos.length === 8 && dos.every((p) => Math.abs(p.z) > 40 && Math.abs(p.x) < 130), "dos_lados: sin cabeceras");
  const cab = repartirSillas(m, { tipo: "tiffany", cantidad: 2, disposicion: "cabeceras" }).puestos;
  assert.ok(cab.length === 2 && cab.every((p) => Math.abs(p.x) > 130 && Math.abs(p.z) < 1), "cabeceras: solo las puntas");
  // Frente: los comensales miran al fondo de la sala (180°): se sientan del lado de adelante (+z) y miran a −z.
  const frente = repartirSillas(m, { tipo: "tiffany", cantidad: 4, disposicion: "frente", haciaGrados: 180 }).puestos;
  assert.ok(frente.length === 4 && frente.every((p) => p.z > 40 && Math.abs(Math.abs(p.giroGrados) - 180) < 1), "frente: del lado contrario al escenario, mirándolo");
  const redonda = repartirSillas(mesaDePedido({ tipo: "redonda" }), { tipo: "tiffany", cantidad: 5, disposicion: "frente", haciaGrados: 180 }).puestos;
  assert.ok(redonda.every((p) => p.z > 0), "en la redonda, media vuelta del lado contrario al escenario");
});

prueba("si no caben todas: las que caben y la nota; la media luna no se sienta por su lado plano", () => {
  const cuadrada = repartirSillas(mesaDePedido({ tipo: "cuadrada", anchoCm: 90 }), { tipo: "tiffany", cantidad: 10, disposicion: "alrededor" });
  assert.equal(cuadrada.puestos.length, 4);
  assert.equal(cuadrada.capacidad, 4);
  assert.match(cuadrada.nota ?? "", /solo caben 4 sillas Tiffany .*pediste 10.*puse 4/);
  assert.equal(repartirSillas(mesaDePedido({ tipo: "cuadrada", anchoCm: 90 }), { tipo: "tiffany", cantidad: 3, disposicion: "alrededor" }).nota, null, "si caben, sin nota");
  const luna = repartirSillas(mesaDePedido({ tipo: "media_luna", anchoCm: 180 }), { tipo: "tiffany", cantidad: 12, disposicion: "alrededor" });
  assert.ok(luna.puestos.length >= 5 && luna.puestos.length < 12);
  assert.ok(luna.puestos.every((p) => p.z > -45 + 20), "ninguna del lado plano (atrás)");
  assert.equal(repartirSillas(mesaDePedido({ tipo: "redonda" }), { tipo: "tiffany", cantidad: 0, disposicion: "alrededor" }).puestos.length, 0);
});

prueba("ninguna silla se encima con otra, en ningún tipo de mesa ni de silla", () => {
  for (const tipo of TIPOS_MESA) for (const silla of ["tiffany", "banca", "taburete"] as const) for (const d of DISPOSICIONES) {
    const r = repartirSillas(mesaDePedido({ tipo }), { tipo: silla, cantidad: 40, disposicion: d, haciaGrados: 180 });
    const ancho = SILLAS[silla].anchoCm;
    for (let i = 0; i < r.puestos.length; i++) for (let j = i + 1; j < r.puestos.length; j++) {
      assert.ok(dist(r.puestos[i]!, r.puestos[j]!) >= ancho * 0.85, `${tipo}/${silla}/${d}: dos sillas a ${dist(r.puestos[i]!, r.puestos[j]!).toFixed(1)} cm`);
    }
  }
});

// ----------------------------------------------------------------------------------------------------------
// El conjunto: dos piezas que van juntas
// ----------------------------------------------------------------------------------------------------------

function conjuntoSolo(opciones: Parameters<typeof armarConjuntoMesa>[0]["sillas"] = { cantidad: 4 }, extra: Partial<Parameters<typeof armarConjuntoMesa>[0]> = {}): Escena {
  const c = armarConjuntoMesa({ ids: { mesa: "mesa-1", sillas: "sillas-mesa-1" }, mesa: { tipo: "redonda" }, sillas: opciones, colocacion: { en: "piso", xCm: 100, zCm: 50, giroGrados: 0 }, ...extra });
  return { ...salaGrande(), nodos: c.nodos };
}

prueba("armarConjuntoMesa es una función pura: mesa y grupo de sillas como nodos (el grupo `sobre` la mesa) y sin sillas, solo la mesa", () => {
  const c = armarConjuntoMesa({ ids: { mesa: "m", sillas: "s" }, mesa: { tipo: "rectangular", anchoCm: 300, fondoCm: 100 }, sillas: { cantidad: 12, tipo: "crossback", disposicion: "alrededor" }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } });
  assert.deepEqual(c.nodos.map((n) => n.id), ["m", "s"]);
  assert.ok(c.sillas && c.sillas.colocacion.en === "sobre" && c.sillas.colocacion.padreId === "m");
  assert.equal(sillasDePieza(c.sillas.pieza)!.puestos.length, 12);
  assert.equal(sillasDePieza(c.sillas.pieza)!.tipo, "crossback");
  const sola = armarConjuntoMesa({ ids: { mesa: "m", sillas: "s" }, mesa: { tipo: "redonda" }, sillas: { cantidad: 0 }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } });
  assert.equal(sola.nodos.length, 1);
  const demasiadas = armarConjuntoMesa({ ids: { mesa: "m", sillas: "s" }, mesa: { tipo: "cuadrada", anchoCm: 90 }, sillas: { cantidad: 12 }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } });
  assert.equal(sillasDePieza(demasiadas.sillas!.pieza)!.puestos.length, 4);
  assert.equal(sillasDePieza(demasiadas.sillas!.pieza)!.pedida, 12, "recuerda las que se pidieron");
  assert.ok(demasiadas.notas.some((n) => /solo caben 4/.test(n)));
});

prueba("las sillas se mueven, giran y duplican con su mesa, y se quitan con ella", () => {
  const e0 = conjuntoSolo({ cantidad: 4, disposicion: "un_lado" });
  const rel = (e: Escena) => { const m = centro(caja(e, "mesa-1")), s = centro(caja(e, "sillas-mesa-1")); return { x: s.x - m.x, z: s.z - m.z, mx: m.x, mz: m.z }; };
  const antes = rel(e0);
  assert.ok(antes.z > 60 && Math.abs(antes.x) < 1, `las sillas de un lado quedan al frente: ${JSON.stringify(antes)}`);
  const movida = moverNodo(e0, "mesa-1", { x: 120, y: 0, z: -60 }, { iman: false });
  const m1 = rel(movida);
  cerca(m1.mx - antes.mx, 120, 0.5, "la mesa se movió");
  cerca(m1.x, antes.x, 0.5, "las sillas la siguieron en x");
  cerca(m1.z, antes.z, 0.5, "y en z");
  const girada = rel(girarNodo(e0, "mesa-1", 90));
  cerca(girada.x, antes.z, 1.5, "girada 90°, el frente de la mesa mira a +x y las sillas con él");
  cerca(girada.z, 0, 1.5, "…y ya no están delante");
  // Duplicar la mesa copia el grupo; duplicar las sillas duplica la mesa con ellas.
  const dup = duplicarNodo(e0, "mesa-1");
  assert.equal(dup.nodos.length, 4);
  const copia = mesas(dup).find((n) => n.id !== "mesa-1")!;
  const sillasCopia = sillasDe(dup, copia.id);
  assert.ok(sillasCopia && sillasCopia.id !== "sillas-mesa-1", "la copia tiene sus propias sillas");
  assert.equal(cuantas(dup, copia.id), 4);
  assert.equal(duplicarNodo(e0, "sillas-mesa-1").nodos.length, 4, "duplicar las sillas duplica el conjunto, no mete dos grupos en una mesa");
  assert.equal(mesas(duplicarNodo(duplicarNodo(e0, "sillas-mesa-1"), "sillas-mesa-1")).length, 3);
  // Quitar la mesa quita las sillas; quitar las sillas deja la mesa.
  assert.equal(quitarNodo(e0, "mesa-1").nodos.length, 0);
  assert.deepEqual(quitarNodo(e0, "sillas-mesa-1").nodos.map((n) => n.id), ["mesa-1"]);
  // Con el menú del taller (duplicarPieza / eliminarPieza) también.
  const armada = armarEscena(e0);
  assert.equal(duplicarPieza(e0, "mesa-1", armada).escena.nodos.length, 4);
  assert.equal(eliminarPieza(e0, "mesa-1", { conDecoraciones: false, armada }).nodos.length, 0);
  assert.equal(eliminarPieza(e0, "mesa-1", { conDecoraciones: true, armada }).nodos.length, 0);
});

prueba("un grupo de 40 sillas es UNA pieza y se arma bien; 30 mesas de 10 sillas son 300 sillas en 60 piezas, sin avisos", () => {
  const r = llamar(salaGrande(), "agregar_mesas", { cantidad: 30, sillas_por_mesa: 10, tipo: "redonda", columnas: 6, separacion_cm: 10 });
  assert.equal(r.escena.nodos.length, 60);
  assert.ok(r.escena.nodos.length <= MAX_NODOS);
  const armada = armarEscena(r.escena);
  assert.deepEqual(armada.avisos, []);
  assert.equal(contarMobiliario(r.escena).sillas, 300);
  assert.equal(armada.porNodo.filter((n) => n.id.startsWith("sillas-")).reduce((s, n) => s + n.solidos.length, 0), 300 * 17);
  const una = llamar(salaGrande(), "agregar_mesas", { tipo: "u", sillas_por_mesa: 40 });
  assert.equal(una.escena.nodos.length, 2);
});

prueba("300 sillas se juntan en pocas mallas y se arman rápido (el visor junta lo del mismo material)", () => {
  const r = llamar(salaGrande(), "agregar_mesas", { cantidad: 30, sillas_por_mesa: 10, columnas: 6, separacion_cm: 10 });
  const t0 = performance.now();
  const armada = armarEscena(r.escena);
  const v = crearEscenografiaVisor(() => new THREE.Texture());
  const sillas = armada.porNodo.filter((n) => n.id.startsWith("sillas-"));
  const mallas = sillas.flatMap((n) => v.piezas(n.solidos));
  const ms = performance.now() - t0;
  assert.ok(mallas.length <= sillas.length * 3, `${mallas.length} mallas para 30 grupos`);
  assert.ok(ms < 8000, `armar y juntar 300 sillas tardó ${Math.round(ms)} ms`);
  v.liberar();
});


fin("test-mobiliario-libre");
