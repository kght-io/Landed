import type { Edit } from "@landed/shared/resume/docx";
import { buildTailoredResume, readBaseResumeText } from "./local-tools";

// A SECOND MCP SERVER, for the machine.
//
// The agent already has `jobhunt` (mcp/jobhunt-server.mjs), which is a pure HTTP client over the
// app's API — and once the backend moves, that API is in the cloud. This server is the other side
// of the same session: the user's own disk. Two servers rather than one because they answer to
// different places, and folding them together would mean a server that has to be in two at once.
//
// Runs as a child of the `claude` process, which the desktop app spawns, so it inherits the asset
// root through the environment. Speaks newline-delimited JSON-RPC on stdio — the same shape as
// jobhunt-server.mjs, deliberately, so the two read alike when debugging a session.
//
// stdout is the protocol channel and carries NOTHING else; diagnostics go to stderr.

const ROOT = process.env.LANDED_ASSET_ROOT;
const log = (s: string) => process.stderr.write(`[landed-local] ${s}\n`);
const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");

const TOOLS = [
  {
    name: "readBaseResumeText",
    description:
      "The user's base résumé as visible text — exactly what a human reads in Word, with Word's " +
      "run fragmentation already resolved. Read this BEFORE proposing edits: every `find` string " +
      "you pass to buildTailoredResume must appear verbatim in this output.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ text: readBaseResumeText(ROOT as string) }),
  },
  {
    name: "buildTailoredResume",
    description:
      "Write a tailored résumé to the user's folder as resume/<slug>/resume.docx, by applying " +
      "find/replace edits to the base résumé. All-or-nothing: if any `find` matches nothing, " +
      "NOTHING is written and the unmatched strings come back in `missed` — fix them against " +
      "readBaseResumeText and call again. Formatting, styles, and fonts are preserved.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug, lowercase with hyphens, e.g. acme-corp" },
        edits: {
          type: "array",
          description: "Ordered find/replace pairs. `find` must be verbatim text from readBaseResumeText.",
          items: {
            type: "object",
            properties: { find: { type: "string" }, replace: { type: "string" } },
            required: ["find", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["slug", "edits"],
      additionalProperties: false,
    },
    run: (args: { slug?: unknown; edits?: unknown }) =>
      buildTailoredResume(ROOT as string, String(args.slug ?? ""), (args.edits ?? []) as Edit[]),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const specs = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

function handle(msg: { id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } }): void {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "landed-local", version: "0.1.0" },
        },
      });
      return;
    case "notifications/initialized":
    case "initialized":
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: specs } });
      return;
    case "tools/call": {
      const tool = BY_NAME.get(params?.name ?? "");
      if (!tool) {
        send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
        return;
      }
      try {
        const data = tool.run((params?.arguments ?? {}) as never);
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      } catch (e) {
        // Reported as a tool error, not a protocol error: a failed build is an answer the agent can
        // act on, whereas a -32603 reads as "the server is broken" and ends the attempt.
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(e) }, null, 2) }] },
        });
      }
      return;
    }
    default:
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

function main(): void {
  if (!ROOT) {
    log("LANDED_ASSET_ROOT is not set — the desktop app sets it when it writes the MCP config");
    process.exit(2);
  }
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    // Frames are newline-delimited; a chunk can split one, so the trailing partial stays buffered.
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch (e) {
        log(`bad frame: ${String(e)}`);
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

main();
