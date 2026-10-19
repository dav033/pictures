import { configuracionAlmacen, crearClienteAlmacen, type ClienteAlmacen } from "@/lib/almacen/objetos-s3";
import { getRagPool } from "@/lib/rag/db";
import { avisar, decidir, registrarError, versionCodigo } from "@/lib/registro/servidor";
import { crearLimitador, type Limitador } from "./acceso";
import type { ResultadoAgregacion } from "./analisis";
import { leerPasosAuditoria } from "./pasos-auditoria";
import type { BaseDatos } from "./repositorio";
import type { ResumenGemini } from "./resumen-gemini";
import type { DependenciasServicio } from "./servicio";

/** Todo lo que las rutas de /api/feedback-ia necesitan del exterior, inyectable para probarlas sin base, S3 ni sesión. */
export type DependenciasRutas = {
  db: () => BaseDatos;
  /** `null` si el almacén S3 no está configurado. */
  almacen: () => ClienteAlmacen | null;
  servicio: () => DependenciasServicio;
  /** Resume con Gemini Flash (coste acotado); no se carga hasta que se pide. */
  resumir: (resultado: ResultadoAgregacion, dias: number) => Promise<ResumenGemini | null>;
  resumenAutomaticoActivo: () => boolean;
  limitadorRegistro: Limitador;
  /** Lecturas (GET de calificaciones guardadas) por IP: la página las pide al cargar, pero no sin tope. */
  limitadorConsulta: Limitador;
  limitadorCaptura: Limitador;
  /** Tope diario de capturas por IP: el tope por minuto solo no frena el goteo sostenido. */
  limitadorCapturaDiario: Limitador;
  /** Los análisis con Gemini son de pago: pocos por hora. */
  limitadorResumenGemini: Limitador;
  avisar: (evento: string, datos: unknown) => void;
  auditar: (quien: string, que: string, resultado: unknown) => void;
  registrarFallo: (evento: string, error: unknown) => void;
};

const POR_MINUTO_REGISTRO = 120;
const POR_MINUTO_CONSULTA = 240;
const POR_MINUTO_CAPTURA = 30;
const CAPTURAS_POR_DIA = 300;
const RESUMENES_POR_HORA = 5;

const limitadorRegistro = crearLimitador(POR_MINUTO_REGISTRO);
const limitadorConsulta = crearLimitador(POR_MINUTO_CONSULTA);
const limitadorCaptura = crearLimitador(POR_MINUTO_CAPTURA);
const limitadorCapturaDiario = crearLimitador(CAPTURAS_POR_DIA, 24 * 60 * 60 * 1000);
const limitadorResumenGemini = crearLimitador(RESUMENES_POR_HORA, 60 * 60 * 1000);

export function dependenciasReales(): DependenciasRutas {
  return {
    db: () => getRagPool(),
    almacen: () => {
      const config = configuracionAlmacen();
      return config ? crearClienteAlmacen(config) : null;
    },
    servicio: () => ({ db: getRagPool(), leerPasos: leerPasosAuditoria, versionApp: () => versionCodigo().corta }),
    resumir: async (resultado, dias) => (await import("./resumen-gemini")).resumirConGemini(resultado, dias),
    resumenAutomaticoActivo: () => process.env.FEEDBACK_IA_RESUMEN_GEMINI === "1",
    limitadorRegistro,
    limitadorConsulta,
    limitadorCaptura,
    limitadorCapturaDiario,
    limitadorResumenGemini,
    avisar: (evento, datos) => avisar(evento, datos),
    auditar: (quien, que, resultado) => decidir(quien, que, resultado),
    registrarFallo: (evento, error) => registrarError(evento, error),
  };
}
