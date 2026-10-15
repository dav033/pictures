import { z } from "zod";

const chargeModeSchema = z.enum(["per_person", "unit", "event"]);
const saleUnitSchema = z.object({ singular: z.string(), plural: z.string() });

export const packageItemSchema = z.object({
  id: z.string().min(1),
  total: z.number().finite().nonnegative(),
  is_active: z.boolean(),
  package_id: z.string().min(1),
  charge_type: z.string(),
  // La API real de Happia devuelve `null` en la mayoría de los ítems — no es
  // un caso raro, es el estado normal de "sin descripción". Antes exigía
  // string y toda llamada a listarPackages() fallaba con un ZodError,
  // devolviendo 503 en los tres webhooks sin ninguna pista visible (por
  // diseño, el catch de webhook-control.ts nunca loguea el error real).
  description: z.string().nullable(),
  suggested_start_time: z.string().nullable(),
  provider_name: z.string().nullable(),
  category_name: z.string().nullable(),
  charge_mode: chargeModeSchema.optional(),
  quantity_editable: z.boolean().optional(),
  sale_unit: saleUnitSchema.nullable().optional(),
  removable: z.boolean().optional(),
}).passthrough();

export const packageSchema = z.object({
  id: z.string().min(1),
  event_type_id: z.string().min(1),
  name: z.string().min(1),
  base_guests: z.number().int().positive(),
  standard_duration_minutes: z.number().int().positive().nullable(),
  conditions: z.string().nullable(),
  restrictions: z.string().nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  package_items: z.array(packageItemSchema),
  city: z.string().optional(),
  city_slug: z.string().optional(),
}).passthrough();

export const servicioSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  description: z.string().nullable(),
  total: z.number().finite().nonnegative(),
  charge_type: z.enum(["total", "per_person"]),
  charge_mode: chargeModeSchema,
  quantity_editable: z.boolean(),
  sale_unit: saleUnitSchema.nullable(),
  has_delivery: z.boolean(),
  image_url: z.string().nullable(),
  image_focus: z.string(),
  category_name: z.string(),
  provider_name: z.string(),
  city: z.string(),
  city_slug: z.string(),
  rating: z.object({ average: z.number().finite(), count: z.number().int().nonnegative() }).nullable(),
}).passthrough();

const paginacionSchema = z.object({
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  currentPage: z.number().int().positive(),
});

/** `{ status, data, pagination }`: the same three keys on success and on error. */
export function envolturaSchema<T extends z.ZodType>(item: T) {
  return z.object({
    status: z.string(),
    data: z.array(item).nullable(),
    pagination: paginacionSchema.nullable(),
  });
}

/** Only the `status` message of an error envelope; anything else is treated as opaque. */
export const envolturaErrorSchema = z.object({ status: z.string().min(1).max(200) });
