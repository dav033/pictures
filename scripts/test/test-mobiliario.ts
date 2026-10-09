/**
 * Mobiliario de eventos (`mobiliario-*.ts`) y su integración. Sin coste: ninguna IA ni red.
 *   npx tsx --conditions=react-server scripts/test/test-mobiliario.ts
 * - cada mueble del catálogo arma como escenografía (sin globos ni materiales), apoyado en el piso (y = 0) y con sus
 *   medidas de catálogo;
 * - proporciones reales: silla Tiffany con asiento a 45 y respaldo a 90, mesa imperial de 240×90×75, redonda de Ø150,
 *   cóctel de 110, taburete alto con asiento a 75, consola de 180×45×90;
 * - las medidas y los colores pedidos mandan (un largo, un alto y colores por nombre);
 * - agregar_mobiliario: una fila, sillas alrededor de una mesa redonda (a la misma distancia del centro y mirando a la
 *   mesa) y de una imperial (por los lados largos), mobiliario de pared con texto, errores claros;
 * - lectura de foto: un fondo con id de mobiliario compila a su pieza (y una fila con `cantidad`);
 * - el inventario en inglés para FLUX nombra los muebles y la escenografía no entra en materiales.
 */
import assert from "node:assert/strict";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { aplicarHerramienta, DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS } from "../../src/lib/globos3d/herramientas-escena";
import { LecturaFotoSchema, type LecturaFoto } from "../../src/lib/globos3d/lectura-foto";
import { CATALOGO_MOBILIARIO } from "../../src/lib/globos3d/mobiliario-catalogo";
import { puestosAlrededor } from "../../src/lib/globos3d/mobiliario-disposicion";
import { armarPieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);
const mueble = (id: string) => CATALOGO_MOBILIARIO.find((m) => m.id === id) ?? assert.fail(`falta ${id}`);
const armado = (id: string) => armarPieza({ tipo: "escenografia", elementos: mueble(id).elementos() });
const agregar = (escena: Escena, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, "agregar_mobiliario", args);
  if (!r.ok) assert.fail(r.error);
  return r;
};
const xz = (n: Escena["nodos"][number]) => (n.colocacion.en === "piso" ? { x: n.colocacion.xCm, z: n.colocacion.zCm, g: n.colocacion.giroGrados } : assert.fail(`${n.id} no está en el piso`));

/** Los que se arman de varias piezas o con partes sueltas: solo se mide su apoyo en el piso. */
const COMPUESTOS = /_sillas$|^sala_lounge$|^mesas_nido|^escalera|^biombo|^mesa_regalos|^jarron|^carrito|^aro|^arco|^alfombra|^peldanos|^mesa_hex|_mantel$|_licra$|^base_|^lampara|^neon|^columna/;

prueba("todos los muebles del catálogo arman como escenografía, en el piso y con sus medidas", () => {
  assert.ok(CATALOGO_MOBILIARIO.length >= 35, `solo ${CATALOGO_MOBILIARIO.length}`);
  for (const m of CATALOGO_MOBILIARIO) {
    const a = armado(m.id);
    assert.equal(a.globos.length, 0, m.id);
    assert.equal(a.materiales.length, 0, `${m.id} no cotiza`);
    if (m.lugar === "piso") cerca(a.caja.min.y, 0, 0.6, `${m.id}: apoyado en el piso`);
    if (COMPUESTOS.test(m.id)) continue;
    cerca(a.caja.max.x - a.caja.min.x, m.medidas.anchoCm, m.medidas.anchoCm * 0.15, `${m.id} ancho`);
    cerca(a.caja.max.y - a.caja.min.y, m.medidas.altoCm, m.medidas.altoCm * 0.15, `${m.id} alto`);
  }
});

prueba("el catálogo del editor y la lectura de fotos listan los muebles (ids únicos)", () => {
  const ids = FONDOS_CATALOGO.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of CATALOGO_MOBILIARIO) assert.ok(ids.includes(m.id), m.id);
  for (const necesario of ["silla_tiffany", "mesa_imperial", "mesa_redonda_mantel", "mesa_coctel", "taburete_alto", "mesa_postres", "mesas_nido_hexagonales", "sofa", "carrito_dulces", "aro_metalico", "neon_cursiva", "peldanos"]) assert.ok(ids.includes(necesario), necesario);
});

prueba("proporciones de las piezas clave", () => {
  const caja = (id: string) => armado(id).caja;
  cerca(caja("silla_tiffany").max.y, 90, 1, "silla Tiffany: respaldo");
  cerca(caja("mesa_imperial").max.y, 75, 0.5, "mesa imperial: alto");
  cerca(caja("mesa_imperial").max.x - caja("mesa_imperial").min.x, 240, 1, "mesa imperial: largo");
  cerca(caja("mesa_imperial").max.z - caja("mesa_imperial").min.z, 90, 1, "mesa imperial: fondo");
  cerca(caja("mesa_redonda").max.x - caja("mesa_redonda").min.x, 150, 1, "mesa redonda: diámetro");
  cerca(caja("mesa_coctel").max.y, 110, 0.5, "mesa cóctel: alto");
  cerca(caja("taburete_alto").max.y, 75, 0.5, "taburete alto: asiento");
  cerca(caja("mesa_postres").max.y, 90, 0.5, "consola: alto");
  // El asiento de la silla Tiffany (la cara de arriba del cojín) queda a 45 cm.
  const cojin = (armado("silla_tiffany").solidos ?? []).filter((s) => s.forma === "caja" && s.hex === "#f4efe4");
  assert.equal(cojin.length, 1);
  const c = cojin[0]!;
  assert.ok(c.forma === "caja");
  if (c.forma === "caja") cerca(c.origen.y + c.tamano.y / 2, 45, 1, "asiento de la silla Tiffany");
});

prueba("las medidas y los colores pedidos mandan", () => {
  const r = agregar(vacia(), { id: "mesa_imperial", ancho_cm: 300, fondo_cm: 100, alto_cm: 80, colores: ["madera", "negro"] });
  const a = armarEscena(r.escena).porNodo[0]!.caja;
  cerca(a.max.x - a.min.x, 300, 1, "largo pedido");
  cerca(a.max.y, 80, 0.5, "alto pedido");
  const solidos = armarPieza(r.escena.nodos[0]!.pieza).solidos ?? [];
  assert.ok(solidos.some((s) => s.hex === "#8a6a45") && solidos.some((s) => s.hex === "#1c1c1c"), "colores por nombre");
  assert.match(r.resumen, /300×100×80/);
});

prueba("agregar_mobiliario: fila de sillas centrada y separada", () => {
  const r = agregar(vacia(), { id: "silla_tiffany", cantidad: 5, x_cm: 40 });
  assert.equal(r.escena.nodos.length, 5);
  const xs = r.escena.nodos.map((n) => xz(n).x);
  cerca(xs.reduce((s, x) => s + x, 0) / 5, 40, 0.6, "fila centrada en x_cm");
  assert.ok(xs.every((x, i) => i === 0 || x - xs[i - 1]! >= 45), "no se pisan");
  assert.equal(new Set(r.escena.nodos.map((n) => n.id)).size, 5);
  assert.equal(armarEscena(r.escena).materiales.length, 0, "no cotiza");
});

prueba("6 sillas alrededor de una mesa redonda: mismo radio, mirando a la mesa", () => {
  const m = agregar(vacia(), { id: "mesa_redonda_mantel", x_cm: 50, z_cm: -30 });
  const s = agregar(m.escena, { id: "silla_tiffany", cantidad: 6, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  const sillas = s.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany"));
  assert.equal(sillas.length, 6);
  const radios = sillas.map((n) => Math.hypot(xz(n).x - 50, xz(n).z + 30));
  assert.ok(Math.max(...radios) - Math.min(...radios) < 1.5, `radios parejos ${radios.map((r) => r.toFixed(0)).join(",")}`);
  assert.ok(radios[0]! > 75 + 20, "fuera de la mesa");
  for (const n of sillas) {
    // El frente (sin g, cos g) apunta de la silla al centro de la mesa.
    const { x, z, g: giro } = xz(n), g = (giro * Math.PI) / 180, dx = 50 - x, dz = -30 - z, d = Math.hypot(dx, dz);
    cerca((Math.sin(g) * dx) / d + (Math.cos(g) * dz) / d, 1, 0.02, `${n.id} mira a la mesa`);
  }
});

prueba("sillas alrededor de una mesa imperial: por los lados largos y las cabeceras", () => {
  const m = agregar(vacia(), { id: "mesa_imperial_mantel" });
  const s = agregar(m.escena, { id: "silla_tiffany", cantidad: 10, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  const sillas = s.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany"));
  assert.equal(sillas.length, 10);
  const zMesa = xz(m.escena.nodos[0]!).z;
  const z = sillas.map((n) => xz(n).z);
  assert.ok(z.filter((v) => v > zMesa + 40).length >= 4 && z.filter((v) => v < zMesa - 40).length >= 4, "cuatro o más por cada lado largo");
  assert.ok(puestosAlrededor({ cx: 0, cz: 0, anchoCm: 240, fondoCm: 90, cantidad: 30, holguraCm: 30, frenteCm: 45 }).length < 30, "no mete más de los que caben");
  const llena = agregar(m.escena, { id: "silla_tiffany", cantidad: 24, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  assert.match(llena.resumen, /solo caben/);
});

prueba("errores claros; el neón va en la pared con su texto y su color", () => {
  const sinMesa = aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor" });
  assert.ok(!sinMesa.ok && /alrededor_de/.test(sinMesa.error));
  const malaMesa = aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: "no-existe" });
  assert.ok(!malaMesa.ok && /no-existe/.test(malaMesa.error));
  assert.ok(!aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "silla_voladora" }).ok);
  const malColor = aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "sofa", colores: ["zzzz"] });
  assert.ok(!malColor.ok && /color/i.test(malColor.error));
  const neon = agregar(vacia(), { id: "neon_cursiva", texto: "Sofia 15", colores: ["negro", "#00ffcc"], altura_cm: 140 });
  assert.equal(neon.escena.nodos[0]!.colocacion.en, "pared");
  const motivo = armarPieza(neon.escena.nodos[0]!.pieza).solidos?.[0]?.motivo;
  assert.equal(motivo?.texto, "Sofia 15");
  assert.equal(motivo?.hex, "#00ffcc");
  assert.equal(motivo?.estilo, "neon");
});

prueba("la herramienta está declarada para Gemini con todos los ids", () => {
  assert.ok(NOMBRES_HERRAMIENTAS.includes("agregar_mobiliario"));
  const d = DECLARACIONES_ESCENA.find((x) => x.name === "agregar_mobiliario") ?? assert.fail("declaración");
  const texto = JSON.stringify(d);
  for (const m of CATALOGO_MOBILIARIO) assert.ok(texto.includes(m.id), `falta ${m.id} en la declaración`);
  assert.match(d.description, /alrededor/);
});

prueba("la lectura de una foto con mobiliario compila (sillas en fila y mesa redonda)", () => {
  const color = (nombre: string, hex: string) => ({ nombre, hex, peso: 100, acabado: "mate" as const });
  const lectura = LecturaFotoSchema.parse({
    resumen: "Mesa redonda con sillas doradas", aspecto: 1.2, escala: { altoImagenCm: 300, referencia: "mesa de 75 cm" }, pisoY: 0.9,
    sala: { pared: "#eeeeee", piso: "#d8cbbb" },
    piezas: [
      { tipo: "fondo", id: "mesa_redonda_mantel", x: 0.5, yBase: 0.9, ancho: 0.5, alto: 0.25, colores: [color("blanco", "#f5f5f0")] },
      { tipo: "fondo", id: "silla_tiffany", x: 0.5, yBase: 0.95, ancho: 0.6, alto: 0.3, cantidad: 4, colores: [color("dorado", "#d4af5a")] },
    ],
  } satisfies LecturaFoto);
  const r = compilarLectura(lectura);
  assert.equal(r.omitidas.length, 0, r.omitidas.join("; "));
  assert.equal(r.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany")).length, 4);
  assert.ok(r.escena.nodos.some((n) => n.id.startsWith("mesa-redonda-mantel")));
  assert.ok(r.escena.nodos.every((n) => n.pieza.tipo === "escenografia" && n.pieza.catalogoId));
  assert.equal(armarEscena(r.escena).materiales.length, 0);
});

prueba("el inventario en inglés para FLUX nombra los muebles", () => {
  const a = agregar(vacia(), { id: "mesa_imperial_mantel" });
  const b = agregar(a.escena, { id: "silla_tiffany", cantidad: 3, disposicion: "fila" });
  const texto = escenaEnIngles(b.escena, armarEscena(b.escena));
  assert.match(texto, /banquet table with a floor-length tablecloth/);
  assert.match(texto, /3 × Tiffany \(chiavari\) chair/);
});

console.log(`test-mobiliario: ${pruebas} pruebas ok`);
