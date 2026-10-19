/**
 * La foto de XV años del dueño (2026-10-10, «quince-mesa»): un fondo con guirnalda orgánica, paneles de glitter y lentejuelas,
 * puertas con arco, neones de mariposa y un trono, visto desde una mesa de invitados. En producción salió una mesa redonda gigante
 * en el centro y una guirnalda de 84 globos flotando a media pared. Sin red ni IA: las lecturas y las detecciones son las del
 * registro real (`scripts/test/fixtures/foto-quince/`, sin la foto: tiene personas):
 * - `lectura-produccion.json`: Gemini con el prompt de producción (la mesa del primer plano como `mesa_redonda_mantel`, escala de la mesa);
 * - `lectura-nueva.json`: Gemini con el prompt nuevo; `lectura-claude.json`: Claude (CLI) con el prompt nuevo;
 * - `lectura-cromado-a.json`, `-b.json` y `-c.json` (la c con el piso leído en el primer plano, 0,88): Gemini (2026-10-11) con el prompt que nombra el malva y la ciruela espejo como cromados.
 * Cada una pasa por el camino de producción (`medirConDetecciones` → `compilarLectura`).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-foto-quince.ts
 *
 * El largo de la guirnalda y su escala salen de los globos detectados (≈ 9,6 m de alto de foto); su cuerpo, del grosor medido (≈ 0,06 a
 * 0,08 del alto): la foto enseña unos 80 globos a la vista, y armada lleva 130 a 160 (el resto queda detrás, como en una de verdad).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { codigoDeColor } from "../../src/lib/globos3d/colores-lectura";
import { ajustarColoresSiPuede } from "../../src/lib/globos3d/cuotas-color";
import { copiasDeTelon, esTelonRepetible } from "../../src/lib/globos3d/telones-en-fila";
import { avisoDeOmitidas } from "../../src/lib/globos3d/escena-ia-foto";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { escalaDelMontaje } from "../../src/lib/globos3d/escala-del-montaje";
import { conHonestidad } from "../../src/lib/globos3d/honestidad-respuesta";
import { LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { resolverOtro } from "../../src/lib/globos3d/lectura-otro";
import { medirConDetecciones, type FondoDetectado, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { medirFondos } from "../../src/lib/globos3d/medir-fondos";
import { pisoPorFondosDetectados } from "../../src/lib/globos3d/piso-por-fondos";
import { alargarPorLosGlobos } from "../../src/lib/globos3d/puntas-por-globos";
import { sinPrimerPlano, sujetoDeLaFoto } from "../../src/lib/globos3d/sujeto-foto";
import { globosDe } from "../../src/lib/globos3d/medir-geometria";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";

let pruebas = 0, fallos = 0;
const prueba = (nombre: string, fn: () => void) => {
  try { fn(); pruebas += 1; console.log(`  ok  ${nombre}`); } catch (e) { fallos += 1; console.log(`  FALLA ${nombre}: ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)}`); }
};

const F = "scripts/test/fixtures/foto-quince/";
const json = (nombre: string): unknown => JSON.parse(readFileSync(F + nombre, "utf8"));
const detecciones = json("detecciones.json") as GloboDetectado[];
const fondos = json("fondos.json") as FondoDetectado[];

/** Lo que ve la persona: la lectura medida con las detecciones y compilada, como en `modelarDesdeFoto`. */
function modelar(archivo: string) {
  const medida = medirConDetecciones(LecturaFotoSchema.parse(json(archivo)), detecciones, fondos);
  const c = compilarLectura(medida.lectura);
  return { medida, c, armada: armarEscena(c.escena), notas: [...medida.notas, ...c.notas] };
}

const esDorado = (codigo: string) => /dorado/i.test(referenciaPorCodigo(codigo)?.nombreCompleto ?? "");
const idsDe = (e: Escena) => e.nodos.map((n) => n.id);

/** La parte (0 a 1) de cada color de la guirnalda `k` de la lectura medida en lo armado, junto a la que dice la lectura: por el código con que se arma cada color. */
function repartoDeLaGuirnalda(archivo: string, k: number) {
  const { medida, armada } = modelar(archivo);
  const leida = medida.lectura.piezas.filter((p): p is Extract<PiezaLeida, { tipo: "guirnalda_organica" }> => p.tipo === "guirnalda_organica")[k]!;
  const nodo = armada.porNodo.filter((n) => n.id.startsWith("guirnalda-organica"))[k]!;
  const peso = leida.colores.reduce((s, x) => s + x.peso, 0);
  return leida.colores.map((x) => {
    const codigos = new Set(["R-18", "R-12", "R-9", "R-5", "R-24"].map((f) => codigoDeColor(x, [f], [])));
    return { nombre: x.nombre, leido: x.peso / peso, armado: nodo.globos.filter((g) => codigos.has(g.codigo)).length / nodo.globos.length, dorado: [...codigos].some(esDorado), globos: nodo.globos.length };
  });
}

/** Lo que tiene que cumplir cualquiera de las tres lecturas: el sujeto, la guirnalda, el color y el fondo. */
function comprobarEscena(archivo: string, fondosEsperados: Readonly<Record<string, number>>) {
  const { medida, c, armada, notas } = modelar(archivo);
  // 1. Ni una mesa: la del primer plano es el salón desde donde se tomó la foto.
  assert.ok(!c.escena.nodos.some((n) => /^mesa/.test(n.id)), `sin mesas: ${idsDe(c.escena).join(", ")}`);
  assert.ok(notas.some((n) => /primer plano/.test(n)), "la nota dice que lo del primer plano no es la decoración");
  for (const n of armada.porNodo.filter((x) => x.solidos.length)) assert.ok(n.caja.max.x - n.caja.min.x < 250, `${n.id}: ningún mueble gigante (${Math.round(n.caja.max.x - n.caja.min.x)} cm)`);
  // 2. La guirnalda cruza el fondo, pegada a la pared, sobre los paneles (ni a media pared a 3,6 m ni en el piso).
  const guirnaldas = armada.porNodo.filter((n) => n.id.startsWith("guirnalda-organica"));
  const desde = Math.min(...guirnaldas.map((n) => n.caja.min.x)), hasta = Math.max(...guirnaldas.map((n) => n.caja.max.x));
  assert.ok(hasta - desde >= 350, `la guirnalda cruza ${Math.round(hasta - desde)} cm`);
  const globosGuirnalda = guirnaldas.reduce((s, n) => s + n.globos.length, 0);
  assert.ok(globosGuirnalda >= 130, `${globosGuirnalda} globos en la guirnalda`);
  for (const g of c.escena.nodos.filter((n) => n.id.startsWith("guirnalda-organica"))) assert.equal(g.colocacion.en === "pared" && g.colocacion.pared, "fondo", `${g.id} en la pared del fondo`);
  const abajo = Math.min(...guirnaldas.map((n) => n.caja.min.y)), arriba = Math.max(...guirnaldas.map((n) => n.caja.max.y));
  assert.ok(abajo >= 60 && abajo <= 200 && arriba >= 220 && arriba <= 330, `la guirnalda va de ${Math.round(abajo)} a ${Math.round(arriba)} cm del piso`);
  // 3. El dorado de los racimos cromados cuenta, y es el que dice la lectura (medida con los globos detectados): el de cada guirnalda y, juntas, el de toda la escena.
  const globos = armada.globos;
  const dorado = globos.filter((g) => esDorado(g.codigo)).length / globos.length;
  const guirnaldasLeidas = medida.lectura.piezas.filter((p) => p.tipo === "guirnalda_organica").length;
  let doradoLeido = 0;
  for (let k = 0; k < guirnaldasLeidas; k++) {
    const reparto = repartoDeLaGuirnalda(archivo, k);
    doradoLeido += reparto.filter((x) => x.dorado).reduce((s, x) => s + x.leido, 0) * reparto[0]!.globos;
    for (const x of reparto) assert.ok(Math.abs(x.armado - x.leido) <= 0.05, `guirnalda ${k + 1}, ${x.nombre}: leído ${Math.round(x.leido * 100)} %, armado ${Math.round(x.armado * 100)} %`);
  }
  doradoLeido /= globosGuirnalda;
  assert.ok(dorado > 0 && Math.abs(dorado - doradoLeido) <= 0.05, `dorado armado ${Math.round(dorado * 100)} %, leído ${Math.round(doradoLeido * 100)} %`);
  // 4. Los paneles, puertas y el trono del catálogo.
  for (const [prefijo, cuantos] of Object.entries(fondosEsperados)) {
    const hay = c.escena.nodos.filter((n) => n.id === prefijo || n.id.startsWith(`${prefijo}-`)).length;
    assert.ok(hay >= cuantos, `${prefijo}: ${hay} de ${cuantos} (${idsDe(c.escena).join(", ")})`);
  }
  return { c, notas, globosGuirnalda, dorado, largo: hasta - desde };
}

console.log("Las tres lecturas del registro, por el camino de producción");

prueba("producción: sin la mesa gigante, guirnalda de 5,8 m sobre los paneles, dorado, lentejuelas y trono", () => {
  const r = comprobarEscena("lectura-produccion.json", { lentejuelas: 2, sillon: 1 });
  assert.ok(r.notas.some((n) => /Mesa redonda con mantel.*primer plano/.test(n)), "la mesa leída se quita con su nota");
  assert.ok(r.notas.some((n) => /línea del piso leída \(0\.95\)/.test(n)), "el piso pasa al pie del montaje");
  assert.ok(r.notas.some((n) => /escala leída \(280 cm.*no cuadra/.test(n)), "la escala de la mesa se rehace con los paneles");
  assert.ok(r.notas.some((n) => /guirnalda 1 sigue más allá/.test(n)), "la guirnalda se alarga hasta el racimo dorado de la derecha");
  assert.ok(r.notas.some((n) => /vajilla con copas.*sobre la mesa de invitados/.test(n)), "lo de encima de la mesa se va con ella");
  assert.deepEqual(r.c.omitidas, [], "nada de la mesa de invitados llega como «No pude»");
});

prueba("prompt nuevo (Gemini): la mesa es «primer plano», la puerta con arco y el neón de mariposa como «No pude»", () => {
  const r = comprobarEscena("lectura-nueva.json", { lentejuelas: 1, "arcos-chiara": 1, sillon: 1 });
  assert.ok(r.notas.some((n) => /primer plano: mesa de invitados.*no decoración/.test(n)), r.notas.join(" | "));
  assert.ok(r.notas.some((n) => /línea del piso leída \(0\.52\).*0\.452/.test(n)), "el piso pasa a las patas del trono detectado");
  // El dorado de la foto es ~36 % de los globos detectados (21 de 58), no el 59 % de antes; el morado detectado (26 %) es el merlot de la lectura.
  assert.ok(r.dorado >= 0.3 && r.dorado <= 0.42, `dorado ${Math.round(r.dorado * 100)} %`);
  const merlot = repartoDeLaGuirnalda("lectura-nueva.json", 0).find((x) => /merlot/i.test(x.nombre))!;
  assert.ok(merlot.leido >= 0.2 && merlot.armado >= 0.2, `merlot leído ${Math.round(merlot.leido * 100)} %, armado ${Math.round(merlot.armado * 100)} %`);
  assert.ok(r.c.escena.nodos.filter((n) => n.id === "lentejuelas" || n.id.startsWith("lentejuelas-")).length === 2, "la otra pared de glitter que la detección trae y el lector no leyó");
  assert.ok(r.c.omitidas.some((o) => /mariposa/.test(o)), r.c.omitidas.join(" | "));
});

prueba("prompt nuevo (Claude): neones de mariposa y flores del piso como «No pude», y la puerta con arco", () => {
  const r = comprobarEscena("lectura-claude.json", { lentejuelas: 2, "arcos-chiara": 1, sillon: 1 });
  assert.deepEqual(r.c.omitidas.filter((o) => /mariposa|flores/.test(o)).length, 3, r.c.omitidas.join(" | "));
});

prueba("prompt con el cromado (Gemini, 2026-10-11, tres lecturas): el malva o ciruela espejo se lee Reflex Violeta cromado y se arma Reflex, el dorado es el de la foto y las dos paredes de glitter salen", () => {
  for (const [archivo, puerta] of [["lectura-cromado-a.json", "marco-tela"], ["lectura-cromado-b.json", "marco-tela"], ["lectura-cromado-c.json", "arcos-chiara"]] as const) {
    const r = comprobarEscena(archivo, { lentejuelas: 2, [puerta]: 1, sillon: 1 });
    assert.ok(r.dorado >= 0.27 && r.dorado <= 0.4, `${archivo}: dorado ${Math.round(r.dorado * 100)} %`);
    const { armada } = modelar(archivo);
    const violeta = armada.globos.filter((g) => g.codigo === "951").length / armada.globos.length;
    assert.ok(violeta >= 0.18, `${archivo}: Reflex Violeta ${Math.round(violeta * 100)} %`);
    assert.equal(armada.globos.filter((g) => g.codigo === "051").length, 0, `${archivo}: ni un Fashion Violeta mate`);
  }
});

prueba("si el lector pone el piso en el primer plano (0,88) y la detección lo sube al pie del montaje, los paneles vuelven a decir la escala (con el piso de antes salía en 640 cm y la guirnalda de 112 globos)", () => {
  const { medida, armada } = modelar("lectura-cromado-c.json");
  assert.ok(medida.notas.some((n) => /línea del piso leída \(0\.88\).*0\.452/.test(n)), medida.notas.join(" | "));
  assert.ok(medida.notas.some((n) => /no cuadra con los paneles del fondo que leyó: ellos dan \d+ cm/.test(n)), medida.notas.join(" | "));
  assert.ok(medida.lectura.escala.altoImagenCm >= 900, `escala ${medida.lectura.escala.altoImagenCm} cm`);
  assert.equal(medida.notas.filter((n) => /no cuadra con los paneles del fondo/.test(n)).length, 1, "la nota de la escala sale una sola vez");
  assert.ok(!/telones del fondo \(leída \d+: telones/.test(medida.lectura.escala.referencia), medida.lectura.escala.referencia);
  assert.ok(armada.globos.length >= 130, `${armada.globos.length} globos`);
});

prueba("lo que no se armó llega a la persona como «No pude armar de la foto», pieza por pieza, aunque el modelo lo calle", () => {
  const { c } = modelar("lectura-claude.json");
  const callada = "Armé la guirnalda y los paneles de la foto.";
  assert.match(conHonestidad(callada, [], [], [avisoDeOmitidas(c.omitidas, callada)!]), /No pude armar de la foto: neón de mariposa en pie.*arreglo de flores/);
  const aMedias = "Armé todo; los neones de mariposa no los tiene el taller.";
  const resto = avisoDeOmitidas(c.omitidas, aMedias)!;
  assert.ok(!resto.texto.includes("mariposa") && resto.texto.includes("arreglo de flores"), resto.texto);
  assert.equal(avisoDeOmitidas(c.omitidas, "Ni los neones de mariposa ni el arreglo de flores del piso se arman."), null, "si ya lo dijo todo, no se repite");
  assert.equal(avisoDeOmitidas(["Pieza 3 (fondo): Cannot read properties of undefined"], callada)!.texto, "No pude armar de la foto: una pieza (fondo) no se pudo armar.", "sin el error interno");
  assert.equal(avisoDeOmitidas([], callada), null);
});

console.log("Las reglas, una por una");

const color = { nombre: "blanco", hex: "#f4f2ee", peso: 100, acabado: "mate" as const };
const base: LecturaFoto = LecturaFotoSchema.parse(json("lectura-produccion.json"));
const fondo = (id: string, extra: Partial<Extract<PiezaLeida, { tipo: "fondo" }>>): PiezaLeida => ({ tipo: "fondo", id, x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.3, colores: [color], ...extra });
const guirnalda = base.piezas.find((p) => p.tipo === "guirnalda_organica")!;

prueba("en un primer plano de la mesa de postres o del trono, la pieza del montaje se queda y la escala no salta", () => {
  const pared = fondo("lentejuelas", { x: 0.5, yBase: 0.55, alto: 0.5, ancho: 0.9 });
  const postres = LecturaFotoSchema.parse({ ...base, pisoY: null, escala: { altoImagenCm: 150, referencia: "mesa de postres de 90 cm" }, piezas: [pared, fondo("mesa_postres", { yBase: 0.99, alto: 0.6, ancho: 0.9 })] });
  const r1 = sujetoDeLaFoto(postres).lectura;
  assert.equal(r1.piezas.length, 2, "la mesa de postres es del montaje");
  assert.equal(r1.escala.altoImagenCm, 150, "sin la línea del piso, los telones no rehacen la escala");
  const trono = LecturaFotoSchema.parse({ ...base, pisoY: 0.98, escala: { altoImagenCm: 250, referencia: "trono" }, piezas: [{ ...guirnalda, puntos: guirnalda.puntos.map((q) => ({ ...q, y: 0.1 })) }, fondo("sillon", { yBase: 0.99, alto: 0.7, ancho: 0.6 })] });
  assert.equal(sujetoDeLaFoto(trono).lectura.piezas.length, 2, "un trono no es la mesa de invitados");
});

prueba("la mesa de invitados se va aunque el lector la llame mesa_mantel o lea también las sillas de los invitados", () => {
  const conSillas = LecturaFotoSchema.parse({ ...base, piezas: [...base.piezas.filter((p) => p.tipo !== "fondo" || p.id !== "mesa_redonda_mantel"), fondo("mesa_mantel", { x: 0.5, yBase: 1, ancho: 1, alto: 0.6 }), fondo("silla_tiffany", { x: 0.1, yBase: 0.99, ancho: 0.2, alto: 0.5 })] });
  const r = sinPrimerPlano(conSillas);
  assert.ok(!r.lectura.piezas.some((p) => p.tipo === "fondo" && p.id === "mesa_mantel"), r.notas.join(" | "));
});

prueba("la escala leída solo se cambia cuando los paneles dicen 1,6 veces más, nunca menos", () => {
  const panel = fondo("lentejuelas", { yBase: 0.8, alto: 0.6 });
  const cortado = LecturaFotoSchema.parse({ ...base, pisoY: 0.8, escala: { altoImagenCm: 150, referencia: "x" }, piezas: [fondo("lentejuelas", { yBase: 0.8, alto: 0.8 })] });
  assert.equal(escalaDelMontaje(cortado).lectura, cortado, "un panel cortado por el borde de arriba no enseña su alto");
  const corta = LecturaFotoSchema.parse({ ...base, pisoY: 0.8, escala: { altoImagenCm: 200, referencia: "x" }, piezas: [panel] });
  assert.equal(escalaDelMontaje(corta).lectura.escala.altoImagenCm, 400, "240 cm en 0,6 del alto");
  const parecida = LecturaFotoSchema.parse({ ...corta, escala: { altoImagenCm: 300, referencia: "x" } });
  assert.equal(escalaDelMontaje(parecida).lectura, parecida);
  const grande = LecturaFotoSchema.parse({ ...corta, escala: { altoImagenCm: 900, referencia: "x" } });
  assert.equal(escalaDelMontaje(grande).lectura, grande);
});

prueba("la línea del piso sube a las patas de los muebles solo si todos flotan sobre ella y nada leído baja más", () => {
  const trono: FondoDetectado = { box_2d: [250, 550, 452, 655], id: "silla_tiffany" };
  const leida = (pisoY: number, piezas: PiezaLeida[] = [guirnalda]) => LecturaFotoSchema.parse({ ...base, pisoY, piezas });
  assert.equal(pisoPorFondosDetectados(leida(0.58), [trono]).pisoY, 0.452);
  assert.equal(pisoPorFondosDetectados(leida(0.58), [trono, { box_2d: [500, 100, 600, 300], id: "pedestales" }]).pisoY, 0.58, "un pedestal apoya en ella");
  assert.equal(pisoPorFondosDetectados(leida(0.58), [{ box_2d: [100, 100, 300, 300], id: "lentejuelas" }]).pisoY, 0.58, "un telón con el pie tapado no cuenta");
  assert.equal(pisoPorFondosDetectados(leida(0.58), [{ box_2d: [500, 0, 990, 1000], id: "mesa_redonda_mantel" }]).pisoY, 0.58, "lo cortado por abajo no cuenta");
  const columna: PiezaLeida = { tipo: "columna_organica", forma: "recta", x: 0.2, yBase: 0.9, yArriba: 0.3, ancho: 0.1, grosor: 0.1, tamanos: {}, racimos: 0.3, colores: [color] };
  assert.equal(pisoPorFondosDetectados(leida(0.9, [columna]), [{ box_2d: [600, 400, 750, 600], id: "mesa_postres" }]).pisoY, 0.9, "una columna leída apoya en la línea leída: la mesa detectada detrás no la sube");
});

prueba("la punta se alarga por una masa continua de globos, no por uno suelto lejos ni con los de la guirnalda vecina", () => {
  const g = (x: number, y: number) => ({ box_2d: [(y - 0.015) * 1000, (x - 0.015) * 1000, (y + 0.015) * 1000, (x + 0.015) * 1000], color: "dorado" });
  const p = { ...guirnalda, puntos: [{ x: 0.1, y: 0.2, grosor: 0.08 }, { x: 0.5, y: 0.2, grosor: 0.08 }] } as Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
  const cadena = globosDe([0.56, 0.59, 0.62, 0.65, 0.68].map((x) => g(x, 0.2)), 1);
  const alargada = alargarPorLosGlobos([p], cadena, 1).guirnaldas[0]!;
  assert.ok(alargada.puntos.length === 3 && alargada.puntos[2]!.x > 0.6, JSON.stringify(alargada.puntos));
  const lejos = globosDe([0.56, 0.59, 0.85, 0.88, 0.91].map((x) => g(x, 0.2)), 1);
  assert.equal(alargarPorLosGlobos([p], lejos, 1).guirnaldas[0], p, "con un hueco, no");
  const vecina = { ...p, puntos: [{ x: 0.6, y: 0.2, grosor: 0.08 }, { x: 0.9, y: 0.2, grosor: 0.08 }] } as typeof p;
  assert.equal(alargarPorLosGlobos([p, vecina], cadena, 1).guirnaldas[0], p, "los globos de la vecina son de ella");
});

prueba("tres puertas leídas como UNA pieza con cantidad son tres, de lado a lado de lo leído; dos paredes de glitter, dos", () => {
  const puertasLeidas = fondo("arcos_chiara", { x: 0.45, yBase: 0.5, ancho: 0.3, alto: 0.3, cantidad: 3 }) as Extract<PiezaLeida, { tipo: "fondo" }>;
  const compiladas = compilarLectura(LecturaFotoSchema.parse({ ...base, piezas: [guirnalda, puertasLeidas] }));
  const puertas = armarEscena(compiladas.escena).porNodo.filter((n) => n.id === "arcos-chiara" || n.id.startsWith("arcos-chiara-"));
  assert.equal(puertas.length, 3, compiladas.escena.nodos.map((n) => n.id).join(", "));
  const cajas = puertas.map((n) => n.caja).sort((a, b) => a.min.x - b.min.x);
  const ancho = cajas.map((q) => q.max.x - q.min.x);
  assert.ok(Math.max(...ancho) - Math.min(...ancho) <= 2, `mismo ancho: ${ancho.map(Math.round).join(", ")}`);
  for (let i = 1; i < cajas.length; i++) assert.ok(cajas[i]!.min.x >= cajas[i - 1]!.max.x - 1, "una junto a otra, sin encimarse");
  const centro = (cajas[0]!.min.x + cajas[2]!.max.x) / 2;
  assert.ok(Math.abs(centro - (0.45 - 0.5) * base.aspecto * base.escala.altoImagenCm) <= 25, `centradas en x 0,45: ${Math.round(centro)} cm`);
  assert.ok(compiladas.notas.some((n) => /la foto trae 3 en fila; se arman 3/.test(n)), compiladas.notas.join(" | "));
  const conNombre = copiasDeTelon({ ...puertasLeidas, texto: "XV Ana", colorTexto: "dorado" }, base.aspecto)!;
  assert.deepEqual(conNombre.map((c) => c.texto), [undefined, "XV Ana", undefined], "el nombre rotulado va una sola vez, en la copia del centro");
  assert.deepEqual(conNombre.map((c) => c.colorTexto), [undefined, "dorado", undefined]);
  // Los arcos chiara escalonados llevan un arco por color: tres colores × cantidad 3 no son nueve arcos, son UN juego de arcos.
  const escalonados = { ...puertasLeidas, colores: [color, { ...color, hex: "#f2dcc4" }, { ...color, hex: "#d6336c" }] };
  assert.equal(copiasDeTelon(escalonados, base.aspecto), null, "con varios colores no es una fila");
  const juego = compilarLectura(LecturaFotoSchema.parse({ ...base, piezas: [guirnalda, escalonados] }));
  assert.equal(juego.escena.nodos.filter((n) => n.id.startsWith("arcos-chiara")).length, 1, "un solo juego de arcos");
  assert.ok(copiasDeTelon({ ...puertasLeidas, colores: [color] }, base.aspecto)?.length === 3, "con un solo color sí: tres puertas");
  const una = compilarLectura(LecturaFotoSchema.parse({ ...base, piezas: [guirnalda, { ...puertasLeidas, cantidad: undefined }] }));
  assert.equal(una.escena.nodos.filter((n) => n.id.startsWith("arcos-chiara")).length, 1, "sin cantidad, una sola pieza como siempre");
  const paredes = compilarLectura(LecturaFotoSchema.parse({ ...base, piezas: [guirnalda, fondo("lentejuelas", { cantidad: 2, ancho: 0.4, alto: 0.3, yBase: 0.5 })] }));
  assert.equal(paredes.escena.nodos.filter((n) => n.id.startsWith("lentejuelas")).length, 2);
});

prueba("si el ajuste de colores lanza, la guirnalda se queda como salió (con su nota y su «no se armó» del ajuste) y no va entera a «omitidas»", () => {
  const { c, medida } = modelar("lectura-nueva.json");
  const armada = armarEscena(c.escena);
  assert.ok(armada.porNodo.some((n) => n.id === "guirnalda-organica"));
  const pieza = c.escena.nodos.find((n) => n.id === "guirnalda-organica")!.pieza;
  assert.equal(pieza.tipo, "organico");
  if (pieza.tipo !== "organico") return;
  const notas: string[] = [], omitidas: string[] = [];
  const paleta = { paleta: [...pieza.opciones.colores], origen: pieza.opciones.colores.map((_, i) => i), objetivo: pieza.opciones.colores.map(() => 1 / pieza.opciones.colores.length) };
  const fallido = ajustarColoresSiPuede("Pieza 1 (guirnalda_organica): el ajuste de los colores al reparto de la lectura", pieza, paleta, (g) => `color ${g}`, notas, omitidas, () => { throw new Error("falla forzada"); });
  assert.equal(fallido.pieza, pieza, "la pieza sale como estaba");
  assert.equal(fallido.nota, null);
  assert.ok(notas.some((n) => /el ajuste de los colores.*no se pudo armar y se omite \(falla forzada\); el resto de la pieza se arma igual/.test(n)), notas.join(" | "));
  assert.ok(omitidas.some((o) => /el ajuste de los colores.*falla forzada/.test(o)) && omitidas.length === 1, omitidas.join(" | "));
  const bien = ajustarColoresSiPuede("x", pieza, paleta, (g) => `color ${g}`, [], []);
  assert.equal(bien.pieza.tipo, "organico", "sin fallo, el ajuste de siempre");
  assert.ok(medida.notas.length > 0 && !c.omitidas.some((o) => /ajuste de los colores/.test(o)), "una compilación normal no omite nada del ajuste");
  const fuente = readFileSync("src/lib/globos3d/compilar-lectura.ts", "utf8");
  assert.equal((fuente.match(/ajustarColoresSiPuede\(/g) ?? []).length, 2, "la guirnalda y el montón de piso pasan por el ajuste que no tira la pieza");
  assert.ok(!/conLasCuotasDeLaLectura\(/.test(fuente), "ninguna pieza llama al ajuste sin la red");
});

prueba("solo los cinco telones de ancho y alto se repiten por una detección: un aro, el biombo o una escalera (piezas que se cobran) no se agregan solos", () => {
  for (const id of ["lentejuelas", "arcos_chiara", "panel_redondo", "media_luna", "cortina_luces"]) assert.equal(esTelonRepetible(id), true, id);
  for (const id of ["aro_metalico", "aro_hexagonal", "arco_metalico", "biombo", "escalera_decorativa", "cortina_flecos", "marco_tela", "letrero", "sillon"]) assert.equal(esTelonRepetible(id), false, id);
  const aro = fondo("aro_metalico", { x: 0.3, yBase: 0.5, ancho: 0.2, alto: 0.3 });
  const caja = (x0: number, x1: number) => ({ id: "aro_metalico", box_2d: [200, x0, 500, x1] });
  const r = medirFondos([aro], [caja(200, 400), caja(600, 800)], base.aspecto);
  assert.equal(r.piezas.filter((p) => p.tipo === "fondo" && p.id === "aro_metalico").length, 1, "el segundo aro detectado no se arma por sí solo");
});

prueba("el «otro» del salón y de la gente no es un «No pude»; el trono es el sillón del catálogo", () => {
  for (const d of ["primer plano: mesa de invitados con vajilla", "invitados sentados a la mesa y personas bailando al fondo", "personas presentes en el salón"]) assert.equal(resolverOtro(d).tipo, "escenografia", d);
  const trono = resolverOtro("trono tapizado rosado con marco dorado");
  assert.ok(trono.tipo === "catalogo" && trono.id === "sillon", JSON.stringify(trono));
  assert.equal(resolverOtro("neón de mariposa blanco sobre el arco central, sin letras").tipo, "pendiente");
  for (const d of ["novios de globos sobre la mesa", "quinceañera de cartón a la izquierda", "trono de globos dorados", "quinceañera de acrílico", "novios de pastel", "primer plano: racimo de globos dorados"]) assert.equal(resolverOtro(d).tipo, "pendiente", `${d}: es decoración que falta, no el salón ni el sillón`);
  const postres = resolverOtro("mesa de postres frente a las mesas de invitados");
  assert.ok(postres.tipo === "catalogo" && postres.id === "mesa_postres", JSON.stringify(postres));
});

console.log(`test-foto-quince: ${pruebas} pruebas ok, ${fallos} con fallas`);
if (fallos) process.exit(1);
