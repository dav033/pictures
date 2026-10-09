/**
 * Criterio de aceptación de una ronda de refinado (REQ-001 paso 9, P-016). Sin red ni coste (los embeddings y la captura son de mentira):
 * - estructura (se mide la caja de cada pieza armada en el mundo): una pieza que colgaba y baja al piso por la pared, el piso, otra
 *   pieza (reparentar) o el aire, una pieza visible que desaparece, una pieza tapada por los globos de otra más cercana a la
 *   cámara y un total de globos que cae más de 30 % rechazan la ronda; quitar solo se permite hasta donde la escena se pasa de la
 *   lectura de la foto; lo que ya estaba tapado antes y las escenas de las fotos de referencia sin cambios no;
 * - decisión: se acepta solo si la captura de después se parece a la foto al menos `MARGEN_MEJORA` más (el borde exacto cuenta);
 *   el coseno exige la misma dimensión; una frase por motivo y sin números;
 * - el evaluador (captura, reduce la foto una vez, pide el veredicto; si algo falla, se rechaza);
 * - el bucle: una ronda rechazada no se aplica (ni `alRonda` ni deshacer), el resultado carga los veredictos y la frase del motivo;
 * - nada del refinado en `lib/` hace `fetch`.
 * La ruta del servidor está en `test-similitud-refinado.ts` y el origen del pedido en `test-origen-pedido.ts`.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-aceptacion-refinado.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MARGEN_MEJORA, coseno, decidirAceptacion, mejoraDe, veredictoDe } from "@/lib/globos3d/refinado/aceptacion";
import { crearEvaluadorDeRonda, type CuerpoVeredicto } from "@/lib/globos3d/refinado/evaluador";
import { piezasOcultas, piezasQueBajaron, referenciaDeLectura, revisarEstructura, type Referencia } from "@/lib/globos3d/refinado/estructura";
import { MENSAJE_RECHAZO, veredictoSinComparar, type MotivoRechazo, type Rechazo, type Similitud, type Veredicto } from "@/lib/globos3d/refinado/motivos";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "@/lib/globos3d/encuadre-foto";
import { armarEscena, type Escena, type NodoEscena } from "@/lib/globos3d/escena";
import { camaraNumerica, proyectar } from "@/lib/globos3d/proyeccion-foto";
import { refinarConFoto, resumenDeRefinado, type ContextoEvaluacion, type DependenciasRefinado, type RespuestaRonda } from "@/lib/globos3d/refinado/bucle";
import type { ResultadoRonda } from "@/lib/globos3d/refinado/ronda";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const lectura7 = REFERENCIAS_DUENO.find((r) => r.numero === 7)!.lectura;
const encuadre = encuadreDeLectura(lectura7);
const escena7 = compilarLectura(lectura7).escena;
/** La escena de la foto 07 con el «LOVE» (pieza `libre`) puesto donde se pide. */
const conLove = (e: Escena, x: number, y: number, z: number): Escena => ({
  ...e, nodos: e.nodos.map((n) => (n.id === "metalizado" && n.colocacion.en === "libre" ? { ...n, colocacion: { ...n.colocacion, xCm: x, yCm: y, zCm: z } } : n)),
});
/** La escena con el «LOVE» puesto con otra colocación. */
const loveEn = (e: Escena, colocacion: NodoEscena["colocacion"]): Escena => ({ ...e, nodos: e.nodos.map((n) => (n.id === "metalizado" ? { ...n, colocacion } : n)) });
const sinNodo = (e: Escena, id: string): Escena => ({ ...e, nodos: e.nodos.filter((n) => n.id !== id) });
/** La guirnalda de la foto 07 acortada a la mitad de su recorrido (menos globos, la misma pieza). */
function guirnaldaCorta(e: Escena): Escena {
  return {
    ...e, nodos: e.nodos.map((n) => {
      if (n.id !== "guirnalda-organica" || n.pieza.tipo !== "organico") return n;
      const opciones = n.pieza.opciones;
      return { ...n, pieza: { ...n.pieza, opciones: { ...opciones, tramos: opciones.tramos.map((t) => ({ ...t, recorrido: t.recorrido.slice(0, Math.ceil(t.recorrido.length / 3)) })) } } };
    }),
  };
}
const globos = (e: Escena) => armarEscena(e).globos.length;

async function main() {
console.log("Cámara de la foto sin three.js");
await prueba("el centro de la imagen cae en el centro del cuadro y la altura de la foto llena el alto", () => {
  const camara = camaraNumerica(encuadre, escena7.sala);
  const plano = -escena7.sala.fondoCm / 2 + 40;
  const centro = proyectar(camara, { x: 0, y: encuadre.centroYCm, z: plano })!;
  assert.ok(Math.abs(centro.x) < 1e-9 && Math.abs(centro.y) < 1e-9);
  const arriba = proyectar(camara, { x: 0, y: encuadre.centroYCm + encuadre.altoCm / 2, z: plano })!;
  assert.ok(Math.abs(arriba.y - 1) < 1e-9, `el borde de arriba cae en y = ${arriba.y}`);
  assert.equal(proyectar(camara, { x: 0, y: 0, z: camara.z + 10 }), null, "detrás de la cámara no se ve");
});

console.log("Estructura");
const referencia7 = referenciaDeLectura(lectura7);
await prueba("la referencia de la foto 07 es lo que arma su lectura: 2 piezas y los globos de la guirnalda", () => {
  assert.deepEqual(referencia7, { piezas: 2, globos: globos(escena7) });
});
await prueba("las escenas de las fotos de referencia, sin cambios, no tienen nada que reprochar", () => {
  for (const n of [4, 7, 9, 12, 13]) {
    const l = REFERENCIAS_DUENO.find((r) => r.numero === n)!.lectura;
    const e = compilarLectura(l).escena;
    assert.equal(piezasOcultas(e, encuadreDeLectura(l)).size, 0, `foto ${n}: nada tapado de entrada`);
    assert.equal(revisarEstructura(e, e, encuadreDeLectura(l), referenciaDeLectura(l)), null, `foto ${n}`);
  }
});
await prueba("el «LOVE» que colgaba a 114 cm y baja a 5 cm rechaza la ronda; subirlo o bajarlo poco no", () => {
  const abajo = conLove(escena7, -30, 5, -190);
  assert.equal(piezasQueBajaron(armarEscena(escena7), armarEscena(abajo)).length, 1);
  const r = revisarEstructura(escena7, abajo, encuadre);
  assert.equal(r?.motivo, "pieza_baja");
  assert.match(r?.detalle ?? "", /114 cm a 5 cm/);
  assert.equal(revisarEstructura(escena7, conLove(escena7, -30, 150, -190), encuadre), null, "subirlo está bien");
  assert.equal(revisarEstructura(escena7, conLove(escena7, -30, 60, -190), encuadre), null, "bajarlo a 60 cm no es caerse al piso");
});
await prueba("pasar el «LOVE» de la pared al piso (colocación {en: piso}) rechaza la ronda", () => {
  const alPiso = loveEn(escena7, { en: "piso", xCm: -30, zCm: -190, giroGrados: 0 });
  assert.equal(armarEscena(alPiso).porNodo.find((n) => n.id === "metalizado")!.caja.min.y, 0, "en el mundo está en el piso");
  assert.equal(revisarEstructura(escena7, alPiso, encuadre)?.motivo, "pieza_baja");
});
await prueba("reparentar el «LOVE» a una pieza para que quede abajo (colocación {en: sobre}) rechaza la ronda", () => {
  // Se busca un punto sobre la guirnalda que deje el «LOVE» a menos de 15 cm: el criterio mide el mundo, no la colocación.
  const armada = armarEscena(escena7);
  const guirnalda = armada.porNodo.find((n) => n.id === "guirnalda-organica")!;
  const punto = guirnalda.puestas[0]!.caja.min;
  const sobre = loveEn(escena7, { en: "sobre", padreId: "guirnalda-organica", puntoCm: { x: punto.x, y: -140, z: punto.z }, normal: { x: 0, y: 0, z: 1 }, giroGrados: 0 });
  const bajoMundo = armarEscena(sobre).porNodo.find((n) => n.id === "metalizado")!.caja.min.y;
  assert.ok(bajoMundo < 15, `el «LOVE» quedó a ${bajoMundo} cm`);
  assert.equal(revisarEstructura(escena7, sobre, encuadre)?.motivo, "pieza_baja");
});
await prueba("una pieza que ya estaba a menos de 40 cm no cuenta como caída", () => {
  const baja = conLove(escena7, -30, 30, -190);
  assert.equal(revisarEstructura(baja, conLove(escena7, -30, 5, -190), encuadre), null);
});
await prueba("quitar una pieza visible (el «LOVE») rechaza la ronda aunque no baje nada", () => {
  const r = revisarEstructura(escena7, sinNodo(escena7, "metalizado"), encuadre, referencia7);
  assert.equal(r?.motivo, "pieza_quitada");
  assert.match(r?.detalle ?? "", /LOVE/);
  assert.equal(revisarEstructura(escena7, sinNodo(escena7, "metalizado"), encuadre)?.motivo, "pieza_quitada", "sin referencia tampoco se permite quitar");
});
await prueba("una pieza que sigue en la escena pero sin copias (su padre no existe) también cuenta como quitada", () => {
  const sinCopias: Escena = { ...escena7, nodos: escena7.nodos.map((n) => (n.id === "metalizado" ? { ...n, colocacion: { en: "ancla", padreId: "pieza-que-no-existe", ancla: 0, cada: 1, giroGrados: 0 } as const } : n)) };
  assert.equal(armarEscena(sinCopias).porNodo.find((n) => n.id === "metalizado")!.copias, 0);
  assert.equal(revisarEstructura(escena7, sinCopias, encuadre, referencia7)?.motivo, "pieza_quitada");
});
await prueba("se puede quitar lo que la escena tiene de más que la lectura de la foto, y no más", () => {
  const conExtra: Escena = { ...escena7, nodos: [...escena7.nodos, { ...escena7.nodos[1]!, id: "extra", nombre: "LOVE de más", colocacion: { en: "libre", xCm: 200, yCm: 100, zCm: -190, giroGrados: 0 } }] };
  assert.equal(revisarEstructura(conExtra, escena7, encuadre, referencia7), null, "quitar la pieza de más es lo correcto");
  assert.equal(revisarEstructura(conExtra, sinNodo(sinNodo(conExtra, "extra"), "metalizado"), encuadre, referencia7)?.motivo, "pieza_quitada", "pero no una de las que sí están en la foto");
});
/**
 * El «LOVE» puesto detrás de la guirnalda (a ras de la pared, a la altura de su cuerpo). Dónde queda tapado depende de cómo
 * se empacan los globos (el relleno tupido cambió el acomodo y dejó un hueco donde antes había globo): se busca el primer
 * sitio tapado entre varios a lo largo del cuerpo, en vez de fijar uno que dependa de un acomodo exacto.
 */
const loveTapado = (): Escena => {
  for (const y of [200, 230, 250, 215]) for (const x of [-20, 0, 20, -40, 40]) {
    const e = conLove(escena7, x, y, -245);
    if (piezasOcultas(e, encuadre).has("metalizado")) return e;
  }
  throw new Error("el «LOVE» no queda tapado detrás de la guirnalda en ningún sitio a la altura de su cuerpo");
};
await prueba("el «LOVE» detrás de los globos de la guirnalda queda tapado y rechaza la ronda", () => {
  const tapado = loveTapado();
  assert.deepEqual([...piezasOcultas(tapado, encuadre)], ["metalizado"]);
  const r = revisarEstructura(escena7, tapado, encuadre);
  assert.equal(r?.motivo, "pieza_oculta");
  assert.match(r?.detalle ?? "", /LOVE/);
});
await prueba("lo que ya estaba tapado antes de la ronda no se le reprocha a la ronda", () => {
  const tapado = loveTapado();
  assert.equal(revisarEstructura(tapado, tapado, encuadre), null);
});
await prueba("el «LOVE» delante de la guirnalda (más cerca de la cámara) se ve", () => {
  assert.equal(piezasOcultas(conLove(escena7, -20, 200, -100), encuadre).size, 0);
});
await prueba("acortar la guirnalda baja los globos más de 30 %: rechaza", () => {
  const corta = guirnaldaCorta(escena7);
  assert.ok(globos(corta) < globos(escena7) * 0.7, `quedaron ${globos(corta)} de ${globos(escena7)}`);
  assert.equal(revisarEstructura(escena7, corta, encuadre, referencia7)?.motivo, "menos_globos");
});
await prueba("bajar los globos solo se permite hasta lo que da la lectura: lo que sobra de la escena, no lo que pide el modelo", () => {
  // La escena tiene el doble de globos que la lectura (dos guirnaldas en lugar de una): quitar una es corregir el exceso.
  const doble: Escena = { ...escena7, nodos: [...escena7.nodos, { ...escena7.nodos[0]!, id: "guirnalda-2", nombre: "Guirnalda repetida" }] };
  const referencia: Referencia = referencia7;
  assert.ok(globos(doble) >= referencia.globos * 2 - 2);
  assert.equal(revisarEstructura(doble, escena7, encuadre, referencia), null, "volver a lo que dice la lectura se acepta");
  assert.equal(revisarEstructura(doble, guirnaldaCorta(escena7), encuadre, referencia)?.motivo, "menos_globos", "pasarse por debajo de la lectura no");
  assert.equal(revisarEstructura(escena7, guirnaldaCorta(escena7), encuadre, { ...referencia, globos: 500 })?.motivo, "menos_globos", "una lectura con más globos que la escena no deja bajar de 30 %");
  assert.equal(revisarEstructura(escena7, guirnaldaCorta(escena7), encuadre, { ...referencia, globos: 10 }), null, "una lectura con muchos menos globos que la escena sí lo permite: sobran");
});

console.log("Decisión");
const s = (antes: number, despues: number): Similitud => ({ antes, despues });
await prueba("se acepta solo si la captura de después se parece a la foto al menos el margen más que la de antes", () => {
  assert.equal(decidirAceptacion(s(0.6, 0.6 + MARGEN_MEJORA + 0.001), null).aceptada, true);
  const igual = decidirAceptacion(s(0.6, 0.6), null);
  assert.ok(!igual.aceptada && igual.rechazo.motivo === "no_mejora");
  const peor = decidirAceptacion(s(0.6, 0.55), null);
  assert.ok(!peor.aceptada && peor.rechazo.motivo === "no_mejora" && /menos/.test(peor.rechazo.detalle));
  const apenas = decidirAceptacion(s(0.6, 0.6 + MARGEN_MEJORA / 2), null);
  assert.ok(!apenas.aceptada && apenas.rechazo.motivo === "no_mejora", "una mejora dentro del ruido no basta");
});
await prueba("el borde exacto del margen se acepta y un pelo menos no", () => {
  for (const antes of [0.5, 0.6, 0.7321, 0.123456]) {
    assert.equal(decidirAceptacion(s(antes, antes + MARGEN_MEJORA), null).aceptada, true, `antes ${antes}: justo el margen`);
    assert.equal(decidirAceptacion(s(antes, antes + MARGEN_MEJORA - 1e-6), null).aceptada, false, `antes ${antes}: un pelo menos`);
  }
  assert.ok(Math.abs(mejoraDe(s(0.6, 0.65)) - 0.05) < 1e-12);
});
await prueba("la estructura manda sobre la similitud, y sin similitud no se acepta (sin_comparacion)", () => {
  const rechazo: Rechazo = { motivo: "pieza_baja", detalle: "bajó algo" };
  const v = decidirAceptacion(s(0.5, 0.9), rechazo);
  assert.ok(!v.aceptada && v.rechazo.motivo === "pieza_baja");
  const sin = decidirAceptacion(null, null);
  assert.ok(!sin.aceptada && sin.rechazo.motivo === "sin_comparacion");
});
await prueba("coseno: vectores iguales 1, ortogonales 0, vacío 0, y de distinta dimensión lanza", () => {
  assert.ok(Math.abs(coseno([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.equal(coseno([1, 0], [0, 1]), 0);
  assert.equal(coseno([0, 0], [1, 1]), 0);
  assert.throws(() => coseno([1, 2, 3], [1, 2]), RangeError);
  assert.throws(() => coseno([], [1]), RangeError);
});
await prueba("el veredicto que sale de una decisión lleva el motivo, el parecido y el coste, pero no el detalle con números", () => {
  const rechazada = veredictoDe(decidirAceptacion(s(0.6, 0.55), null), 0.0003);
  assert.deepEqual(rechazada, { aceptada: false, motivo: "no_mejora", similitud: s(0.6, 0.55), costeEstimadoUsd: 0.0003 });
  assert.deepEqual(veredictoDe(decidirAceptacion(s(0.5, 0.6), null), 0.0003), { aceptada: true, motivo: null, similitud: s(0.5, 0.6), costeEstimadoUsd: 0.0003 });
  assert.deepEqual(veredictoSinComparar(), { aceptada: false, motivo: "sin_comparacion", similitud: null, costeEstimadoUsd: 0 });
});

console.log("Mensajes");
await prueba("cada motivo de rechazo tiene su frase, distinta de las demás y sin números", () => {
  const motivos: MotivoRechazo[] = ["no_mejora", "pieza_baja", "pieza_quitada", "pieza_oculta", "menos_globos", "sin_comparacion"];
  assert.deepEqual(Object.keys(MENSAJE_RECHAZO).sort(), [...motivos].sort());
  assert.equal(new Set(motivos.map((m) => MENSAJE_RECHAZO[m])).size, motivos.length);
  for (const m of motivos) assert.ok(!/\d/.test(MENSAJE_RECHAZO[m]), `${m}: «${MENSAJE_RECHAZO[m]}» lleva números`);
});
await prueba("sin_comparacion no dice que no mejoró: dice que no se pudo comparar", () => {
  assert.match(MENSAJE_RECHAZO.sin_comparacion, /No pude comparar/);
  assert.doesNotMatch(MENSAJE_RECHAZO.sin_comparacion, /no mejoró/i);
  assert.match(MENSAJE_RECHAZO.no_mejora, /no mejoró/);
});

console.log("Evaluador y bucle");
const foto = { mime: "image/jpeg", base64: "Zm90bw==" };
const captura = (t: string) => ({ mime: "image/jpeg", base64: Buffer.from(t).toString("base64") });
const veredicto = (aceptada: boolean, motivo: MotivoRechazo | null = null, similitud: Similitud | null = s(0.5, aceptada ? 0.6 : 0.4)): Veredicto => ({ aceptada, motivo, similitud, costeEstimadoUsd: 0.0003 });
const evaluar = (respuesta: Veredicto | null | "falla", capturar?: (e: Escena) => Promise<{ mime: string; base64: string }>) => {
  const capturadas: Escena[] = [], pedidos: CuerpoVeredicto[] = [], reducidas: unknown[] = [];
  const f = crearEvaluadorDeRonda({
    capturar: capturar ?? (async (e) => { capturadas.push(e); return captura("despues"); }),
    reducirFoto: async (f) => { reducidas.push(f); return captura("foto-reducida"); },
    veredicto: async (cuerpo) => { pedidos.push(cuerpo); if (respuesta === "falla") throw new Error("red"); return respuesta; },
  });
  return { f, capturadas, pedidos, reducidas };
};
const contexto = (despues: Escena, antes: Escena = escena7): ContextoEvaluacion => ({ ronda: 1, antes, despues, capturaAntes: captura("antes"), foto, lectura: lectura7, encuadre, signal: new AbortController().signal });
await prueba("el evaluador captura la escena de después y manda al servidor las imágenes, las escenas y la lectura", async () => {
  const { f, capturadas, pedidos } = evaluar(veredicto(true));
  const nueva = conLove(escena7, 0, 150, -190);
  const v = await f(contexto(nueva));
  assert.ok(v.aceptada);
  assert.equal(capturadas.length, 1);
  assert.deepEqual(pedidos[0], { foto: captura("foto-reducida"), antes: captura("antes"), despues: captura("despues"), escenaAntes: escena7, escenaDespues: nueva, lectura: lectura7, ronda: 1 });
});
await prueba("la foto se reduce una sola vez por foto aunque haya varias rondas", async () => {
  const { f, reducidas } = evaluar(veredicto(true));
  await f(contexto(escena7)); await f(contexto(escena7));
  assert.equal(reducidas.length, 1);
  await f({ ...contexto(escena7), foto: { ...foto } });
  assert.equal(reducidas.length, 2, "otra foto se reduce de nuevo");
});
await prueba("el veredicto rechazado del servidor se entrega tal cual (motivo y parecido)", async () => {
  const { f } = evaluar(veredicto(false, "pieza_baja", null));
  const v = await f(contexto(conLove(escena7, -30, 5, -190)));
  assert.deepEqual(v, veredicto(false, "pieza_baja", null));
});
await prueba("si la captura o el servidor fallan, la ronda se rechaza como sin_comparacion (no se queda sin comparar)", async () => {
  const fallas = [evaluar("falla"), evaluar(null), evaluar(veredicto(true), async () => { throw new Error("WebGL"); })];
  for (const e of fallas) assert.deepEqual(await e.f(contexto(escena7)), veredictoSinComparar());
});

const cambio = { herramienta: "ajustar_tamanos", resumen: "R-24: 1 → 13", consulta: false };
const resultado = (): ResultadoRonda => ({ ronda: 1, diferencias: [], significativas: 1, cambios: 1, terminar: true, motivo: "ultima_ronda" });
const escenaRonda: Escena = { ...escena7, sala: { ...escena7.sala, anchoCm: 777 } };
const respuesta = (): RespuestaRonda => ({ escena: escenaRonda, respuesta: "subí los R-24", acciones: [cambio], refinar: resultado() });
const entrada = { escena: escena7, foto, lectura: lectura7, encuadre };
function bucle(v: Veredicto, extra: Partial<DependenciasRefinado> = {}) {
  const aplicadas: number[] = [], progreso: string[] = [], contextos: ContextoEvaluacion[] = [];
  const deps: DependenciasRefinado = {
    capturar: async () => captura("antes"),
    pedir: async () => ({ ok: true, datos: respuesta() }),
    alProgreso: (p) => progreso.push(p.fase ?? "comparando"),
    alRonda: (h) => aplicadas.push(h.ronda),
    evaluar: async (c) => { contextos.push(c); return v; },
    signal: new AbortController().signal,
    maxRondas: 1,
    ...extra,
  };
  return { deps, aplicadas, progreso, contextos };
}
await prueba("una ronda que mejora se aplica, con su deshacer, y la barra pasa por «revisando»; el veredicto queda en el resultado", async () => {
  const { deps, aplicadas, progreso, contextos } = bucle(veredicto(true));
  const r = await refinarConFoto(entrada, deps);
  assert.deepEqual(aplicadas, [1]);
  assert.equal(r.rondas.length, 1);
  assert.equal(r.rondas[0]!.antes, escena7, "deshacer vuelve a la escena de antes");
  assert.equal(r.escena.sala.anchoCm, 777);
  assert.deepEqual(progreso, ["comparando", "revisando"]);
  assert.deepEqual(r.evaluaciones, [{ ronda: 1, veredicto: veredicto(true) }]);
  assert.equal(contextos[0]!.lectura, lectura7, "el servidor decide con la lectura: el navegador solo se la pasa");
  assert.equal(contextos[0]!.ronda, 1);
});
await prueba("una ronda que no mejora NO se aplica: la escena anterior sigue y el deshacer no recibe nada", async () => {
  const { deps, aplicadas } = bucle(veredicto(false, "no_mejora"));
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "rechazada");
  assert.deepEqual(aplicadas, []);
  assert.equal(r.rondas.length, 0);
  assert.equal(r.escena, escena7, "es la misma escena de antes de la ronda");
  assert.equal(r.rechazo, "no_mejora");
  assert.equal(r.evaluaciones.length, 1, "el veredicto rechazado también se conserva");
  assert.equal(resumenDeRefinado(r), MENSAJE_RECHAZO.no_mejora);
});
await prueba("cada motivo dice su frase al usuario, sin cifras", async () => {
  for (const motivo of Object.keys(MENSAJE_RECHAZO) as MotivoRechazo[]) {
    const r = await refinarConFoto(entrada, bucle(veredicto(false, motivo)).deps);
    assert.equal(r.motivo, "rechazada");
    assert.equal(resumenDeRefinado(r), MENSAJE_RECHAZO[motivo]);
  }
  const sinComparar = await refinarConFoto(entrada, bucle(veredictoSinComparar()).deps);
  assert.match(resumenDeRefinado(sinComparar), /^No pude comparar con la foto/);
});
await prueba("detener durante la revisión no aplica la ronda", async () => {
  const control = new AbortController();
  const { deps, aplicadas } = bucle(veredicto(true), { signal: control.signal, evaluar: async () => { control.abort(); return veredicto(true); } });
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "detenido");
  assert.deepEqual(aplicadas, []);
});
await prueba("sin criterio (la evaluación sin cabeza) las rondas se aplican como siempre, sin veredictos", async () => {
  const { deps, aplicadas } = bucle(veredicto(true), { evaluar: undefined });
  const r = await refinarConFoto(entrada, deps);
  assert.deepEqual(aplicadas, [1]);
  assert.deepEqual(r.evaluaciones, []);
});
await prueba("ninguna pieza de lib/globos3d/refinado hace fetch (los pedidos viven en components/tres-d/refinado-http.ts)", () => {
  const carpeta = path.resolve("src/lib/globos3d/refinado");
  for (const archivo of readdirSync(carpeta)) assert.doesNotMatch(readFileSync(path.join(carpeta, archivo), "utf8"), /\bfetch\(/, archivo);
});

console.log(`\n${pruebas} pruebas pasaron.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
