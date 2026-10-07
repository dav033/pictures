import type { BriefGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";

/**
 * Lo que dijo el cliente, tal como lo dijo, para el plan y la imagen de la vista guiada. Importable desde el cliente:
 * sin biblioteca, servidor ni modelo.
 *
 * Por qué (comparador 100, I2 e I4): la guiada pedía el plan a /api/chat con una instrucción de máquina («Resuelve ahora
 * el plan exacto…») y un brief solo con colores. Así el plan quedaba con `original_request` = esa instrucción, la escena
 * de la imagen salía de ella (nunca «… celebration atmosphere», ni lugar ni momento) y la auditoría guardaba la
 * descripción que escribió la IA. La clásica, en cambio, manda las palabras del cliente.
 *
 * El evento NO va en el texto de la instrucción: /api/chat lee el texto como lo que dijo el cliente y vuelve la ocasión un
 * filtro duro del catálogo («boda» → solo globos impresos «Nuestra Boda», el I3 de la clásica). Va en el brief
 * (`tipo_evento`), que no filtra (`filtrosDurosDeBusqueda`), y en `solicitudCliente`, que solo da `original_request` y
 * la ocasión del plan.
 */

export type ContextoClienteGuiado = {
  /** Las palabras del cliente en la conversación, sin los textos que pone la interfaz («Me gusta «…»», «Es para…»). */
  solicitud?: string;
  evento?: string;
  tematica?: string;
  /** Palabras literales: «unos 3 metros», «en un jardín», «de noche», «300 mil pesos». */
  medida?: string;
  lugar?: string;
  momento?: string;
  presupuesto?: string;
  /** Piezas que el cliente pidió orgánicas («arco orgánico» → `arco`): mezcla de tamaños aunque la oficial sea lisa. */
  organicas?: readonly EstructuraOficialId[];
};

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

/**
 * Textos que la interfaz manda en nombre del cliente (botones y acciones de VistaGuiada): no son sus palabras. «Es para
 * mi negocio.» sí dice algo (el uso), pero ya está en el brief.
 */
const MENSAJE_DE_INTERFAZ = /^(?:me gusta «|quiero saber cu[aá]nto|quiero saber d[oó]nde|quiero comprar|quiero aprender|quiero contratar|quiero cotizar|es para (?:uso personal|mi negocio)\.?$|prop[oó]nme|una pieza individual\.?$|ninguna me convence|otra celebraci[oó]n$|s[ií], arm[eé]moslo|arma mi plan con «|agrega «|busca (?:decoradores|un distribuidor)|elijo a |mu[eé]strame ideas|mira esta foto|tengo una foto|subir una foto|ver ideas$|ver otros estilos$|agr[eé]gale una pieza que combine|hazla m[aá]s (?:grande|sencilla)|qu[ií]tale |quiero otros colores)/i;

export function esMensajeDeInterfaz(texto: string): boolean {
  return MENSAJE_DE_INTERFAZ.test(texto.trim());
}

/**
 * Las palabras del cliente en orden, sin los textos de la interfaz ni repetidos, como las junta la clásica para
 * `original_request` (todos los mensajes del cliente). Ej. mamá: «Cumpleaños. 4 a 6 años. Rosa y lila.».
 */
export function solicitudDelCliente(mensajesCliente: readonly string[], maximo = 1200): string | undefined {
  const vistos = new Set<string>();
  const propios = mensajesCliente
    .map((texto) => texto.trim().replace(/\s*\nAdjunté una foto de inspiración\.$/, ""))
    .filter((texto) => texto.length > 0 && !esMensajeDeInterfaz(texto))
    .filter((texto) => { const clave = normalizar(texto); if (vistos.has(clave)) return false; vistos.add(clave); return true; })
    .map((texto) => (/[.!?…]$/.test(texto) ? texto : `${texto}.`));
  if (!propios.length) return undefined;
  const unida = propios.join(" ");
  return unida.length <= maximo ? unida : unida.slice(unida.length - maximo).replace(/^\S*\s/, "");
}

/** El contexto del cliente para el plan y la imagen: su brief (lo que el servidor guardó sin modelo) y sus palabras. */
export function contextoClienteGuiado(brief: BriefGuiado, mensajesCliente: readonly string[]): ContextoClienteGuiado {
  const solicitud = solicitudDelCliente(mensajesCliente);
  const valido = (valor: string | undefined) => (valor?.trim() && !/^(?:pendiente|por[ _-]?definir|sin definir|ninguna)$/i.test(valor.trim()) ? valor.trim() : undefined);
  const evento = valido(brief.evento);
  const tematica = valido(brief.tematica);
  return {
    ...(solicitud ? { solicitud } : {}),
    ...(evento ? { evento } : {}),
    ...(tematica ? { tematica } : {}),
    ...(brief.medida ? { medida: brief.medida.texto } : {}),
    ...(brief.lugar ? { lugar: brief.lugar } : {}),
    ...(brief.momento ? { momento: brief.momento } : {}),
    ...(brief.presupuesto ? { presupuesto: brief.presupuesto } : {}),
    ...(brief.estructura?.organica ? { organicas: [brief.estructura.id] } : {}),
  };
}

/**
 * La línea de la instrucción del plan con las palabras del cliente que importan (medida, lugar, momento, presupuesto),
 * o null. Sin el evento (ver arriba): «para una boda» en el texto filtra el catálogo por ocasión.
 */
export function lineaPalabrasCliente(cliente: ContextoClienteGuiado | undefined, opciones: { sinMedida?: boolean } = {}): string | null {
  if (!cliente) return null;
  const partes = [
    // `sinMedida`: alguna pieza ya trae sus medidas (las que pidió, ya puestas en su pieza, o las de una idea): no se
    // repiten en palabras, que podrían contradecirlas.
    cliente.medida && !opciones.sinMedida ? `medida «${cliente.medida}»` : "",
    cliente.lugar ? `lugar «${cliente.lugar}»` : "",
    cliente.momento ? `momento «${cliente.momento}»` : "",
    cliente.presupuesto ? `presupuesto «${cliente.presupuesto}»` : "",
  ].filter(Boolean);
  return partes.length ? `Lo que pidió el cliente, con sus palabras (respétalo): ${partes.join("; ")}.` : null;
}

/** Brief de chat-v1 con lo que dijo el cliente: evento, lugar y momento. Ninguno filtra el catálogo (solo ambienta). */
export function briefChatCliente(cliente: ContextoClienteGuiado | undefined): { tipo_evento?: string; espacio?: string; momento_dia?: string } {
  if (!cliente) return {};
  return {
    ...(cliente.evento ? { tipo_evento: cliente.evento } : {}),
    ...(cliente.lugar ? { espacio: cliente.lugar } : {}),
    ...(cliente.momento ? { momento_dia: cliente.momento } : {}),
  };
}

/**
 * Lo que la guiada le da a `cuerpoGeneracion` (el constructor compartido con la clásica) para «Ver cómo quedaría»: el
 * brief completo de la conversación (evento, temática, lugar, momento y la paleta del plan) y, como en la clásica, las
 * palabras del cliente como `solicitudUsuario` (la escena y `registrarPlanAudit.solicitudOriginal`). Solo si el cliente
 * no escribió nada, la descripción del plan.
 */
export function entradaImagenGuiada<P extends { plan: { concepto: { paleta: readonly string[]; descripcion: string } } }>(plan: P, cliente: ContextoClienteGuiado): {
  brief: { tipo_evento?: string; colores: string[]; estilo?: string; espacio?: string; momento_dia?: string };
  solicitudUsuario: string;
} {
  return {
    brief: {
      ...(cliente.evento ? { tipo_evento: cliente.evento } : {}),
      colores: [...plan.plan.concepto.paleta],
      ...(cliente.tematica ? { estilo: cliente.tematica } : {}),
      ...(cliente.lugar ? { espacio: cliente.lugar } : {}),
      ...(cliente.momento ? { momento_dia: cliente.momento } : {}),
    },
    solicitudUsuario: cliente.solicitud ?? plan.plan.concepto.descripcion,
  };
}
