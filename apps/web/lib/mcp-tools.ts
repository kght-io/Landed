// Read the jobhunt MCP server's tool catalog (name / description / input schema) for the in-app
// /mcp reference, straight from the server module so the docs never drift from the real tools.
// The server only starts its stdio loop when launched directly (see jobhunt-server.mjs), so
// importing it here is side-effect-free — we just read the exported TOOLS metadata.
import { TOOLS, SERVER } from "@landed/mcp/jobhunt-server.mjs";

export type McpCategory = "read" | "scan" | "queue" | "write";
export type McpParam = { name: string; type: string; description?: string; required: boolean };
export type McpToolDoc = { name: string; description: string; params: McpParam[]; category: McpCategory; readOnly: boolean };

type RawSchema = { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
type RawTool = { name: string; description?: string; inputSchema?: RawSchema };

// Bucket a tool by its verb so the docs group into the four capabilities the agent actually thinks
// in: read (safe lookups) · scan (fetch/scrape boards) · queue (lease + drain work) · write (mutate
// the pipeline, logged to Changes). Falls back to `write` for any unrecognized mutating verb.
function categoryOf(name: string): McpCategory {
  if (/^scan/i.test(name)) return "scan";
  if (/^(claim|wait)/i.test(name)) return "queue";
  if (/^(list|get|search)/i.test(name)) return "read";
  return "write";
}

// The catalog, each flattened to a doc-friendly shape + categorized.
export function listMcpTools(): { server: { name: string; version: string }; tools: McpToolDoc[] } {
  const tools: McpToolDoc[] = (TOOLS as unknown as RawTool[]).map((t) => {
    const props = t.inputSchema?.properties ?? {};
    const required = new Set(t.inputSchema?.required ?? []);
    const params: McpParam[] = Object.entries(props).map(([name, s]) => ({
      name,
      type: s?.type ?? "any",
      description: s?.description,
      required: required.has(name),
    }));
    const category = categoryOf(t.name);
    return { name: t.name, description: t.description ?? "", params, category, readOnly: category === "read" };
  });
  return { server: SERVER as { name: string; version: string }, tools };
}
