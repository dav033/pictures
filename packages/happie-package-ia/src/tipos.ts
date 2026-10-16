export type HappiaChargeMode = "per_person" | "unit" | "event";

export interface HappiaSaleUnit {
  singular: string;
  plural: string;
}

export interface HappiaPackageItem {
  id: string;
  total: number;
  is_active: boolean;
  package_id: string;
  charge_type: string;
  description: string | null;
  suggested_start_time: string | null;
  provider_name: string | null;
  category_name: string | null;
  // Additive fields (2026-10-13). Optional so a deployment that has not shipped them yet still parses.
  charge_mode?: HappiaChargeMode;
  quantity_editable?: boolean;
  sale_unit?: HappiaSaleUnit | null;
  removable?: boolean;
}

export interface HappiaPackage {
  id: string;
  event_type_id: string;
  name: string;
  base_guests: number;
  standard_duration_minutes: number | null;
  conditions: string | null;
  restrictions: string | null;
  is_active: boolean;
  is_featured: boolean;
  package_items: HappiaPackageItem[];
  city_id?: string;
  city?: string;
  city_slug?: string;
}

export interface ListarPackagesRespuesta {
  packages: HappiaPackage[];
}

/** One bookable service from `GET /api/services` (always these 16 keys). */
export interface HappiaServicio {
  id: string;
  name: string | null;
  description: string | null;
  total: number;
  charge_type: "total" | "per_person";
  charge_mode: HappiaChargeMode;
  quantity_editable: boolean;
  sale_unit: HappiaSaleUnit | null;
  has_delivery: boolean;
  image_url: string | null;
  image_focus: string;
  category_name: string;
  provider_name: string;
  city: string;
  city_slug: string;
  rating: { average: number; count: number } | null;
}

export interface HappiaPaginacion {
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

export interface HappiaPagina<T> {
  items: T[];
  pagination: HappiaPaginacion;
}

export interface HappiaConsultaPagina {
  page?: number;
  limit?: number;
  /** City slug (lowercase, no accents), e.g. `barranquilla`. */
  city_id?: string;
  city?: string;
  signal?: AbortSignal;
}
