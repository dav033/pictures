export type MetadatosExportacionGlb = { nombre: string; globos: number; piezas: number };

export type ExportadoresEscena = {
  exportarPng: () => Promise<Blob>;
  exportarGlb: (metadatos: MetadatosExportacionGlb) => Promise<Blob>;
};
