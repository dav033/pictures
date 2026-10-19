/**
 * Animación de vuelo (maqueta EstadoInicial): una copia de la miniatura
 * elegida viaja desde la galería hasta su chip en el compositor. Es solo
 * decoración: con prefers-reduced-motion, o si falta el origen o el destino,
 * no hace nada y el chip aparece igual.
 */
export function volarFoto(origen: HTMLImageElement | null, destino: Element | null): void {
  if (!origen || !destino || typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const desde = origen.getBoundingClientRect();
  const hasta = destino.getBoundingClientRect();
  if (desde.width === 0 || hasta.width === 0) return;

  const copia = document.createElement("img");
  copia.src = origen.currentSrc || origen.src;
  copia.alt = "";
  copia.setAttribute("aria-hidden", "true");
  copia.className = "foto-en-vuelo";
  Object.assign(copia.style, { left: `${hasta.left}px`, top: `${hasta.top}px`, width: `${hasta.width}px`, height: `${hasta.height}px`, transformOrigin: "top left" });
  document.body.appendChild(copia);

  const escala = desde.width / hasta.width;
  const dx = desde.left - hasta.left;
  const dy = desde.top - hasta.top;
  const animacion = copia.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${escala})`, opacity: 1, borderRadius: "1rem" },
      { transform: "translate(0, 0) scale(1)", opacity: 1, borderRadius: "0.5rem", offset: 0.85 },
      { transform: "translate(0, 0) scale(1)", opacity: 0, borderRadius: "0.5rem" },
    ],
    { duration: 650, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
  );
  const quitar = () => copia.remove();
  animacion.addEventListener("finish", quitar);
  animacion.addEventListener("cancel", quitar);
}
