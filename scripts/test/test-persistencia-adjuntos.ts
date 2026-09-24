/**
 * Iteración 4 (revisión): al recargar, la conversación guardada en
 * sessionStorage conserva una miniatura liviana de las fotos de cada turno
 * (mensaje del cliente y recortes por pieza de la propuesta), con un tope de
 * imágenes y de tamaño para no romper el límite del almacenamiento.
 * Determinista, sin navegador. Run: npx tsx scripts/test/test-persistencia-adjuntos.ts
 */
import assert from "node:assert/strict";
import {
  aligerarAdjuntos,
  claveImagen,
  imagenesSinMiniatura,
  MAX_CARACTERES_MINIATURA,
  MAX_IMAGENES_GUARDADAS,
  type AdjuntosTurno,
} from "../../src/lib/estado/persistencia-adjuntos";
import {
  elegirImagenReducida,
  generacionParaRestaurar,
  leerGeneraciones,
  MAX_CARACTERES_IMAGEN_GENERADA,
  MAX_GENERACIONES_GUARDADAS,
  MAX_IMAGENES_GENERADAS_GUARDADAS,
  registrarGeneracion,
  registrarVistaPreviaNoDisponible,
  serializarGeneraciones,
  sinImagenes,
} from "../../src/lib/estado/persistencia-generacion";
import { creatividadGuardada } from "../../src/lib/estado/persistencia-creatividad";
import { adjuntosParaGeneracion } from "../../src/lib/estado/generacion-adjuntos";

type Mensaje = { id: string; adjuntos?: AdjuntosTurno };

const foto = (semilla: string) => ({ base64: `${semilla.repeat(400)}FIN${semilla}`, mime: "image/jpeg" });
const miniatura = (semilla: string) => `data:image/jpeg;base64,MINI${semilla}`;

const referencia = foto("r");
const espacio = foto("e");
const mensajes: Mensaje[] = [
  { id: "cliente", adjuntos: { referencias: [{ id: "REF_01", ...referencia }], fotoEspacio: espacio } },
  { id: "propuesta", adjuntos: { referencias: [{ id: "REF_01", ...referencia }], fotoEspacio: espacio } },
  { id: "texto" },
];

// Sin miniaturas todavía: no se guarda ningún base64 pesado.
const sinMiniaturas = aligerarAdjuntos(mensajes, new Map());
assert.equal(sinMiniaturas[0]!.adjuntos, undefined, "sin miniatura lista, el turno se guarda sin fotos");
assert.equal(JSON.stringify(sinMiniaturas).includes(referencia.base64), false, "nunca el base64 original");
assert.deepEqual(imagenesSinMiniatura(mensajes, new Map()).map(claveImagen).sort(), [claveImagen(espacio), claveImagen(referencia)].sort(), "pide cada foto una sola vez");

// Con miniaturas: se guardan con el mismo id REF_01 para que los recortes sigan enlazados.
const miniaturas = new Map([[claveImagen(referencia), miniatura("r")], [claveImagen(espacio), miniatura("e")]]);
const livianos = aligerarAdjuntos(mensajes, miniaturas);
assert.deepEqual(livianos[1]!.adjuntos, { referencias: [{ id: "REF_01", base64: miniatura("r"), mime: "image/jpeg" }], fotoEspacio: { base64: miniatura("e"), mime: "image/jpeg" } });
assert.equal(livianos[2]!.adjuntos, undefined);
assert.deepEqual(imagenesSinMiniatura(mensajes, miniaturas), []);

// Una propuesta aprobada usa sus originales; miniaturas restauradas nunca viajan al proveedor.
const originalesDePropuesta = adjuntosParaGeneracion(mensajes[1]!.adjuntos);
assert.equal(originalesDePropuesta.fotoEspacio?.base64, espacio.base64);
assert.deepEqual(originalesDePropuesta.referencias, [{ base64: referencia.base64, mime: referencia.mime }]);
assert.equal(originalesDePropuesta.tieneMiniaturas, false);
const miniaturasDePropuesta = adjuntosParaGeneracion(livianos[1]!.adjuntos);
assert.equal(miniaturasDePropuesta.fotoEspacio, null);
assert.deepEqual(miniaturasDePropuesta.referencias, []);
assert.equal(miniaturasDePropuesta.tieneMiniaturas, true);

// Un mensaje ya restaurado (miniatura como data URL) se vuelve a guardar tal cual.
const restaurados = aligerarAdjuntos(livianos, new Map());
assert.deepEqual(restaurados, livianos, "recargar dos veces no pierde las miniaturas");
assert.deepEqual(imagenesSinMiniatura(livianos, new Map()), []);

// Tope de imágenes: se conservan las más recientes.
const muchos: Mensaje[] = Array.from({ length: MAX_IMAGENES_GUARDADAS + 3 }, (_, indice) => ({ id: `m${indice}`, adjuntos: { referencias: [{ id: "REF_01", ...foto(`x${indice}`) }] } }));
const todasLasMiniaturas = new Map(muchos.map((mensaje, indice) => [claveImagen(mensaje.adjuntos!.referencias[0]!), miniatura(`x${indice}`)]));
const recortados = aligerarAdjuntos(muchos, todasLasMiniaturas);
assert.equal(recortados.filter((mensaje) => mensaje.adjuntos).length, MAX_IMAGENES_GUARDADAS);
assert.equal(recortados.at(-1)!.adjuntos !== undefined && recortados[0]!.adjuntos === undefined, true, "se guardan las fotos de los turnos más recientes");
assert.equal(imagenesSinMiniatura(muchos, new Map()).length, MAX_IMAGENES_GUARDADAS, "no se generan miniaturas que no se guardarían");

// Una miniatura demasiado grande no se guarda.
const enorme = new Map([[claveImagen(referencia), `data:image/jpeg;base64,${"A".repeat(MAX_CARACTERES_MINIATURA + 1)}`]]);
assert.equal(aligerarAdjuntos([mensajes[0]!], enorme)[0]!.adjuntos?.referencias.length ?? 0, 0);
console.log("[PASS] persistencia de adjuntos: miniaturas livianas, ids estables y topes de tamaño");

// D5 del E2E real: la propuesta aprobada y su imagen reducida sobreviven a la recarga, por plan_hash.
{
  const imagen = (semilla: string, largo = 2_000) => `data:image/jpeg;base64,${semilla.repeat(largo)}`;
  let guardadas = registrarGeneracion([], "hash-a", null, 1);
  assert.deepEqual(guardadas, [{ planHash: "hash-a", imagen: null, guardadaEn: 1 }], "la aprobación se guarda aunque la imagen aún no esté");
  guardadas = registrarGeneracion(guardadas, "hash-a", imagen("a"), 2);
  assert.equal(guardadas.length, 1, "el mismo plan no se duplica");
  assert.equal(guardadas[0]!.imagen, imagen("a"));
  assert.equal(registrarGeneracion(guardadas, "hash-a", undefined, 3)[0]!.imagen, imagen("a"), "undefined conserva la imagen ya guardada");

  // Recargar: se restaura la aprobación más reciente cuyo plan sigue en la conversación.
  const texto = serializarGeneraciones(registrarGeneracion(guardadas, "hash-b", imagen("b"), 5));
  const leidas = leerGeneraciones(texto);
  assert.equal(generacionParaRestaurar(leidas, new Set(["hash-a", "hash-b"]))!.planHash, "hash-b");
  assert.equal(generacionParaRestaurar(leidas, new Set(["hash-a"]))!.imagen, imagen("a"));
  assert.equal(generacionParaRestaurar(leidas, new Set(["otro"])), null, "un plan que ya no está no se restaura");

  // Presupuesto: una imagen reducida demasiado grande no se guarda, pero la aprobación sí.
  const enorme = `data:image/jpeg;base64,${"Z".repeat(MAX_CARACTERES_IMAGEN_GENERADA)}`;
  assert.equal(elegirImagenReducida([enorme, imagen("m"), imagen("s", 10)]), imagen("m"), "se usa la primera reducción que cabe");
  assert.equal(elegirImagenReducida([enorme]), null);
  const sinCaber = registrarGeneracion([], "hash-c", enorme, 6);
  assert.deepEqual(sinCaber, [{ planHash: "hash-c", imagen: null, guardadaEn: 6 }], "sin imagen que quepa → «Ya generaste esta imagen»");

  // Tope de imágenes: solo las aprobaciones más recientes conservan la suya; el total queda acotado.
  let muchas: ReturnType<typeof registrarGeneracion> = [];
  for (let indice = 0; indice < MAX_GENERACIONES_GUARDADAS + 2; indice += 1) muchas = registrarGeneracion(muchas, `h${indice}`, imagen(String(indice), 40_000), indice);
  assert.equal(muchas.length, MAX_GENERACIONES_GUARDADAS);
  assert.equal(muchas.filter((generacion) => generacion.imagen).length, MAX_IMAGENES_GENERADAS_GUARDADAS);
  assert.ok(serializarGeneraciones(muchas).length <= MAX_IMAGENES_GENERADAS_GUARDADAS * MAX_CARACTERES_IMAGEN_GENERADA + 2_000, "presupuesto total acotado");
  assert.deepEqual(sinImagenes(muchas).filter((generacion) => generacion.imagen), [], "degradación si sessionStorage rechaza la escritura");

  // Datos corruptos o manipulados no rompen la carga.
  assert.deepEqual(leerGeneraciones("{no json"), []);
  assert.deepEqual(leerGeneraciones(JSON.stringify({ generaciones: [{ planHash: "x", imagen: "javascript:alert(1)", guardadaEn: 1 }, { planHash: 3 }] })), []);
  console.log("[PASS] persistencia de la generación aprobada: por plan_hash, imagen reducida con presupuesto y degradación");
}

// D5 sin foto (E2E real 2): fal sin saldo responde VISTA_PREVIA_NO_DISPONIBLE. La
// aprobación se registra con ese aviso por plan_hash y sobrevive a la recarga; un
// intento posterior con imagen quita la marca.
{
  const imagen = `data:image/jpeg;base64,${"q".repeat(2_000)}`;
  let guardadas = registrarVistaPreviaNoDisponible(registrarGeneracion([], "hash-viejo", null, 1), "hash-fiel", 2);
  assert.deepEqual(guardadas[0], { planHash: "hash-fiel", imagen: null, guardadaEn: 2, sinVistaPrevia: true });
  const restaurada = generacionParaRestaurar(leerGeneraciones(serializarGeneraciones(guardadas)), new Set(["hash-fiel", "hash-viejo"]));
  assert.equal(restaurada?.planHash, "hash-fiel", "tras recargar la propuesta sigue aprobada");
  assert.equal(restaurada?.sinVistaPrevia, true, "tras recargar se muestra el aviso de vista previa no disponible");
  assert.equal(leerGeneraciones(serializarGeneraciones(sinImagenes(guardadas)))[0]?.sinVistaPrevia, true, "la degradación conserva el aviso");
  guardadas = registrarVistaPreviaNoDisponible(guardadas, "hash-fiel", 3);
  assert.equal(guardadas.filter((generacion) => generacion.planHash === "hash-fiel").length, 1, "reintentos fallidos no duplican");
  guardadas = registrarGeneracion(guardadas, "hash-fiel", imagen, 4);
  assert.equal(guardadas[0]!.sinVistaPrevia, undefined, "una imagen creada después quita el aviso");
  assert.equal(guardadas[0]!.imagen, imagen);
  assert.deepEqual(leerGeneraciones(JSON.stringify({ generaciones: [{ planHash: "x", imagen: null, guardadaEn: 1, sinVistaPrevia: "si" }] })), [], "marca manipulada se ignora");
  console.log("[PASS] D5 sin foto: aprobación con aviso de vista previa no disponible persiste por plan_hash");
}

// Creatividad tras recargar (E2E real 2): el nivel viaja con la conversación guardada.
{
  const guardado = JSON.parse(JSON.stringify({ mensajes: [{ id: "m1" }], brief: null, creatividad: 0 })) as unknown;
  assert.equal(creatividadGuardada(guardado), 0, "«Fiel» (0) se restaura aunque sea falsy");
  assert.equal(creatividadGuardada({ creatividad: 4 }), 4);
  assert.equal(creatividadGuardada({ mensajes: [] }), null, "conversación anterior sin nivel → por defecto");
  assert.equal(creatividadGuardada({ creatividad: 9 }), null);
  assert.equal(creatividadGuardada({ creatividad: "0" }), null);
  assert.equal(creatividadGuardada({ creatividad: 2.5 }), null);
  assert.equal(creatividadGuardada(null), null);
  console.log("[PASS] creatividad: el nivel de la conversación se guarda y se restaura validado");
}
