import { readdir } from "node:fs/promises";
import path from "node:path";
import { INSTRUCTIONS_ROOT } from "@landed/core/config";

export const dynamic = "force-dynamic";

export type InstructionFile = { path: string; name: string; group: string };

async function walk(dir: string, rel = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), childRel)));
    else if (e.name.endsWith(".md")) out.push(childRel);
  }
  return out;
}

// GET /api/instructions -> all .md files, grouped by top-level folder (the "agent").
export async function GET() {
  try {
    const rels = (await walk(INSTRUCTIONS_ROOT)).sort();
    const files: InstructionFile[] = rels.map((rel) => {
      const segs = rel.split("/");
      return {
        path: rel,
        name: segs[segs.length - 1],
        // top-level file -> its own agent (coding, application); nested -> folder (cowork)
        group: segs.length > 1 ? segs[0] : segs[0].replace(/\.md$/, ""),
      };
    });
    return Response.json({ root: INSTRUCTIONS_ROOT, files });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
