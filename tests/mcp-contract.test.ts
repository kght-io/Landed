// THE TOOL CONTRACT — one catalog, three consumers, no drift.
//
// shared/src/mcp/tool-schemas.mjs is the single definition of the agent's tool surface. The stdio
// MCP server (mcp/jobhunt-server.mjs) binds a runner to each schema by name; the in-app /mcp
// reference renders the same schemas; a direct-API chat layer would send them as `tools: [...]`.
// The failure this guards against is a tool defined on one side only — a schema the MCP server
// can't execute, or a runner the agent can never see.
import test from "node:test";
import assert from "node:assert/strict";

import { TOOL_SCHEMAS, TOOL_SCHEMA_BY_NAME, MCP_SERVER } from "@landed/shared/mcp/tool-schemas.mjs";
import { TOOLS, SERVER } from "@landed/mcp/jobhunt-server.mjs";
import { listMcpTools } from "../frontend/lib/mcp-tools";

type Schema = { name: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } };
type BoundTool = Schema & { run: (args: unknown) => Promise<unknown> };

const schemas = TOOL_SCHEMAS as unknown as Schema[];
const bound = TOOLS as unknown as BoundTool[];

test("every shared schema is a well-formed tool definition", () => {
  assert.ok(schemas.length > 0, "the contract must not be empty");
  for (const t of schemas) {
    assert.equal(typeof t.name, "string", `tool name must be a string: ${JSON.stringify(t)}`);
    assert.ok(t.name.length > 0, "tool name must not be empty");
    assert.ok((t.description ?? "").length > 20, `${t.name} needs a description the model can act on`);
    assert.equal(t.inputSchema?.type, "object", `${t.name}.inputSchema must be a JSON-Schema object`);
    // A required key that isn't a declared property would ask the model for an argument the tool
    // never reads — the Anthropic API validates input_schema, MCP does not, so catch it here.
    for (const req of t.inputSchema.required ?? []) {
      assert.ok(t.inputSchema.properties?.[req] !== undefined, `${t.name}: required "${req}" is not a declared property`);
    }
  }
});

test("tool names are unique", () => {
  const names = schemas.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, `duplicate tool name in the contract: ${names.join(", ")}`);
  assert.equal(Object.keys(TOOL_SCHEMA_BY_NAME).length, names.length);
});

test("the MCP server's catalog and the shared contract agree", () => {
  // Same tools, same order — the server advertises exactly what the contract defines.
  assert.deepEqual(
    bound.map((t) => t.name),
    schemas.map((t) => t.name),
    "the MCP server's TOOLS drifted from the shared schema module"
  );
  // ...and the schema half is the shared one, not a copy that can rot.
  for (const [i, t] of bound.entries()) {
    assert.equal(t.description, schemas[i].description, `${t.name}: description differs from the contract`);
    assert.equal(t.inputSchema, schemas[i].inputSchema, `${t.name}: inputSchema is a copy, not the shared object`);
    assert.equal(typeof t.run, "function", `${t.name} has no runner — the MCP server can't execute it`);
  }
  assert.equal(SERVER, MCP_SERVER, "the MCP server identity must come from the shared contract");
});

test("the in-app /mcp reference documents every contract tool", () => {
  const { server, tools } = listMcpTools();
  assert.equal(server.name, MCP_SERVER.name);
  assert.equal(server.version, MCP_SERVER.version);
  assert.deepEqual(tools.map((t) => t.name), schemas.map((t) => t.name));
  for (const [i, doc] of tools.entries()) {
    const schema = schemas[i];
    assert.equal(doc.description, schema.description);
    assert.deepEqual(doc.params.map((p) => p.name), Object.keys(schema.inputSchema.properties ?? {}));
    const required = new Set(schema.inputSchema.required ?? []);
    for (const p of doc.params) assert.equal(p.required, required.has(p.name), `${doc.name}.${p.name} required flag`);
  }
});
