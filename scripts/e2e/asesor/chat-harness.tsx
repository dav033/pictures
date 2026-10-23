import { createRoot } from "react-dom/client";
import { ChatView } from "../../../src/components/asesor/ChatView";

const root = document.getElementById("root");
if (!root) throw new Error("Chat harness root is missing.");
createRoot(root).render(<ChatView />);
