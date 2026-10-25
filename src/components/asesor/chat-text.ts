/**
 * The chat shows plain text (`whitespace-pre-wrap`). The prompt asks the model for plain text, but if it still emits
 * Markdown emphasis or list markers, show the words instead of the raw `**` and `*` characters.
 */
export function plainChatText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}
