/**
 * Lo que dejó la sesión del dueño del 2026-10-09 (11:33 a 11:37, conversación 3d-20261009-103125-92b58a). Sin coste: ni red ni IA.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-sesion-dueno-2.ts
 * - un aviso de una herramienta que sí funcionó («AVISO DE COLOR … dilo al usuario») llega a la respuesta final;
 * - una clave desconocida (`cuelga` por `cuelga_cm`) es un error con la clave buena, también anidada;
 * - la descripción para FLUX no niega lo que hay (arco con patas + globos del techo; «techo vacío» con helio colgado);
 * - los globos del techo no echan sombra en el visor; el mantel tiene falda más oscura que la tapa;
 * - «mesas» ambiguas: la regla de preguntar; las líneas de registro de más de 15 KB salen en fragmentos que se juntan;
 * - toda foto «Igual al visor» captura la sala entera y va por el camino fiel.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { claveDesconocida, sugerenciaDeClave } from "../../src/lib/globos3d/argumentos-desconocidos";
import type { AvisoUsuario } from "../../src/lib/globos3d/avisos-usuario";
import { conHonestidad } from "../../src/lib/globos3d/honestidad-respuesta";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { colgadoDelTecho, descripcionRender3d, promptFotoDeLayout, promptRender3d } from "../../src/lib/globos3d/render-ia";
import { REGLAS_AGENTE } from "../../src/lib/globos3d/escena-ia-agente";
import { MAX_LINEA_STDOUT, partirLinea, reensamblarFragmentos } from "../../src/lib/registro/fragmentos";
import { mesaConMantel, sombrear, SOMBRA_FALDA } from "../../src/lib/globos3d/escenografia";
import { mesaRedondaMantel } from "../../src/lib/globos3d/mobiliario-mesas";
import { mat } from "../../src/lib/globos3d/mobiliario-base";
import { entradasDeVercel, lineasPropias } from "../ops/lineas-vercel";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1200, fondoCm: 900, altoCm: 450 }, nodos: [] });
const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => { const r = aplicarHerramienta(e, herramienta, args); if (!r.ok) assert.fail(`${herramienta}: ${r.error}`); return r.escena; };

console.log("Avisos de herramientas que funcionaron");
const TEXTO_AVISO = "«Marco»: Ningún color de la paleta se fabrica en R-9: se usa Metal Rojo (515), el más parecido a Reflex Cristal Rojo (915).";
const AVISO: AvisoUsuario = { texto: TEXTO_AVISO, palabras: ["no se fabrica", "más parecid", "sustitu", "515", "915"] };
prueba("el aviso de color es un dato de la herramienta, sin la instrucción para el modelo", () => {
  const e = paso(vacia(), "agregar_pieza", { tipo: "arco_organico", colores: ["dorado reflex", "plata reflex"] });
  const r = aplicarHerramienta(e, "cambiar_pieza", { id: "arco-organico", colores: ["azul reflex", "violeta reflex", "rojo reflex"] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.resumen, /AVISO DE COLOR/, "el resumen para el modelo lo sigue diciendo");
  assert.equal(r.avisos?.length, 1);
  assert.match(r.avisos![0]!.texto, /Ningún color de la paleta se fabrica en R-9: se usa/);
  assert.doesNotMatch(r.avisos![0]!.texto, /Si el usuario|ajustar_tamanos|dilo al usuario/);
  const sin = conHonestidad("Listo.", [], [], r.avisos);
  assert.match(sin, /\n\nAviso: «.*»: Ningún color/);
  assert.equal(conHonestidad("Ojo: ese color no se fabrica en R-9, puse el más parecido.", [], [], r.avisos), "Ojo: ese color no se fabrica en R-9, puse el más parecido.");
  assert.equal(aplicarHerramienta(e, "ver_escena", {}).ok && (aplicarHerramienta(e, "ver_escena", {}) as { avisos?: unknown }).avisos, undefined);
});
prueba("la respuesta que lo calla recibe «Aviso: …»; la que lo dice no se repite", () => {
  const avisos: AvisoUsuario[] = [{ texto: "«Marco»: Ningún color de la paleta se fabrica en R-9: se usa Metal Rojo (515), el más parecido a Reflex Cristal Rojo (915).", palabras: ["no se fabrica", "más parecid", "sustitu", "515", "915"] }];
  const r = conHonestidad("Listo, recoloreé la escena.", [], [], avisos);
  assert.match(r, /^Listo, recoloreé la escena\.\n\nAviso: «Marco»: Ningún color .*Metal Rojo \(515\)/);
  assert.doesNotMatch(r, /Ojo, no todo salió/, "un aviso no es un fallo");
  assert.equal(conHonestidad("Ojo: ese color no se fabrica en R-9, puse Metal Rojo.", [], [], avisos), "Ojo: ese color no se fabrica en R-9, puse Metal Rojo.");
  assert.equal(conHonestidad("Cambié el rojo por el 515.", [], [], avisos), "Cambié el rojo por el 515.");
  assert.equal(conHonestidad("Listo.", [], [], []), "Listo.");
});
prueba("la ruta junta los avisos de cada herramienta y los pasa a la respuesta final", () => {
  const ruta = readFileSync("src/app/api/escena-ia/route.ts", "utf8");
  assert.match(ruta, /avisosUsuario\.push\(\.\.\.\("avisos" in hecho \? hecho\.avisos \?\? \[\] : \[\]\)\)/);
  assert.match(ruta, /conHonestidad\(respuesta, fallos, problemas, avisosUsuario\)/);
});

console.log("Claves desconocidas");
prueba("`cuelga` en vez de `cuelga_cm` (anidada en `donde`) es un error que nombra la clave buena y no aplica nada", () => {
  const e = vacia();
  const r = aplicarHerramienta(e, "agregar_pieza", { tipo: "techo", modelo: "techo_helio", colores: ["blanco"], donde: { en: "techo", cuelga: 0, x_cm: 100, z_cm: 0 } });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /«donde\.cuelga» no existe en agregar_pieza: ¿quisiste decir «donde\.cuelga_cm»\?/);
  assert.match(r.error, /Claves válidas de donde: .*cuelga_cm/);
  assert.equal(r.escena, e);
  const bien = aplicarHerramienta(e, "agregar_pieza", { tipo: "techo", modelo: "techo_helio", colores: ["blanco"], donde: { en: "techo", cuelga_cm: 0, x_cm: 100, z_cm: 0 } });
  assert.equal(bien.ok, true, bien.ok ? "" : bien.error);
});
prueba("también las de primer nivel y las de herramientas extra; las válidas pasan", () => {
  const r = aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "silla_tiffany", cantidd: 3 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /«cantidd» no existe en agregar_mobiliario: ¿quisiste decir «cantidad»\?/);
  assert.equal(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "silla_tiffany", cantidad: 3 }).ok, true);
  assert.equal(aplicarHerramienta(vacia(), "ver_escena", {}).ok, true);
});
prueba("la sugerencia busca por prefijo y por parecido, y calla si nada se parece", () => {
  assert.equal(sugerenciaDeClave("cuelga", ["en", "cuelga_cm", "x_cm"]), "cuelga_cm");
  assert.equal(sugerenciaDeClave("alto", ["alto_cm", "ancho_cm"]), "alto_cm");
  assert.equal(sugerenciaDeClave("zzzzzz", ["en", "x_cm"]), null);
  assert.equal(claveDesconocida(undefined, { a: 1 }, "x"), null);
});
prueba("las declaraciones de herramientas no cambian de tamaño (no se usó `.strict()`)", () => {
  const declaraciones = readFileSync("src/lib/globos3d/herramientas-escena.ts", "utf8");
  assert.doesNotMatch(declaraciones, /\.strict\(\)/);
});

console.log("La descripción para FLUX no niega lo que hay");
function conTecho(): Escena {
  let e = paso(vacia(), "agregar_pieza", { tipo: "marco_organico", ancho_cm: 420, alto_cm: 280, colores: ["blanco", "dorado"], donde: { en: "piso", x_cm: 0, z_cm: -300 } });
  e = paso(e, "agregar_pieza", { tipo: "techo", modelo: "techo_helio", colores: ["blanco", "dorado"], donde: { en: "techo", cuelga_cm: 40, x_cm: 0, z_cm: 0 } });
  return e;
}
prueba("un marco con patas más globos del techo no dice que faltan las patas a los lados", () => {
  const e = conTecho();
  const d = escenaEnIngles(e, armarEscena(e));
  assert.match(d, /complete arch: two legs/);
  // El hueco que se dice es el de en medio (la abertura del marco), no «a la izquierda y a la derecha» por culpa de los globos del techo.
  assert.doesNotMatch(d, /on the left and on the right|(?:left|right) of center/, d);
  assert.match(d, /in the center the wall is bare/);
});
prueba("con globos colgados del techo la sala no es «plain and empty» ni en la descripción ni en los textos", () => {
  const e = conTecho();
  const d = descripcionRender3d(escenaEnIngles(e, armarEscena(e)), []);
  assert.ok(colgadoDelTecho(d));
  assert.doesNotMatch(d, /plain and empty|all empty/);
  for (const texto of [promptRender3d(d, "igual_visor"), promptRender3d(d, "estudio"), promptFotoDeLayout(d)]) assert.doesNotMatch(texto, /plain and empty|plain empty room|and empty\./, texto.slice(-400));
  assert.match(promptRender3d(d, "igual_visor"), /hangs from or floats against the ceiling/);
});
prueba("sin nada en el techo la sala sigue «plain and empty»", () => {
  const e = paso(vacia(), "agregar_pieza", { tipo: "columna", colores: ["blanco"], donde: { en: "piso", x_cm: 0, z_cm: -200 } });
  const d = descripcionRender3d(escenaEnIngles(e, armarEscena(e)), []);
  assert.ok(!colgadoDelTecho(d));
  assert.match(promptRender3d(d, "igual_visor"), /all plain and empty/);
});

console.log("Visor");
prueba("el nodo de techo se arma con `enTecho` y el visor no le da sombra a esos globos", () => {
  const armada = armarEscena(conTecho());
  assert.equal(armada.porNodo.find((n) => n.id.startsWith("techo"))?.enTecho, true);
  assert.equal(armada.porNodo.find((n) => n.id === "marco-organico")?.enTecho, undefined);
  const visor = readFileSync("src/components/tres-d/escena-globos.ts", "utf8");
  assert.match(visor, /globo\.sinSombra \? SIN_SOMBRA : ""/);
  assert.match(visor, /malla\.castShadow = [^;]*!clave\.endsWith\(SIN_SOMBRA\)/);
  assert.match(readFileSync("src/components/tres-d/Taller3D.tsx", "utf8"), /n\.enTecho \? \{ sinSombra: true \}/);
});
prueba("el mantel: la falda es más oscura que la tapa, hay reborde y dobladillo, y la altura de la cubierta no cambia", () => {
  assert.equal(sombrear("#f7f6f2", 1), "#f7f6f2");
  assert.notEqual(sombrear("#f7f6f2", SOMBRA_FALDA), "#f7f6f2");
  assert.ok(parseInt(sombrear("#ffffff", SOMBRA_FALDA).slice(1, 3), 16) < 255);
  assert.equal(sombrear("rojo", 0.5), "rojo");
  const m = mat("#f7f6f2", "tela");
  const redonda = mesaRedondaMantel({ anchoCm: 150, fondoCm: 150, altoCm: 75, tapa: m, patas: m });
  const colores = new Set(redonda.map((e) => ("hex" in e ? e.hex : "")));
  assert.ok(colores.size >= 3, `tapa, falda y reborde: ${[...colores].join(",")}`);
  assert.ok(redonda.some((e) => "hex" in e && e.hex === "#f7f6f2"), "la tapa conserva el color pedido");
  const cuadrada = mesaConMantel({ anchoCm: 180, fondoCm: 75, altoCm: 75, mantel: "#f7f6f2" });
  assert.ok(cuadrada.some((e) => "hex" in e && e.hex === "#f7f6f2") && cuadrada.some((e) => "hex" in e && e.hex === sombrear("#f7f6f2", SOMBRA_FALDA)));
});

console.log("Ambigüedad de «mesas»");
prueba("la regla del agente manda preguntar cuando «mesas» pueden ser el mobiliario o lo que va encima", () => {
  assert.match(REGLAS_AGENTE, /«Mesas de decoración»[\s\S]*las MESAS[\s\S]*ENCIMA[\s\S]*preguntar_usuario[\s\S]*quitar solo los centros de mesa/);
});

console.log("Líneas de registro largas");
const larga = (n: number) => JSON.stringify({ ts: "2026-10-09T16:31:00.000Z", seq: 7, tipo: "llamada_ia", solicitud: "abc", conversacion: "3d-prueba", datos: { sistema: 'dice "hola" '.repeat(n) } });
prueba("una línea de más de 15 KB sale en fragmentos válidos, cada uno bajo el límite, y se junta idéntica", () => {
  const original = larga(4_000);
  assert.ok(original.length > 40_000);
  const partes = partirLinea(original);
  assert.ok(partes.length > 3);
  for (const p of partes) { assert.ok(p.length <= MAX_LINEA_STDOUT, `${p.length}`); const o = JSON.parse(p) as { conversacion?: string; parte: number; de: number }; assert.equal(o.conversacion, "3d-prueba"); assert.equal(o.de, partes.length); }
  assert.deepEqual(reensamblarFragmentos(partes), [original]);
  assert.deepEqual(reensamblarFragmentos([partes[0]!, "otra línea", ...partes.slice(1).reverse()]), [original, "otra línea"].sort((a, b) => (a === original ? -1 : b === original ? 1 : 0)));
});
prueba("una línea corta pasa tal cual; un grupo incompleto o recortado no inventa nada", () => {
  const corta = larga(10);
  assert.deepEqual(partirLinea(corta), [corta]);
  const partes = partirLinea(larga(4_000));
  assert.equal(reensamblarFragmentos(partes.slice(1)).length, partes.length - 1, "faltando una parte quedan los fragmentos sueltos");
  const enorme = partirLinea(larga(200_000));
  assert.ok(enorme.length <= 40 && enorme.every((p) => p.length <= MAX_LINEA_STDOUT));
  assert.ok(reensamblarFragmentos(enorme).every((l) => l.includes("fragmento_de")), "recortada: no se arma una línea falsa");
});
prueba("verVercel las junta aunque vengan en entradas distintas de logs[]", () => {
  const original = larga(4_000);
  const partes = partirLinea(original);
  const entradas = entradasDeVercel(partes.map((p) => JSON.stringify({ requestPath: "/api/escena-ia", logs: [{ message: p }] })).join("\n"));
  assert.deepEqual(reensamblarFragmentos(entradas.flatMap((e) => lineasPropias(e.mensajes))), [original]);
});
prueba("el registro ya no corta la línea de auditoría a 16 KB con un «…[recortado]»", () => {
  const registro = readFileSync("src/lib/registro/registro.ts", "utf8");
  assert.doesNotMatch(registro, /\[recortado\]/);
  assert.match(registro, /partirLinea\(linea\)/);
});

console.log("La foto «Igual al visor»");
prueba("la captura es siempre la sala entera y la ruta usa el camino fiel para toda foto de ese lugar", () => {
  assert.match(readFileSync("src/components/tres-d/Taller3D.tsx", "utf8"), /visor\.capturar\(\{ escenaEntera: true \}\)/);
  assert.match(readFileSync("src/app/api/render-3d-imagen/route.ts", "utf8"), /usaCaminoFiel\(ambiente as AmbienteRender\)/);
});

console.log(`\n${pruebas} pruebas ok`);
