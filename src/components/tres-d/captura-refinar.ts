import { armarEscena, type Escena } from "@/lib/globos3d/escena";
import type { FotoAdjuntaIA } from "@/lib/globos3d/cuerpo-escena-ia";
import { medidasCaptura, salaParaFoto, type Encuadre } from "@/lib/globos3d/encuadre-foto";
import { mostrarArmada } from "./armada-visor";
import { exigirLetraDeRotulos } from "./fuente-rotulos";
import { camaraDeFoto } from "./camara-foto";

/**
 * **Captura de la escena para compararla con la foto** (REQ-001 paso 9): dibuja la escena en un visor propio, fuera de
 * pantalla (no depende de la pestaña ni del encuadre del visor del taller, ni lo mueve), con la cámara de la foto
 * (`camara-foto.ts`), y devuelve un JPEG de a lo más `ladoMax` px. Es el mismo código en el navegador del taller y en la
 * página de captura que usa la evaluación sin cabeza (`scripts/exp/evaluar-foto-a-escena.ts`).
 */

export const LADO_CAPTURA_REFINAR = 1024;
const ESPERA_CUADRO_MS = 150;

/** Espera a que el navegador pinte un cuadro (o un tiempo corto: una pestaña en segundo plano no pinta). */
const esperarCuadro = () => new Promise<void>((resolver) => { const reloj = setTimeout(resolver, ESPERA_CUADRO_MS); requestAnimationFrame(() => { clearTimeout(reloj); resolver(); }); });

export async function capturarEscenaParaRefinar(escena: Escena, encuadre: Encuadre, ladoMax = LADO_CAPTURA_REFINAR): Promise<FotoAdjuntaIA> {
  const { ancho, alto } = medidasCaptura(encuadre.aspecto, ladoMax);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  Object.assign(lienzo.style, { position: "fixed", left: "-99999px", top: "0", width: `${ancho}px`, height: `${alto}px`, pointerEvents: "none" });
  lienzo.setAttribute("aria-hidden", "true");
  document.body.appendChild(lienzo);
  const { crearEscena } = await import("./escena-globos");
  const visor = crearEscena(lienzo);
  try {
    const armada = armarEscena(escena);
    // La letra de los rótulos tiene que estar cargada antes de dibujar: si no, la captura que va a la IA saldría con marcas.
    await exigirLetraDeRotulos(armada.solidos);
    const sala = salaParaFoto(armada.sala, encuadre);
    mostrarArmada(visor, armada, sala);
    await esperarCuadro();
    visor.dibujar();
    const datos = visor.renderFoto(camaraDeFoto(encuadre, sala), ancho, alto);
    return { mime: "image/jpeg", base64: datos.slice(datos.indexOf(",") + 1) };
  } finally {
    visor.destruir();
    lienzo.remove();
  }
}
