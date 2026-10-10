/**
 * La política de escala de la foto → escena (`escala-por-muebles.ts`, `medir-con-detecciones.ts`). Sin red ni coste.
 * - piezas de medida conocida (mesas, silla suelta, pedestales, panel redondo) dan la escala; lo que no es de medida conocida, no;
 * - precedencia: con piezas firmes, concuerdan → media geométrica, discrepan → mediana; sin ninguna pieza, los globos se limitan a 2× la escala leída (2,5× si varias
 *   guirnaldas coinciden); con una referencia blanda (pedestales, panel) mandan los globos dentro de su intervalo, que puede dejar la escala por encima de 2× la leída
 *   porque es evidencia de la foto y no un tope arbitrario; aun así nunca se pasa de la escala de los globos ni se cruza la leída hacia el otro lado;
 * - la banda muerta de ±10 % no rehace los formatos; la fuente y si los globos quedaron limitados (`acotada`) van en el resultado, en las notas y en la auditoría.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-escala-politica.ts
 */
import assert from "node:assert/strict";
import { decidirEscala, escalaPorMuebles, escalasCorroboradas, intervaloPorReferenciasBlandas, RAZON_MAXIMA_CORROBORADA, RAZON_MAXIMA_SIN_MUEBLES } from "../../src/lib/globos3d/escala-por-muebles";
import { diametroOrganicoCm } from "../../src/lib/globos3d/mezcla-lectura";
import { formatosPorEscala } from "../../src/lib/globos3d/medir-tamanos";
import { crearAzar } from "../../src/lib/globos3d/organico";
import type { MezclaLeida, PiezaLeida, LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { datosDeLaMedida } from "../../src/lib/globos3d/modelar-desde-foto";
import { medirConDetecciones, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const BLANCO = { nombre: "blanco", hex: "#f4f2ee", peso: 100, acabado: "mate" as const };
const fondoDe = (id: string, extra: Partial<Extract<PiezaLeida, { tipo: "fondo" }>> = {}): PiezaLeida => ({ tipo: "fondo", id, x: 0.5, yBase: 0.9, ancho: 0.3, alto: 0.3, colores: [BLANCO], ...extra });
const cercano = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

console.log("Piezas de medida conocida");
prueba("los pedestales son una referencia blanda: un intervalo con la medida de 75 cm del más alto, no un punto", () => {
  const caja = { id: "pedestales", box_2d: [500, 300, 900, 700] };
  const i = intervaloPorReferenciasBlandas([caja], [fondoDe("pedestales", { yBase: 0.9, alto: 0.4, ancho: 0.4 })], 1)!;
  assert.ok(cercano(i.min, (75 / 0.4) * 0.85, 0.5), `min ${i.min}`);
  assert.ok(i.max > (75 / 0.4) * 1.15 * 1.5, `max ${i.max}: sube por estar delante del plano`);
  assert.equal(escalaPorMuebles([caja], [fondoDe("pedestales", { yBase: 0.9, alto: 0.4, ancho: 0.4 })], 1), null, "no es una pieza firme");
});

prueba("de un juego de pedestales vale la caja detectada MÁS ALTA, no la unión de los cuerpos", () => {
  const cajas = [{ id: "pedestales", box_2d: [650, 300, 900, 400] }, { id: "pedestales", box_2d: [500, 420, 900, 520] }, { id: "pedestales", box_2d: [600, 540, 960, 640] }];
  const leidas = [fondoDe("pedestales", { x: 0.47, yBase: 0.9, alto: 0.46, ancho: 0.34, cantidad: 3 })];
  const i = intervaloPorReferenciasBlandas(cajas, leidas, 1)!;
  assert.ok(cercano(i.min, (75 / 0.4) * 0.85, 0.5), `la más alta mide 0,40 (la unión 0,46): min ${i.min}`);
});

prueba("el panel redondo da el intervalo por su ancho con aro (158 cm)", () => {
  const i = intervaloPorReferenciasBlandas([{ id: "panel_redondo", box_2d: [100, 400, 700, 600] }], [fondoDe("panel_redondo", { yBase: 0.7, alto: 0.6, ancho: 0.2 })], 1)!;
  assert.ok(cercano(i.min, (158 / 0.2) * 0.85, 1), `min ${i.min}`);
});

prueba("una silla suelta da la escala firme; una fila de sillas, una pieza que no es de medida conocida o sin caja detectada, no", () => {
  const silla = fondoDe("silla_tiffany", { yBase: 0.9, alto: 0.3, ancho: 0.1 });
  const caja = { id: "silla_tiffany", box_2d: [600, 450, 900, 550] };
  assert.ok(escalaPorMuebles([caja], [silla], 1)! > 0);
  assert.equal(escalaPorMuebles([caja], [{ ...silla, cantidad: 4 } as PiezaLeida], 1), null);
  assert.equal(escalaPorMuebles([{ id: "pastel", box_2d: [600, 450, 900, 550] }], [fondoDe("pastel")], 1), null);
  assert.equal(escalaPorMuebles([], [silla], 1), null);
});

console.log("Precedencia");
prueba("sin piezas, los globos que inflan la escala 2,3× quedan acotados a 2× la leída y la decisión dice que es una cota", () => {
  const d = decidirEscala(694, null, 300);
  assert.equal(d.cm, 300 * RAZON_MAXIMA_SIN_MUEBLES);
  assert.deepEqual([d.fuente, d.acotada], ["globos_acotados", true]);
  assert.equal(decidirEscala(150, null, 300).cm, 150, "1,9× por debajo todavía cabe");
  const d2 = decidirEscala(320, null, 300);
  assert.deepEqual([d2.cm, d2.fuente, d2.acotada], [320, "globos", false]);
});

prueba("si varias guirnaldas coinciden entre sí la cota se ensancha: la evidencia es de los globos, no de una pieza", () => {
  assert.equal(escalasCorroboradas([400, 430]), true);
  assert.equal(escalasCorroboradas([400, 700]), false);
  assert.equal(escalasCorroboradas([400]), false);
  assert.equal(decidirEscala(900, null, 300, true).cm, 300 * RAZON_MAXIMA_CORROBORADA);
  assert.equal(decidirEscala(500, null, 300, true).cm, 500);
});

prueba("con piezas firmes: concuerdan → media geométrica; discrepan → la mediana; la fuente lo dice", () => {
  const juntos = decidirEscala(251, 318, 260);
  assert.equal(Math.round(juntos.cm), 283);
  assert.equal(juntos.fuente, "globos+muebles");
  const mueble = decidirEscala(694, 220, 300);
  assert.deepEqual([mueble.cm, mueble.fuente], [300, "lectura"], "globos 694, pieza 220, lectura 300: manda la mediana");
  assert.deepEqual([decidirEscala(694, 320, 300).cm, decidirEscala(694, 320, 300).fuente], [320, "muebles"]);
});

prueba("con una referencia blanda los globos valen dentro de su intervalo y, fuera, el borde más cercano", () => {
  const i = { min: 190, max: 400 };
  assert.deepEqual([decidirEscala(380, null, 300, false, i).cm, decidirEscala(380, null, 300, false, i).acotada], [380, false]);
  const fuera = decidirEscala(694, null, 300, false, i);
  assert.deepEqual([fuera.cm, fuera.fuente, fuera.acotada], [400, "referencia_blanda", true]);
  assert.equal(decidirEscala(100, null, 300, false, i).cm, 190);
  assert.deepEqual([decidirEscala(215, null, 215, false, { min: 278, max: 600 }).cm, decidirEscala(215, null, 215, false, { min: 278, max: 600 }).acotada], [215, false], "si globos y lector coinciden, la referencia blanda no los empuja");
});

console.log("Formatos con la escala final");
prueba("formatosPorEscala rehace el formato de cada escalón: diámetro × escala vuelve a cuadrar con el formato nombrado", () => {
  // Medidos con una escala de 520 cm (R-12 = 25 cm → d 0,048; R-18 = 34 cm...) y reescalados a 260: los cm se parten por la mitad.
  const d = { gigante: 0.14, grande: 0.075, mediano: 0.05, chico: 0.045 };
  const m: MezclaLeida = { gigantes: 4, grandes: 20, medianos: 50, chicos: 26, diametroGigante: d.gigante, diametroGrande: d.grande, diametroMediano: d.mediano, diametroChico: d.chico, formatoGigante: "R-36", formatoGrande: "R-24", formatoMediano: "R-18", formatoChico: "R-9" };
  const r = formatosPorEscala(m, 260);
  for (const [e, f] of [["diametroGigante", "formatoGigante"], ["diametroGrande", "formatoGrande"], ["diametroMediano", "formatoMediano"], ["diametroChico", "formatoChico"]] as const) {
    const cm = (r[e] as number) * 260, real = diametroOrganicoCm(r[f] as string)!;
    assert.ok(Math.abs(Math.log(real / cm)) < Math.log(1.45), `${f} ${r[f]} (${real} cm) no cuadra con ${cm.toFixed(0)} cm`);
  }
  assert.notEqual(r.formatoMediano, "R-18", "el R-18 de 520 cm ya no es de 13 cm de foto a 260");
  assert.equal(formatosPorEscala(m, 520).formatoMediano, "R-18", "con la escala con que se midieron no cambia nada");
});

console.log("Resultado de la medida");
const ASPECTO = 1;
const ESCALA_REAL = 300;
const D = { gigante: 75 / ESCALA_REAL, grande: 34 / ESCALA_REAL, mediano: 25 / ESCALA_REAL, chico: 12 / ESCALA_REAL };
const caja = (cx: number, cy: number, d: number, color: string): GloboDetectado => ({
  box_2d: [Math.round((cy - d / 2) * 1000), Math.round(((cx - d / 2) / ASPECTO) * 1000), Math.round((cy + d / 2) * 1000), Math.round(((cx + d / 2) / ASPECTO) * 1000)], color,
});
const EJE = [{ x: 0.12, y: 0.55, grosor: 0.14 }, { x: 0.3, y: 0.32, grosor: 0.14 }, { x: 0.5, y: 0.24, grosor: 0.14 }, { x: 0.7, y: 0.32, grosor: 0.14 }, { x: 0.88, y: 0.55, grosor: 0.14 }];
const DORADO = { nombre: "dorado", hex: "#D4AF37", peso: 60, acabado: "cromado" as const };
const guirnalda: PiezaLeida = {
  tipo: "guirnalda_organica", puntos: EJE, tamanos: {}, racimos: 0.4, colores: [DORADO, { ...BLANCO, peso: 40 }],
  mezcla: { gigantes: 5, grandes: 25, medianos: 50, chicos: 20, diametroGigante: 0.3, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
};
function globosAlLargo(eje: ReadonlyArray<{ x: number; y: number }>, cuantos: Array<[number, number]>, colores: readonly string[], opciones: { semilla?: number; lateral?: number; desde?: number; hasta?: number; ruido?: number } = {}): GloboDetectado[] {
  const azar = crearAzar(opciones.semilla ?? 3);
  const largos = [0];
  for (let i = 1; i < eje.length; i++) largos.push(largos[i - 1]! + Math.hypot(eje[i]!.x - eje[i - 1]!.x, eje[i]!.y - eje[i - 1]!.y));
  const total = largos[largos.length - 1]!;
  const lista = cuantos.flatMap(([d, n]) => Array.from({ length: n }, () => d));
  // Barajada determinista.
  for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [lista[i], lista[j]] = [lista[j]!, lista[i]!]; }
  const salida: GloboDetectado[] = [];
  lista.forEach((d, k) => {
    const t = (opciones.desde ?? 0) + ((k + azar()) / lista.length) * ((opciones.hasta ?? 1) - (opciones.desde ?? 0));
    const meta = t * total;
    let i = 1;
    while (i < eje.length - 1 && largos[i]! < meta) i++;
    const a = eje[i - 1]!, b = eje[i]!, u = (meta - largos[i - 1]!) / ((largos[i]! - largos[i - 1]!) || 1);
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const normal = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    const lado = (azar() * 2 - 1) * (opciones.lateral ?? 0.03);
    const real = d * (1 + (azar() * 2 - 1) * (opciones.ruido ?? 0));
    salida.push(caja(a.x + (b.x - a.x) * u + normal.x * lado, a.y + (b.y - a.y) * u + normal.y * lado, real, colores[k % colores.length]!));
  });
  return salida;
}
// Los globos dicen 300 cm; el lector leyó 130: los globos inflan la escala 2,3×.
const globos = globosAlLargo(EJE, [[D.gigante, 3], [D.grande, 14], [D.mediano, 40], [D.chico, 14]], ["dorado", "blanco", "dorado"]);
const lectura = (extra: Partial<LecturaFoto> = {}): LecturaFoto => ({ resumen: "prueba", aspecto: ASPECTO, escala: { altoImagenCm: 130, referencia: "a ojo" }, pisoY: 0.9, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas: [guirnalda], ...extra });

prueba("el resultado dice la fuente, que la escala es una cota, y rehace los formatos con la escala final", () => {
  const r = medirConDetecciones(lectura(), globos);
  assert.ok(r.escala, "devuelve la decisión");
  assert.equal(r.escala!.leida, 130);
  assert.ok(r.escala!.globos > 2 * 130, `los globos darían ${r.escala!.globos}`);
  assert.deepEqual([r.escala!.fuente, r.escala!.acotada], ["globos_acotados", true]);
  assert.equal(r.lectura.escala.altoImagenCm, 260);
  assert.match(r.notas.join(" "), /limitados a la escala leída/);
  assert.match(r.notas.join(" "), /Es un límite prudente, no una medida/, "la nota no presenta el límite como medida");
  assert.doesNotMatch([...r.notas, r.lectura.escala.referencia].join(" "), /cota|globos_acotados|alto de foto/, "sin jerga en lo que lee el usuario o el agente");
  const m = (r.lectura.piezas.find((p) => p.tipo === "guirnalda_organica") as Extract<PiezaLeida, { tipo: "guirnalda_organica" }>).mezcla!;
  const cmMediano = m.diametroMediano! * r.lectura.escala.altoImagenCm;
  assert.ok(Math.abs(Math.log(diametroOrganicoCm(m.formatoMediano!)! / cmMediano)) < Math.log(1.45), `${m.formatoMediano} vs ${cmMediano.toFixed(0)} cm`);
});

prueba("con pedestales que dan un intervalo de 106-230 cm y globos fuera, la escala queda en el borde del intervalo y no en los globos", () => {
  const conPedestales = lectura({ piezas: [guirnalda, fondoDe("pedestales", { x: 0.5, yBase: 0.95, alto: 0.6, ancho: 0.4 })] });
  const r = medirConDetecciones(conPedestales, globos, [{ id: "pedestales", box_2d: [350, 300, 950, 700] }]);
  assert.equal(r.escala!.muebles, null);
  assert.notEqual(r.escala!.fuente, "globos");
  assert.ok(r.lectura.escala.altoImagenCm <= 75 / 0.6 * 1.15 * 1.6 + 1, `escala ${r.lectura.escala.altoImagenCm}`);
});

prueba("dentro de la banda muerta (±10 %) la escala leída se queda y los formatos no cambian (foto 42: R-18 no pasa a R-24)", () => {
  // Los grandes miden 42 cm a la escala de los globos (300): en el borde de lo que aún es un R-18 (34 cm ± 25 %); con 330 cm leídos serían de 46 y pasarían a R-24.
  const alBorde = globosAlLargo(EJE, [[D.gigante, 3], [42 / 300, 14], [D.mediano, 40], [D.chico, 14]], ["dorado", "blanco", "dorado"]);
  const medida = (leida: number) => {
    const r = medirConDetecciones(lectura({ escala: { altoImagenCm: leida, referencia: "a ojo" } }), alBorde);
    const mezcla = (r.lectura.piezas.find((p) => p.tipo === "guirnalda_organica") as Extract<PiezaLeida, { tipo: "guirnalda_organica" }>).mezcla!;
    return { escala: r.lectura.escala.altoImagenCm, globos: r.escala!.globos, mezcla };
  };
  const formatos = (m: ReturnType<typeof medida>["mezcla"]) => [m.formatoGigante, m.formatoGrande, m.formatoMediano, m.formatoChico];
  const referencia = medida(300);
  let sensibles = 0, enBanda = 0;
  for (let leida = 250; leida <= 360; leida += 2) {
    const m = medida(leida);
    if (Math.abs(m.globos - leida) / leida > 0.1) continue;
    enBanda += 1;
    assert.equal(m.escala, leida, `con la leída en ${leida} la escala se queda`);
    assert.deepEqual(formatos(m.mezcla), formatos(referencia.mezcla), `los formatos cambiaron con la leída en ${leida}`);
    if (formatos(formatosPorEscala(referencia.mezcla, leida)).join() !== formatos(referencia.mezcla).join()) sensibles += 1;
  }
  assert.ok(enBanda >= 10, `${enBanda} escalas leídas dentro de la banda`);
  assert.ok(sensibles > 0, "la prueba tiene sentido: rehacer los formatos con alguna de esas escalas sí los cambiaría");
});

prueba("la auditoría de la medida guarda si los globos quedaron limitados", () => {
  const r = medirConDetecciones(lectura(), globos);
  const d = datosDeLaMedida(lectura(), r, { globos, fondos: [], racimos: { revisadas: 0, quitadas: 0 } });
  assert.equal(d.escalaAcotada, true);
  assert.equal(d.escalaFuente, "globos_acotados");
  const sin = datosDeLaMedida(lectura(), { lectura: lectura(), notas: [] }, { globos, fondos: [], racimos: { revisadas: 0, quitadas: 0 } });
  assert.equal(sin.escalaAcotada, null);
});

console.log(`test-escala-politica: ${pruebas} pruebas ok`);
