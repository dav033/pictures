/**
 * Arnés de entrenamiento (W4): `capacidad_faltante` partida en sus causas concretas, sin modelo. Los casos salen de la pasada 2
 * (corrida 2026-10-10T17-07-01-532Z, las 30 fotos del dueño; `fixtures/evidencia-pasada-2.json`, que escribe
 * `reclasificar-corrida.ts --evidencia`): la lectura cruda, lo que la compilación no armó, los errores de las herramientas y la
 * escena final de cada foto.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-capacidad.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { comprobarCuerpo } from "../../src/lib/globos3d/presupuesto-cuerpo";
import { archivoDeAuditoria, deteccionAnotada, erroresDeHerramientas, eventosDeConversacion, idConversacionDePasada, leerEventos, lecturaCrudaDeAuditoria, type EventoAuditoria } from "../entrenamiento/lib-auditoria";
import { claseDominanteDeCapacidad, clasificarCapacidad, CLASES_CAPACIDAD, hayCapacidadFaltante, pasadasPorClase, sumarConteos, type ConteoCapacidad, type EvidenciaCapacidad } from "../entrenamiento/lib-capacidad";
import { evidenciaDePasada, resumirNodos, resumirPiezas } from "../entrenamiento/lib-evidencia";
import { clasificarFallos, HECHOS_SIN_FALLOS } from "../entrenamiento/lib-fallos";
import { clavePedida, clavePuesta, familiaDeClave, familiaDeFondo, familiaDeOtro, FONDOS_DE_ARCO, FONDOS_DE_COLUMNA, FONDOS_DE_PARED, type FamiliaEstructura } from "../entrenamiento/lib-familias";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-capacidad-"));
let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** `marcadaAntes`: si el arnés marcó la foto con `capacidad_faltante` al correr (antes de partirla en causas). */
const pasada2 = JSON.parse(readFileSync(path.resolve(__dirname, "../entrenamiento/fixtures/evidencia-pasada-2.json"), "utf8")) as { fuente: string; fotos: Record<string, EvidenciaCapacidad & { marcadaAntes: boolean }> };
const foto = (n: number) => {
  const evidencia = pasada2.fotos[`images (${n})`];
  assert.ok(evidencia, `la pasada 2 trae la foto ${n}`);
  return evidencia;
};
const vacia = (cambios: Partial<EvidenciaCapacidad> = {}): EvidenciaCapacidad => ({ piezasLeidas: [], nodosFinales: [], omitidas: [], erroresHerramientas: [], ...cambios });

console.log("Capacidad que falta, partida en causas concretas (arnés W4):");

prueba("la pasada 2 trae las 30 fotos con su lectura, su escena final y los errores de las herramientas", () => {
  assert.equal(pasada2.fuente, "2026-10-10T17-07-01-532Z");
  assert.equal(Object.keys(pasada2.fotos).length, 30);
  assert.ok(Object.values(pasada2.fotos).every((e) => e.piezasLeidas.length > 0 && e.nodosFinales.length > 0));
});

prueba("fotos de la pasada 2, una por una: la familia que falta sale de lo que dice el «otro» y de lo que la escena final no tiene", () => {
  assert.deepEqual(clasificarCapacidad(foto(26)), {}, "los pedestales dorados son del catálogo y están en la escena: no falta nada");
  assert.deepEqual(clasificarCapacidad(foto(38)), {}, "todo lo leído está armado");
  assert.deepEqual(clasificarCapacidad(foto(30)), {}, "la lectura solo trae una guirnalda y un panel: están armados");
  assert.deepEqual(clasificarCapacidad(foto(29)), { falta_pared: 1, falta_figura: 3 }, "el telón de castillo es pared; los copos de nieve, el árbol y el muñeco, figuras");
  assert.deepEqual(clasificarCapacidad(foto(52)), { falta_figura: 4 }, "tres globos de foil y las calabazas");
  assert.deepEqual(clasificarCapacidad(foto(33)), { falta_mueble_fondo: 2 }, "el cilindro blanco y el pastel detectado sin mesa debajo («base_pastel»)");
  assert.deepEqual(clasificarCapacidad(foto(54)), { falta_pared: 1 }, "un muro denso de globos sin estructura");
  assert.deepEqual(clasificarCapacidad(foto(49)), { falta_arco: 1, falta_mueble_fondo: 1 }, "el arco de medio punto y el pedestal acrílico");
  assert.deepEqual(clasificarCapacidad(foto(27)), { falta_pared: 1, falta_figura: 1, falta_mueble_fondo: 1 }, "cortinas de tul, mariposas y un postre en soporte");
});

prueba("un fondo fijo del catálogo que el asistente intentó cambiar es `fondo_fijo`, una vez por mensaje distinto", () => {
  assert.deepEqual(clasificarCapacidad(foto(31)), { falta_figura: 1, falta_mueble_fondo: 1, fondo_fijo: 2 });
});

prueba("un color que no está en la tabla Sempertex es `color_no_disponible`, y el pastel sin mesa debajo que no se armó es un mueble que falta", () => {
  assert.deepEqual(clasificarCapacidad(foto(34)), { falta_arco: 1, falta_figura: 1, falta_mueble_fondo: 2, color_no_disponible: 1 });
  assert.ok(foto(34).nodosFinales.every((n) => n.id !== "pastel"), "la escena final no tiene el pastel que la lectura pedía");
});

prueba("una medida fuera de rango es `tamano_fuera_de_rango`: de la compilación (racimo de 161 cm) o de la herramienta (ancho de 60 cm), y reintentar con otra cifra no la cuenta dos veces", () => {
  assert.deepEqual(clasificarCapacidad(foto(36)), { falta_mueble_fondo: 2, tamano_fuera_de_rango: 1 });
  assert.ok(foto(36).omitidas.some((o) => /Grosor de 161 cm fuera de rango/.test(o)));
  assert.equal(foto(50).erroresHerramientas.length, 4, "cuatro llamadas fallidas…");
  assert.deepEqual(clasificarCapacidad(foto(50)), { falta_mueble_fondo: 2, tamano_fuera_de_rango: 1 }, "…del mismo límite");
  assert.equal(clasificarCapacidad(foto(37)).tamano_fuera_de_rango, 1);
});

prueba("el tope del cuerpo de globos de la app (el mensaje real de `comprobarCuerpo`) es `presupuesto_cuerpo`", () => {
  const rechazos: string[] = [];
  for (const [largoCm, grosorCm] of [[3000, 40], [1500, 150]] as const) {
    try { comprobarCuerpo(() => ({ largoCm, grosorCm }), grosorCm); } catch (error) { rechazos.push(error instanceof Error ? error.message : String(error)); }
  }
  assert.equal(rechazos.length, 2, "demasiado largo y demasiado grueso");
  assert.deepEqual(clasificarCapacidad(vacia({ erroresHerramientas: rechazos })), { presupuesto_cuerpo: 2 }, "dos mensajes distintos");
  assert.deepEqual(clasificarCapacidad(vacia({ omitidas: [rechazos[1]!], erroresHerramientas: [rechazos[1]!.replace("1500", "1800")] })), { presupuesto_cuerpo: 1 }, "la misma frase con otra cifra es el mismo rechazo");
});

prueba("lo que el asistente rechaza por otra causa (falta el texto de un letrero) no es capacidad que falte", () => {
  assert.deepEqual(clasificarCapacidad(foto(42)), { falta_mueble_fondo: 1 }, "solo las varillas; el error del letrero no cuenta");
  assert.ok(foto(42).erroresHerramientas.length > 0);
});

prueba("una pieza que el taller sí arma y la escena final no tiene cuenta por familia; si la tiene, no falta", () => {
  const racimo = { tipo: "racimo_piso" }, columna = { tipo: "columna_organica" }, guirnalda = { tipo: "guirnalda_organica" };
  const nodo = (id: string, tipo = "organico") => ({ id, tipo });
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [guirnalda, columna, racimo, racimo], nodosFinales: [nodo("guirnalda-organica"), nodo("racimo-piso")] })), { falta_columna: 2 }, "faltan la columna y un racimo, que son de la familia columna");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [guirnalda, columna, racimo, racimo], nodosFinales: [nodo("guirnalda-organica"), nodo("columna-organica"), nodo("racimo-piso"), nodo("racimo-piso-2")] })), {});
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [guirnalda], nodosFinales: [] })), { falta_guirnalda: 1 });
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [{ tipo: "fondo", id: "lentejuelas" }, { tipo: "fondo", id: "arcos_chiara" }], nodosFinales: [nodo("lentejuelas", "escenografia")] })), { falta_arco: 1 });
});

prueba("los globos, los ramos y los corazones no se cuentan (se compilan a globos sueltos o a un montón); un «otro» de fondo de la foto tampoco", () => {
  const piezas = [{ tipo: "globo" }, { tipo: "ramo_helio" }, { tipo: "corazon" }, { tipo: "otro", descripcion: "ventanales y césped detrás del montaje, sin piezas de decoración adicionales" }];
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: piezas })), {});
});

prueba("un «otro» del catálogo (mesa de postres) se pide a la escena: si ya no está, falta un mueble; un «otro» que no dice qué pieza es queda `otro_pendiente`", () => {
  const mesa = { tipo: "otro", descripcion: "mesa dorada de postres con bandejas" };
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [mesa], nodosFinales: [{ id: "mesa-postres", tipo: "escenografia" }] })), {});
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [mesa], nodosFinales: [] })), { falta_mueble_fondo: 1 });
  const marca = { tipo: "otro", descripcion: "marca de agua GM'DECOMAGIC con teléfono sobre la foto" };
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [marca, marca] })), { otro_pendiente: 2 });
});

prueba("la clase madre `capacidad_faltante` se marca con cualquier causa concreta, y sigue marcándose con el conteo de piezas «otro» de antes", () => {
  assert.deepEqual(clasificarFallos(HECHOS_SIN_FALLOS), []);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, capacidades: { color_no_disponible: 1 } }), ["capacidad_faltante"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, omitidasCompilacion: 1, capacidades: { fondo_fijo: 1 } }), ["compilacion", "capacidad_faltante"]);
  assert.deepEqual(clasificarFallos({ ...HECHOS_SIN_FALLOS, piezasOtro: 1 }), ["capacidad_faltante"]);
  assert.equal(hayCapacidadFaltante({}), false);
  assert.equal(hayCapacidadFaltante(undefined), false);
});

prueba("reclasificada la pasada 2 entera: las 27 fotos con `capacidad_faltante` que marcó el arnés, menos la 40 (su arreglo de pampas ya estaba leído como el jarrón del catálogo), ahora con su causa", () => {
  const conteos = Object.entries(pasada2.fotos).map(([nombre, evidencia]) => ({ nombre, conteo: clasificarCapacidad(evidencia) }));
  const marcadas = conteos.filter((c) => hayCapacidadFaltante(c.conteo)).map((c) => c.nombre);
  assert.equal(marcadas.length, 26);
  assert.deepEqual(marcadas, Object.entries(pasada2.fotos).filter(([n, e]) => e.marcadaAntes && n !== "images (40)").map(([n]) => n), "las que marcó el arnés al correr, salvo la 40");
  assert.deepEqual(Object.keys(pasada2.fotos).filter((n) => !marcadas.includes(n)), ["images (26)", "images (30)", "images (38)", "images (40)"], "las tres que no tenían fallo y la 40");
  const todos = conteos.map((c) => c.conteo);
  // Sobre las escenas finales de la pasada (sin las figuras de `figuras-lectura.ts`, que no existían): las pampas en el piso son el jarrón del
  // catálogo (la 39 lo echa en falta como mueble, ya no como figura) y un «otro» con dos figuras (rizos y flores de la 44) son dos causas.
  assert.deepEqual(pasadasPorClase(todos), { falta_arco: 2, falta_pared: 7, falta_figura: 16, falta_mueble_fondo: 15, fondo_fijo: 1, tamano_fuera_de_rango: 3, color_no_disponible: 1 }, "fotos en que se vio cada causa");
  assert.deepEqual(sumarConteos(todos), { falta_arco: 2, falta_pared: 7, falta_figura: 24, falta_mueble_fondo: 23, fondo_fijo: 2, tamano_fuera_de_rango: 3, color_no_disponible: 1 }, "causas distintas");
  const dominantes: Record<string, number> = {};
  for (const c of todos) { const d = claseDominanteDeCapacidad([c]); if (d) dominantes[d] = (dominantes[d] ?? 0) + 1; }
  assert.deepEqual(dominantes, { falta_mueble_fondo: 11, falta_figura: 10, falta_pared: 3, falta_arco: 1, fondo_fijo: 1 });
});

prueba("una figura que el taller arma (calabazas, rizos, flores de globos, un número relleno de globos) pide su pieza a la escena: si ya está no falta, y es una causa por figura", () => {
  const calabazas = { tipo: "otro", descripcion: "dos calabazas de Halloween (jack-o-lantern) en el piso, a la izquierda" };
  const numero = { tipo: "otro", descripcion: "número 5 de caja tipo mosaico, lleno de globos verde menta, durazno y rosa con flores de tela" };
  const espirales = { tipo: "otro", descripcion: "espirales de foil dorado tipo cinta rizada y flores doradas de globos R-5 pegadas al muro" };
  const nodo = (id: string, tipo: string, contorno?: "texto") => ({ id, tipo, ...(contorno ? { contorno } : {}) });
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [calabazas, numero, espirales] })), { falta_figura: 4 }, "calabazas, el número y las dos figuras de la 44 (rizos y flores)");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [calabazas, numero, espirales], nodosFinales: [nodo("calabaza-grande", "decoracion"), nodo("calabaza-grande-2", "decoracion"), nodo("numero-globos", "forma", "texto"), nodo("rizo-voluta", "decoracion"), nodo("flor5", "decoracion")] })), {}, "con sus piezas en la escena no falta nada");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [calabazas, espirales], nodosFinales: [nodo("flor5", "decoracion"), nodo("flor5-2", "decoracion")] })), { falta_figura: 2 }, "las flores no cubren las calabazas ni los rizos: se compara por pieza");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [{ tipo: "otro", descripcion: "murciélago negro de foil arriba a la izquierda" }] })), { falta_figura: 1 }, "un globo de foil con forma de murciélago sigue siendo capacidad que falta");
  assert.equal(clavePuesta({ id: "forma", tipo: "forma", contorno: "texto" }), "forma:texto", "un número que puso la IA de escena (id «forma») es el número que pedía la lectura");
  assert.equal(clavePuesta({ id: "corazon", tipo: "forma" }), "forma", "un corazón relleno no cubre un número");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [numero], nodosFinales: [nodo("forma", "forma")] })), { falta_figura: 1 }, "una forma que no es un número no cubre el número que falta");
  assert.equal(familiaDeClave("forma"), "figura");
});

prueba("la clase dominante: la que más se repite entre las pasadas; en empate, la primera del orden; ninguna sin causas", () => {
  assert.equal(claseDominanteDeCapacidad([]), null);
  assert.equal(claseDominanteDeCapacidad([{}, undefined]), null);
  assert.equal(claseDominanteDeCapacidad([{ falta_figura: 1, falta_pared: 1 }]), "falta_pared", "empate: gana la que va antes en CLASES_CAPACIDAD");
  assert.equal(claseDominanteDeCapacidad([{ falta_figura: 1 }, { falta_figura: 1, falta_pared: 1 }, { falta_pared: 1, fondo_fijo: 1 }]), "falta_pared");
  const sumas: ConteoCapacidad = sumarConteos([{ falta_figura: 2 }, undefined, { falta_figura: 1, color_no_disponible: 1 }]);
  assert.deepEqual(sumas, { falta_figura: 3, color_no_disponible: 1 });
  assert.ok(CLASES_CAPACIDAD.indexOf("falta_pared") < CLASES_CAPACIDAD.indexOf("falta_figura"));
});

prueba("las familias de los fondos y las claves con que se compara lo que la lectura pide con lo que la escena tiene", () => {
  const casos: Array<[string, FamiliaEstructura]> = [
    ["arcos_chiara", "arco"], ["aro_metalico", "arco"], ["columna_griega", "columna"], ["lentejuelas", "pared"], ["panel_redondo", "pared"], ["marco_tela", "pared"],
    ["pedestales", "mueble_fondo"], ["mesa_coctel", "mueble_fondo"], ["pastel", "mueble_fondo"], ["neon_cursiva", "mueble_fondo"], ["tapete_redondo", "mueble_fondo"],
  ];
  for (const [id, familia] of casos) assert.equal(familiaDeFondo(id), familia, id);
  assert.equal(clavePuesta({ id: "racimo-piso-2", tipo: "organico" }), "racimo");
  assert.equal(clavePuesta({ id: "guirnalda-organica", tipo: "organico" }), "guirnalda");
  assert.equal(clavePuesta({ id: "arco-organico", tipo: "arco_organico" }), "guirnalda", "una guirnalda rearmada como arco orgánico sigue siendo la guirnalda que pedía la lectura");
  assert.equal(clavePuesta({ id: "pedestal", tipo: "escenografia", muebleId: "pedestales" }), "fondo:pedestales", "un mueble se reconoce por el id del catálogo, no por el de su nodo");
  assert.equal(clavePuesta({ id: "media-luna", tipo: "escenografia" }), "fondo:media_luna");
  assert.equal(clavePuesta({ id: "globo-r-18", tipo: "metalizado" }), "metalizado", "un metalizado conserva el id de un globo");
  assert.equal(clavePuesta({ id: "racimo-uvas-dorado-3", tipo: "decoracion" }), "decoracion:racimo_uvas_dorado");
  assert.equal(clavePuesta({ id: "globo-r-24", tipo: "globo" }), null);
  assert.equal(clavePedida({ tipo: "racimo_piso" }), "racimo");
  assert.equal(clavePedida({ tipo: "decoracion", id: "racimo_uvas_dorado" }), "decoracion:racimo_uvas_dorado");
  assert.equal(clavePedida({ tipo: "ramo_helio" }), null);
  assert.equal(clavePedida({ tipo: "globo" }), null);
  for (const [clave, familia] of [["guirnalda", "guirnalda"], ["columna", "columna"], ["racimo", "columna"], ["metalizado", "figura"], ["decoracion:orbe_flecos_dorado", "figura"], ["fondo:arcos_chiara", "arco"], ["fondo:mesa_postres", "mueble_fondo"]] as const) assert.equal(familiaDeClave(clave), familia, clave);
});

prueba("los ids de fondo que cada familia nombra existen en el catálogo (si se renombran, la familia no los pierde en silencio)", () => {
  const ids = new Set(FONDOS_CATALOGO.map((f) => f.id));
  for (const id of [...FONDOS_DE_ARCO, ...FONDOS_DE_COLUMNA, ...FONDOS_DE_PARED]) assert.ok(ids.has(id), `el catálogo ya no tiene «${id}»`);
});

prueba("lo que sobra de una cosa no tapa lo que falta de otra: se compara por clave, no por familia entera", () => {
  const nodo = (id: string, tipo: string, muebleId?: string) => ({ id, tipo, ...(muebleId ? { muebleId } : {}) });
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [{ tipo: "metalizado" }, { tipo: "decoracion", id: "racimo_uvas_dorado" }], nodosFinales: [nodo("metalizado", "metalizado"), nodo("metalizado-2", "metalizado")] })), { falta_figura: 1 }, "un metalizado de dos palabras son dos nodos y no cubren la decoración que falta");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [{ tipo: "fondo", id: "mesa_postres" }], nodosFinales: [nodo("silla-tiffany", "escenografia", "silla_tiffany"), nodo("silla-tiffany-2", "escenografia", "silla_tiffany")] })), { falta_mueble_fondo: 1 }, "dos sillas no cubren la mesa de postres que falta");
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: [{ tipo: "fondo", id: "pedestales" }], nodosFinales: [nodo("pedestal", "escenografia", "pedestales")] })), {}, "el nodo «pedestal» es el fondo «pedestales»");
});

prueba("un «otro» con nombre del catálogo que la lectura ya trae como fondo no se pide dos veces (la compilación no arma el segundo)", () => {
  const piezas = [{ tipo: "fondo", id: "pedestales" }, { tipo: "otro", descripcion: "pedestales dorados de alambre en forma de jaula, junto al panel" }];
  assert.deepEqual(clasificarCapacidad(vacia({ piezasLeidas: piezas, nodosFinales: [{ id: "pedestal", tipo: "escenografia", muebleId: "pedestales" }] })), {});
});

prueba("la familia de un «otro» sale del nombre de la pieza (lo primero que dice), no de lo que lleva o de dónde está", () => {
  const casos: Array<[string, FamiliaEstructura | null]> = [
    ["mariposas rosas metálicas pegadas en la pared", "figura"],
    ["dos mariposas grandes de foil lila y blanco sobre el arco", "figura"],
    ["muñeco de nieve con gorro rosa y cajas de regalo rosadas en el piso", "figura"],
    ["letras gigantes blancas ONE con mesa de dulces: frascos dorados", "figura"],
    ["dos cajas blancas de regalo con moño de ratán sobre la mesa", "figura"],
    ["arreglo de flores rosas, pampas y ramas secas al pie de la columna, en el piso", "figura"],
    ["número 1 de caja tipo mosaico, lleno de globos rosa", "figura"],
    ["cortinas de tul rosa pálido a la izquierda", "pared"],
    ["telón de castillo rosado con ventanas blancas y copos de nieve blancos", "pared"],
    ["panel decorativo de ramas oscuras en la pared, sobre el arco", "pared"],
    ["muro denso de globos de látex mezclados con cromados plata y dorado, sin estructura visible", "pared"],
    ["arco de medio punto negro mate detrás de los globos y el neón", "arco"],
    ["arcoíris de madera o ratán en tonos terracota, crema y rosa, con flecos colgando de la base", "arco"],
    ["dos columnas de acrílico transparente con globos blancos, blush y nude dentro, a la izquierda", "columna"],
    ["racimo de globos rosa cromado cortado por el borde izquierdo", "columna"],
    ["escalera de madera y pared de ladrillo visto al fondo, con ramas de eucalipto blanco arriba a la derecha", "mueble_fondo"],
    ["base blanca baja bajo el muro de globos", "mueble_fondo"],
    ["bandeja dorada con mini tortas y postres sobre pedestal dorado", "mueble_fondo"],
    ["caja o bocina negra a la derecha, en el borde de la foto", "mueble_fondo"],
    ["estantería metálica negra a la derecha", "mueble_fondo"],
    ["mesa rústica de madera con patas en A y travesaño metálico negro", "mueble_fondo"],
    ["marca de agua GM'DECOMAGIC con teléfono sobre la foto", null],
    ["distintivo negro con logo pequeño sobre la columna, a la izquierda", null],
  ];
  for (const [descripcion, familia] of casos) assert.equal(familiaDeOtro(descripcion), familia, descripcion);
});

prueba("la auditoría de una pasada: lectura cruda, detección anotada y errores de las herramientas, con la conversación de la pasada", () => {
  assert.equal(idConversacionDePasada("2026-10-10T17-07-01-532Z", "images (25).jpg"), "entrenamiento-2026-10-10T17-07-01-532Z-images-25");
  const eventos: EventoAuditoria[] = [
    { tipo: "respuesta_ia", datos: { proposito: "lectura_foto_escena", llamadasHerramientas: [{ nombre: "responder_json", argumentos: { piezas: [{ tipo: "otro", descripcion: "oso de peluche" }, { tipo: "fondo", id: "pastel" }] } }] } },
    { tipo: "decision", datos: { quien: "herramienta:escena_ia", resultado: { ok: true, resumen: "listo" } } },
    { tipo: "decision", datos: { quien: "herramienta:escena_ia", resultado: { ok: false, error: "No encontré el color «rosa polvo» en la tabla Sempertex." } } },
    { tipo: "decision", datos: { quien: "modelo:escena_ia", resultado: { ok: false, error: "no es de una herramienta" } } },
    { tipo: "decision", datos: { quien: "modelo:deteccion_globos", resultado: { revisadas: 8, racimos: 1 } } },
    { tipo: "decision", datos: { quien: "modelo:deteccion_globos", resultado: { globos: 91, fondos: ["media_luna", "pedestales"], trozos: 9 } } },
  ];
  assert.deepEqual(deteccionAnotada(eventos), { globos: 91, fondos: ["media_luna", "pedestales"], trozos: 9 }, "la que trae los fondos, no la revisión de racimos");
  assert.equal(deteccionAnotada([]), undefined);
  assert.deepEqual(resumirPiezas((lecturaCrudaDeAuditoria(eventos) as { piezas: unknown[] }).piezas), [{ tipo: "otro", descripcion: "oso de peluche" }, { tipo: "fondo", id: "pastel" }]);
  assert.equal(lecturaCrudaDeAuditoria([]), undefined);
  assert.deepEqual(erroresDeHerramientas(eventos), ["No encontré el color «rosa polvo» en la tabla Sempertex."]);
  const dia = path.join(tmp, "registro", "conversaciones", "2026-10-10");
  mkdirSync(dia, { recursive: true });
  writeFileSync(path.join(dia, "entrenamiento-x-images-25.jsonl"), `${eventos.map((e) => JSON.stringify(e)).join("\n")}\n`);
  assert.equal(archivoDeAuditoria(path.join(tmp, "registro"), "entrenamiento-x-images-25"), path.join(dia, "entrenamiento-x-images-25.jsonl"));
  assert.deepEqual(eventosDeConversacion(path.join(tmp, "registro"), "entrenamiento-x-images-25"), { eventos, lineasRotas: 0 });
  assert.equal(archivoDeAuditoria(path.join(tmp, "registro"), "no-existe"), null);
  assert.deepEqual(eventosDeConversacion(path.join(tmp, "sin-registro"), "x"), { eventos: [], lineasRotas: 0 });
  const nodos = resumirNodos({ nodos: [{ id: "pedestal", pieza: { tipo: "escenografia", mueble: { id: "pedestales" } } }, { id: "globo-r-12", pieza: { tipo: "globo" } }, { id: "forma", pieza: { tipo: "forma", forma: { contorno: { tipo: "texto" } } } }, { id: "forma-2", pieza: { tipo: "forma", forma: { contorno: { tipo: "predefinido" } } } }] });
  assert.deepEqual(nodos, [{ id: "pedestal", tipo: "escenografia", muebleId: "pedestales" }, { id: "globo-r-12", tipo: "globo" }, { id: "forma", tipo: "forma", contorno: "texto" }, { id: "forma-2", tipo: "forma" }], "una forma que dibuja un número lo dice; las demás no");
  assert.deepEqual(evidenciaDePasada({ piezas: [{ tipo: "fondo", id: "pastel" }], escena: { nodos: [] }, omitidas: ["x"], erroresHerramientas: ["y"] }), { piezasLeidas: [{ tipo: "fondo", id: "pastel" }], nodosFinales: [], omitidas: ["x"], erroresHerramientas: ["y"] });
});

prueba("una línea rota de la auditoría no tira la clasificación: se salta y se cuenta", () => {
  const archivo = path.join(tmp, "rota.jsonl");
  const buena = JSON.stringify({ tipo: "decision", datos: { quien: "herramienta:escena_ia", resultado: { ok: false, error: "fuera de rango" } } });
  writeFileSync(archivo, [buena, '{"tipo":"decision","datos":{"quien":"herram', "[1,2]", JSON.stringify({ tipo: "decision" }), "", buena].join("\n"));
  const { eventos, lineasRotas } = leerEventos(archivo);
  assert.equal(eventos.length, 2);
  assert.equal(lineasRotas, 3, "la cortada a medias, la que no es un evento y la que no trae datos");
  assert.deepEqual(clasificarCapacidad(vacia({ erroresHerramientas: erroresDeHerramientas(eventos) })), { tamano_fuera_de_rango: 1 });
});

prueba("un tope de globo fuera de rango («Un R-12 se infla entre 20 y 30 cm») es `tamano_fuera_de_rango`", () => {
  assert.deepEqual(clasificarCapacidad(vacia({ erroresHerramientas: ["Un R-12 se infla entre 20 y 30 cm (pediste 45)."] })), { tamano_fuera_de_rango: 1 });
  assert.deepEqual(clasificarCapacidad(vacia({ erroresHerramientas: ["Un R-18 se infla entre 35 y 45 cm (pediste 60).", "Un R-12 se infla entre 20 y 30 cm (pediste 45)."] })), { tamano_fuera_de_rango: 1 }, "la misma frase con otras cifras es el mismo rechazo");
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de la capacidad que falta: OK`);
