import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { visualDNAJsonSchema } from "../src/visual-dna";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = path.join(packageRoot, "schema");

await mkdir(schemaDir, { recursive: true });
await writeFile(
  path.join(schemaDir, "visual-dna-v1.schema.json"),
  `${JSON.stringify(visualDNAJsonSchema, null, 2)}\n`,
  "utf8"
);
