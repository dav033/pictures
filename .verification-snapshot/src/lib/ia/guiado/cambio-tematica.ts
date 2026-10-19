import { motivosNombrados, normalizarBusqueda } from "@/lib/biblioteca-sempertex/biblioteca";

/**
 * Probador (2026-10-06): «mejor cambiemos, mi hijo ahora quiere dinosaurios» con un plan de Spiderman a la vista. El
 * modelo solo llamó `proponer_composicion` (sin `guardar_brief_guiado`): la cabecera siguió diciendo «Cumpleaños · 5
 * años · Spiderman», nunca vio la idea real «Semiarco selvático de dinosaurios» y rehízo el mismo plan recoloreado.
 *
 * Regla determinista del servidor: si el cliente nombra un motivo o personaje (dinosaurios, princesas, Spiderman…)
 * distinto del de su brief y lo dice como un cambio, el brief se actualiza y se buscan las ideas reales de la nueva
 * temática antes de que hable el modelo. Sin React y sin red.
 */

export type CambioTematica = {
  /** La temática que tenía el brief. */
  anterior: string;
  /** La nueva, tal como la escribió el cliente («Dinosaurios», «Spiderman»). */
  nueva: string;
  /** El grupo del catálogo que la reconoce («dinosaurio»). */
  grupo: string;
  motivo: string;
};

// «mejor», «cambiemos», «ahora quiere», «prefiero», «en vez de», «ya no»…: el cliente cambia lo que pidió.
const INTENCION_CAMBIO = /\b(?:cambi\w*|mejor|ahora|prefier\w*|prefer\w*|en vez|en lugar|ya no|otra tematica|otro tema|otra idea|quiere|quiero|queremos|le gusta\w*|le encanta\w*|nos gusta\w*)\b/;
// Pedir un adorno para una pieza no es cambiar la temática («ponle un dinosaurio a la columna»).
const EDICION_PIEZA = /\b(?:agreg\w*|anad\w*|pon\w*|sum\w*|inclu\w*|quit\w*|columna|columnas|arco|arcos|semiarco|guirnalda|pieza|piezas|globo|globos)\b/;

/** «dinosaurios» en «mi hijo ahora quiere Dinosaurios!» → «Dinosaurios», con las tildes y mayúsculas del cliente. */
function formaDelCliente(texto: string, normalizada: string): string {
  const fichas = [...texto.matchAll(/[\p{L}\p{N}]+/gu)].map((ficha) => ({ original: ficha[0], normal: normalizarBusqueda(ficha[0]), inicio: ficha.index ?? 0 }));
  const partes = normalizada.split(" ");
  for (let indice = 0; indice + partes.length <= fichas.length; indice += 1) {
    if (partes.every((parte, desplazamiento) => fichas[indice + desplazamiento]!.normal === parte)) {
      const ultima = fichas[indice + partes.length - 1]!;
      const original = texto.slice(fichas[indice]!.inicio, ultima.inicio + ultima.original.length);
      return original.charAt(0).toLocaleUpperCase("es") + original.slice(1);
    }
  }
  return normalizada.charAt(0).toLocaleUpperCase("es") + normalizada.slice(1);
}

export function detectarCambioTematica(entrada: { ultimoUsuario: string; tematicaPrevia?: string | undefined }): CambioTematica | null {
  const anterior = entrada.tematicaPrevia?.trim();
  const texto = entrada.ultimoUsuario.trim();
  if (!anterior || !texto) return null;
  const normal = normalizarBusqueda(texto);
  const nombrados = motivosNombrados(texto);
  if (!nombrados.length) return null;
  const previos = new Set(motivosNombrados(anterior).map((item) => item.grupo));
  const nuevo = nombrados.find((item) => !previos.has(item.grupo));
  if (!nuevo) return null;
  const palabras = normal.split(" ").filter(Boolean).length;
  const intencion = INTENCION_CAMBIO.test(normal);
  if (!intencion && palabras > 4) return null;
  if (EDICION_PIEZA.test(normal)) return null;
  return {
    anterior,
    nueva: formaDelCliente(texto, nuevo.palabra),
    grupo: nuevo.grupo,
    motivo: intencion ? "el cliente pidió cambiar de temática" : "el cliente solo nombró otra temática",
  };
}
