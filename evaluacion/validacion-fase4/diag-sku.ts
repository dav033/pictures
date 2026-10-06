import { canonicalizeSku } from "@/lib/rag/catalog/canonicalize";
for (const s of ["B2B-20017228", "20017228", "B2B-20008171"]) console.log(s, "->", canonicalizeSku(s));
