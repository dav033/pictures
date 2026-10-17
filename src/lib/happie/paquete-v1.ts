import type { HappiaPackage } from "@sempertex/happie-package-ia";
import type { z } from "zod";
import type { HappiePackageV1Schema } from "@/lib/ia/contracts/happie-v1";

type PaqueteV1 = z.infer<typeof HappiePackageV1Schema>;

/** Text the strict contract can carry: blank becomes `null` (the API sends "" for some provider names). */
const textoOnull = (valor: string | null): string | null => (valor && valor.trim() ? valor : null);

/**
 * Projects a Happia package to exactly the `happie.v1` shape. Happia adds fields over time (city, charge_mode,
 * sale_unit, removable...) and the response contract is strict, so the pick is explicit instead of passing the raw
 * object through: a new upstream field must never turn every recommendation into a 502.
 */
export function aPaqueteV1(paquete: HappiaPackage): PaqueteV1 {
  return {
    id: paquete.id,
    event_type_id: paquete.event_type_id,
    name: paquete.name,
    base_guests: paquete.base_guests,
    standard_duration_minutes: paquete.standard_duration_minutes,
    conditions: paquete.conditions,
    restrictions: paquete.restrictions,
    is_active: paquete.is_active,
    is_featured: paquete.is_featured,
    package_items: paquete.package_items.map((item) => ({
      id: item.id,
      total: item.total,
      is_active: item.is_active,
      package_id: item.package_id,
      charge_type: item.charge_type,
      description: textoOnull(item.description),
      suggested_start_time: item.suggested_start_time,
      provider_name: textoOnull(item.provider_name),
      category_name: textoOnull(item.category_name),
    })),
  };
}

/** Same shape the recommender returns, with every package projected to `happie.v1`. */
export function recomendacionesV1<T extends { paquete: HappiaPackage }>(recomendaciones: T[]): Array<Omit<T, "paquete"> & { paquete: PaqueteV1 }> {
  return recomendaciones.map((r) => ({ ...r, paquete: aPaqueteV1(r.paquete) }));
}
