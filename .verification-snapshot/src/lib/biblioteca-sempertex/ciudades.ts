import proveedoresRaw from "./proveedores.json";

/**
 * Ciudades con decoradores, distribuidores o tienda en el directorio, en el orden en que aparecen (Bogotá, Medellín, Cali,
 * Barranquilla). Apto para el cliente: solo lee el JSON, sin validar ni tocar el entorno.
 */
export const CIUDADES_PROVEEDORES: readonly string[] = Object.freeze([
  ...new Set((proveedoresRaw as ReadonlyArray<{ zona: { ciudad: string } }>).map((proveedor) => proveedor.zona.ciudad)),
]);
