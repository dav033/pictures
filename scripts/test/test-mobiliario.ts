/**
 * Mobiliario de eventos (`mobiliario-*.ts`) y su integración. Sin coste: ninguna IA ni red.
 *   npx tsx --conditions=react-server scripts/test/test-mobiliario.ts
 * - cada mueble del catálogo (los 37, también los conjuntos) arma como escenografía sin globos ni materiales, apoyado en el
 *   piso, y mide lo que dicen sus medidas totales (±12 %);
 * - se guarda paramétrico (`mueble.opciones`, sin sólidos): la escena pesa poco y `cambiar_pieza` cambia medidas, colores
 *   y texto; un fondo fijo da error claro; `ver_escena` dice nombre, medidas y colores;
 * - los conjuntos escalan a lo pedido y los colores van en su orden (hexagonales: alambre y vidrio);
 * - colores: nombres compuestos («azul marino», «oro rosa», «verde menta claro»), hex, y el error con ayuda;
 * - agregar_mobiliario: filas (también de mesas), sillas alrededor de una mesa redonda (mismo radio, mirando a ella) y de una
 *   imperial (derechas por los lados largos), tope en la mesa llena, retiro de siempre, la base de pastel sobre la mesa y dos
 *   toques seguidos sin encimarse;
 * - lectura de foto: el mobiliario compila (cantidad en fila, alrededor de la mesa leída, de pared de uno en uno, acabado);
 * - el inventario en inglés para FLUX nombra muebles, colores y el texto del letrero.
 */
import assert from "node:assert/strict";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { aplicarHerramienta, DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS } from "../../src/lib/globos3d/herramientas-escena";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";
import { CATALOGO_MOBILIARIO, muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { colocacionPorDefecto } from "../../src/lib/globos3d/mobiliario-colocar";
import { hexDeColor } from "../../src/lib/globos3d/mobiliario-colores";
import { puestosAlrededor } from "../../src/lib/globos3d/mobiliario-disposicion";
import { elementosDeEscenografia, piezaDeEntrada, piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { RETIRO_PISO_CM, retiroDe } from "../../src/lib/globos3d/mobiliario-tipos";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);
const mueble = (id: string) => muebleDe(id) ?? assert.fail(`falta ${id}`);
const armado = (id: string) => armarPieza(piezaDeMueble(mueble(id)));
const medidasDe = (pieza: Pieza) => { const { min, max } = armarPieza(pieza).caja; return { ancho: max.x - min.x, fondo: max.z - min.z, alto: max.y - min.y, y0: min.y }; };
const agregar = (escena: Escena, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, "agregar_mobiliario", args);
  if (!r.ok) assert.fail(r.error);
  return r;
};
const cambiar = (escena: Escena, args: Record<string, unknown>) => aplicarHerramienta(escena, "cambiar_pieza", args);
const piso = (n: Escena["nodos"][number]) => (n.colocacion.en === "piso" ? { x: n.colocacion.xCm, z: n.colocacion.zCm, g: n.colocacion.giroGrados } : assert.fail(`${n.id} no está en el piso`));
const color = (nombre: string, hex: string, acabado: "mate" | "brillante" | "cromado" | "perla" = "mate") => ({ nombre, hex, peso: 100, acabado });

prueba("los 37 muebles del catálogo arman como escenografía, apoyados y con sus medidas totales (±12 %)", () => {
  assert.equal(CATALOGO_MOBILIARIO.length, 37);
  for (const m of CATALOGO_MOBILIARIO) {
    const a = armado(m.id);
    assert.equal(a.globos.length, 0, m.id);
    assert.equal(a.materiales.length, 0, `${m.id} no cotiza`);
    const r = medidasDe(piezaDeMueble(m));
    if (m.lugar === "piso") cerca(r.y0, 0, 0.6, `${m.id}: apoyado en el piso`);
    for (const [que, real, esperado] of [["ancho", r.ancho, m.medidas.anchoCm], ["fondo", r.fondo, m.medidas.fondoCm], ["alto", r.alto, m.medidas.altoCm]] as const) {
      cerca(real, esperado, Math.max(3, esperado * 0.12), `${m.id} ${que}`);
    }
  }
});

prueba("el registro es uno solo, con clase fondo|mueble, y trae los muebles pedidos", () => {
  const ids = FONDOS_CATALOGO.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(FONDOS_CATALOGO.filter((f) => f.clase === "fondo").length >= 9);
  for (const m of CATALOGO_MOBILIARIO) assert.ok(ids.includes(m.id) && m.clase === "mueble", m.id);
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
  const cojin = (armado("silla_tiffany").solidos ?? []).filter((s) => s.forma === "caja" && s.hex === "#f4efe4");
  assert.equal(cojin.length, 1);
  const c = cojin[0]!;
  assert.ok(c.forma === "caja");
  if (c.forma === "caja") cerca(c.origen.y + c.tamano.y / 2, 45, 1, "asiento de la silla Tiffany");
});

prueba("el mueble se guarda con sus opciones y sin sólidos: la escena no engorda", () => {
  const r = agregar(vacia(), { id: "silla_tiffany", cantidad: 6, colores: ["blanco"] });
  for (const n of r.escena.nodos) {
    assert.ok(n.pieza.tipo === "escenografia" && n.pieza.elementos.length === 0 && n.pieza.mueble?.opciones, n.id);
    assert.ok(elementosDeEscenografia(n.pieza as Extract<Pieza, { tipo: "escenografia" }>).length > 10, "se arma al vuelo");
  }
  assert.ok(JSON.stringify(r.escena).length < 6 * 700 + 1500, `escena de 6 sillas: ${JSON.stringify(r.escena).length} caracteres`);
  // Un fondo fijo sí guarda sus elementos, con su id.
  const fijo = piezaDeEntrada(FONDOS_CATALOGO.find((f) => f.id === "panel_redondo")!);
  assert.ok(fijo.tipo === "escenografia" && fijo.elementos.length > 0 && fijo.mueble?.id === "panel_redondo" && !fijo.mueble.opciones);
});

prueba("cambiar_pieza cambia medidas, colores y texto de un mueble, y dice por qué un fondo fijo no", () => {
  const a = agregar(vacia(), { id: "mesa_imperial", colores: ["madera", "negro"] });
  const id = a.escena.nodos[0]!.id;
  const c = cambiar(a.escena, { id, ancho_cm: 300, alto_cm: 80, colores: ["blanco"] });
  assert.ok(c.ok, c.ok ? "" : c.error);
  if (!c.ok) return;
  const m = medidasDe(c.escena.nodos[0]!.pieza);
  cerca(m.ancho, 300, 2, "largo nuevo");
  cerca(m.alto, 80, 0.5, "alto nuevo");
  assert.deepEqual((c.escena.nodos[0]!.pieza as Extract<Pieza, { tipo: "escenografia" }>).mueble?.opciones?.colores, ["#f7f6f2", "#1c1c1c"], "solo cambió el primer color; el segundo queda");
  assert.match(c.resumen, /Mesa imperial/);
  const v = aplicarHerramienta(c.escena, "ver_escena", {});
  assert.ok(v.ok && /Mesa imperial · 3\d\d×\d+×80 cm/.test(v.resumen) && /tapa #f7f6f2/.test(v.resumen) && !/elementos/.test(v.resumen), v.ok ? v.resumen.slice(0, 400) : v.error);
  const r = cambiar(c.escena, { id, reemplazar_colores: [{ de: "blanco", a: "dorado" }] });
  assert.ok(r.ok && (r.escena.nodos[0]!.pieza as Extract<Pieza, { tipo: "escenografia" }>).mueble?.opciones?.colores[0] === "#d6b25a", r.ok ? "" : r.error);
  assert.ok(!cambiar(c.escena, { id, reemplazar_colores: [{ de: "rojo", a: "verde" }] }).ok, "un color que no usa");
  const neon = agregar(vacia(), { id: "neon_cursiva" });
  const n2 = cambiar(neon.escena, { id: neon.escena.nodos[0]!.id, texto: "Valentina", colores: ["negro", "verde"] });
  assert.ok(n2.ok && armarPieza(n2.escena.nodos[0]!.pieza).solidos?.[0]?.motivo?.texto === "Valentina", n2.ok ? "" : n2.error);
  const fondo: Escena = { ...vacia(), nodos: [{ id: "panel", nombre: "Panel redondo", pieza: piezaDeEntrada(FONDOS_CATALOGO.find((f) => f.id === "panel_redondo")!), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  const mal = cambiar(fondo, { id: "panel", colores: ["rojo"] });
  assert.ok(!mal.ok && /fondo|fija/.test(mal.error) && /agregar_mobiliario/.test(mal.error), mal.ok ? "debía fallar" : mal.error);
  assert.ok(cambiar(fondo, { id: "panel", nombre: "Otro nombre" }).ok, "solo el nombre sí");
});

prueba("los conjuntos escalan a lo pedido y los colores van en su orden", () => {
  for (const [id, pedido] of [["sala_lounge", { ancho_cm: 300, fondo_cm: 160, alto_cm: 70 }], ["mesa_redonda_sillas", { ancho_cm: 320, alto_cm: 100 }], ["mesa_imperial_sillas", { ancho_cm: 420, fondo_cm: 240 }], ["mesas_nido_hexagonales", { ancho_cm: 90 }], ["jarron_pampas", { ancho_cm: 80, alto_cm: 160 }], ["mesa_regalos", { ancho_cm: 200, alto_cm: 130 }]] as const) {
    const r = agregar(vacia(), { id, ...pedido });
    const real = medidasDe(r.escena.nodos[0]!.pieza);
    if ("ancho_cm" in pedido) cerca(real.ancho, pedido.ancho_cm, pedido.ancho_cm * 0.15, `${id} ancho`);
    if ("fondo_cm" in pedido) cerca(real.fondo, pedido.fondo_cm, pedido.fondo_cm * 0.15, `${id} fondo`);
    if ("alto_cm" in pedido) cerca(real.alto, pedido.alto_cm, pedido.alto_cm * 0.15, `${id} alto`);
    assert.match(r.resumen, new RegExp(`${Math.round(real.ancho)}×${Math.round(real.fondo)}×${Math.round(real.alto)}`), `${id}: el resumen dice las medidas reales`);
  }
  const hex = muebleDe("mesa_hexagonal")!;
  assert.deepEqual(hex.coloresDe, ["alambre", "vidrio (opcional)"]);
  const sin = agregar(vacia(), { id: "mesa_hexagonal" }), con = agregar(vacia(), { id: "mesa_hexagonal", colores: ["dorado", "vidrio"] });
  assert.equal((armarPieza(con.escena.nodos[0]!.pieza).solidos ?? []).length, (armarPieza(sin.escena.nodos[0]!.pieza).solidos ?? []).length + 1, "el segundo color agrega el vidrio");
  const nido = agregar(vacia(), { id: "mesas_nido_hexagonales", colores: ["plata", "celeste"] });
  assert.ok((armarPieza(nido.escena.nodos[0]!.pieza).solidos ?? []).some((s) => s.hex === "#9ec9ea"), "el vidrio del nido sale del segundo color");
  assert.ok(medidasDe(piezaDeMueble(mueble("alfombra_redonda"), { ...{ anchoCm: 200, fondoCm: 200, altoCm: 1, colores: ["#112233", "#112233"] } })).ancho === 200);
  const alfombra = agregar(vacia(), { id: "alfombra_redonda", colores: ["rosa"] });
  assert.deepEqual((alfombra.escena.nodos[0]!.pieza as Extract<Pieza, { tipo: "escenografia" }>).mueble?.opciones?.colores, ["#f0b8c8", "#f0b8c8"], "el ribete sigue al primer color");
});

prueba("colores: la frase completa, la palabra más específica, hex, tonos y el error con ayuda", () => {
  assert.equal(hexDeColor("azul marino", []), "#1f3366");
  assert.equal(hexDeColor("Azul Marino brillante", []), "#1f3366");
  assert.equal(hexDeColor("oro rosa", []), "#e0a899");
  assert.equal(hexDeColor("verde menta", []), "#a9d6c9");
  assert.notEqual(hexDeColor("verde menta claro", []), "#a9d6c9", "claro aclara");
  assert.equal(hexDeColor("rosa palo", []), "#e8b8b8");
  assert.equal(hexDeColor("dorado", []), "#d6b25a");
  assert.equal(hexDeColor("#ABCDEF", []), "#abcdef");
  const oscuro = hexDeColor("rojo oscuro", []), rojo = hexDeColor("rojo", []);
  assert.ok(parseInt(oscuro.slice(1, 3), 16) < parseInt(rojo.slice(1, 3), 16), "oscuro oscurece");
  assert.throws(() => hexDeColor("zzzz", []), /No reconozco el color/);
});

prueba("agregar_mobiliario: fila de sillas (y de mesas) centrada, separada y delante de la mesa", () => {
  const r = agregar(vacia(), { id: "silla_tiffany", cantidad: 5, x_cm: 40 });
  assert.equal(r.escena.nodos.length, 5);
  const xs = r.escena.nodos.map((n) => piso(n).x);
  cerca(xs.reduce((s, x) => s + x, 0) / 5, 40, 0.6, "fila centrada en x_cm");
  assert.ok(xs.every((x, i) => i === 0 || x - xs[i - 1]! >= 45), "no se pisan");
  assert.equal(new Set(r.escena.nodos.map((n) => n.id)).size, 5);
  assert.equal(armarEscena(r.escena).materiales.length, 0, "no cotiza");
  const mesas = agregar(vacia(), { id: "mesa_coctel", cantidad: 3 });
  assert.equal(mesas.escena.nodos.length, 3);
  assert.ok(mesas.escena.nodos.every((n) => n.colocacion.en === "piso"));
  // La fila de sillas por defecto no toca la falda de una mesa redonda con mantel puesta por defecto.
  const mesa = agregar(vacia(), { id: "mesa_redonda_mantel" });
  const fila = agregar(mesa.escena, { id: "silla_tiffany", cantidad: 3 });
  const zMesa = piso(mesa.escena.nodos[0]!).z, zSilla = piso(fila.escena.nodos[1]!).z;
  assert.ok(zSilla - 22.5 >= zMesa + 82 + 7, `la silla (${zSilla}) queda delante de la falda de la mesa (${zMesa})`);
});

prueba("6 sillas alrededor de una mesa redonda: mismo radio, mirando a la mesa; llena, no se pasa", () => {
  const m = agregar(vacia(), { id: "mesa_redonda_mantel", x_cm: 50, z_cm: -30 });
  const s = agregar(m.escena, { id: "silla_tiffany", cantidad: 6, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  const sillas = s.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany"));
  assert.equal(sillas.length, 6);
  const radios = sillas.map((n) => Math.hypot(piso(n).x - 50, piso(n).z + 30));
  assert.ok(Math.max(...radios) - Math.min(...radios) < 1.5, `radios parejos ${radios.map((r) => r.toFixed(0)).join(",")}`);
  assert.ok(radios[0]! > 82 + 20, "fuera de la falda de la mesa");
  for (const n of sillas) {
    const { x, z, g: giro } = piso(n), g = (giro * Math.PI) / 180, dx = 50 - x, dz = -30 - z, d = Math.hypot(dx, dz);
    cerca((Math.sin(g) * dx) / d + (Math.cos(g) * dz) / d, 1, 0.02, `${n.id} mira a la mesa`);
  }
  const llena = agregar(m.escena, { id: "silla_tiffany", cantidad: 24, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  const puestas = llena.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany")).length;
  assert.ok(puestas >= 9 && puestas <= 14, `caben ${puestas}`);
  assert.match(llena.resumen, new RegExp(`solo caben ${puestas} de 24`));
});

prueba("sillas alrededor de una mesa imperial: derechas por los lados largos y las que sobran en las cabeceras", () => {
  const m = agregar(vacia(), { id: "mesa_imperial_mantel" });
  const s = agregar(m.escena, { id: "silla_tiffany", cantidad: 10, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id });
  const sillas = s.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany"));
  assert.equal(sillas.length, 10);
  const zMesa = piso(m.escena.nodos[0]!).z;
  const lados = sillas.filter((n) => Math.abs(piso(n).z - zMesa) > 40);
  assert.ok(lados.length >= 8, `${lados.length} por los lados largos`);
  assert.ok(lados.every((n) => [0, 180].includes(Math.abs(piso(n).g))), "perpendiculares a la mesa, no en abanico");
  assert.ok(puestosAlrededor({ cx: 0, cz: 0, anchoCm: 240, fondoCm: 90, cantidad: 30, holguraCm: 30, frenteCm: 45 }).length < 30, "no mete más de los que caben");
  assert.match(agregar(m.escena, { id: "silla_tiffany", cantidad: 24, disposicion: "alrededor", alrededor_de: m.escena.nodos[0]!.id }).resumen, /solo caben/);
});

prueba("el retiro por defecto es uno; la base de pastel va encima de la mesa y dos toques seguidos no se encaman", () => {
  assert.equal(retiroDe(FONDOS_CATALOGO.find((f) => f.id === "panel_redondo")!), RETIRO_PISO_CM);
  const sala = vacia();
  const silla = mueble("silla_tiffany");
  const una = colocacionPorDefecto(sala, silla, silla.medidas);
  assert.ok(una.en === "piso" && una.zCm === Math.round(-sala.sala.fondoCm / 2 + silla.retiroCm!));
  const e1: Escena = { ...sala, nodos: [{ id: "silla-tiffany", nombre: "Silla", pieza: piezaDeEntrada(silla), colocacion: una }] };
  const dos = colocacionPorDefecto(e1, silla, silla.medidas);
  assert.ok(dos.en === "piso" && Math.abs(dos.xCm - 0) >= 45, "la segunda silla se corre a un lado");
  // Base de pastel: con mesa, encima; sin mesa, en el piso.
  assert.equal(agregar(vacia(), { id: "base_pastel" }).escena.nodos[0]!.colocacion.en, "piso");
  const mesa = agregar(vacia(), { id: "mesa_postres_mantel", x_cm: 30 });
  const con = agregar(mesa.escena, { id: "base_pastel" });
  const c = con.escena.nodos[1]!.colocacion;
  assert.ok(c.en === "libre" && Math.abs(c.yCm - 90) <= 1 && Math.abs(c.xCm - 30) <= 1, JSON.stringify(c));
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

prueba("la herramienta está declarada para Gemini con todos los ids y el orden de los colores", () => {
  assert.ok(NOMBRES_HERRAMIENTAS.includes("agregar_mobiliario"));
  const d = DECLARACIONES_ESCENA.find((x) => x.name === "agregar_mobiliario") ?? assert.fail("declaración");
  const texto = JSON.stringify(d);
  for (const m of CATALOGO_MOBILIARIO) assert.ok(texto.includes(m.id), `falta ${m.id} en la declaración`);
  assert.match(texto, /Colores en orden: 1 estructura, 2 cojín/);
  assert.match(d.description, /alrededor/);
});

prueba("la lectura de una foto con mobiliario compila (cantidad en fila, alrededor de la mesa, pared, acabado)", () => {
  const base = { aspecto: 1.2, escala: { altoImagenCm: 300, referencia: "mesa de 75 cm" }, pisoY: 0.9, sala: { pared: "#eeeeee", piso: "#d8cbbb" } };
  const compilar = (piezas: unknown[]) => {
    const lectura = LecturaFotoSchema.parse({ resumen: "Fiesta con mobiliario", ...base, piezas });
    return compilarLectura(lectura);
  };
  const mesaYSillas = compilar([
    { tipo: "fondo", id: "mesa_redonda_mantel", x: 0.5, yBase: 0.9, ancho: 0.5, alto: 0.25, colores: [color("blanco", "#f5f5f0")] },
    { tipo: "fondo", id: "silla_tiffany", x: 0.5, yBase: 0.95, ancho: 0.6, alto: 0.3, cantidad: 6, colores: [color("dorado", "#d4af5a", "cromado")] },
  ]);
  assert.equal(mesaYSillas.omitidas.length, 0, mesaYSillas.omitidas.join("; "));
  const sillas = mesaYSillas.escena.nodos.filter((n) => n.id.startsWith("silla-tiffany"));
  assert.equal(sillas.length, 6);
  const mesa = mesaYSillas.escena.nodos.find((n) => n.id.startsWith("mesa-redonda-mantel"))!;
  const radios = sillas.map((n) => Math.hypot(piso(n).x - piso(mesa).x, piso(n).z - piso(mesa).z));
  assert.ok(Math.max(...radios) - Math.min(...radios) < 1.5, `sillas alrededor de la mesa leída (${radios.map((r) => r.toFixed(0)).join(",")})`);
  assert.ok(mesaYSillas.escena.nodos.every((n) => n.pieza.tipo === "escenografia" && n.pieza.mueble && n.pieza.elementos.length === 0));
  assert.equal((sillas[0]!.pieza as Extract<Pieza, { tipo: "escenografia" }>).mueble?.opciones?.acabado, "metal", "el acabado leído (cromado) se conserva");
  assert.equal(armarEscena(mesaYSillas.escena).materiales.length, 0);

  const fila = compilar([{ tipo: "fondo", id: "mesa_coctel", x: 0.5, yBase: 0.9, ancho: 0.6, alto: 0.3, cantidad: 3, colores: [color("blanco", "#ffffff")] }]);
  assert.equal(fila.escena.nodos.length, 3, "cantidad también en las mesas (no solo asientos)");
  const xs = fila.escena.nodos.map((n) => piso(n).x);
  assert.ok(xs[1]! - xs[0]! >= 66 && Math.abs(xs[1]! - xs[0]! - (xs[2]! - xs[1]!)) < 0.6, "en fila pareja");

  const pared = compilar([{ tipo: "fondo", id: "neon_cursiva", texto: "Mia", x: 0.5, yBase: 0.5, ancho: 0.3, alto: 0.15, cantidad: 3, colores: [color("negro", "#000000"), color("rosa", "#ff66aa")] }]);
  assert.equal(pared.escena.nodos.length, 1);
  assert.ok(pared.notas.some((n) => /de pared van de uno en uno/.test(n)), pared.notas.join("|"));
  const loco = compilar([{ tipo: "fondo", id: "silla_tiffany", x: 0.5, yBase: 0.95, ancho: 0.9, alto: 0.9, colores: [color("dorado", "#d4af5a")] }]);
  assert.ok(medidasDe(loco.escena.nodos[0]!.pieza).alto <= 90 * 2.2 + 2 && loco.notas.some((n) => /no es razonable/.test(n)), "lo leído de más se acota y se avisa");
});

prueba("el inventario en inglés para FLUX nombra muebles, colores y el texto del letrero", () => {
  const a = agregar(vacia(), { id: "mesa_imperial_mantel" });
  const b = agregar(a.escena, { id: "silla_tiffany", cantidad: 3, disposicion: "fila" });
  const c = agregar(b.escena, { id: "neon_cursiva", texto: "Mia 15", colores: ["negro", "rosa"] });
  const texto = escenaEnIngles(c.escena, armarEscena(c.escena));
  assert.match(texto, /banquet table with a floor-length tablecloth in white/);
  assert.match(texto, /3 × Tiffany \(chiavari\) chair in [^,]*#D6B25A/);
  assert.match(texto, /cursive neon sign on a dark panel in [^,]*reading "Mia 15"/);
});

console.log(`test-mobiliario: ${pruebas} pruebas ok`);
