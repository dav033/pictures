import { zonaDeCroquis } from "@/lib/plan/croquis-zona";
import { paletaMedida, type Pixel } from "@/lib/plan/paleta-medida";
import { cruzarColor, codigosPorPalabras, CODIGOS_POR_NOMBRE_EN } from "@/lib/plan/referencia-sempertex";
import { acabadoObservado } from "@/lib/plan/acabado-observado";
import {
  ANALISIS_COLOR_VERSION,
  type AnalisisColorSempertex,
  type ColorConReferencia,
  type ColorDePieza,
} from "@/lib/plan/analisis-color";
import { decodificarPixeles } from "./decodificar-pixeles";
import { equilibrarMuestra } from "@/lib/plan/balance-blancos";
import type { MuestraPixeles } from "@/lib/plan/dominancia-color";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";

/**
 * Los colores de cada pieza detectada, cruzados con una referencia del catálogo Sempertex y su Pantone.
 *
 * Corre **después** de la detección y sobre la misma foto: para cada elemento del blueprint recorta su caja,
 * le aplica el croquis de su tipo de estructura (`croquis-zona.ts`), saca de 2 a 5 colores de esos píxeles
 * (`paleta-medida.ts`) y cruza cada uno contra el color del globo inflado de las 90 referencias
 * (`referencia-sempertex.ts`).
 *
 * **No decide nada.** El resultado viaja fuera del blueprint, así que no entra en ningún contrato, no llega a
 * Python y no toca el `plan_hash`: es un bloque para mirar mientras se decide si el color medido debe
 * reemplazar las etiquetas de texto del analizador en lo que un plan compra. Quien lo quiera usar para comprar
 * tiene que cambiar `colores-referencia.ts`, y eso sí mueve dinero.
 *
 * Nunca rompe el análisis: una foto que no se puede decodificar o una caja sin píxeles suficientes deja a esa
 * pieza sin color medido y lo dice en sus avisos.
 */


/** Candidatas por color. Tres, porque 37 de las 90 referencias tienen otra a menos de ΔE 10. */
const CANDIDATAS = 3;

/**
 * El croquis (paso 2) recorta, dentro de la caja de cada pieza, la forma típica de su tipo de estructura —un
 * anillo para el arco, una franja para la columna, una elipse para un bouquet— para no medir la pared.
 *
 * Es aproximado y se sabe: una columna conserva el 82 % de su caja, así que recorta poco, y en una pieza
 * orgánica deja fuera los globos que se salen del contorno. Se queda puesto porque es el paso donde se ataca
 * el fondo de raíz; apagarlo es poner esto en `false` y medir la caja entera.
 */
const USAR_CROQUIS = true;

/** Los píxeles de la caja de una pieza que caen dentro de su croquis. */
function pixelesDeLaPieza(
  muestra: MuestraPixeles,
  caja: { x: number; y: number; width: number; height: number },
  dentro: (u: number, v: number) => boolean,
): { pixeles: Pixel[]; deLaCaja: number } {
  const desdeX = Math.max(0, Math.floor(caja.x * muestra.ancho));
  const desdeY = Math.max(0, Math.floor(caja.y * muestra.alto));
  const hastaX = Math.min(muestra.ancho, Math.ceil((caja.x + caja.width) * muestra.ancho));
  const hastaY = Math.min(muestra.alto, Math.ceil((caja.y + caja.height) * muestra.alto));
  const ancho = Math.max(1, hastaX - desdeX);
  const alto = Math.max(1, hastaY - desdeY);
  const pixeles: Pixel[] = [];
  for (let y = desdeY; y < hastaY; y++) {
    for (let x = desdeX; x < hastaX; x++) {
      const u = (x - desdeX + 0.5) / ancho;
      const v = (y - desdeY + 0.5) / alto;
      if (!dentro(u, v)) continue;
      const i = (y * muestra.ancho + x) * 3;
      pixeles.push({ r: muestra.rgb[i], g: muestra.rgb[i + 1], b: muestra.rgb[i + 2] });
    }
  }
  return { pixeles, deLaCaja: ancho * alto };
}

/**
 * Junta los colores medidos que cruzan a **la misma referencia**: son el mismo globo visto con distinta luz.
 *
 * Un globo cromado se reparte solo en varios grupos —el reflejo, el cuerpo y la caída oscura—, y sin esto un
 * árbol hecho todo de dorado cromado salía como cinco marrones distintos. Lo que interesa saber es qué globos
 * lleva la pieza, no en cuántos tonos se reparte su luz, así que cada referencia aparece **una vez**, con la
 * suma de lo que ocupa.
 *
 * Se queda el color medido del grupo más grande (es un color real de la foto, no un promedio de promedios) y el
 * cruce del que mejor se parecía. Lo que no cruzó con ninguna referencia **no es un color de la pieza** —es
 * sombra, un mueble o el fondo— y se cae de la lista, dejándolo dicho en los avisos.
 */
function unirPorReferencia(colores: readonly ColorConReferencia[]): {
  colores: ColorConReferencia[];
  avisos: string[];
} {
  const avisos: string[] = [];
  /**
   * **Cada color medido se queda con la referencia más cercana.** No se descarta ninguno.
   *
   * Antes solo se listaban los colores cuya etiqueta el analizador había escrito con el nombre exacto de la
   * lámina. Era demasiado estricto por el lado que no toca: un arco verde oscuro, verde lima y blanco salía
   * con **un solo color**, el blanco, porque el catálogo no llama a sus verdes «forest green» ni «light
   * green». Y el color exacto no se puede sacar de una foto —hay luz, sombra, oclusión entre globos y una
   * cámara de por medio—, así que exigirlo era exigir lo imposible.
   *
   * Lo que sí hace falta es no llenar la pantalla con la pared, la mesa y el mismo globo contado tres veces.
   * De eso se encargan los pasos de antes, que son los que saben: el croquis recorta la zona de la pieza,
   * `paleta-medida` descarta lo que ocupa menos del 6 % y topa en cinco colores, y aquí se juntan los grupos
   * que caen en la misma referencia, que son el mismo globo con otra luz.
   *
   * Lo que el analizador **sí** nombró sigue teniendo ventaja: `cruzarColor` pone esa referencia delante
   * cuando los píxeles la admiten, porque el acabado solo lo ve el modelo. Lo que cambia es que ya no es un
   * requisito para existir.
   */
  const porCodigo = new Map<string, ColorConReferencia>();
  for (const color of colores) {
    const codigo = color.cruce.candidatas[0].codigo;
    const previo = porCodigo.get(codigo);
    if (!previo) {
      porCodigo.set(codigo, { ...color });
      continue;
    }
    // Representa el grupo que **mejor** cruzó, no el más grande: el color de la sombra con la etiqueta
    // «Dorado» al lado engaña a quien lo mira, aunque la sombra ocupe más.
    const mejor =
      color.cruce.candidatas[0].distancia < previo.cruce.candidatas[0].distancia ? color : previo;
    porCodigo.set(codigo, {
      hex: mejor.hex,
      parte: Math.round((previo.parte + color.parte) * 1e4) / 1e4,
      pixeles: previo.pixeles + color.pixeles,
      cruce: mejor.cruce,
    });
  }
  const unidos = [...porCodigo.values()].sort((a, b) => b.parte - a.parte);
  const juntados = colores.length - unidos.length;
  if (juntados > 0) {
    avisos.push(
      juntados === 1
        ? "Un color era el mismo globo visto con otra luz y se juntó con el suyo."
        : `${juntados} colores eran el mismo globo visto con otra luz y se juntaron con el suyo.`,
    );
  }
  // Un color que ninguna referencia alcanza de cerca se lista igual, con la más cercana, pero se dice: es la
  // diferencia entre «es este globo» y «el que más se le parece de los que se venden».
  const lejanos = unidos.filter((c) => c.cruce.sinReferencia);
  if (lejanos.length > 0) {
    avisos.push(
      lejanos.length === 1
        ? "Un color no tiene un globo igual en el catálogo."
        : `${lejanos.length} colores no tienen un globo igual en el catálogo.`,
    );
  }
  return { colores: unidos, avisos };
}

export async function medirColoresSempertex(
  blueprint: ReferenceBlueprintV2,
  imagenes: readonly ImagenEtiquetada[],
): Promise<AnalisisColorSempertex> {
  const porImagen = new Map<string, MuestraPixeles>();
  for (const imagen of imagenes) {
    // Una sola decodificación por foto aunque tenga ocho piezas.
    if (porImagen.has(imagen.id)) continue;
    try {
      // En luz blanca: el cruce compara contra globos fotografiados así (`balance-blancos.ts`).
      porImagen.set(imagen.id, equilibrarMuestra(await decodificarPixeles(Buffer.from(imagen.base64, "base64")), blueprint.elements, imagen.id).muestra);
    } catch (error) {
      console.warn("[color-sempertex] no se pudo decodificar una referencia", {
        image_id: imagen.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const piezas: ColorDePieza[] = [];
  for (const elemento of blueprint.elements) {
    // Solo las piezas de globos. Una cortina, una mesa o un mueble también tienen color, pero no se compran en
    // el catálogo de Sempertex, y listarlos llenaba la pantalla de piezas que no son del diseño.
    if (elemento.category !== "balloon_structure") continue;
    const muestra = porImagen.get(elemento.source_image_id);
    // El tipo del plan que el reconocedor le puso a la pieza (`STRUCTURE_TYPE_MAP`). Un aro llega como
    // `arco`, así que se recorta con el anillo del arco y no con el del aro: es lo que dice el blueprint.
    const tipo = elemento.visual_semantics?.structure_type ?? "";
    const zona = zonaDeCroquis(tipo);
    if (!muestra) {
      piezas.push({
        elementId: elemento.element_id,
        tipo,
        croquis: { forma: zona.forma, parteDeLaCaja: zona.parteDeLaCaja },
        pixeles: { medidos: 0, deLaCaja: 0 },
        colores: [],
        avisos: ["No se pudo leer la foto de esta pieza."],
      });
      continue;
    }
    const { pixeles, deLaCaja } = pixelesDeLaPieza(
      muestra,
      elemento.reference_bbox,
      USAR_CROQUIS ? zona.dentro : () => true,
    );
    const paleta = paletaMedida(pixeles);
    const acabado = acabadoObservado(elemento.appearance.observed_colors, CODIGOS_POR_NOMBRE_EN, codigosPorPalabras);
    // El acabado no se puede sacar de los píxeles —un dorado cromado y un café mate tienen casi el mismo color
    // promedio—, pero el analizador ya lo escribió («chrome gold», «matte white»). Con eso se restringe la
    // familia antes de cruzar, que es lo que distingue un Reflex de un Fashion.
    const cruzados = paleta.colores.map((color) => ({
      ...color,
      cruce: cruzarColor(color.hex, {
        cuantas: CANDIDATAS,
        familias: acabado.familias,
        nombradas: acabado.nombradas.flatMap((n) => n.codigos),
      }),
    }));
    const { colores, avisos } = unirPorReferencia(cruzados);
    piezas.push({
      elementId: elemento.element_id,
      tipo,
      croquis: USAR_CROQUIS
        ? { forma: zona.forma, parteDeLaCaja: zona.parteDeLaCaja }
        : { forma: "la caja entera (croquis descableado)", parteDeLaCaja: 1 },
      pixeles: { medidos: paleta.pixeles, deLaCaja },
      colores,
      avisos: [
        ...paleta.avisos,
        ...avisos,
        ...(acabado.familias.length || acabado.nombradas.length
          ? []
          : ["No se distingue el acabado en la foto: un globo cromado podría confundirse con uno mate."]),
      ],
    });
  }
  return { version: ANALISIS_COLOR_VERSION, piezas };
}
