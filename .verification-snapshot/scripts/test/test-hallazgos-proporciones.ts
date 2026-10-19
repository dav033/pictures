/**
 * Los hallazgos de la revisión de las proporciones (REQ-001), cada uno con la prueba que falla sin su arreglo. Sin coste ni red:
 * - un juego de pedestales con el pie sobre la línea del piso no atraviesa el panel de atrás;
 * - un aro con el pie tapado no se estira a óvalo;
 * - un montón cuyo pie se ve sobre el piso se asienta sobre la mesa que tenga debajo; si no, cuelga y lo dice;
 * - una punta que la foto corta por su borde no se recoge;
 * - los campos que solo mide la detección (`SOLO_MEDIDOS`) no van en el esquema de Gemini y el prompt dice que no se escriban.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-hallazgos-proporciones.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { armarEscena } from "@/lib/globos3d/escena";
import { LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "@/lib/globos3d/lectura-foto";
import { SOLO_MEDIDOS, esquemaLecturaParaGemini } from "@/lib/globos3d/leer-foto-ia";
import { construirPromptLectura } from "@/lib/globos3d/prompt-lectura-foto";
import { recogerPuntas } from "@/lib/globos3d/puntas-lectura";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const blanco = [{ nombre: "blanco", hex: "#f5f3ee", peso: 100, acabado: "mate" as const }];
const MEZCLA = { grandes: 20, medianos: 60, chicos: 20, diametroGrande: 0.09, diametroMediano: 0.065, diametroChico: 0.03, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };
const H = 400, PISO = 0.74;
const lectura = (piezas: PiezaLeida[]): LecturaFoto => LecturaFotoSchema.parse({ resumen: "prueba de hallazgos", aspecto: 0.75, escala: { altoImagenCm: H, referencia: "prueba" }, pisoY: PISO, sala: { pared: "#ece8e2", piso: "#8a5a36" }, piezas });
const caja = (l: LecturaFoto, prefijo: string) => armarEscena(compilarLectura(l).escena).porNodo.find((n) => n.id.startsWith(prefijo))!.caja;

console.log("Pedestales sin profundidad");
prueba("con el pie en la línea del piso, los pedestales quedan por delante del panel de lentejuelas", () => {
  const cajas = [{ x: 0.3, yBase: PISO, ancho: 0.2, alto: 0.25 }, { x: 0.5, yBase: PISO, ancho: 0.2, alto: 0.3 }];
  const l = lectura([
    { tipo: "fondo", id: "lentejuelas", x: 0.5, yBase: PISO, ancho: 0.6, alto: 0.5, colores: blanco },
    { tipo: "fondo", id: "pedestales", x: 0.4, yBase: PISO, ancho: 0.4, alto: 0.3, colores: blanco, cajas },
  ]);
  const panel = caja(l, "lentejuelas"), pedestal = caja(l, "pedestal");
  assert.ok(pedestal.min.z >= panel.max.z - 1, `el pedestal empieza en z ${pedestal.min.z.toFixed(0)} y el panel acaba en ${panel.max.z.toFixed(0)}`);
});

console.log("Aros con el pie tapado");
prueba("un aro de pie libre (con mástil) cuyo pie se ve sobre el piso conserva su tope y llega al piso: el arma con su ancho de diámetro, sin quedarse corto", () => {
  for (const id of ["aro_metalico", "aro_hexagonal"]) {
    const c = caja(lectura([{ tipo: "fondo", id, x: 0.5, yBase: 0.55, ancho: 0.4, alto: 0.4, colores: blanco }]), id.replace(/_/g, "-"));
    const tope = (PISO - 0.55) * H + 0.4 * H;
    assert.ok(Math.abs(c.max.y - tope) <= 4, `${id}: tope ${c.max.y.toFixed(0)} cm, leído ${tope.toFixed(0)} cm`);
    assert.ok(c.min.y <= 2, `${id}: el pie queda a ${c.min.y.toFixed(0)} cm`);
  }
});

console.log("Montón con el pie sobre el piso");
const monton = (yPie: number): PiezaLeida => ({ tipo: "racimo_piso", x: 0.3, yPie, yArriba: yPie - 0.2, ancho: 0.2, tamanos: {}, mezcla: MEZCLA, racimos: 0.5, colores: blanco });
const nodoMonton = (piezas: PiezaLeida[]) => { const c = compilarLectura(lectura(piezas)); return { nodo: c.escena.nodos.find((n) => n.id.startsWith("racimo-piso"))!, notas: c.notas }; };
prueba("sin nada debajo, cuelga y lo dice", () => {
  const { nodo, notas } = nodoMonton([monton(0.5)]);
  assert.equal(nodo.colocacion.en, "libre");
  assert.ok(notas.some((n) => /se cuelga en el aire/.test(n)), notas.join(" | "));
});
prueba("sobre una mesa cuyo tope queda a la altura de su pie, se asienta en el tope de la mesa y no avisa", () => {
  const topeMesa = 0.5, alto = 0.18;
  const mesa: PiezaLeida = { tipo: "fondo", id: "mesa_mantel", x: 0.3, yBase: topeMesa + alto, ancho: 0.4, alto, colores: blanco };
  const { nodo, notas } = nodoMonton([mesa, monton(topeMesa)]);
  assert.ok(nodo.colocacion.en === "libre", JSON.stringify(nodo.colocacion));
  if (nodo.colocacion.en === "libre") assert.ok(Math.abs(nodo.colocacion.yCm - (PISO - topeMesa) * H) <= 30, `yCm ${nodo.colocacion.yCm}`);
  assert.ok(!notas.some((n) => /se cuelga en el aire/.test(n)));
  const delante = compilarLectura(lectura([mesa, monton(topeMesa)])).escena.nodos.find((n) => n.id.startsWith("mesa-mantel"))!.colocacion;
  assert.ok(nodo.colocacion.en === "libre" && delante.en === "piso" && Math.abs(nodo.colocacion.zCm - delante.zCm) <= 40, "el montón queda a la profundidad de la mesa");
});
prueba("sobre un pedestal en primer plano (su pie más abajo que la línea del piso), se asienta sobre el pedestal tal como se arma: misma profundidad y su altura", () => {
  const cajas = [{ x: 0.3, yBase: 0.9, ancho: 0.2, alto: 0.3 }];
  const pedestales: PiezaLeida = { tipo: "fondo", id: "pedestales", x: 0.3, yBase: 0.9, ancho: 0.2, alto: 0.3, colores: blanco, cajas };
  const l = lectura([pedestales, monton(0.6)]);
  const { nodo, notas } = nodoMonton([pedestales, monton(0.6)]);
  const pedestal = compilarLectura(l).escena.nodos.find((n) => n.id.startsWith("pedestal"))!;
  assert.ok(nodo.colocacion.en === "libre" && pedestal.colocacion.en === "piso", JSON.stringify(nodo.colocacion));
  if (nodo.colocacion.en === "libre" && pedestal.colocacion.en === "piso") {
    assert.equal(nodo.colocacion.zCm, pedestal.colocacion.zCm, "a la profundidad del pedestal");
    const alto = caja(l, "pedestal").max.y;
    assert.ok(Math.abs(nodo.colocacion.yCm - alto) <= 2, `y ${nodo.colocacion.yCm}, el pedestal mide ${alto.toFixed(0)}`);
    assert.ok(Math.abs(nodo.colocacion.xCm - pedestal.colocacion.xCm) < 150, "y por encima de él, no a otro lado de la sala");
  }
  assert.ok(notas.some((n) => /se asienta encima/.test(n)), notas.join(" | "));
});
prueba("el montón sobre un pedestal en primer plano toma la escala del pedestal, no la de la pared (el mismo montón colgado se ve más grande)", () => {
  const pedestal: PiezaLeida = { tipo: "fondo", id: "pedestales", x: 0.3, yBase: 0.9, ancho: 0.2, alto: 0.3, colores: blanco, cajas: [{ x: 0.3, yBase: 0.9, ancho: 0.2, alto: 0.3 }] };
  const ancho = (piezas: PiezaLeida[]) => { const c = caja(lectura(piezas), "racimo-piso"); return c.max.x - c.min.x; };
  const encima = ancho([pedestal, monton(0.6)]);
  const colgado = ancho([monton(0.6)]);
  assert.ok(encima < colgado * 0.95, `encima ${encima.toFixed(0)} cm, colgado ${colgado.toFixed(0)} cm`);
});
prueba("un pedestal bajo en primer plano, cuyo tope se ve por debajo de la línea del piso, también sostiene al montón", () => {
  const corto: PiezaLeida = { tipo: "fondo", id: "pedestales", x: 0.3, yBase: 0.97, ancho: 0.2, alto: 0.1, colores: blanco, cajas: [{ x: 0.3, yBase: 0.97, ancho: 0.2, alto: 0.1 }] };
  const { nodo, notas } = nodoMonton([corto, monton(0.87)]);
  assert.equal(nodo.colocacion.en, "libre", JSON.stringify(nodo.colocacion));
  const l = lectura([corto, monton(0.87)]);
  const pedestal = compilarLectura(l).escena.nodos.find((n) => n.id.startsWith("pedestal"))!;
  if (nodo.colocacion.en === "libre" && pedestal.colocacion.en === "piso") assert.equal(nodo.colocacion.zCm, pedestal.colocacion.zCm);
  assert.ok(notas.some((n) => /se asienta encima/.test(n)), notas.join(" | "));
});
prueba("una mesa que no está debajo (en x) no lo sostiene", () => {
  const mesa: PiezaLeida = { tipo: "fondo", id: "mesa_mantel", x: 0.8, yBase: 0.68, ancho: 0.2, alto: 0.18, colores: blanco };
  assert.equal(nodoMonton([mesa, monton(0.5)]).nodo.colocacion.en, "libre");
  assert.ok(nodoMonton([mesa, monton(0.5)]).notas.some((n) => /se cuelga en el aire/.test(n)));
});

console.log("Puntas en el borde de la foto");
prueba("una punta marcada en el borde de la foto no se recoge", () => {
  const puntos = [{ x: 0, y: 150, grosor: 60, enBorde: true }, { x: 100, y: 150, grosor: 60 }, { x: 200, y: 150, grosor: 60 }];
  const r = recogerPuntas(puntos);
  assert.equal(r[0]!.x, 0, "la punta cortada por el borde no se mueve");
  assert.ok(r[2]!.x < 200, "la otra, libre, sí se recoge");
});

console.log("Campos solo medidos");
prueba("ninguno de los campos que solo escribe la detección está en el esquema de Gemini y el prompt dice que no se escriban", () => {
  const claves = new Set<string>();
  const recorrer = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(recorrer); return; }
    if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (k === "properties" && v && typeof v === "object") Object.keys(v).forEach((c) => claves.add(c)); recorrer(v); }
  };
  recorrer(esquemaLecturaParaGemini());
  const linea = construirPromptLectura().split("\n").find((x) => /no los escribas/.test(x)) ?? "";
  for (const campo of SOLO_MEDIDOS) {
    assert.ok(!claves.has(campo), `«${campo}» está en el esquema de Gemini`);
    assert.ok(linea.includes(campo), `el prompt no dice que «${campo}» no se escriba`);
  }
  assert.ok(SOLO_MEDIDOS.has("cajas"));
});

console.log(`test-hallazgos-proporciones: ${pruebas} pruebas ok`);
