from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "propuesta-lora-sempertex-pagina-01-final.pdf"
PREVIEW = ROOT / "docs" / "propuesta-lora-sempertex-pagina-01-final-preview.png"

W, H = A4
M = 48

INK = HexColor("#142F35")
TEAL = HexColor("#087F78")
TEAL_LIGHT = HexColor("#E8F5F2")
ORANGE = HexColor("#E6763D")
ORANGE_LIGHT = HexColor("#FFF1E9")
GRAY = HexColor("#63757A")
LINE = HexColor("#D7E4E2")
PAPER = HexColor("#FCFDFC")


def register_fonts() -> None:
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists():
        pdfmetrics.registerFont(TTFont("Sempertex", str(regular)))
    if bold.exists():
        pdfmetrics.registerFont(TTFont("Sempertex-Bold", str(bold)))


def f(bold: bool = False) -> str:
    return "Sempertex-Bold" if bold else "Sempertex"


def txt(c: canvas.Canvas, value: str, x: float, y: float, size: float,
        color=INK, bold: bool = False) -> None:
    c.setFillColor(color)
    c.setFont(f(bold), size)
    c.drawString(x, y, value)


def wrap(c: canvas.Canvas, value: str, x: float, y: float, width: float,
         size: float = 10, leading: float | None = None, color=GRAY,
         bold: bool = False, max_lines: int | None = None) -> float:
    leading = leading or size * 1.4
    lines: list[str] = []
    current = ""
    for word in value.split():
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(candidate, f(bold), size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" .,;") + "…"
    c.setFillColor(color)
    c.setFont(f(bold), size)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def card(c: canvas.Canvas, x: float, y: float, w: float, h: float,
         fill=PAPER, stroke=LINE, radius: float = 12) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def circle_number(c: canvas.Canvas, number: str, x: float, y: float, color=TEAL) -> None:
    c.setFillColor(color)
    c.circle(x, y, 13, fill=1, stroke=0)
    tw = pdfmetrics.stringWidth(number, f(True), 8.5)
    txt(c, number, x - tw / 2, y - 3, 8.5, HexColor("#FFFFFF"), True)


def arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float) -> None:
    c.setStrokeColor(TEAL)
    c.setFillColor(TEAL)
    c.setLineWidth(1.4)
    c.line(x1, y1, x2, y2)
    c.line(x2, y2, x2 - 6, y2 + 3)
    c.line(x2, y2, x2 - 6, y2 - 3)


def build() -> None:
    register_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Replace previous generated artifacts before writing the new version.
    OUT.unlink(missing_ok=True)
    PREVIEW.unlink(missing_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("Propuesta de entrenamiento LoRA para Sempertex · Página 1")
    c.setAuthor("Sempertex")

    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Plain report layout: standard headings, paragraphs and numbered steps.
    txt(c, "PROPUESTA DE ENTRENAMIENTO LoRA", M, H - 43, 8.5, INK, True)
    txt(c, "Sempertex", W - M - 48, H - 43, 8.5, GRAY)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(M, H - 58, W - M, H - 58)

    txt(c, "Propuesta de entrenamiento LoRA para Sempertex", M, H - 105, 20, INK, True)
    txt(c, "Documento de trabajo — Página 1", M, H - 128, 9, GRAY)

    y = H - 181
    txt(c, "1. Motivo de la propuesta", M, y, 12, INK, True)
    y -= 25
    y = wrap(c, "El sistema actual puede generar imágenes atractivas, pero no siempre respeta el ambiente solicitado, la hora del evento o los productos reales de Sempertex. También puede introducir globos, colores o decoraciones que no pertenecen al catálogo.", M, y, W - 2 * M, 10.2, 14.5, INK, False, 6)
    y -= 8
    y = wrap(c, "Por esta razón, se propone entrenar un LoRA orientado al lenguaje visual de la marca y conectarlo con el catálogo de productos. El objetivo no es que el modelo memorice toda la base de datos, sino que aprenda a construir decoraciones con una apariencia coherente y verificable.", M, y, W - 2 * M, 10.2, 14.5, INK, False, 6)

    y -= 18
    txt(c, "2. Objetivo", M, y, 12, INK, True)
    y -= 25
    y = wrap(c, "El sistema debe producir propuestas de decoración que:", M, y, W - 2 * M, 10.2, 14.5, INK, False, 2)
    objectives = [
        "mantengan un estilo visual reconocible de Sempertex;",
        "respeten el evento, el ambiente, la hora y el nivel de presupuesto;",
        "utilicen productos reales cuando el catálogo los confirme;",
        "puedan revisarse antes de presentarse al cliente.",
    ]
    for item in objectives:
        y -= 19
        txt(c, "•", M + 5, y, 10, INK, True)
        y = wrap(c, item, M + 20, y, W - 2 * M - 20, 10, 14, INK, False, 2)

    y -= 18
    txt(c, "3. Cómo se realizará", M, y, 12, INK, True)
    y -= 27
    steps = [
        ("1.", "Organizar los datos.", "Separar componentes, módulos y composiciones; asignar categorías y revisar licencias."),
        ("2.", "Preparar el material.", "Elegir imágenes variadas, eliminar duplicados y escribir captions que describan solo lo visible."),
        ("3.", "Entrenar por rondas.", "Probar una primera versión, medirla y ajustar el dataset antes de continuar."),
        ("4.", "Comparar y aprobar.", "Usar una matriz de prompts para comprobar estilo, contexto, producto y calidad."),
    ]
    for number, title, body in steps:
        txt(c, number, M + 2, y, 10, INK, True)
        txt(c, title, M + 28, y, 10.2, INK, True)
        y = wrap(c, body, M + 154, y, W - M - (M + 154), 9.6, 13.5, GRAY, False, 2)
        y -= 15

    y -= 2
    txt(c, "4. Reparto de responsabilidades", M, y, 12, INK, True)
    y -= 25
    txt(c, "LoRA", M, y, 10, INK, True)
    y = wrap(c, "Aprende la forma de organizar las decoraciones, el acabado de los globos, las paletas y el lenguaje visual de las composiciones.", M + 72, y, W - 2 * M - 72, 9.6, 13.5, INK, False, 3)
    y -= 10
    txt(c, "Catálogo", M, y, 10, INK, True)
    y = wrap(c, "Confirma SKU, referencia, tamaño, color, impresión, disponibilidad y enlace de producto.", M + 72, y, W - 2 * M - 72, 9.6, 13.5, INK, False, 3)

    c.setStrokeColor(LINE)
    c.line(M, 92, W - M, 92)
    txt(c, "Resultado esperado", M, 72, 10.5, INK, True)
    wrap(c, "Entrenar estilo; consultar producto; verificar resultado. La calidad se aprobará con ejemplos comparables, no con una sola imagen aislada.", M + 118, 72, W - M - (M + 118), 9, 12, INK, False, 2)

    txt(c, "Documento base para revisión · Página 1 de 1", M, 30, 7.5, GRAY)
    c.showPage()
    c.save()


if __name__ == "__main__":
    build()
