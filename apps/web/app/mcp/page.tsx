import { Plug } from "lucide-react";
import { listMcpTools } from "@/lib/mcp-tools";
import McpDocs from "@/components/mcp/McpDocs";

export const dynamic = "force-dynamic";

// In-app reference for the jobhunt MCP server's tools — rendered live from apps/mcp/jobhunt-server.mjs
// (via lib/mcp-tools), grouped into capability tabs (Read / Scan / Queue / Write).
export default function McpDocsPage() {
  const { server, tools } = listMcpTools();
  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-sky-500 text-zinc-950 shadow-lg shadow-violet-500/20">
            <Plug size={18} strokeWidth={2.4} />
          </span>
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-zinc-100">MCP tool reference</h1>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              The <code className="font-mono text-zinc-300">{server.name}</code> server (v{server.version}) — the {tools.length} capabilities the agent calls over MCP to run your pipeline. Live from <code className="font-mono">apps/mcp/jobhunt-server.mjs</code>.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <McpDocs tools={tools} />
        </div>
      </div>
    </div>
  );
}
