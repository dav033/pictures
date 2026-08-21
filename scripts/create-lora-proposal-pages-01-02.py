# -*- coding: utf-8 -*-
"""Create the first two pages of the Sempertex LoRA proposal."""

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = DOCS / "propuesta-entrenamiento-lora-sempertex-v10.pdf"
PREVIEW = DOCS / "propuesta-entrenamiento-lora-sempertex-v10-preview.png"

W, H = A4
M = 46

INK = HexColor("#142F35")
TEAL = HexColor("#087F78")
TEAL_LIGHT = HexColor("#E8F5F2")
ORANGE = HexColor("#E6763D")
ORANGE_LIGHT = HexColor("#FFF1E9")
GRAY = HexColor("#63757A")
LINE = HexColor("#D7E4E2")
PAPER = HexColor("#FFFFFF")
IMAGE_BG = HexColor("#F5F7F6")


def register_fonts() -> None:
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists():
        pdfmetrics.registerFont(TTFont("Sempertex", str(regular)))
    if bold.exists():
        pdfmetrics.registerFont(TTFont("Sempertex-Bold", str(bold)))


def font_name(bold: bool = False) -> str:
    return "Sempertex-Bold" if bold else "Sempertex"


def text(c: canvas.Canvas, value: str, x: float, y: float, size: float,
         color=INK, bold: bool = False) -> None:
    c.setFillColor(color)
    c.setFont(font_name(bold), size)
    c.drawString(x, y, value)


def wrap(c: canvas.Canvas, value: str, x: float, y: float, width: float,
         size: float = 10, leading: float | None = None, color=GRAY,
         bold: bool = False, max_lines: int | None = None) -> float:
    leading = leading or size * 1.4
    lines: list[str] = []
    current = ""
    for word in value.split():
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(candidate, font_name(bold), size) <= width:
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
    c.setFont(font_name(bold), size)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def header(c: canvas.Canvas, page_number: int, total_pages: int = 5) -> None:
    text(c, "PROPUESTA DE ENTRENAMIENTO LoRA", M, H - 43, 8.5, INK, True)
    text(c, "Sempertex", W - M - 48, H - 43, 8.5, GRAY)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(M, H - 58, W - M, H - 58)
    text(c, f"Página {page_number} de {total_pages}", W - M - 58, 30, 7.5, GRAY)


def draw_page_one(c: canvas.Canvas) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    header(c, 1)

    text(c, "Propuesta de entrenamiento LoRA para Sempertex", M, H - 105, 20, INK, True)
    text(c, "Documento de trabajo — Página 1", M, H - 128, 9, GRAY)

    y = H - 181
    text(c, "1. Motivo de la propuesta", M, y, 12, INK, True)
    y -= 25
    y = wrap(
        c,
        "El sistema actual puede generar imágenes atractivas, pero no siempre respeta el ambiente solicitado, la hora del evento o los productos reales de Sempertex. También puede introducir globos, colores o decoraciones que no pertenecen al catálogo.",
        M, y, W - 2 * M, 10.2, 14.5, INK, max_lines=6,
    )
    y -= 8
    y = wrap(
        c,
        "Por esta razón, se propone entrenar un LoRA orientado al lenguaje visual de la marca y conectarlo con el catálogo de productos. El objetivo no es que el modelo memorice toda la base de datos, sino que aprenda a construir decoraciones con una apariencia coherente y verificable.",
        M, y, W - 2 * M, 10.2, 14.5, INK, max_lines=6,
    )

    y -= 18
    text(c, "2. Objetivo", M, y, 12, INK, True)
    y -= 25
    y = wrap(c, "El sistema debe producir propuestas de decoración que:", M, y, W - 2 * M, 10.2, 14.5, INK, max_lines=2)
    objectives = [
        "mantengan un estilo visual reconocible de Sempertex;",
        "respeten el evento, el ambiente, la hora y el nivel de presupuesto;",
        "utilicen productos reales cuando el catálogo los confirme;",
        "puedan revisarse antes de presentarse al cliente.",
    ]
    for item in objectives:
        y -= 19
        text(c, "•", M + 5, y, 10, INK, True)
        y = wrap(c, item, M + 20, y, W - 2 * M - 20, 10, 14, INK, max_lines=2)

    y -= 18
    text(c, "3. Cómo se realizará", M, y, 12, INK, True)
    y -= 27
    steps = [
        ("1.", "Organizar los datos.", "Separar componentes, módulos y composiciones; asignar categorías y revisar licencias."),
        ("2.", "Preparar el material.", "Elegir imágenes variadas, eliminar duplicados y escribir captions que describan solo lo visible."),
        ("3.", "Entrenar por rondas.", "Probar una primera versión, medirla y ajustar el dataset antes de continuar."),
        ("4.", "Comparar y aprobar.", "Usar una matriz de prompts para comprobar estilo, contexto, producto y calidad."),
    ]
    for number, title, body in steps:
        text(c, number, M + 2, y, 10, INK, True)
        text(c, title, M + 28, y, 10.2, INK, True)
        y = wrap(c, body, M + 154, y, W - M - (M + 154), 9.6, 13.5, GRAY, max_lines=2)
        y -= 15

    y -= 2
    text(c, "4. Reparto de responsabilidades", M, y, 12, INK, True)
    y -= 25
    text(c, "LoRA", M, y, 10, INK, True)
    y = wrap(c, "Aprende la forma de organizar las decoraciones, el acabado de los globos, las paletas y el lenguaje visual de las composiciones.", M + 72, y, W - 2 * M - 72, 9.6, 13.5, INK, max_lines=3)
    y -= 10
    text(c, "Catálogo", M, y, 10, INK, True)
    y = wrap(c, "Confirma SKU, referencia, tamaño, color, impresión, disponibilidad y enlace de producto.", M + 72, y, W - 2 * M - 72, 9.6, 13.5, INK, max_lines=3)

    c.setStrokeColor(LINE)
    c.line(M, 92, W - M, 92)
    text(c, "Resultado esperado", M, 72, 10.5, INK, True)
    wrap(c, "Entrenar estilo; consultar producto; verificar resultado. La calidad se aprobará con ejemplos comparables, no con una sola imagen aislada.", M + 118, 72, W - M - (M + 118), 9, 12, INK, max_lines=2)

    c.showPage()


def draw_image_tile(c: canvas.Canvas, image_path: Path, label: str,
                    x: float, top: float, width: float, height: float) -> None:
    c.setFillColor(IMAGE_BG)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.rect(x, top - height, width, height, fill=1, stroke=1)
    try:
        c.drawImage(str(image_path), x + 3, top - 78, width - 6, 75,
                    preserveAspectRatio=True, anchor="c", anchorAtXY=False,
                    mask="auto")
    except Exception:
        text(c, "Imagen no disponible", x + 8, top - 40, 7.5, GRAY)
    wrap(c, label, x + 4, top - 91, width - 8, 7.5, 9, INK, True, max_lines=3)


def draw_page_two(c: canvas.Canvas) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    header(c, 2)

    text(c, "5. Taxonomía inicial del material", M, H - 105, 20, INK, True)
    text(c, "Una clasificación corta para entrenar con orden", M, H - 128, 9, GRAY)

    y = H - 177
    text(c, "Alcance de esta primera versión", M, y, 12, TEAL, True)
    y -= 24
    y = wrap(
        c,
        "Las categorías no buscan abarcar todos los eventos posibles. Se enfocan en los estilos más comunes y en los tipos de decoración que más suelen pedir los clientes. La taxonomía podrá crecer después, cuando existan suficientes ejemplos y una necesidad clara.",
        M, y, W - 2 * M, 10, 14, INK, max_lines=4,
    )
    c.setStrokeColor(ORANGE)
    c.setLineWidth(2)
    c.line(M, y - 5, M, y - 28)
    wrap(
        c,
        "Una imagen puede pertenecer a más de una categoría; así reutilizamos composiciones con estilos compartidos.",
        M + 12, y - 10, W - 2 * M - 12, 9, 12, GRAY, max_lines=2,
    )

    y = 550
    text(c, "Categorías prioritarias · imágenes representativas", M, y, 11.5, INK, True)
    y -= 18

    image_paths = [
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-4ceb690c-bd09-413b-b247-d2620edfddb4.png"), "Boda"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-73def6a2-ecdd-4b24-bb7a-db20f6d0dda5.png"), "Cumpleaños y fiesta infantil"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-80d555e0-b4ea-4e7d-a8ce-57ecabee44c8.png"), "Cumpleaños adulto"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-ec4621c9-5813-4ec5-bff9-56fa96326b68.png"), "Quince años"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-72472f6c-cf92-4bf9-b6ae-efe487ac6e1c.png"), "Halloween"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-08019101-20de-40cc-987d-fa70b828bdae.png"), "Navidad"),
        (Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-17c08c5a-73fb-4f9d-ad43-41dda5ea5487.png"), "Graduación"),
    ]
    cols = 4
    gap = 9
    tile_width = (W - 2 * M - gap * (cols - 1)) / cols
    tile_height = 112
    for index, (image_path, label) in enumerate(image_paths):
        row = index // cols
        col = index % cols
        x = M + col * (tile_width + gap)
        top = y - row * 123
        draw_image_tile(c, image_path, label, x, top, tile_width, tile_height)

    text(c, "Genérico", M, 280, 8.5, INK, True)

    y = 240
    text(c, "Tipos de elemento", M, y, 11.5, INK, True)
    y -= 22
    rows = [
        ("Componentes", "Elementos individuales: globos, cortinas, mesas, estructuras y accesorios."),
        ("Módulos", "Conjuntos parciales: arcos, bouquets, guirnaldas y mesas decoradas."),
        ("Composiciones", "Decoraciones completas, ubicadas dentro de un ambiente real."),
    ]
    for title, body in rows:
        text(c, title, M, y, 9.2, INK, True)
        y = wrap(c, body, M + 86, y, W - M - (M + 86), 8.8, 11.5, GRAY, max_lines=2)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.5)
        c.line(M, y + 3, W - M, y + 3)
        y -= 12

    text(c, "Atributos que acompañan cada imagen", M, 130, 10.5, TEAL, True)
    wrap(c, "Ambiente: interior/exterior · Hora: día/tarde/noche · Presupuesto: Low/Mid/High · Categorías múltiples.", M, 112, W - 2 * M, 8.6, 11.5, INK, max_lines=1)

    text(c, "Evolución futura", M, 82, 10.5, ORANGE, True)
    wrap(c, "Después podrán añadirse taxonomías por sexo/género, edad, estilo y paleta, según utilidad y disponibilidad de ejemplos.", M, 64, W - 2 * M, 8.6, 11.5, GRAY, max_lines=1)

    c.setStrokeColor(LINE)
    c.line(M, 42, W - M, 42)
    text(c, "Documento base para revisión", M, 24, 7.5, GRAY)
    c.showPage()


def draw_wide_image(c: canvas.Canvas, image_path: Path, caption: str,
                    x: float, top: float, width: float, height: float) -> None:
    c.setFillColor(IMAGE_BG)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.rect(x, top - height, width, height, fill=1, stroke=1)
    if image_path.exists():
        c.drawImage(str(image_path), x + 3, top - height + 3, width - 6, height - 6,
                    preserveAspectRatio=True, anchor="c", anchorAtXY=False,
                    mask="auto")
    text(c, caption, x, top - height - 16, 8.2, GRAY, True)


def draw_bullet_list(c: canvas.Canvas, items: list[str], x: float, y: float,
                     width: float, size: float = 8.9, leading: float = 12.2) -> float:
    for item in items:
        text(c, "•", x, y, size, INK, True)
        y = wrap(c, item, x + 12, y, width - 12, size, leading, INK, max_lines=5)
        y -= 8
    return y


def draw_page_three(c: canvas.Canvas) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    header(c, 3)

    text(c, "6. Estado actual del demo con Gemini", M, H - 105, 20, INK, True)
    text(c, "Resultado útil para prototipar; todavía insuficiente para producción", M, H - 128, 9, GRAY)

    text(c, "Muestras observadas", M, 674, 11.5, TEAL, True)
    image_one = Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-8627a017-ff64-45cd-9250-892f8d88ed29.png")
    image_two = Path(r"C:\Users\davidt\AppData\Local\Temp\codex-clipboard-39f41b10-e535-4add-b6f7-6b2def67a76b.png")
    image_width = (W - 2 * M - 14) / 2
    draw_wide_image(c, image_one, "XV años · salón", M, 650, image_width, 134)
    draw_wide_image(c, image_two, "XV años · exterior y noche", M + image_width + 14, 650, image_width, 134)

    left_x = M
    right_x = M + 265
    col_width = 242
    text(c, "Lo que funciona", left_x, 465, 11, TEAL, True)
    draw_bullet_list(c, [
        "Buena composición general y capacidad para proponer montajes completos.",
        "Elementos representativos de Sempertex bien representados en la escena.",
        "Puede adaptar paletas, ambientes y niveles de decoración a pedidos distintos.",
    ], left_x, 442, col_width)

    text(c, "Limitaciones detectadas", right_x, 465, 11, ORANGE, True)
    draw_bullet_list(c, [
        "Jerarquía de tamaños insuficiente: suele mostrar globos R-12, aunque una composición real combina al menos dos tamaños.",
        "Inconsistencias visuales o lógicas: una columna puede desaparecer o una cortina quedar sin puntos de apoyo.",
        "Los globos con fuentes o textos pierden consistencia cuando la composición se vuelve compleja.",
        "Se enfoca en presentar elementos, pero no siempre en su armonía y propósito; por ejemplo, velas encendidas sin el pastel correspondiente.",
    ], right_x, 442, col_width)

    c.setStrokeColor(LINE)
    c.line(M, 184, W - M, 184)
    text(c, "Recomendación", M, 162, 11, INK, True)
    wrap(
        c,
        "El estado actual puede servir como prototipo, pero no alcanza el nivel necesario para una implementación empresarial. La siguiente etapa debe alimentar una IA con reglas de composición, jerarquía de tamaños, lógica constructiva, identidad visual y referencias verificables del catálogo Sempertex.",
        M + 92, 162, W - M - (M + 92), 9.1, 12.5, INK, max_lines=4,
    )
    text(c, "Conclusión: generar una imagen atractiva no basta; debe respetar producto, contexto y lógica de decoración.", M, 91, 9.2, GRAY, True)
    c.showPage()


def draw_architecture_box(c: canvas.Canvas, number: str, title: str, body: str,
                          x: float, y: float, width: float, height: float,
                          fill=IMAGE_BG) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, 8, fill=1, stroke=1)
    c.setFillColor(TEAL)
    c.circle(x + 18, y + height - 18, 10, fill=1, stroke=0)
    tw = pdfmetrics.stringWidth(number, font_name(True), 7.5)
    text(c, number, x + 18 - tw / 2, y + height - 21, 7.5, PAPER, True)
    text(c, title, x + 36, y + height - 22, 10.2, INK, True)
    wrap(c, body, x + 18, y + height - 42, width - 36, 8.8, 12, GRAY, max_lines=3)


def draw_down_arrow(c: canvas.Canvas, x: float, y1: float, y2: float) -> None:
    c.setStrokeColor(TEAL)
    c.setFillColor(TEAL)
    c.setLineWidth(1.2)
    c.line(x, y1, x, y2 + 5)
    c.line(x, y2, x - 4, y2 + 6)
    c.line(x, y2, x + 4, y2 + 6)


def draw_page_four(c: canvas.Canvas) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    header(c, 4)

    text(c, "7. Arquitectura del sistema", M, H - 105, 20, INK, True)
    text(c, "Cada capa cumple una función concreta y puede evolucionar sin rehacer la aplicación", M, H - 128, 9, GRAY)

    text(c, "Flujo principal", M, 674, 11.5, TEAL, True)
    box_x = M + 55
    box_w = W - 2 * M - 110
    box_h = 68
    ys = [570, 485, 400, 315, 230]
    boxes = [
        ("1", "Interfaz de usuario", "La persona describe evento, ambiente, hora, estilo y presupuesto desde la aplicación."),
        ("2", "Orquestador propio", "Recibe la solicitud, aplica reglas de negocio y coordina las llamadas a cada servicio."),
        ("3", "Gemini directo · análisis", "Interpreta la intención, organiza el pedido y transforma lenguaje libre en una especificación estructurada."),
        ("4", "Catálogo + vector DB", "Aporta productos reales, SKU, referencias, tamaños, colores, categorías y disponibilidad."),
        ("5", "fal.ai · generación visual", "Ejecuta el LoRA Sempertex y genera la composición usando estilo, productos y contexto preparados."),
    ]
    fills = [HexColor("#F5FAF9"), IMAGE_BG, HexColor("#EEF8F6"), IMAGE_BG, HexColor("#FFF6F0")]
    for index, ((number, title, body), y, fill) in enumerate(zip(boxes, ys, fills)):
        draw_architecture_box(c, number, title, body, box_x, y, box_w, box_h, fill)
        if index < len(ys) - 1:
            draw_down_arrow(c, W / 2, y - 7, ys[index + 1] + box_h + 7)

    c.setStrokeColor(LINE)
    c.line(M, 180, W - M, 180)
    text(c, "Principios de la arquitectura", M, 158, 11, INK, True)
    wrap(c, "Gemini analiza; catálogo decide qué existe; fal.ai interpreta el estilo y genera la escena. La interfaz no conoce claves ni detalles de proveedores.", M, 137, W - 2 * M, 9.1, 12.5, INK, max_lines=2)
    wrap(c, "Esta separación permite cambiar el modelo de generación, añadir nuevos productos o incorporar otras categorías sin cambiar la experiencia de usuario.", M, 105, W - 2 * M, 9.1, 12.5, GRAY, max_lines=2)
    text(c, "Resultado: más control sobre identidad visual, productos reales, costos y evolución del sistema.", M, 68, 9.2, GRAY, True)
    c.showPage()


def draw_cost_row(c: canvas.Canvas, y: float, item: str, scope: str,
                  cost: str, height: float, header_row: bool = False,
                  total_row: bool = False) -> None:
    x_item = M + 10
    x_scope = M + 232
    x_cost = W - M - 58
    color = INK if header_row or total_row else GRAY
    bold = header_row or total_row
    text(c, item, x_item, y - 17, 8.7, color, bold)
    wrap(c, scope, x_scope, y - 17, 180, 8.2, 10.5, color, bold, max_lines=3)
    tw = pdfmetrics.stringWidth(cost, font_name(bold), 8.8)
    text(c, cost, x_cost - tw, y - 17, 8.8, color, bold)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(M, y - height, W - M, y - height)


def draw_page_five(c: canvas.Canvas) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    header(c, 5)

    text(c, "8. Estimación de costes · fase de entrenamiento", M, H - 105, 19, INK, True)
    text(c, "Dataset mínimo de 300 imágenes y pruebas acotadas", M, H - 128, 9, GRAY)

    text(c, "Alcance recomendado", M, 674, 11.5, TEAL, True)
    wrap(c, "Preparar un dataset mínimo de 300 imágenes aprobadas, con captions y clasificación; ejecutar 3–5 entrenamientos LoRA y realizar una ronda corta de generación para comprobar el resultado.", M, 651, W - 2 * M, 9.5, 13, INK, max_lines=3)
    wrap(c, "La generación de imágenes será marginal: solo se producirán ejemplos suficientes para comparar el estilo y decidir si vale la pena ampliar el entrenamiento.", M, 609, W - 2 * M, 9.2, 12.5, GRAY, max_lines=2)

    text(c, "Estimación de servicios", M, 565, 11.5, INK, True)
    table_top = 542
    table_left = M
    table_right = W - M
    table_bottom = 248
    c.setFillColor(TEAL_LIGHT)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.rect(table_left, table_top - 34, table_right - table_left, 34, fill=1, stroke=1)
    draw_cost_row(c, table_top, "Partida", "Qué cubre", "USD", 34, header_row=True)

    rows = [
        ("Preparación y empaquetado", "300 imágenes, captions, clasificación, ZIP y almacenamiento temporal.", "$0–10", 40),
        ("Entrenamiento LoRA", "3–5 runs de 1.000 pasos. El precio base actual es $2 por run.", "$6–10", 40),
        ("Generación de prueba", "20–40 imágenes totales, repartidas entre fal.ai y Gemini.", "$5–15", 46),
        ("Ajustes puntuales", "Reintentos limitados y pequeños cambios al prompt o dataset.", "$4–10", 46),
        ("Margen de contingencia", "Una ronda adicional si el resultado necesita confirmación.", "$4–13", 46),
    ]
    y = table_top - 34
    for item, scope, cost, height in rows:
        draw_cost_row(c, y, item, scope, cost, height)
        y -= height
    c.setFillColor(ORANGE_LIGHT)
    c.rect(table_left, table_bottom, table_right - table_left, 42, fill=1, stroke=0)
    draw_cost_row(c, table_bottom + 42, "Total estimado de servicios", "Reserva operativa para completar el entrenamiento.", "$19–58", 42, total_row=True)

    text(c, "Presupuesto recomendado", M, 226, 11, ORANGE, True)
    text(c, "USD 40–75", M, 198, 19, INK, True)
    wrap(c, "Incluye margen para variación de precios, resolución y una ronda adicional de entrenamiento. No incluye desarrollo de aplicación ni implementación de producción.", M + 118, 200, W - M - (M + 118), 8.9, 12, GRAY, max_lines=3)

    text(c, "Decisión al finalizar", M, 132, 10.5, INK, True)
    wrap(c, "Si el estilo mejora con 300 imágenes y las composiciones responden de forma consistente, se justifica ampliar el dataset. Si no, se corrigen datos y captions antes de seguir entrenando.", M, 113, W - 2 * M, 8.8, 12, GRAY, max_lines=3)

    c.setStrokeColor(LINE)
    c.line(M, 51, W - M, 51)
    text(c, "Estimación de referencia en USD · precios de API pueden cambiar según modelo, resolución y volumen.", M, 33, 7.2, GRAY)
    c.showPage()


def build() -> None:
    register_fonts()
    DOCS.mkdir(parents=True, exist_ok=True)
    OUT.unlink(missing_ok=True)
    PREVIEW.unlink(missing_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("Propuesta de entrenamiento LoRA para Sempertex")
    c.setAuthor("Sempertex")
    draw_page_one(c)
    draw_page_two(c)
    draw_page_three(c)
    draw_page_four(c)
    draw_page_five(c)
    c.save()


if __name__ == "__main__":
    build()
