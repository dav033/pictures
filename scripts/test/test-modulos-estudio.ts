/**
 * Estudio de módulos (REQ-011): dominio y caché. Sin red ni coste: el generador de FLUX es un doble y los adaptadores son
 * los de memoria. Comprueba:
 * - las simetrías salen de la geometría de `armarModulo` (dúo 2, trío 6, cuarteto 4, quinteto 2, sexteto 6: sin voltear, el piso fija el arriba);
 * - la clave es canónica: «rojo + azul» = «azul + rojo»; dos colores distintos o otro tamaño/tipo/versión, otra clave;
 * - validación (catálogo, más colores que globos = error, menos = ciclo) y el aviso de formato no fabricado;
 * - la versión del pipeline lleva la huella de la geometría, la captura y el texto de FLUX (cualquier cambio invalida las claves);
 * - el servicio: acierto sin generar, fallo → una generación, dos peticiones simultáneas → una sola, el fallo y el tope
 *   no dejan nada, el objeto perdido se regenera, la reserva muerta se toma, y sin caché el render se devuelve sin guardar.
 */
import assert from "node:assert/strict";
import { coloresPorAcabado, resolverConfig, acabadoDe, nombreTipo, FORMATO_POR_DEFECTO, TIPOS_ESTUDIO, type ConfigModulo } from "../../src/lib/modulos-estudio/configuracion";
import { puedeEscribirCacheModulos } from "../../src/lib/modulos-estudio/puede-escribir";
import { huellaDeSesion } from "../../src/lib/modulos-estudio/sesion";
import { cookieDeAdministrador, crearLimitador, ipDe } from "../../src/lib/feedback-ia/acceso";
import { sessionToken } from "../../src/lib/auth/session";
import { huellaCaptura, huellaGeometria, huellaTexto, versionPipeline } from "../../src/lib/modulos-estudio/huella-pipeline";
import { claveObjeto, claveRender, configCanonica, VERSION_PIPELINE } from "../../src/lib/modulos-estudio/clave-render";
import { coloresCanonicos, GLOBOS_POR_TIPO, simetriasDeModulo } from "../../src/lib/modulos-estudio/simetrias";
import { promptModuloEstudio } from "../../src/lib/modulos-estudio/prompt-estudio";
import { armarEstudio, cajaDeGlobo, escenaEstudio } from "../../src/lib/modulos-estudio/escena-estudio";
import { crearAlmacenMemoria, crearRepositorioMemoria } from "../../src/lib/modulos-estudio/adaptadores/memoria";
import { crearAlmacenS3 } from "../../src/lib/modulos-estudio/adaptadores/almacen-s3";
import { CacheCaidoError, crearServicioRenders, huellaImagen, FaltaCapturaError, RenderEnCursoError } from "../../src/lib/modulos-estudio/servicio-renders";
import type { CapturaBase, GeneradorRender } from "../../src/lib/modulos-estudio/puertos";
import { reiniciarFotosPorHora, tomarFotoDeLaHora } from "../../src/lib/globos3d/tope-fotos-hora";
import { crearClienteAlmacen } from "../../src/lib/almacen/objetos-s3";
import { interpretarSalida, tamanoDePedido } from "../../src/lib/modulos-estudio/interpretar";
import { ErrorInterpretacion, interpretarPedido } from "../../src/lib/modulos-estudio/interpretar-ia";
import { formatoPorId } from "../../src/lib/globos3d/formatos";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { MODULOS, armarModulo } from "../../src/lib/globos3d/modulos";

const REFLEX_ROJO = "915";
const AZUL_MATE = "040";
const ROJO_MATE = "015";

const ok = (resultado: ReturnType<typeof resolverConfig>): ConfigModulo => {
  assert.ok(resultado.ok, resultado.ok ? "" : resultado.errores.join(" "));
  return resultado.config;
};

async function principal() {
  // Si una promesa no se resuelve (un cierre de señal mal hecho), la prueba falla en vez de salir en silencio con código 0.
  const perro = setTimeout(() => { console.error("[FAIL] test-modulos-estudio: una promesa no se resolvió en 60 s"); process.exit(1); }, 60_000);
  // ---- Los tipos del estudio son exactamente los de modulos.ts; la pareja se llama «Dúo». ----
  assert.deepEqual(TIPOS_ESTUDIO.map((t) => t.id), MODULOS.map((m) => m.id));
  assert.equal(nombreTipo("pareja"), "Dúo");
  assert.equal(nombreTipo("sexteto"), "Sexteto");
  assert.equal(FORMATO_POR_DEFECTO, "R-12");

  // ---- Simetrías derivadas de la geometría. ----
  const orden = Object.fromEntries(MODULOS.map((m) => [m.id, simetriasDeModulo(m.id).length]));
  assert.deepEqual(orden, { pareja: 2, trio: 6, cuarteto: 4, quinteto: 2, sexteto: 6 });
  for (const m of MODULOS) {
    const grupo = simetriasDeModulo(m.id);
    const n = GLOBOS_POR_TIPO[m.id];
    assert.equal(n, m.globos);
    const texto = (p: readonly number[]) => p.join(",");
    const conjunto = new Set(grupo.map(texto));
    assert.ok(conjunto.has(texto(Array.from({ length: n }, (_, i) => i))), `${m.id}: falta la identidad`);
    // Es un grupo: cerrado por composición.
    for (const a of grupo) for (const b of grupo) assert.ok(conjunto.has(texto(a.map((i) => b[i]!))), `${m.id}: no es cerrado`);
  }
  // A1: ningún elemento del grupo mueve un globo de arriba a abajo (el piso y la cámara fijan el arriba): las alturas de las
  // direcciones que arma `armarModulo` se conservan, y el sexteto con las dos mitades cambiadas NO es el mismo módulo.
  for (const m of MODULOS) {
    const formato = formatoPorId("R-12")!;
    const direcciones = armarModulo(m, formato, formato.infladoDecoracionCm).globos.map((g) => g.direccion);
    for (const p of simetriasDeModulo(m.id)) direcciones.forEach((d, i) => assert.ok(Math.abs(direcciones[p[i]!]!.y - d.y) < 1e-9, `${m.id}: una simetría voltea el globo ${i}`));
  }
  assert.notEqual(coloresCanonicos("sexteto", ["915", "040", "915", "040", "915", "040"]).join(), coloresCanonicos("sexteto", ["040", "915", "040", "915", "040", "915"]).join(), "el azul arriba no es el rojo arriba");
  assert.equal(coloresCanonicos("sexteto", ["915", "040", "915", "040", "915", "040"]).join(), coloresCanonicos("sexteto", ["915", "040", "915", "040", "915", "040"].slice(2).concat(["915", "040"]).slice(0, 6)).join(), "girar el sexteto de dos en dos conserva la altura");
  // El quinteto de `armarModulo` alterna arriba/abajo con i % 2 y con cinco globos el 4 y el 0 quedan los dos arriba:
  // solo el espejo que cambia 0↔4 y 1↔3 (deja el 2) lo deja igual. Un rojo en el globo 0 NO equivale a un rojo en el 1.
  assert.notEqual(coloresCanonicos("quinteto", ["915", "040", "040", "040", "040"]).join(), coloresCanonicos("quinteto", ["040", "915", "040", "040", "040"]).join());
  assert.equal(coloresCanonicos("quinteto", ["915", "040", "010", "009", "040"]).join(), coloresCanonicos("quinteto", ["040", "009", "010", "040", "915"]).join(), "el espejo (invertir el orden) es el mismo quinteto");

  // ---- Clave canónica: el dúo «rojo reflex + azul mate» es el «azul mate + rojo reflex». ----
  const duoA = ok(resolverConfig({ tipo: "pareja", colores: [REFLEX_ROJO, AZUL_MATE] }));
  const duoB = ok(resolverConfig({ tipo: "pareja", colores: [AZUL_MATE, REFLEX_ROJO] }));
  assert.equal(claveRender(duoA), claveRender(duoB));
  assert.equal(claveRender(duoA), `${VERSION_PIPELINE}:pareja:R-12:${AZUL_MATE}_${REFLEX_ROJO}`);
  assert.deepEqual(configCanonica(duoA).colores, configCanonica(duoB).colores);
  // Otro color, otro tamaño, otro tipo, otra versión: otra clave.
  assert.notEqual(claveRender(duoA), claveRender(ok(resolverConfig({ tipo: "pareja", colores: [ROJO_MATE, AZUL_MATE] }))));
  assert.notEqual(claveRender(duoA), claveRender(ok(resolverConfig({ tipo: "pareja", formatoId: "R-9", colores: [REFLEX_ROJO, AZUL_MATE] }))));
  assert.notEqual(claveRender(duoA), claveRender(duoA, "estudio-v2"));
  assert.notEqual(claveRender(ok(resolverConfig({ tipo: "trio", colores: [REFLEX_ROJO] }))), claveRender(duoA));
  // Trío: cualquier orden de dos rojos y un azul es el mismo módulo (triángulo: las 6 simetrías).
  const trios = [[ROJO_MATE, ROJO_MATE, AZUL_MATE], [ROJO_MATE, AZUL_MATE, ROJO_MATE], [AZUL_MATE, ROJO_MATE, ROJO_MATE]]
    .map((c) => claveRender(ok(resolverConfig({ tipo: "trio", colores: c }))));
  assert.equal(new Set(trios).size, 1);
  // Cuarteto (dos parejas cruzadas, una arriba y otra abajo): no se puede voltear. ABAB (la pareja de arriba roja, la de
  // abajo azul) NO es BABA (azul arriba); AABB = ABBA = BBAA = BAAB (solo giros y espejos que conservan la altura).
  const cuarteto = (c: string[]) => claveRender(ok(resolverConfig({ tipo: "cuarteto", colores: c })));
  const [A, B] = [REFLEX_ROJO, AZUL_MATE];
  assert.notEqual(cuarteto([A, B, A, B]), cuarteto([B, A, B, A]), "el azul arriba no es el rojo arriba");
  assert.equal(cuarteto([A, A, B, B]), cuarteto([B, A, A, B]));
  assert.equal(cuarteto([A, A, B, B]), cuarteto([B, B, A, A]));
  assert.notEqual(cuarteto([A, B, A, B]), cuarteto([A, A, B, B]));
  // La clave sirve de ruta de objeto sin caracteres raros.
  assert.equal(claveObjeto(claveRender(duoA), "image/jpeg"), `modulos/${VERSION_PIPELINE}/pareja/R-12_${AZUL_MATE}_${REFLEX_ROJO}.jpg`);
  assert.ok(!claveObjeto(claveRender(duoA), "image/png").includes(":"));
  assert.equal(claveObjeto(claveRender(duoA), "image/jpeg", "ficha-3"), `modulos/${VERSION_PIPELINE}/pareja/R-12_${AZUL_MATE}_${REFLEX_ROJO}-ficha3.jpg`, "la ficha de la reserva va en el nombre del objeto");

  // ---- Validación y repetición en ciclo. ----
  assert.deepEqual(ok(resolverConfig({ tipo: "pareja", colores: [ROJO_MATE] })).colores, [ROJO_MATE, ROJO_MATE]);
  assert.deepEqual(ok(resolverConfig({ tipo: "trio", colores: [A, B] })).colores, [A, B, A]);
  assert.deepEqual(ok(resolverConfig({ tipo: "sexteto", colores: [A, B] })).colores, [A, B, A, B, A, B]);
  assert.deepEqual(ok(resolverConfig({ tipo: "cuarteto", colores: [A, B, ROJO_MATE] })).colores, [A, B, ROJO_MATE, A]);
  const avisoCiclo = resolverConfig({ tipo: "trio", colores: [A, B] });
  assert.ok(avisoCiclo.ok && avisoCiclo.avisos.some((a) => a.includes("ciclo")));
  // «Dúo rojo» es el mismo módulo que «dúo rojo + rojo».
  assert.equal(claveRender(ok(resolverConfig({ tipo: "pareja", colores: [ROJO_MATE] }))), claveRender(ok(resolverConfig({ tipo: "pareja", colores: [ROJO_MATE, ROJO_MATE] }))));
  const demasiados = resolverConfig({ tipo: "pareja", colores: [A, B, ROJO_MATE] });
  assert.ok(!demasiados.ok && demasiados.errores.some((e) => e.includes("2 globos") && e.includes("3 colores")));
  const noExiste = resolverConfig({ tipo: "pareja", colores: ["999", "04"] });
  assert.ok(!noExiste.ok && noExiste.errores.length === 2);
  assert.ok(!resolverConfig({ tipo: "octeto", colores: [A] }).ok);
  assert.ok(!resolverConfig({ tipo: "pareja", colores: [] }).ok);
  assert.ok(!resolverConfig({ tipo: "pareja", formatoId: "R-36", colores: [A] }).ok, "R-36 no se ofrece en el estudio");
  assert.ok(!resolverConfig({ tipo: "pareja", formatoId: "T-260", colores: [A] }).ok);
  // Un color que no se fabrica en el tamaño se avisa, no se bloquea.
  const sinR5 = coloresPorAcabado("R-12").flatMap((g) => g.colores).find((c) => !c.formatos.includes("R-5"));
  if (sinR5) {
    const r = resolverConfig({ tipo: "pareja", formatoId: "R-5", colores: [sinR5.codigo] });
    assert.ok(r.ok && r.avisos.some((a) => a.includes("no se fabrica en R-5")));
  }
  assert.equal(acabadoDe(REFLEX_ROJO), "Reflex");
  assert.equal(acabadoDe(AZUL_MATE), "Fashion");
  assert.ok(coloresPorAcabado("R-12").length >= 6);

  // ---- El texto de FLUX: huella ligada a la versión del pipeline. ----
  const prompt = promptModuloEstudio(configCanonica(duoA));
  assert.ok(prompt.includes("single pair (duo) of two balloons"));
  assert.ok(prompt.includes("1 × chrome red (#A62D2F), glossy mirror-chrome latex"), prompt);
  assert.ok(prompt.includes("1 × matte light blue (#01B2E8), opaque matte latex"));
  assert.ok(prompt.includes("Nothing else is in the image"));
  assert.ok(!/furniture, table/.test(prompt.replace("no room, furniture, table", "")), "no pide muebles");
  assert.ok(!/knotted together at the center/.test(prompt) && prompt.includes("tied together in one small knot") && prompt.includes("same positions"), "el texto no se contradice: un solo nudo y los globos donde la captura los pone");

  // ---- La versión del pipeline lleva la huella de la geometría, la captura y el texto (A3). ----
  assert.match(VERSION_PIPELINE, /^estudio-v2\.[0-9a-f]{8}$/);
  assert.equal(VERSION_PIPELINE, "estudio-v2.6d49bd25", "Cambió la geometría de armarModulo, la captura 3D o el texto de FLUX: es lo esperado si lo cambiaste; las claves viejas dejan de servirse. Anota aquí la versión nueva.");
  const base = { geometria: huellaGeometria(), captura: huellaCaptura(), texto: huellaTexto() };
  assert.equal(versionPipeline(base), VERSION_PIPELINE);
  // Un cambio de 0,02 cm en una sola dirección de un solo módulo cambia la huella (y por ella la versión y todas las claves)...
  const geometriaMovida = huellaGeometria((modulo, formato, d) => {
    const armado = armarModulo(modulo, formato, d);
    return modulo.id === "sexteto" && formato.id === "R-18" ? { ...armado, globos: armado.globos.map((g, i) => (i === 3 ? { ...g, nudo: { ...g.nudo, x: g.nudo.x + 0.02 } } : g)) } : armado;
  });
  assert.notEqual(geometriaMovida, base.geometria);
  assert.notEqual(versionPipeline({ ...base, geometria: geometriaMovida }), VERSION_PIPELINE);
  assert.notEqual(claveRender(duoA, versionPipeline({ ...base, geometria: geometriaMovida })), claveRender(duoA));
  // ...pero el ruido de punto flotante por debajo de 0,005 cm no la mueve.
  assert.equal(huellaGeometria((modulo, formato, d) => {
    const armado = armarModulo(modulo, formato, d);
    return { ...armado, globos: armado.globos.map((g) => ({ ...g, nudo: { ...g.nudo, x: g.nudo.x + 1e-9 } })) };
  }), base.geometria);
  // El texto de FLUX también: cualquier palabra distinta cambia la versión.
  assert.notEqual(huellaTexto((c) => `${promptModuloEstudio(c)} Extra.`), base.texto);

  // ---- La escena del estudio: un módulo, sin sala dibujada, y la caja de cada globo. ----
  const escena = escenaEstudio(duoA);
  assert.equal(escena.nodos.length, 1);
  assert.deepEqual(escena.sala.mostrar, { piso: false, fondo: false, laterales: false, techo: false });
  const armada = armarEstudio(ok(resolverConfig({ tipo: "sexteto", colores: [A, B] })));
  assert.equal(armada.globos.length, 6);
  assert.equal(Math.min(...armada.globos.map((g) => g.nudo.y)) >= 0, true, "apoyado en el piso");
  for (let i = 0; i < 6; i++) {
    const caja = cajaDeGlobo(armada, i)!;
    assert.ok(caja.max.x - caja.min.x > 20 && caja.min.y > -8, `caja del globo ${i}`);
  }
  assert.equal(cajaDeGlobo(armada, 9), null);

  // ---- El tope por hora compartido. ----
  reiniciarFotosPorHora();
  for (let i = 0; i < 3; i++) assert.ok(tomarFotoDeLaHora(1_000, 3).ok);
  assert.ok(!tomarFotoDeLaHora(2_000, 3).ok);
  assert.ok(tomarFotoDeLaHora(1_000 + 3_600_001, 3).ok, "la ventana vuelve a abrirse pasada la hora");
  reiniciarFotosPorHora();

  // ---- El servicio con adaptadores de memoria. ----
  const captura: CapturaBase = { mime: "image/png", base64: "iVBORw0KGgo=" };
  const jpg = (n: number) => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]);
  const crear = (extra: { sinRepo?: boolean; sinAlmacen?: boolean; generar?: GeneradorRender; reloj?: { t: number } } = {}) => {
    const reloj = extra.reloj ?? { t: 0 };
    const repo = crearRepositorioMemoria(() => reloj.t);
    const almacen = crearAlmacenMemoria();
    let llamadas = 0;
    const generar: GeneradorRender = extra.generar ?? (async () => { llamadas++; await Promise.resolve(); return { bytes: jpg(llamadas), mime: "image/jpeg", costeUsd: 0.05 }; });
    const contados: GeneradorRender = async (c, cap, s) => { const r = await generar(c, cap, s); return r; };
    const servicio = crearServicioRenders({
      repositorio: extra.sinRepo ? null : repo, almacen: extra.sinAlmacen ? null : almacen, generar: contados,
      ahora: () => reloj.t, dormir: async () => { reloj.t += 1500; await Promise.resolve(); }, pasoEsperaMs: 1500, esperaMaximaMs: 6000, caducaReservaMs: 150_000,
    });
    return { servicio, repo, almacen, reloj, llamadas: () => llamadas };
  };

  // Fallo: genera una vez, guarda objeto y fila lista; la clave equivalente (otro orden) es un acierto sin generar.
  {
    const { servicio, repo, almacen, llamadas } = crear();
    const consulta0 = await servicio.consultar(duoA);
    assert.equal(consulta0.estado, "miss");
    const r1 = await servicio.obtenerOGenerar(duoA, captura);
    assert.equal(r1.origen, "generada");
    assert.ok(r1.origen === "generada" && r1.guardada && r1.costeUsd === 0.05);
    assert.equal(llamadas(), 1);
    const fila = repo.filas.get(r1.clave)!;
    assert.equal(fila.estado, "lista");
    assert.equal(fila.objeto, `modulos/${VERSION_PIPELINE}/pareja/R-12_${AZUL_MATE}_${REFLEX_ROJO}-ficha1.jpg`);
    assert.deepEqual([...fila.colores], [AZUL_MATE, REFLEX_ROJO], "la fila guarda la forma canónica");
    assert.equal(almacen.objetos.size, 1);
    const r2 = await servicio.obtenerOGenerar(duoB, null);
    assert.equal(r2.origen, "cache");
    assert.equal(llamadas(), 1, "el acierto no genera");
    assert.equal((await servicio.consultar(duoB)).estado, "hit");
    // Otro módulo: otra generación.
    await servicio.obtenerOGenerar(ok(resolverConfig({ tipo: "trio", colores: [A] })), captura);
    assert.equal(llamadas(), 2);
  }

  // Sin captura y sin caché: error claro y no se reserva nada.
  {
    const { servicio, repo, llamadas } = crear();
    await assert.rejects(servicio.obtenerOGenerar(duoA, null), FaltaCapturaError);
    assert.equal(repo.filas.size, 0);
    assert.equal(llamadas(), 0);
  }

  // Dos peticiones simultáneas por la misma clave (mismo proceso) → una sola generación; y desde «dos instancias»
  // (dos servicios sobre las mismas tablas) también: la perdedora espera y recibe el acierto.
  {
    const { servicio, llamadas } = crear();
    const [a, b, c] = await Promise.all([servicio.obtenerOGenerar(duoA, captura), servicio.obtenerOGenerar(duoB, captura), servicio.obtenerOGenerar(duoA, captura)]);
    assert.equal(llamadas(), 1);
    assert.deepEqual([a.origen, b.origen, c.origen], ["generada", "generada", "generada"], "comparten la promesa de la generadora");
  }
  {
    const reloj = { t: 0 };
    const repo = crearRepositorioMemoria(() => reloj.t);
    const almacen = crearAlmacenMemoria();
    let llamadas = 0;
    const generar: GeneradorRender = async () => { llamadas++; await new Promise((r) => setTimeout(r, 20)); return { bytes: jpg(1), mime: "image/jpeg", costeUsd: 0.05 }; };
    const mk = () => crearServicioRenders({ repositorio: repo, almacen, generar, pasoEsperaMs: 5, esperaMaximaMs: 2000 });
    const [a, b] = await Promise.all([mk().obtenerOGenerar(duoA, captura), mk().obtenerOGenerar(duoB, captura)]);
    assert.equal(llamadas, 1, "dos instancias, una generación");
    assert.deepEqual([a.origen, b.origen].sort(), ["cache", "generada"]);
  }

  // Un fallo del generador (o el tope por hora) libera la reserva y no guarda nada.
  {
    const { servicio, repo, almacen } = crear({ generar: async () => { throw new Error("FLUX caído"); } });
    await assert.rejects(servicio.obtenerOGenerar(duoA, captura), /FLUX caído/);
    assert.equal(repo.filas.size, 0);
    assert.equal(almacen.objetos.size, 0);
  }

  // El almacén falla al guardar: se devuelve la imagen (ya pagada), sin fila ni media entrada.
  {
    const { servicio, repo, almacen } = crear();
    almacen.guardar = async () => { throw new Error("almacén caído"); };
    const r = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(r.origen === "generada" && !r.guardada && Boolean(r.aviso));
    assert.equal(repo.filas.size, 0, "sin fila lista sin imagen");
  }

  // Objeto perdido con la fila lista: no se sirve; se regenera y la fila queda coherente.
  {
    const { servicio, repo, almacen, llamadas } = crear();
    await servicio.obtenerOGenerar(duoA, captura);
    almacen.objetos.clear();
    assert.equal((await servicio.consultar(duoA)).estado, "miss");
    const r = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(r.origen === "generada" && r.guardada);
    assert.equal(llamadas(), 2);
    assert.equal(repo.filas.size, 1);
    assert.equal(almacen.objetos.size, 1);
  }

  // Reserva muerta (quien la tomó se cayó): pasada la caducidad se toma y se genera; antes, se espera y se rinde.
  {
    const { servicio, repo, reloj, llamadas } = crear();
    await repo.reservar({ clave: servicio.clave(duoA), tipo: "pareja", formatoId: "R-12", colores: [AZUL_MATE, REFLEX_ROJO], version: VERSION_PIPELINE });
    reloj.t = 1000;
    await assert.rejects(servicio.obtenerOGenerar(duoA, captura), RenderEnCursoError);
    assert.equal(llamadas(), 0);
    reloj.t = 200_000;
    const r = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(r.origen === "generada" && r.guardada);
    assert.equal(llamadas(), 1);
  }

  // Sin base o sin almacén: el render se genera y se devuelve, sin guardar; la consulta dice «no disponible».
  for (const extra of [{ sinRepo: true }, { sinAlmacen: true }, { sinRepo: true, sinAlmacen: true }]) {
    const { servicio, repo, almacen, llamadas } = crear(extra);
    assert.equal((await servicio.consultar(duoA)).estado, "no_disponible");
    const r = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(r.origen === "generada" && !r.guardada && Boolean(r.aviso));
    assert.equal(llamadas(), 1);
    assert.equal(repo.filas.size, 0);
    assert.equal(almacen.objetos.size, 0);
    await assert.rejects(servicio.obtenerOGenerar(duoA, null), FaltaCapturaError);
  }

  // Base o almacén CONFIGURADOS pero caídos: no se paga una imagen a ciegas (podría estar ya guardada o en curso).
  {
    const { servicio, repo, almacen, llamadas } = crear();
    repo.buscar = async () => { throw new Error("Neon caído"); };
    assert.equal((await servicio.consultar(duoA)).estado, "no_disponible");
    await assert.rejects(servicio.obtenerOGenerar(duoA, captura), CacheCaidoError);
    assert.equal(llamadas(), 0);
    const otro = crear();
    await otro.servicio.obtenerOGenerar(duoA, captura);
    otro.almacen.leer = async () => { throw new Error("almacén caído"); };
    await assert.rejects(otro.servicio.obtenerOGenerar(duoA, captura), CacheCaidoError);
    assert.equal(otro.llamadas(), 1, "una fila lista con el almacén caído no se vuelve a pagar");
    assert.equal(almacen.objetos.size, 0);
  }

  // A6: la señal es de cada llamante. Si el primero cierra la página, el segundo (que comparte la generación) sigue y
  // el render se guarda; el que canceló recibe el AbortError. La generación no ve ninguna señal.
  {
    let senalVista: AbortSignal | undefined | "sin-llamar" = "sin-llamar";
    let soltar: () => void = () => undefined;
    const bloqueo = new Promise<void>((r) => { soltar = r; });
    const { servicio, repo, almacen } = crear({ generar: async (_c, _cap, senal) => { senalVista = senal; await bloqueo; return { bytes: jpg(1), mime: "image/jpeg", costeUsd: 0.05 }; } });
    const primero = new AbortController();
    const delPrimero = servicio.obtenerOGenerar(duoA, captura, { senal: primero.signal });
    const delSegundo = servicio.obtenerOGenerar(duoB, captura);
    await Promise.resolve();
    primero.abort();
    await assert.rejects(delPrimero, (e: unknown) => e instanceof DOMException && e.name === "AbortError");
    soltar();
    const segundo = await delSegundo;
    assert.ok(segundo.origen === "generada" && segundo.guardada, "el segundo recibe y guarda el render aunque el primero se fue");
    assert.equal(senalVista, undefined, "la generación compartida no recibe la señal de nadie");
    assert.equal(repo.filas.size, 1);
    assert.equal(almacen.objetos.size, 1);
    // Ya cancelada de entrada: ni siquiera arranca.
    const otro = crear();
    const cancelado = new AbortController();
    cancelado.abort();
    await assert.rejects(otro.servicio.obtenerOGenerar(duoA, captura, { senal: cancelado.signal }), /cancel/i);
    assert.equal(otro.llamadas(), 0);
  }

  // A5: el presupuesto de la petición. Con menos de 100 s de los 120 s, no se empieza a generar (409 enseguida) ni se toma
  // una reserva caducada; el que espera una generación ajena se rinde a los 45 s, no a los 100.
  {
    const reloj = { t: 0 };
    const sinTiempo = crear({ reloj });
    await assert.rejects(sinTiempo.servicio.obtenerOGenerar(duoA, captura, { inicioMs: -30_000 }), RenderEnCursoError);
    assert.equal(sinTiempo.llamadas(), 0);
    assert.equal(sinTiempo.repo.filas.size, 0, "sin tiempo no se reserva nada");
    const justo = await sinTiempo.servicio.obtenerOGenerar(duoA, captura, { inicioMs: -20_000 });
    assert.ok(justo.origen === "generada", "con 100 s justos todavía se genera");
    // Reserva caducada pero a la petición no le quedan 100 s: no la toma.
    const caducada = crear({ reloj });
    await caducada.repo.reservar({ clave: caducada.servicio.clave(duoA), tipo: "pareja", formatoId: "R-12", colores: [AZUL_MATE, REFLEX_ROJO], version: VERSION_PIPELINE });
    reloj.t = 300_000;
    await assert.rejects(caducada.servicio.obtenerOGenerar(duoA, captura, { inicioMs: 300_000 - 40_000 }), RenderEnCursoError);
    assert.equal(caducada.llamadas(), 0);
    // Sin caché configurado también se respeta.
    const sinCacheSinTiempo = crear({ sinRepo: true, reloj });
    await assert.rejects(sinCacheSinTiempo.servicio.obtenerOGenerar(duoA, captura, { inicioMs: reloj.t - 60_000 }), RenderEnCursoError);
    // El que espera una reserva viva se rinde pronto: con el servicio por defecto son 45 s, no 100.
    const espera = { t: 0 };
    const reposo = crearRepositorioMemoria(() => espera.t);
    await reposo.reservar({ clave: claveRender(duoA), tipo: "pareja", formatoId: "R-12", colores: [AZUL_MATE, REFLEX_ROJO], version: VERSION_PIPELINE });
    const paciente = crearServicioRenders({ repositorio: reposo, almacen: crearAlmacenMemoria(), generar: async () => { throw new Error("no debe generar"); }, ahora: () => espera.t, dormir: async (ms) => { espera.t += ms; } });
    await assert.rejects(paciente.obtenerOGenerar(duoA, captura), RenderEnCursoError);
    assert.ok(espera.t >= 45_000 && espera.t < 50_000, `esperó ${espera.t} ms`);
  }

  // A4: la fila guarda la huella de la captura y de la sesión; descartar borra fila y objeto y deja volver a generar.
  {
    const { servicio, repo, almacen, llamadas } = crear();
    const primera = await servicio.obtenerOGenerar(duoA, captura, { sesion: "sesion-abc" });
    assert.ok(primera.origen === "generada" && primera.guardada);
    const fila = repo.filas.get(primera.clave)!;
    assert.match(fila.capturaSha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal(fila.sesion, "sesion-abc");
    const antes = await servicio.consultar(duoA);
    assert.ok(antes.estado === "hit");
    assert.equal(await servicio.descartar(duoB), true, "el equivalente descarta el mismo render");
    assert.equal(repo.filas.size, 0);
    assert.equal(almacen.objetos.size, 0, "se borra también el objeto");
    assert.equal((await servicio.consultar(duoA)).estado, "miss");
    assert.equal(await servicio.descartar(duoA), false, "descartar lo que no hay no falla");
    const otra = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(otra.origen === "generada" && otra.guardada);
    assert.equal(llamadas(), 2);
    // La URL versionada: otra imagen, otra huella.
    const nueva = await servicio.consultar(duoA);
    assert.ok(antes.estado === "hit" && nueva.estado === "hit" && antes.huella !== nueva.huella, "la huella del contenido cambia al regenerar");
    assert.match(nueva.estado === "hit" ? nueva.huella : "", /^[0-9a-f]{16}$/);
    // Una reserva en curso no se descarta.
    const enCurso = crear();
    await enCurso.repo.reservar({ clave: enCurso.servicio.clave(duoA), tipo: "pareja", formatoId: "R-12", colores: [AZUL_MATE, REFLEX_ROJO], version: VERSION_PIPELINE });
    assert.equal(await enCurso.servicio.descartar(duoA), false);
    assert.equal(enCurso.repo.filas.size, 1);
    // Sin caché configurado: descartar dice que no hay caché.
    await assert.rejects(crear({ sinRepo: true }).servicio.descartar(duoA), CacheCaidoError);
  }

  // A4: la puerta de las escrituras (POST de generación y DELETE): una sola función.
  {
    const entorno = process.env as Record<string, string | undefined>;
    const guardado = { modo: entorno.MODULOS_ESCRITURA, nodo: entorno.NODE_ENV };
    const peticion = new Request("http://localhost/api/modulos-render");
    const entornoDe = (modo: string | undefined, nodo: string) => { if (modo === undefined) delete entorno.MODULOS_ESCRITURA; else entorno.MODULOS_ESCRITURA = modo; entorno.NODE_ENV = nodo; };
    const con = (modo: string | undefined, nodo: string) => {
      if (modo === undefined) delete entorno.MODULOS_ESCRITURA; else entorno.MODULOS_ESCRITURA = modo;
      entorno.NODE_ENV = nodo;
      return puedeEscribirCacheModulos(peticion);
    };
    assert.equal(con(undefined, "production"), false, "en producción, sin variable ni sesión de administración: CERRADA");
    assert.equal(con("cerrada", "production"), false);
    assert.equal(con("abierta", "production"), true);
    assert.equal(con(undefined, "development"), true, "en desarrollo, abierta por defecto");
    assert.equal(con("cerrada", "development"), false, "y se puede cerrar");
    assert.equal(con("otra-cosa", "production"), false, "solo abierta abre");
    // La sesión de administración del panel de la IA (la MISMA función, cookie `feedback_admin` + sesión de la app) abre la puerta
    // aunque en producción no haya variable; sin ADMIN_PASSWORD, con otra clave o sin la sesión de la app no abre.
    const previo = { app: entorno.APP_PASSWORD, admin: entorno.ADMIN_PASSWORD };
    entorno.APP_PASSWORD = "clave-de-la-app";
    entorno.ADMIN_PASSWORD = "clave-del-panel";
    const cookieAdmin = cookieDeAdministrador().split(";")[0]!;
    const sesionApp = `session=${sessionToken("clave-de-la-app")}`;
    const conCookies = (cookie: string, extra: Record<string, string> = {}) => new Request("http://localhost/api/modulos-render", { headers: { cookie, ...extra } });
    entornoDe(undefined, "production");
    assert.equal(puedeEscribirCacheModulos(conCookies(`${sesionApp}; ${cookieAdmin}`)), true, "el administrador del panel puede");
    assert.equal(puedeEscribirCacheModulos(conCookies(sesionApp)), false, "la sesión del equipo sola no");
    assert.equal(puedeEscribirCacheModulos(conCookies(cookieAdmin)), false, "la cookie de administrador sin la sesión de la app no");
    assert.equal(puedeEscribirCacheModulos(conCookies(`${sesionApp}; feedback_admin=${"0".repeat(64)}`)), false, "una cookie de administrador falsa no");
    assert.equal(puedeEscribirCacheModulos(conCookies(`${sesionApp}; ${cookieAdmin}`, { origin: "https://otro.sitio" })), false, "de otro origen no (CSRF)");
    delete entorno.ADMIN_PASSWORD;
    assert.equal(puedeEscribirCacheModulos(conCookies(`${sesionApp}; ${cookieAdmin}`)), false, "sin ADMIN_PASSWORD el administrador queda cerrado");
    entornoDe("abierta", "production");
    assert.equal(puedeEscribirCacheModulos(conCookies(sesionApp, { origin: "https://otro.sitio" })), false, "ni abierta deja escribir desde otro origen");
    if (previo.app === undefined) delete entorno.APP_PASSWORD; else entorno.APP_PASSWORD = previo.app;
    if (previo.admin === undefined) delete entorno.ADMIN_PASSWORD; else entorno.ADMIN_PASSWORD = previo.admin;
    if (guardado.modo === undefined) delete entorno.MODULOS_ESCRITURA; else entorno.MODULOS_ESCRITURA = guardado.modo;
    if (guardado.nodo === undefined) delete entorno.NODE_ENV; else entorno.NODE_ENV = guardado.nodo;
    // La huella de la sesión no es la cookie.
    const conCookie = new Request("http://localhost/", { headers: { cookie: "otra=1; session=secreto-de-sesion; x=2" } });
    const huella = huellaDeSesion(conCookie);
    assert.match(huella ?? "", /^[0-9a-f]{16}$/);
    assert.ok(!huella!.includes("secreto"));
    assert.equal(huellaDeSesion(peticion), null);
  }

  // La huella del contenido se guarda al escribir: preguntar si hay render (meta) hace un HEAD, no baja la imagen.
  {
    const { servicio, repo, almacen } = crear();
    const hecha = await servicio.obtenerOGenerar(duoA, captura);
    const fila = repo.filas.get(hecha.clave)!;
    assert.match(fila.huella ?? "", /^[0-9a-f]{16}$/);
    let lecturas = 0;
    const leerOriginal = almacen.leer.bind(almacen);
    almacen.leer = async (objeto) => { lecturas++; return leerOriginal(objeto); };
    const consulta = await servicio.consultar(duoA);
    assert.ok(consulta.estado === "hit" && consulta.huella === fila.huella && consulta.mime === "image/jpeg");
    assert.equal(lecturas, 0, "consultar no lee el objeto");
    const leida = await servicio.leer(duoA, fila.huella!);
    assert.ok(leida && leida.huella === fila.huella && leida.imagen.bytes.length === 5);
    assert.equal(lecturas, 1);
    assert.equal(await servicio.leer(duoA, "0000000000000000"), null, "una huella que ya no es la de la fila no lee nada");
    assert.equal(lecturas, 1);
    assert.equal(leida?.huella, huellaImagen(leida!.imagen), "la huella guardada es la del contenido");
    almacen.objetos.clear();
    assert.equal((await servicio.consultar(duoA)).estado, "miss", "con la fila lista pero sin objeto, no hay render");
  }

  // A6 (2.ª ronda): cada generación tiene su objeto; un descarte lento no borra el que otra generación guardó para la misma clave.
  {
    const { servicio, repo, almacen } = crear();
    const primera = await servicio.obtenerOGenerar(duoA, captura);
    const objetoViejo = repo.filas.get(primera.clave)!.objeto!;
    // Simula la carrera: la fila vieja se elimina, otra instancia genera y guarda la nueva, y RECIÉN después llega el borrado.
    const eliminada = await repo.eliminar(primera.clave);
    assert.equal(eliminada?.objeto, objetoViejo);
    const segunda = await servicio.obtenerOGenerar(duoA, captura);
    const objetoNuevo = repo.filas.get(segunda.clave)!.objeto!;
    assert.notEqual(objetoNuevo, objetoViejo, "la nueva generación no reutiliza el nombre del objeto");
    await almacen.borrar(objetoViejo);
    assert.equal((await servicio.consultar(duoA)).estado, "hit", "el borrado tardío del objeto viejo no toca el nuevo");
  }

  // A7 (2.ª ronda): sin caché nadie puede aprovechar el resultado, así que la cancelación de quien lo pidió sí llega a FLUX.
  {
    const recibidas: Array<AbortSignal | undefined> = [];
    const { servicio } = crear({ sinRepo: true, generar: async (_c, _cap, senal) => { recibidas.push(senal); return { bytes: jpg(1), mime: "image/jpeg", costeUsd: 0.05 }; } });
    const control = new AbortController();
    await servicio.obtenerOGenerar(duoA, captura, { senal: control.signal });
    assert.equal(recibidas[0], control.signal);
  }

  // A2 (2.ª ronda): la huella del texto de FLUX ve TODAS las familias de acabado y los tamaños, no solo unos colores de ejemplo.
  {
    const base = huellaTexto();
    for (const codigo of [...new Map(TABLA_SEMPERTEX.referencias.map((x) => [x.familia, x.codigo])).values()]) {
      const cambiado = huellaTexto((c) => (c.colores[0] === codigo && c.formatoId === "R-24" ? `${promptModuloEstudio(c)} Cambio.` : promptModuloEstudio(c)));
      assert.notEqual(cambiado, base, `el texto del color ${codigo} (una referencia de cada familia) en R-24 debe cambiar la huella`);
    }
  }

  // A5 (2.ª ronda): el ancla del centro de la pareja cae entre los dos cuerpos, no en el nudo.
  {
    const f = formatoPorId("R-12")!;
    const armado = armarModulo(MODULOS[0]!, f, 25);
    const natural = armado.globos.map((g) => g.direccion.z * 17.25);
    assert.ok(Math.abs(armado.anclas[0]!.posicion.z - (natural[0]! + natural[1]!) / 2) < 0.1 && armado.anclas[0]!.posicion.z < -5);
  }

  // A8: el límite por IP del intérprete (el limitador del panel de la IA, no una copia).
  {
    const limite = crearLimitador(20, 60_000);
    for (let i = 0; i < 20; i++) assert.ok(limite("1.2.3.4", 1_000 + i));
    assert.ok(!limite("1.2.3.4", 2_000), "la 21.ª del minuto se rechaza");
    assert.ok(limite("5.6.7.8", 2_000), "otra IP tiene su propia cuenta");
    assert.ok(limite("1.2.3.4", 61_001), "pasado el minuto vuelve a abrirse");
    assert.equal(ipDe(new Request("http://x/", { headers: { "x-forwarded-for": " 9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
    assert.equal(ipDe(new Request("http://x/")), "desconocida");
  }

  // Ficha de la reserva: quien tardó más que la caducidad no pisa a quien tomó su reserva.
  {
    const reloj = { t: 0 };
    const repo = crearRepositorioMemoria(() => reloj.t);
    const nueva = { clave: "k", tipo: "pareja", formatoId: "R-12", colores: [AZUL_MATE, REFLEX_ROJO], version: VERSION_PIPELINE };
    const a = await repo.reservar(nueva);
    assert.ok(a.reservada);
    reloj.t = 200_000;
    const fichaB = await repo.reclamarCaducada("k", 150_000);
    assert.ok(fichaB && a.reservada && fichaB !== a.dueno);
    await repo.liberar("k", a.reservada ? a.dueno : "");
    assert.ok(repo.filas.has("k"), "la ficha vieja no borra la reserva de B");
    await assert.rejects(repo.completar("k", a.reservada ? a.dueno : "", { objeto: "o", mime: "image/jpeg", costeUsd: 0.05, capturaSha256: "h", sesion: null, huella: "hhhhhhhhhhhhhhhh" }), /ya no es de quien/);
    await repo.completar("k", fichaB!, { objeto: "o", mime: "image/jpeg", costeUsd: 0.05, capturaSha256: "h", sesion: null, huella: "hhhhhhhhhhhhhhhh" });
    assert.equal(repo.filas.get("k")!.estado, "lista");
  }

  // El adaptador S3 traduce al cliente compartido de REQ-010 (poner / obtener).
  {
    const guardado = new Map<string, { cuerpo: Uint8Array; tipo: string }>();
    const almacen = crearAlmacenS3({
      async poner(clave, cuerpo, tipo) { guardado.set(clave, { cuerpo, tipo }); },
      async obtener(clave) { return guardado.get(clave) ?? null; },
      async borrar(clave) { guardado.delete(clave); },
      async existe(clave) { return guardado.has(clave); },
    });
    await almacen.guardar("modulos/x.jpg", { bytes: jpg(7), mime: "image/jpeg" });
    assert.deepEqual(await almacen.leer("modulos/x.jpg"), { bytes: jpg(7), mime: "image/jpeg" });
    assert.equal(await almacen.leer("modulos/y.jpg"), null);
    assert.equal(await almacen.existe("modulos/x.jpg"), true);
    assert.equal(await almacen.existe("modulos/y.jpg"), false);
    await almacen.borrar("modulos/x.jpg");
    assert.equal(await almacen.leer("modulos/x.jpg"), null);
  }

  // De punta a punta con el cliente S3 REAL (firma SigV4) contra un S3 falso en memoria: el objeto va bajo `modulos/`,
  // cada petición lleva la firma y el servicio sirve la segunda vez sin generar.
  {
    const bucket = new Map<string, { cuerpo: Uint8Array; tipo: string }>();
    const peticiones: Array<{ metodo: string; ruta: string; firmada: boolean }> = [];
    const falso: typeof fetch = async (entrada, init) => {
      const url = new URL(String(entrada));
      const metodo = init?.method ?? "GET";
      const cabeceras = init?.headers as Record<string, string>;
      peticiones.push({ metodo, ruta: url.pathname, firmada: /^AWS4-HMAC-SHA256 /.test(cabeceras.authorization ?? "") });
      const clave = decodeURIComponent(url.pathname.replace(/^\/decoracion-feedback\//, ""));
      if (metodo === "HEAD") return new Response(null, { status: bucket.has(clave) ? 200 : 404 });
      if (metodo === "DELETE") { bucket.delete(clave); return new Response(null, { status: 204 }); }
      if (metodo === "PUT") { bucket.set(clave, { cuerpo: new Uint8Array(init?.body as Buffer), tipo: cabeceras["content-type"] ?? "" }); return new Response(null, { status: 200 }); }
      const objeto = bucket.get(clave);
      return objeto ? new Response(Buffer.from(objeto.cuerpo), { status: 200, headers: { "content-type": objeto.tipo } }) : new Response(null, { status: 404 });
    };
    const cliente = crearClienteAlmacen({ endpoint: "https://almacen.test", region: "garage", bucket: "decoracion-feedback", accessKeyId: "GKtest", secretAccessKey: "secreto" }, falso);
    const repo = crearRepositorioMemoria();
    let llamadas = 0;
    const servicio = crearServicioRenders({ repositorio: repo, almacen: crearAlmacenS3(cliente), generar: async () => { llamadas++; return { bytes: jpg(9), mime: "image/jpeg", costeUsd: 0.05 }; } });
    const primero = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(primero.origen === "generada" && primero.guardada);
    assert.equal(bucket.size, 1);
    assert.match([...bucket.keys()][0]!, new RegExp(`^modulos/${VERSION_PIPELINE.replace(".", "\\.")}/pareja/R-12_${AZUL_MATE}_${REFLEX_ROJO}-[A-Za-z0-9]{1,12}\\.jpg$`));
    const segundo = await servicio.obtenerOGenerar(duoB, null);
    assert.ok(segundo.origen === "cache" && segundo.imagen.mime === "image/jpeg" && segundo.imagen.bytes.length === 5);
    assert.equal(llamadas, 1);
    assert.ok(peticiones.length >= 2 && peticiones.every((p) => p.firmada), "toda petición al almacén va firmada");
    // Un almacén que no responde (objeto borrado a mano) no rompe: se regenera.
    bucket.clear();
    const tercero = await servicio.obtenerOGenerar(duoA, captura);
    assert.ok(tercero.origen === "generada" && tercero.guardada);
    assert.equal(llamadas, 2);
  }

  // ---- US-2: el pedido en palabras (el modelo es un doble; lo que cuenta es la resolución a códigos). ----
  {
    const pedido = interpretarSalida({ tipo: "pareja", tamano: null, globos: [{ color: "rojo", acabado: "reflex" }, { color: "azul", acabado: "mate" }] });
    assert.ok(pedido.ok);
    assert.deepEqual(pedido.ok && pedido.config.colores, [REFLEX_ROJO, AZUL_MATE]);
    assert.equal(pedido.ok && claveRender(pedido.config), claveRender(duoA), "«dúo de reflex rojo con azul mate» es el dúo del ejemplo");
    const inverso = interpretarSalida({ tipo: "pareja", tamano: "R-12", globos: [{ color: "Azul", acabado: "mate" }, { color: "rojo", acabado: "cromado" }] });
    assert.equal(inverso.ok && claveRender(inverso.config), claveRender(duoA));
    // «Rojo cristal» (A7) es el Reflex Cristal Rojo 915, dicho de cualquier manera; «cristal» solo sigue siendo el cristal.
    for (const g of [{ color: "rojo", acabado: "cristal" }, { color: "rojo cristal", acabado: null }, { color: "cristal rojo", acabado: null }, { color: "Rojo", acabado: "transparente" }]) {
      const c = interpretarSalida({ tipo: "pareja", tamano: null, globos: [g] });
      assert.ok(c.ok && c.config.colores[0] === REFLEX_ROJO, `${g.color} ${g.acabado} debe ser 915`);
    }
    const soloCristal = interpretarSalida({ tipo: "pareja", tamano: null, globos: [{ color: "cristal", acabado: null }] });
    assert.ok(soloCristal.ok && soloCristal.config.colores[0] === "390", "«cristal» a secas es el 390 Cristal Transparente");
    // Un color que el catálogo no tiene se reporta y no se inventa.
    const raro = interpretarSalida({ tipo: "pareja", tamano: null, globos: [{ color: "rojo vino tinto", acabado: null }, { color: "azul", acabado: "mate" }] });
    assert.ok(!raro.ok && raro.desconocidos.includes("rojo vino tinto") && raro.errores.some((e) => e.includes("catálogo")));
    // Sin tipo, sin colores, más colores que globos, tamaño que no existe.
    assert.ok(!interpretarSalida({ tipo: null, tamano: null, globos: [{ color: "rojo", acabado: null }] }).ok);
    assert.ok(!interpretarSalida({ tipo: "trio", tamano: null, globos: [] }).ok);
    const demasiadosPedidos = interpretarSalida({ tipo: "pareja", tamano: null, globos: [{ color: "rojo", acabado: null }, { color: "azul", acabado: null }, { color: "verde", acabado: null }] });
    assert.ok(!demasiadosPedidos.ok && demasiadosPedidos.errores.some((e) => e.includes("2 globos")));
    const tamanoRaro = interpretarSalida({ tipo: "pareja", tamano: "gigante", globos: [{ color: "rojo", acabado: null }] });
    assert.ok(tamanoRaro.ok && tamanoRaro.config.formatoId === "R-12" && tamanoRaro.avisos.some((a) => a.includes("gigante")));
    const conTamano = interpretarSalida({ tipo: "trio", tamano: "9 pulgadas", globos: [{ color: "rojo", acabado: null }] });
    assert.ok(conTamano.ok && conTamano.config.formatoId === "R-9");
    assert.deepEqual(["12", "R-12", "R12", "5\"", "36", "x"].map(tamanoDePedido), ["R-12", "R-12", "R-12", "R-5", null, null]);
    // Con el generador de IA doble: JSON válido, JSON roto y fallo del modelo.
    const bueno = await interpretarPedido("un dúo de reflex rojo con azul mate", { generar: async () => ({ texto: JSON.stringify({ tipo: "pareja", tamano: null, globos: [{ color: "rojo", acabado: "reflex" }, { color: "azul", acabado: "mate" }] }) }) });
    assert.ok(bueno.ok);
    await assert.rejects(interpretarPedido("x", { generar: async () => ({ texto: "no es json" }) }), (e: unknown) => e instanceof ErrorInterpretacion && e.causa === "invalida");
    await assert.rejects(interpretarPedido("x", { generar: async () => { throw new Error("red caída"); } }), (e: unknown) => e instanceof ErrorInterpretacion && e.causa === "modelo");
    const vacio = await interpretarPedido("   ", { generar: async () => { throw new Error("no debe llamarse"); } });
    assert.ok(!vacio.ok);
  }

  clearTimeout(perro);
  console.log("[PASS] test-modulos-estudio");
}

principal().catch((error) => { console.error(error); process.exit(1); });
