import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prepareAdvisorPhoto } from "../photos";
import { personalizedBriefRows, type PersonalizedBrief } from "./brief";

/** Render the approved facts and their selected reference photos into a self-contained PDF. */
export async function createPersonalizedPdf(brief: PersonalizedBrief, photos: Array<{ mimeType: string; data: Buffer }>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]);
  let y = 795;
  // Helvetica cannot encode every Unicode symbol. Preserve unsupported code points explicitly
  // instead of silently replacing customer-provided content with an indistinguishable question mark.
  const safe = (text: string) => Array.from(text).map((c) => { if (c === "\n") return c; try { font.encodeText(c); return c; } catch { return `[U+${c.codePointAt(0)?.toString(16).toUpperCase()}]`; } }).join("");
  const line = (text: string, size = 11, strong = false) => {
    const selected = strong ? bold : font;
    const draw = (value: string) => {
      if (y < 55) { page = document.addPage([595, 842]); y = 795; }
      page.drawText(value, { x: 55, y, size, font: selected, color: rgb(0.18, 0.16, 0.22) }); y -= size + 5;
    };
    let buffer = "";
    for (const character of safe(text)) {
      if (character === "\n") { if (buffer) draw(buffer); else y -= size + 5; buffer = ""; continue; }
      if (selected.widthOfTextAtSize(buffer + character, size) > 485 && buffer) { draw(buffer); buffer = character; }
      else buffer += character;
    }
    if (buffer) draw(buffer);
  };
  line("Happia · Brief de evento personalizado", 19, true); y -= 12;
  for (const row of personalizedBriefRows(brief)) { line(row.label, 11, true); line(row.value); y -= 7; }
  if (photos.length) { y -= 10; line("Imágenes de referencia", 15, true); }
  for (const photo of photos) {
    const prepared = await prepareAdvisorPhoto(photo.mimeType, photo.data);
    const image = await document.embedJpg(prepared.derivative);
    const scale = Math.min(485 / image.width, 300 / image.height, 1);
    const width = image.width * scale; const height = image.height * scale;
    if (y - height < 50) { page = document.addPage([595, 842]); y = 795; }
    page.drawImage(image, { x: 55, y: y - height, width, height }); y -= height + 20;
  }
  return document.save();
}
