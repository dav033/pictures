import { configuracionAlmacen, crearClienteAlmacen, type ClienteAlmacen } from "@/lib/almacen/objetos-s3";
import { getRagPool } from "@/lib/rag/db";
import { decidir, registrarError, versionCodigo } from "@/lib/registro/servidor";
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
  limitadorCaptura: Limitador;
  auditar: (quien: string, que: string, resultado: unknown) => void;
  registrarFallo: (evento: string, error: unknown) => void;
};

const POR_MINUTO_REGISTRO = 120;
const POR_MINUTO_CAPTURA = 30;

const limitadorRegistro = crearLimitador(POR_MINUTO_REGISTRO);
const limitadorCaptura = crearLimitador(POR_MINUTO_CAPTURA);

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
    limitadorCaptura,
    auditar: (quien, que, resultado) => decidir(quien, que, resultado),
    registrarFallo: (evento, error) => registrarError(evento, error),
  };
}
