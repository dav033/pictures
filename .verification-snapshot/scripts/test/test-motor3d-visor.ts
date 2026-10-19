/**
 * La vista 3D del plan guiado, del lado del navegador y sin navegador (REQ-007, fase 3). Sin red, sin WebGL y sin coste: el
 * visor, el lienzo, la red y el entorno son dobles.
 * - `desde-armada-compacta`: la armada compacta del motor real se vuelve lo que `mostrarArmada` dibuja (globos, tubos, caja de
 *   cada pieza, color por código Sempertex, sala neutra) y lo que llega por la red se valida antes;
 * - `visor-compartido`: UN visor para todas las imágenes, en fila; se recicla, se suelta tras un rato sin pedidos, al perder el
 *   contexto y a pedido, y siempre pierde el contexto a propósito (`WEBGL_lose_context`);
 * - `gestor-vista`: sin WebGL, con poca memoria o con el visor caído sale el SVG del servidor; con WebGL, una armada por plan y
 *   una imagen por (pieza, cámara).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor3d-visor.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { armarDesdeEspec, type ArmadaCompactaV1 } from "../../src/lib/globos3d/motor/v1";
import { TABLA_SEMPERTEX, referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import type { EscenaGlobos } from "../../src/components/tres-d/escena-globos";
import { armadaDibujable, codigoDeHex, escenaDesdeArmada, salaDeArmada } from "../../src/components/guiado/motor3d/desde-armada-compacta";
import { FalloWebgl, RENDERS_POR_VISOR, crearVisorCompartido, type DependenciasVisor, type MotorDelVisor, type PedidoImagen, type VisorCompartido } from "../../src/components/guiado/motor3d/visor-compartido";
import { FalloArmada, MEMORIA_MINIMA_GB, crearGestorVista, modoInicial, type EntornoVista, type FirmaPlan } from "../../src/components/guiado/motor3d/gestor-vista";
import { todosLosCasos } from "../lib/casos-motor-guiada";

const armados = todosLosCasos().flatMap((caso) => {
  const resultado = armarDesdeEspec(caso.espec);
  return resultado.noRepresentable.length ? [] : [{ id: caso.id, resultado }];
});
const COLUMNA = armados.find((a) => a.id.includes("columna"))!.resultado.armada;
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── desde-armada-compacta ───

test("la armada compacta de cada caso se puede dibujar y se vuelve la escena del visor, globo por globo", () => {
  for (const { id, resultado } of armados) {
    const { armada } = resultado;
    assert.equal(armadaDibujable(armada), true, id);
    const escena = escenaDesdeArmada(armada);
    assert.equal(escena.globos.length, armada.globos.length / 5, `${id}: un globo del visor por cada uno de la armada`);
    assert.deepEqual(escena.porNodo.map((n) => n.id), armada.piezas.map((p) => p.id), `${id}: un nodo por pieza`);
    armada.piezas.forEach((pieza, i) => {
      const nodo = escena.porNodo[i]!;
      assert.equal(nodo.globos.length, pieza.globos[1], `${id}/${pieza.id}`);
      assert.equal(nodo.tubos.length, pieza.tubos[1]);
      assert.equal(nodo.flores.length, pieza.flores[1]);
      assert.deepEqual([nodo.caja.min.x, nodo.caja.min.y, nodo.caja.min.z, nodo.caja.max.x, nodo.caja.max.y, nodo.caja.max.z], pieza.caja);
    });
  }
});

test("cada globo vuelve a su centro y a su color Sempertex exacto (con su acabado)", () => {
  const { armada } = armados.find((a) => a.id.includes("oficial-arco"))!.resultado;
  const escena = escenaDesdeArmada(armada);
  escena.globos.forEach((g, i) => {
    const [x, y, z, diametro, color] = armada.globos.slice(i * 5, i * 5 + 5) as [number, number, number, number, number];
    assert.equal(g.infladoCm, diametro);
    assert.deepEqual({ x: g.nudo.x + g.direccion.x * (g.infladoCm / 2 + g.cuelloExtraCm), y: g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm), z: g.nudo.z + g.direccion.z * (g.infladoCm / 2 + g.cuelloExtraCm) }, { x, y, z }, "el centro del globo no se mueve");
    assert.equal(referenciaPorCodigo(g.codigo)?.hexGlobo, armada.paleta[color], "el código da el mismo tono");
  });
});

test("codigoDeHex: cada tono de la tabla vuelve a su código; uno ajeno toma el más cercano", () => {
  for (const ref of TABLA_SEMPERTEX.referencias) assert.equal(codigoDeHex(ref.hexGlobo), ref.codigo);
  const casi = TABLA_SEMPERTEX.referencias[3]!;
  const mover = (hex: string) => `#${[1, 3, 5].map((i) => Math.min(255, Number.parseInt(hex.slice(i, i + 2), 16) + 1).toString(16).padStart(2, "0")).join("")}`;
  assert.ok(referenciaPorCodigo(codigoDeHex(mover(casi.hexGlobo))));
  assert.match(codigoDeHex("#9ca3af"), /^\d{3}$/, "el gris de «sin referencia» también tiene código");
});

test("una pieza sola, y la sala neutra sin cuadrícula ni ayudas, techo ni paredes laterales", () => {
  const unaSola = escenaDesdeArmada(COLUMNA, { pieza: COLUMNA.piezas[0]!.id });
  assert.equal(unaSola.porNodo.length, 1);
  assert.equal(unaSola.globos.length, COLUMNA.piezas[0]!.globos[1]);
  assert.equal(escenaDesdeArmada(COLUMNA, { pieza: "EST_99_NADA" }).porNodo.length, 0);
  const sala = salaDeArmada(COLUMNA);
  assert.deepEqual(sala.mostrar, { piso: true, fondo: true, laterales: false, techo: false });
  assert.deepEqual(sala.ambiente, { piso: "liso", luces: false, ventana: false });
  assert.ok(sala.anchoCm >= 2400 && sala.altoCm >= 900, "la pared del fondo no deja ver sus bordes");
  assert.equal(sala.fondoCm, COLUMNA.sala.fondoCm, "la profundidad es la del motor: de ella depende dónde está la pared");
  assert.deepEqual(escenaDesdeArmada(COLUMNA).solidos, [], "sin escenografía");
  assert.deepEqual(escenaDesdeArmada(COLUMNA).cilindros, []);
});

test("armadaDibujable no se fía de la red", () => {
  const rota = (cambio: Partial<ArmadaCompactaV1> | Record<string, unknown>) => ({ ...COLUMNA, ...cambio });
  for (const [nombre, valor] of [
    ["null", null], ["texto", "armada"], ["otra versión", rota({ version: "armada-compacta.v9" })], ["sin sala", rota({ sala: undefined })],
    ["globos que no son de 5 en 5", rota({ globos: [1, 2, 3] })], ["color fuera de la paleta", rota({ globos: [0, 0, 0, 25, 99] })],
    ["un número que no lo es", rota({ globos: [0, 0, 0, 25, Number.NaN] })], ["paleta con un color mal escrito", rota({ paleta: ["rojo"] })],
    ["tubo con puntos truncos", rota({ tubos: [{ grosorCm: 2, color: 0, puntos: [1, 2] }] })], ["piezas sin caja", rota({ piezas: [{ id: "x" }] })],
  ] as const) assert.equal(armadaDibujable(valor), false, nombre);
});

// ─── visor-compartido ───

type Registro = { creados: number; destruidos: number; contextosPerdidos: number; lienzosQuitados: number; mostrados: string[][]; renders: Array<{ vista: string; lado: number }>; enCurso: number; maximoEnCurso: number };

function entorno(opciones: { ocioMs?: number; fallaCrear?: boolean; fallaCargar?: boolean; alRenderizar?: () => void } = {}) {
  const r: Registro = { creados: 0, destruidos: 0, contextosPerdidos: 0, lienzosQuitados: 0, mostrados: [], renders: [], enCurso: 0, maximoEnCurso: 0 };
  const oyentes = new Map<string, Set<(e: Event) => void>>();
  const lienzos: HTMLCanvasElement[] = [];
  const crearLienzo = (): HTMLCanvasElement => {
    const propios = new Map<string, Set<(e: Event) => void>>();
    const lienzo = {
      addEventListener: (tipo: string, f: (e: Event) => void) => { (propios.get(tipo) ?? propios.set(tipo, new Set()).get(tipo)!).add(f); oyentes.set(tipo, propios.get(tipo)!); },
      removeEventListener: (tipo: string, f: (e: Event) => void) => { propios.get(tipo)?.delete(f); },
      remove: () => { r.lienzosQuitados += 1; },
      getContext: (tipo: string) => (tipo === "webgl2" ? { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => { r.contextosPerdidos += 1; } } : null) } : null),
    } as unknown as HTMLCanvasElement;
    lienzos.push(lienzo);
    return lienzo;
  };
  const visorFalso = {
    renderEstandar: (vista: string, lado: number) => { r.renders.push({ vista, lado }); opciones.alRenderizar?.(); return `data:image/png;base64,${r.renders.length}`; },
    destruir: () => { r.destruidos += 1; },
  } as unknown as EscenaGlobos;
  const motor: MotorDelVisor = {
    crearEscena: () => { if (opciones.fallaCrear) throw new Error("sin WebGL"); r.creados += 1; return visorFalso; },
    mostrarArmada: (_v, escena) => { r.mostrados.push(escena.porNodo.map((n) => n.id)); },
  };
  const deps: DependenciasVisor = {
    cargarMotor: async () => { if (opciones.fallaCargar) throw new Error("chunk"); return motor; },
    crearLienzo,
    esperarCuadro: async () => { r.enCurso += 1; r.maximoEnCurso = Math.max(r.maximoEnCurso, r.enCurso); await esperar(1); r.enCurso -= 1; },
    ocioMs: opciones.ocioMs ?? 10_000,
  };
  const perderContexto = () => { for (const f of oyentes.get("webglcontextlost") ?? []) f({ preventDefault: () => undefined } as unknown as Event); };
  return { r, deps, perderContexto, visor: crearVisorCompartido(deps) };
}
const pedido = (extra: Partial<PedidoImagen> = {}): PedidoImagen => ({ armada: COLUMNA, vista: "tres-cuartos", lado: 768, ...extra });

test("un solo visor para todas las imágenes, una a la vez", async () => {
  const e = entorno();
  const imagenes = await Promise.all(Array.from({ length: 12 }, (_, i) => e.visor.imagen(pedido({ lado: 100 + i }))));
  assert.equal(e.r.creados, 1, "doce imágenes, un visor (un contexto WebGL)");
  assert.equal(e.r.maximoEnCurso, 1, "nunca dos dibujos a la vez sobre el mismo visor");
  assert.deepEqual(e.r.renders.map((x) => x.lado), Array.from({ length: 12 }, (_, i) => 100 + i), "en el orden en que se pidieron");
  assert.equal(new Set(imagenes).size, 12);
  e.visor.liberar();
});

test("cada pedido dibuja lo suyo: la pieza sola o toda la decoración, con su cámara", async () => {
  const e = entorno();
  await e.visor.imagen(pedido({ pieza: COLUMNA.piezas[0]!.id, vista: "frente", lado: 192 }));
  await e.visor.imagen(pedido());
  assert.deepEqual(e.r.mostrados[0], [COLUMNA.piezas[0]!.id]);
  assert.deepEqual(e.r.mostrados[1], COLUMNA.piezas.map((p) => p.id));
  assert.deepEqual(e.r.renders, [{ vista: "frente", lado: 192 }, { vista: "tres-cuartos", lado: 768 }]);
  e.visor.liberar();
});

test("se recicla cada RENDERS_POR_VISOR dibujos y cada reciclaje pierde el contexto del anterior", async () => {
  const e = entorno();
  for (let i = 0; i < RENDERS_POR_VISOR + 1; i++) await e.visor.imagen(pedido());
  assert.equal(e.r.creados, 2);
  assert.equal(e.r.destruidos, 1);
  assert.equal(e.r.contextosPerdidos, 1, "destruir el visor no basta: el contexto se pierde a propósito");
  assert.equal(e.r.lienzosQuitados, 1);
  e.visor.liberar();
  assert.equal(e.r.destruidos, 2);
  assert.equal(e.r.contextosPerdidos, 2);
});

test("sin pedidos se suelta solo, y el siguiente pedido arma otro", async () => {
  const e = entorno({ ocioMs: 15 });
  await e.visor.imagen(pedido());
  assert.equal(e.r.destruidos, 0);
  await esperar(60);
  assert.equal(e.r.destruidos, 1, "tras el ocio se destruye");
  assert.equal(e.r.contextosPerdidos, 1);
  assert.equal(e.r.lienzosQuitados, 1);
  await e.visor.imagen(pedido());
  assert.equal(e.r.creados, 2);
  e.visor.liberar();
});

test("liberar a pedido (la hoja que gira abre el suyo) es idempotente", async () => {
  const e = entorno();
  e.visor.liberar();
  await e.visor.imagen(pedido());
  e.visor.liberar();
  e.visor.liberar();
  assert.equal(e.r.destruidos, 1);
  assert.equal(e.r.contextosPerdidos, 1);
});

test("suspender (la hoja que gira): espera a lo que se está dibujando, suelta el visor y pausa los pedidos nuevos hasta soltar", async () => {
  const e = entorno();
  const primera = e.visor.imagen(pedido({ lado: 111 }));
  const ficha = e.visor.suspender();
  const durante = e.visor.imagen(pedido({ lado: 222 }));
  await ficha.listo;
  assert.deepEqual((await primera).startsWith("data:image"), true, "lo que ya se dibujaba termina bien: no se destruye bajo sus pies");
  assert.equal(e.r.renders.length, 1);
  assert.equal(e.r.destruidos, 1, "el visor quedó suelto");
  assert.equal(e.r.contextosPerdidos, 1);
  await esperar(60);
  assert.equal(e.r.renders.length, 1, "el pedido de después espera: no abre otro contexto con la hoja abierta");
  assert.equal(e.r.creados, 1);
  ficha.soltar();
  ficha.soltar();
  await durante;
  assert.equal(e.r.renders.length, 2);
  assert.equal(e.r.creados, 2, "al soltar se arma un visor nuevo para lo que esperaba");
  e.visor.liberar();
});

test("suspender: dos hojas a la vez se reparten la pausa, y soltar antes de que empiece la cancela", async () => {
  const e = entorno();
  const a = e.visor.suspender(), b = e.visor.suspender();
  await Promise.all([a.listo, b.listo]);
  const pedida = e.visor.imagen(pedido());
  a.soltar();
  await esperar(40);
  assert.equal(e.r.renders.length, 0, "queda una suspensión: sigue la pausa");
  b.soltar();
  await pedida;
  assert.equal(e.r.renders.length, 1);
  // Una suspensión cancelada antes de su turno no pausa nada.
  const bloqueo = e.visor.imagen(pedido());
  const cancelada = e.visor.suspender();
  cancelada.soltar();
  await bloqueo;
  await cancelada.listo;
  await e.visor.imagen(pedido());
  assert.equal(e.r.renders.length, 3);
  e.visor.liberar();
});

test("una pieza sin nada que dibujar no deja el visor encendido: el temporizador de ocio sigue corriendo", async () => {
  const e = entorno({ ocioMs: 20 });
  await e.visor.imagen(pedido());
  await assert.rejects(e.visor.imagen(pedido({ pieza: "EST_99_NADA" })), /nada que dibujar/);
  await esperar(70);
  assert.equal(e.r.destruidos, 1, "el visor se soltó por ocio aunque el último pedido fuera una pieza vacía");
});

test("si el navegador pierde el contexto, ese visor no se reutiliza", async () => {
  const e = entorno();
  await e.visor.imagen(pedido());
  e.perderContexto();
  await e.visor.imagen(pedido());
  assert.equal(e.r.creados, 2, "el siguiente pedido estrena visor");
  assert.equal(e.r.destruidos, 1);
  e.visor.liberar();
});

test("perder el contexto en pleno dibujo es un FalloWebgl y deja el visor suelto", async () => {
  let perder: () => void = () => undefined;
  const e = entorno({ alRenderizar: () => perder() });
  perder = e.perderContexto;
  await assert.rejects(e.visor.imagen(pedido()), (error: unknown) => error instanceof FalloWebgl);
  assert.equal(e.r.destruidos, 1);
});

test("los fallos de WebGL son FalloWebgl; «no hay nada que dibujar» no, y no abre visor", async () => {
  await assert.rejects(entorno({ fallaCrear: true }).visor.imagen(pedido()), (error: unknown) => error instanceof FalloWebgl && /sin WebGL/.test(error.message));
  await assert.rejects(entorno({ fallaCargar: true }).visor.imagen(pedido()), (error: unknown) => error instanceof FalloWebgl && /chunk/.test(error.message));
  const e = entorno();
  await assert.rejects(e.visor.imagen(pedido({ pieza: "EST_99_NADA" })), (error: unknown) => error instanceof Error && !(error instanceof FalloWebgl) && /nada que dibujar/.test(error.message));
  assert.equal(e.r.creados, 0);
  // Un fallo no rompe la fila: lo que sigue se dibuja.
  const f = entorno({ fallaCrear: true });
  await f.visor.imagen(pedido()).catch(() => undefined);
  await assert.rejects(f.visor.imagen(pedido()), FalloWebgl);
});

// ─── gestor-vista ───

const FIRMA: FirmaPlan = { approval_token: "token", plan_hash: "a".repeat(64), motor: { id: "globos3d", version: "1.1.0" }, espec: { piezas: [] } };
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"><circle data-c=\"0\"/></svg>";
const WEBGL: EntornoVista = { webgl: true, memoriaGb: 8, ahorroDatos: false };

function red(respuestas: { armada?: () => Response; svg?: () => Response } = {}) {
  const llamadas: Array<Record<string, unknown>> = [];
  const fetchFalso = (async (_url: string, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
    llamadas.push(cuerpo);
    if (cuerpo.salida === "svg") return respuestas.svg ? respuestas.svg() : new Response(SVG, { headers: { "content-type": "image/svg+xml" } });
    return respuestas.armada ? respuestas.armada() : Response.json({ armada: COLUMNA, especHash: FIRMA.plan_hash });
  }) as unknown as typeof fetch;
  return { fetch: fetchFalso, llamadas };
}

function visorDoble(imagen: () => Promise<string> = async () => "data:image/png;base64,AAA") {
  const llamadas: PedidoImagen[] = [];
  let liberados = 0;
  const visor: VisorCompartido = { imagen: async (p) => { llamadas.push(p); return imagen(); }, liberar: () => { liberados += 1; }, suspender: () => ({ listo: Promise.resolve(), soltar: () => undefined }) };
  return { visor, llamadas, liberados: () => liberados };
}

test("modoInicial: sin WebGL, con ahorro de datos o con poca memoria no se abre WebGL", () => {
  assert.equal(modoInicial(WEBGL), "webgl");
  assert.equal(modoInicial({ ...WEBGL, webgl: false }), "svg");
  assert.equal(modoInicial({ ...WEBGL, ahorroDatos: true }), "svg");
  assert.equal(modoInicial({ ...WEBGL, memoriaGb: MEMORIA_MINIMA_GB - 0.5 }), "svg");
  assert.equal(modoInicial({ ...WEBGL, memoriaGb: MEMORIA_MINIMA_GB }), "webgl");
  assert.equal(modoInicial({ ...WEBGL, memoriaGb: null }), "webgl", "un navegador que no dice su memoria (Safari, Firefox) no se castiga");
});

test("sin WebGL: el SVG del servidor, sin abrir visor ni pedir la armada", async () => {
  const r = red();
  const gestor = crearGestorVista({ red: r.fetch, entorno: { ...WEBGL, webgl: false }, visor: () => { throw new Error("no debía abrir el visor"); } });
  const imagen = await gestor.imagen(FIRMA, { vista: "tres-cuartos", lado: 768, pieza: "EST_01_COLUMNA" });
  assert.equal(imagen.modo, "svg");
  assert.equal(decodeURIComponent(imagen.url.replace("data:image/svg+xml;charset=utf-8,", "")), SVG);
  assert.deepEqual(r.llamadas, [{ ...FIRMA, salida: "svg", vista: "tres-cuartos", pieza: "EST_01_COLUMNA" }], "una sola petición, con la firma del plan");
  assert.equal(gestor.modo(), "svg");
});

test("con WebGL: una armada por plan aunque la pidan muchas imágenes a la vez, y una imagen por (pieza, cámara)", async () => {
  const r = red(), v = visorDoble();
  const gestor = crearGestorVista({ red: r.fetch, entorno: WEBGL, visor: () => v.visor });
  const pedidos = [{ vista: "tres-cuartos" as const, lado: 768 }, { vista: "tres-cuartos" as const, lado: 192, pieza: "EST_01_COLUMNA" }, { vista: "tres-cuartos" as const, lado: 192, pieza: "EST_02_COLUMNA" }, { vista: "tres-cuartos" as const, lado: 768 }];
  const imagenes = await Promise.all(pedidos.map((p) => gestor.imagen(FIRMA, p)));
  assert.ok(imagenes.every((i) => i.modo === "webgl"));
  assert.equal(r.llamadas.length, 1, "una armada para las cuatro");
  assert.equal(v.llamadas.length, 3, "la repetida sale de lo guardado");
  assert.ok(v.llamadas.every((l) => l.armada.piezas.length === COLUMNA.piezas.length));
  assert.deepEqual(v.llamadas.map((l) => l.pieza), [undefined, "EST_01_COLUMNA", "EST_02_COLUMNA"]);
  assert.equal(v.liberados(), 0);
});

test("si el visor falla, ese plan y los siguientes pasan al SVG del servidor y el visor se suelta", async () => {
  const r = red();
  const v = visorDoble(async () => { throw new FalloWebgl("se perdió el contexto"); });
  const gestor = crearGestorVista({ red: r.fetch, entorno: WEBGL, visor: () => v.visor });
  const primera = await gestor.imagen(FIRMA, { vista: "frente", lado: 768 });
  assert.equal(primera.modo, "svg");
  assert.equal(gestor.modo(), "svg");
  assert.equal(v.liberados(), 1);
  const segunda = await gestor.imagen(FIRMA, { vista: "frente", lado: 192, pieza: "EST_01_COLUMNA" });
  assert.equal(segunda.modo, "svg");
  assert.equal(v.llamadas.length, 1, "el visor no se vuelve a intentar");
  assert.deepEqual(r.llamadas.map((l) => l.salida), ["armada", "svg", "svg"]);
});

test("un fallo que no es de WebGL (la red, la ruta) se dice y no se guarda: el siguiente pedido lo reintenta", async () => {
  let n = 0;
  const r = red({ armada: () => (n++ === 0 ? new Response("{}", { status: 409 }) : Response.json({ armada: COLUMNA })) });
  const v = visorDoble();
  const gestor = crearGestorVista({ red: r.fetch, entorno: WEBGL, visor: () => v.visor });
  await assert.rejects(gestor.imagen(FIRMA, { vista: "frente", lado: 768 }), (error: unknown) => error instanceof FalloArmada && error.estado === 409);
  assert.equal(gestor.modo(), "webgl", "una armada que no llega no es culpa de WebGL");
  assert.equal((await gestor.imagen(FIRMA, { vista: "frente", lado: 768 })).modo, "webgl");
  const caida = crearGestorVista({ red: (async () => { throw new Error("sin red"); }) as unknown as typeof fetch, entorno: WEBGL, visor: () => v.visor });
  await assert.rejects(caida.imagen(FIRMA, { vista: "frente", lado: 768 }), (error: unknown) => error instanceof FalloArmada && error.estado === null);
});

test("lo que llega mal de la ruta no se pinta: armada que no se puede dibujar o un SVG que no lo es", async () => {
  const v = visorDoble();
  const mala = crearGestorVista({ red: red({ armada: () => Response.json({ armada: { version: "x" } }) }).fetch, entorno: WEBGL, visor: () => v.visor });
  await assert.rejects(mala.imagen(FIRMA, { vista: "frente", lado: 768 }), FalloArmada);
  assert.equal(v.llamadas.length, 0);
  const html = crearGestorVista({ red: red({ svg: () => new Response("<html>login</html>") }).fetch, entorno: { ...WEBGL, webgl: false }, visor: () => v.visor });
  await assert.rejects(html.imagen(FIRMA, { vista: "frente", lado: 768 }), FalloArmada);
});

test("las imágenes guardadas tienen tope de memoria: salen las más viejas", async () => {
  const r = red(), v = visorDoble(async () => `data:image/png;base64,${"A".repeat(1000)}`);
  const gestor = crearGestorVista({ red: r.fetch, entorno: WEBGL, visor: () => v.visor, presupuestoImagenes: 2500 });
  for (const lado of [1, 2, 3, 4]) await gestor.imagen(FIRMA, { vista: "frente", lado });
  await new Promise((resolver) => setImmediate(resolver));
  await gestor.imagen(FIRMA, { vista: "frente", lado: 4 });
  assert.equal(v.llamadas.length, 4, "la última sigue guardada");
  await gestor.imagen(FIRMA, { vista: "frente", lado: 1 });
  assert.equal(v.llamadas.length, 5, "la primera ya salió");
});
