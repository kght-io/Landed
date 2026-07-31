import { listMcpTools } from "@/lib/mcp-tools";

export const dynamic = "force-dynamic";

// GET /api/mcp → the jobhunt MCP server's tool catalog (server info + tools with their params).
// Read live from apps/mcp/jobhunt-server.mjs, so it stays in sync as tools are added/changed.
export function GET() {
  return Response.json(listMcpTools());
}
