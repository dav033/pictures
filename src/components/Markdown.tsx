import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * react-markdown no interpreta HTML crudo por defecto (no usamos rehype-raw):
 * el contenido viene de un LLM, así que esto es la sanitización real, no un
 * detalle cosmético.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
