export type FormatoArchivoEscena = "png" | "glb";

export function nombreArchivoEscena(nombre: string, formato: FormatoArchivoEscena): string {
  const seguro = nombre
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  const base = !seguro || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(seguro) ? "escena-3d" : seguro;
  return formato === "png" ? `${base}-3000px.png` : `${base}.glb`;
}

export function descargarArchivoLocal(blob: Blob, nombre: string): void {
  if (blob.size === 0) throw new Error("El archivo exportado está vacío.");
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.style.display = "none";
  document.body.append(enlace);
  try {
    enlace.click();
  } finally {
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
