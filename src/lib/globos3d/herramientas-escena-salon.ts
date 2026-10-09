import { z } from "zod";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { hexDeColor } from "./mobiliario-colores";
import { ajustarSalon } from "./salon-ajustar";
import { armarSalon } from "./salon-armar";
import { MAX_INVITADOS_SALON, TIPOS_MESA_SALON } from "./salon-evento";
import { centrosPerdidos, sincronizarCentros } from "./salon-centros";
import { moverZona, quitarZona } from "./salon-zonas-editar";
import { ZONAS_SALON } from "./salon-zonas";

/**
 * **Herramientas del salón de eventos** (REQ-008): `armar_salon` (mesas con sillas en cuadrícula, mesa principal, pista, postres,
 * fondo de fotos y entrada), y para ajustarlo sin rehacerlo, `ajustar_salon` (invitados, tipo de mesa, medidas, zonas que
 * faltan), `mover_zona` y `quitar_zona`. Solo tocan las piezas `salon-…`; las del usuario se conservan.
 * El composite `planificar_evento` está en herramientas-escena-evento.ts; los centros de mesa que acompañan a las mesas, en salon-centros.ts.
 */

const Zona = z.enum(ZONAS_SALON);
const Mesa = z.enum(TIPOS_MESA_SALON);

const TEXTO_ZONAS = "mesa_principal (mesa de los novios con sillas detrás, mirando al salón), pista (pista de baile libre), mesa_postres (contra la pared izquierda), fondo_fotos (panel contra la pared del fondo, detrás de la mesa principal), entrada (tapete al frente)";

const ArmarSchema = z.object({
  invitados: z.number().int().min(0).max(MAX_INVITADOS_SALON).optional().describe("cuántos invitados; las mesas salen de ahí. 0 o sin decir: solo las zonas, sin mesas de invitados"),
  mesa: Mesa.optional().describe("redonda8 (redonda con 8 sillas, por defecto), redonda10 (redonda de 1,8 m con 10 sillas) o imperial (larga con 10 sillas)"),
  ancho_cm: z.number().optional().describe("ancho del salón (300–3000). Si no dices ancho ni fondo: se usa la sala actual si caben las mesas, y si no se arma la más chica que cabe"),
  fondo_cm: z.number().optional().describe("fondo del salón (300–3000)"),
  zonas: z.array(Zona).max(5).optional().describe(`zonas a armar (todas con 60 o más invitados; con menos, fondo_fotos y mesa_postres): ${TEXTO_ZONAS}`),
  colores: z.array(z.string().min(1).max(40)).max(3).optional().describe("mantel, sillas y cojines, en ese orden (nombre común o #rrggbb)"),
  reemplazar: z.boolean().optional().describe("true: rehace un salón que ya está armado (quita solo sus piezas salon-…; las tuyas se quedan)"),
});

const AjustarSchema = z.object({
  invitados: z.number().int().min(1).max(MAX_INVITADOS_SALON).optional().describe("nuevo total de invitados: agrega o quita mesas del final de la cuadrícula; las de adelante no se mueven"),
  mesa: Mesa.optional().describe("cambia el tipo de todas las mesas de invitados (redonda8, redonda10, imperial), con sus colores"),
  ancho_cm: z.number().optional().describe("nuevo ancho de la sala (300–3000); cada zona se corre con su pared"),
  fondo_cm: z.number().optional().describe("nuevo fondo de la sala (300–3000)"),
  agregar_zonas: z.array(Zona).max(5).optional().describe(`zonas que faltan y se arman (no se quita ninguna): ${TEXTO_ZONAS}`),
});

const MoverSchema = z.object({
  zona: Zona,
  x_cm: z.number().optional().describe("centro de la zona, izquierda (−) a derecha (+) desde el centro de la sala"),
  z_cm: z.number().optional().describe("centro de la zona, fondo (−) a frente (+); la pared del fondo está en z = −fondo/2"),
});

const QuitarSchema = z.object({ zona: z.enum([...ZONAS_SALON, "mesas"]).describe("la zona a quitar, o mesas = todas las mesas de invitados") });

/** Los colores pedidos como `#rrggbb`; uno que no se reconoce se salta con aviso (no se tumba el salón por un color). */
export function coloresDeMuebles(pedidos: readonly string[] | undefined, notas: string[]): string[] {
  const salida: string[] = [];
  for (const c of pedidos ?? []) {
    try { salida.push(hexDeColor(c, notas)); } catch { notas.push(`No reconocí el color «${c}» para los muebles: usé los de siempre desde ahí.`); break; }
  }
  return salida;
}

const unir = (resumen: string, notas: readonly string[]) => [resumen, ...new Set(notas)].join(" ");

export const HERRAMIENTAS_SALON: Readonly<Record<string, HerramientaExtra>> = {
  armar_salon: {
    esquema: ArmarSchema,
    descripcion: "Arma el SALÓN de un evento (boda, XV, fiesta): las mesas de invitados con sus sillas en cuadrícula con pasillos (una pieza por mesa), la mesa principal, la pista de baile libre, la mesa de postres, el panel del fondo de fotos y el tapete de la entrada, todo dentro de la sala; la agranda a lo que necesite (hasta 30 × 30 m). Conserva lo que ya había (la decoración se corre al fondo de fotos). Con invitados = 0 y zonas arma solo esas zonas («solo un rincón de postres»). Para un evento completo con globos usa planificar_evento. Después: ajustar_salon, mover_zona, quitar_zona.",
    aplicar: (escena, argumentos) => {
      const a = ArmarSchema.parse(argumentos ?? {});
      const notas: string[] = [];
      const r = armarSalon(escena, { invitados: a.invitados, mesa: a.mesa, anchoCm: a.ancho_cm, fondoCm: a.fondo_cm, zonas: a.zonas, colores: coloresDeMuebles(a.colores, notas), reemplazar: a.reemplazar }, notas);
      const perdidos = centrosPerdidos(escena, r.escena);
      if (perdidos) notas.push(`${perdidos} centro(s) de mesa del salón anterior se fueron con sus mesas: vuelve a ponerlos con decorar_mesas.`);
      return { escena: r.escena, resumen: unir(r.resumen, notas) };
    },
  },
  ajustar_salon: {
    esquema: AjustarSchema,
    descripcion: "Cambia un salón ya armado SIN rehacerlo ni tocar tus piezas: más o menos invitados (agrega o quita mesas del final), otro tipo de mesa, sala más grande o más chica, o una zona que faltaba. Sirve para «ahora son 60», «mejor mesas imperiales», «el salón de 12 × 18», «agrega la pista».",
    aplicar: (escena, argumentos) => {
      const a = AjustarSchema.parse(argumentos ?? {});
      if (a.invitados === undefined && !a.mesa && a.ancho_cm === undefined && a.fondo_cm === undefined && !a.agregar_zonas?.length) fallar("Dime qué cambiar: invitados, mesa, ancho_cm, fondo_cm o agregar_zonas.");
      const notas: string[] = [];
      const r = ajustarSalon(escena, { invitados: a.invitados, mesa: a.mesa, anchoCm: a.ancho_cm, fondoCm: a.fondo_cm, agregarZonas: a.agregar_zonas }, notas);
      return { escena: sincronizarCentros(escena, r.escena, notas), resumen: unir(r.resumen, notas) };
    },
  },
  mover_zona: {
    esquema: MoverSchema,
    descripcion: "Mueve una zona del salón (pista, mesa principal con sus sillas, mesa de postres, fondo de fotos con su arco, entrada) a otro centro, con todo lo suyo. Avisa si queda encima de mesas.",
    aplicar: (escena, argumentos) => {
      const a = MoverSchema.parse(argumentos ?? {});
      return moverZona(escena, a.zona, a.x_cm, a.z_cm);
    },
  },
  quitar_zona: {
    esquema: QuitarSchema,
    descripcion: "Quita una zona del salón con lo suyo (y lo que estaba sobre ella): pista, mesa principal, postres, fondo de fotos, entrada o todas las mesas de invitados. El resto no se mueve.",
    aplicar: (escena, argumentos) => {
      const a = QuitarSchema.parse(argumentos ?? {});
      return quitarZona(escena, a.zona);
    },
  },
};
