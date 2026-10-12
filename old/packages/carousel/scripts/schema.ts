/** Write templates/template.schema.json from the Zod schema (editor autocompletion for template.json). */
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { templateManifestSchema } from "../src/template-schema";

const out = new URL("../../../templates/template.schema.json", import.meta.url);
const schema = z.toJSONSchema(templateManifestSchema, { io: "input", unrepresentable: "any" });
await writeFile(out, JSON.stringify({ ...schema, title: "Forgecy template.json" }, null, 2) + "\n");
console.log(`wrote ${out.pathname}`);
