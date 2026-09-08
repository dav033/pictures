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
}

export interface ListarPackagesRespuesta {
  packages: HappiaPackage[];
}
