/**
 * La vista 3D de «Tu plan» con los componentes reales (REQ-007, fase 3). Sin red, sin WebGL y sin coste: el plan y las
 * respuestas de `/api/guiada/motor/armada` las graba `datos-vista-motor3d.ts` con la ruta de verdad (el motor es solo de
 * servidor y aquí no se puede importar) y `fetch` las repite.
 * - el plan trae lo que su vista necesita (token, hash, motor, espec) y sobrevive a guardarse en la sesión; uno sin espec no tiene vista;
 * - camino SIN WebGL de punta a punta: firma → gestor → SVG del servidor → `MarcoVistaPlan3D`: la imagen, un círculo por globo de la
 *   lista de materiales (en total y por pieza), la leyenda de colores con las mismas cifras y sin «girar» (no hay visor);
 * - con WebGL el marco ofrece girar; cargando muestra un esqueleto y un error se dice con honestidad, sin ocultar el plan;
 * - la hoja que gira maneja `webglcontextlost`, suelta el visor sin pantalla y pierde su contexto al cerrarse.
 *
 * Run: npx tsx scripts/test/test-motor3d-ui.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { VistaPlanNoDisponible, TEXTO_VISTA_NO_DISPONIBLE } from "@/components/guiado/Plan3DEnPreparacion";
import { globosPorColor, piezasVistaDePlan } from "@/components/guiado/piezas-vista";
import { MarcoVistaPlan3D } from "@/components/guiado/motor3d/VistaPlan3D";
import { firmaDePlan, vistaDePieza, vistaDelPlan } from "@/components/guiado/motor3d/firma-plan";
import { crearGestorVista } from "@/components/guiado/motor3d/gestor-vista";
import type { EstadoImagenPlan3D } from "@/components/guiado/motor3d/usarImagenPlan3D";

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try { await prueba(); casos += 1; console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

type Grabacion = { cuerpo: Record<string, unknown>; estado: number; tipo: string | null; texto: string };
type Datos = { plan: unknown; cotizacion: unknown; globosBom: number; porPieza: Record<string, number>; grabaciones: Grabacion[] };
const datos: Datos = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-vista-motor3d.ts"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as Datos;
const plan = PlanGuiadoSchema.parse(datos.plan);
const piezas = piezasVistaDePlan(plan);
const firma = firmaDePlan(plan)!;
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replace(/\s+/g, " ");
const sinClave = (objeto: object, clave: string) => Object.fromEntries(Object.entries(objeto).filter(([k]) => k !== clave));
const circulos = (svg: string) => [...svg.matchAll(/<circle data-c=/g)].length;
const deDataUrl = (url: string) => decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));

/** Repite las respuestas grabadas con la ruta de verdad, exigiendo que el cuerpo sea exactamente el que ella aceptó. */
const llamadas: Array<Record<string, unknown>> = [];
const redGrabada = (async (_url: string, init?: RequestInit) => {
  const cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
  llamadas.push(cuerpo);
  const grabada = datos.grabaciones.find((g) => g.cuerpo.salida === cuerpo.salida && g.cuerpo.vista === cuerpo.vista && g.cuerpo.pieza === cuerpo.pieza);
  assert.ok(grabada, `ninguna respuesta grabada para ${JSON.stringify({ ...cuerpo, approval_token: "…", espec: "…" })}`);
  assert.deepEqual(cuerpo, grabada.cuerpo, "el cliente manda lo que la ruta aceptó");
  return new Response(grabada.texto, { status: grabada.estado, headers: { "content-type": grabada.tipo ?? "text/plain" } });
}) as unknown as typeof fetch;

const sinWebgl = { webgl: false, memoriaGb: 8, ahorroDatos: false };
const noDebiaAbrirVisor = () => { throw new Error("el visor sin pantalla no debía abrirse"); };

async function main(): Promise<void> {
  await caso("el plan trae su firma (token, hash, motor, espec) y esta sobrevive a guardarse en la sesión", () => {
    assert.equal(firma.approval_token, plan.approval_token);
    assert.equal(firma.plan_hash, plan.plan_hash);
    assert.equal(firma.motor.id, "globos3d");
    const guardado = WidgetGuiadoSchema.parse(JSON.parse(JSON.stringify({ tipo: "plan", plan, motor: "3d", cotizacion: datos.cotizacion })));
    assert.deepEqual(guardado.tipo === "plan" ? firmaDePlan(guardado.plan) : null, firma, "ida y vuelta por el esquema del widget");
    const sinEspec = sinClave(plan, "espec");
    assert.equal(firmaDePlan(PlanGuiadoSchema.parse(sinEspec)), null, "sin espec no hay vista");
    const sinMotor = sinClave(plan, "motor");
    assert.equal(firmaDePlan(PlanGuiadoSchema.parse(sinMotor)), null, "sin motor tampoco");
    assert.equal(firmaDePlan(PlanGuiadoSchema.parse({ ...plan, motor: { id: "python", version: "1" } })), null, "un plan de otro motor no se dibuja aquí");
  });

  await caso("la cámara: de frente solo si todo es plano; una columna pide tres cuartos", () => {
    assert.equal(vistaDePieza("guirnalda"), "frente");
    assert.equal(vistaDePieza("pared_organica"), "frente");
    assert.equal(vistaDePieza("columna"), "tres-cuartos");
    assert.equal(vistaDePieza("arco"), "tres-cuartos");
    assert.equal(vistaDePieza(null), "tres-cuartos");
    assert.equal(vistaDelPlan([{ oficial: "guirnalda" }, { oficial: "pared_densa" }]), "frente");
    assert.equal(vistaDelPlan([{ oficial: "guirnalda" }, { oficial: "arco" }]), "tres-cuartos");
    assert.equal(vistaDelPlan([]), "tres-cuartos");
  });

  await caso("SIN WebGL de punta a punta: el SVG del servidor llega al marco, con un círculo por globo y su leyenda", async () => {
    llamadas.length = 0;
    const gestor = crearGestorVista({ red: redGrabada, entorno: sinWebgl, visor: noDebiaAbrirVisor });
    const imagen = await gestor.imagen(firma, { vista: vistaDelPlan(piezas), lado: 768 });
    assert.equal(imagen.modo, "svg");
    const svg = deDataUrl(imagen.url);
    assert.equal(circulos(svg), datos.globosBom, "tantos círculos como globos en la lista de materiales");

    const estado: EstadoImagenPlan3D = { fase: "lista", imagen };
    const html = renderToStaticMarkup(createElement(MarcoVistaPlan3D, { firma, titulo: plan.plan.concepto.titulo, piezas, estado }));
    assert.match(html, /data-testid="vista-plan-3d" data-modo="svg"/);
    assert.ok(html.includes(`<img src="${imagen.url.replaceAll("&", "&amp;")}"`) || html.includes("data:image/svg+xml;charset=utf-8,"), "la imagen es el SVG");
    assert.ok(!html.includes("Toca para girarla") && !/<button/.test(html), "sin visor no se gira: ni botón ni invitación");
    assert.ok(texto(html).includes("en este dispositivo no se puede girar"), "se dice por qué");
    // La leyenda: un chip por producto con su cantidad, de la misma lista que la tabla; suman los globos del plan.
    const colores = globosPorColor(piezas.flatMap((p) => p.lineas));
    assert.ok(colores.length >= 2);
    assert.equal(colores.reduce((s, c) => s + c.cantidad, 0), datos.globosBom);
    const t = texto(html);
    for (const color of colores) assert.ok(t.includes(`${color.producto ?? color.etiqueta} ${color.cantidad}`), `chip de ${color.producto ?? color.etiqueta}: ${color.cantidad}`);
    assert.equal([...html.matchAll(/<li /g)].length, colores.length, "un chip por color");
  });

  await caso("SIN WebGL, pieza por pieza: el SVG de cada una tiene los globos de esa pieza", async () => {
    llamadas.length = 0;
    const gestor = crearGestorVista({ red: redGrabada, entorno: sinWebgl, visor: noDebiaAbrirVisor });
    for (const pieza of piezas) {
      const imagen = await gestor.imagen(firma, { vista: vistaDePieza(pieza.oficial), lado: 192, pieza: pieza.id });
      assert.equal(circulos(deDataUrl(imagen.url)), datos.porPieza[pieza.id], pieza.id);
    }
    assert.equal(llamadas.length, piezas.length);
    assert.ok(llamadas.every((c) => c.salida === "svg"), "sin WebGL no se pide la armada");
  });

  await caso("con WebGL el marco ofrece girar (un botón con nombre); aún sin abrir la hoja", () => {
    const estado: EstadoImagenPlan3D = { fase: "lista", imagen: { modo: "webgl", url: "data:image/png;base64,AAA" } };
    const html = renderToStaticMarkup(createElement(MarcoVistaPlan3D, { firma, titulo: "Mi plan", piezas, estado }));
    assert.match(html, /data-modo="webgl"/);
    assert.match(html, /<button[^>]*aria-label="Abrir la vista de tu decoración para girarla"/);
    assert.ok(html.includes("Toca para girarla"));
    assert.ok(!html.includes('data-testid="hoja-orbita"'), "la hoja solo existe al tocar");
    assert.ok(texto(html).includes(piezas[0]!.lineas[0]!.producto ?? piezas[0]!.lineas[0]!.etiqueta), "la leyenda también");
  });

  await caso("cargando: esqueleto accesible; error: el aviso honesto y el plan sigue (sin imagen rota)", () => {
    const cargando = renderToStaticMarkup(createElement(MarcoVistaPlan3D, { firma, titulo: "Mi plan", piezas, estado: { fase: "cargando" } }));
    assert.match(cargando, /data-modo="cargando"/);
    assert.match(cargando, /role="status" aria-label="Preparando la vista de tu decoración"/);
    assert.ok(!cargando.includes("<img") && !/<button/.test(cargando));
    const error = renderToStaticMarkup(createElement(MarcoVistaPlan3D, { firma, titulo: "Mi plan", piezas, estado: { fase: "error" } }));
    assert.ok(texto(error).includes(TEXTO_VISTA_NO_DISPONIBLE));
    assert.equal(error, renderToStaticMarkup(createElement(VistaPlanNoDisponible)));
    assert.ok(!error.includes("<img"));
  });

  await caso("la hoja que gira: maneja webglcontextlost, suelta el visor sin pantalla, pierde su contexto y no mira ni arrastra nada", () => {
    const fuente = readFileSync(path.join(__dirname, "..", "..", "src", "components", "guiado", "motor3d", "HojaOrbita.tsx"), "utf8");
    assert.match(fuente, /addEventListener\("webglcontextlost"/);
    assert.match(fuente, /removeEventListener\("webglcontextlost"/);
    assert.match(fuente, /suspenderVisor\(\)/, "un solo contexto vivo: el visor sin pantalla se suspende en la fila");
    assert.match(fuente, /ficha\.soltar\(\)/, "y se reanuda al cerrar la hoja");
    assert.match(fuente, /if \(visor\) \{[\s\S]*?perderContexto\(lienzo\)/, "solo pierde el contexto si hubo visor: no crea uno para perderlo");
    assert.match(fuente, /perderContexto\(lienzo\)/, "al cerrarse pierde el contexto a propósito");
    assert.match(fuente, /<canvas key=\{intento\}/, "tras perder el contexto, un lienzo nuevo");
    assert.match(fuente, /preventDefault\(\)/);
    assert.ok(!/from "three"/.test(fuente), "three.js solo entra por el visor del Taller");
    // D-020: ni elegir, ni arrastrar, ni inspector, ni cuadrícula: ninguna API de edición del visor.
    for (const prohibido of ["piezaEn", "puntoEnPlano", "trasladarPiezas", "lugarEn", "resaltar", "mostrarFantasma", "ocultarCopia", "Inspector"]) assert.ok(!fuente.includes(prohibido), `la hoja no usa ${prohibido}`);
  });

  console.log(`test-motor3d-ui: ok (${casos} pruebas)`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

