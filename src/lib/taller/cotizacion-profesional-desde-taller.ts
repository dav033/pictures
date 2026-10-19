import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { Escena } from "@/lib/globos3d/escena";
import type { MaterialDecoracion } from "@/lib/globos3d/figuras";
import type { ResumenHelio } from "@/lib/globos3d/helio-cinta";
import type { CotizacionTallerV2 } from "./cotizacion-taller-tipos";

/** Convierte el contrato v2 del Taller en la cotización que ya consume el editor profesional. No calcula precios. */
export function cotizacionProfesionalDesdeTaller(taller: CotizacionTallerV2): Cotizacion {
  return {
    lineas: taller.lineas.map((linea) => ({
      id: linea.id,
      productId: linea.productId,
      tamano: linea.tamano,
      tamanoCodigo: linea.tamanoCodigo,
      ...(linea.color ? { color: linea.color } : {}),
      cantidadNecesaria: linea.cantidadNecesaria,
      disponible: linea.disponible,
      varianteId: linea.varianteId,
      nombre: linea.nombre,
      precioPaquete: linea.precioPaquete,
      unidadesPaquete: linea.unidadesPaquete,
      paquetes: linea.paquetes,
      subtotal: linea.subtotal,
      sobrante: linea.sobrante,
    })),
    total: taller.total,
    mermaPorcentaje: taller.mermaPorcentaje,
    incluyeIva: taller.incluyeIva,
    complementosSoportados: taller.complementosSoportados,
  };
}

/** Identidad compacta de escena para marcar cotizaciones viejas y separar sus borradores locales. */
export function claveDeCotizacionTaller(datos: { nombre: string; escena: Escena; materiales: ReadonlyArray<MaterialDecoracion>; helio: ResumenHelio | null }): string {
  const texto = JSON.stringify(datos);
  let a = 2_166_136_261;
  let b = 2_654_435_761;
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    a = Math.imul(a ^ codigo, 16_777_619);
    b = Math.imul(b ^ codigo, 2_246_822_519);
  }
  // No es un token ni una medida de seguridad: solo evita guardar toda la escena en el id del panel y en sessionStorage.
  return `taller-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
