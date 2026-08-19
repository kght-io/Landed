// The seam between "the server is on this machine" and "the server is in the cloud".
//
// Eight UI affordances — reveal a folder, read the résumé diff, link to a downloaded attachment —
// are served today by /api routes that touch the LOCAL filesystem. That works only because the
// Next server happens to run on the same machine as the files. Point the browser at the deployed
// app and those routes still answer 200, but they answer about /app/asset-root inside a container
// in Virginia: silently wrong rather than broken, which is worse.
//
// So every such call goes through one module. In a browser it does what it does today. Inside the
// desktop app a bridge is present on `window.landed`, and the call runs where the files actually
// are. These tests pin that choice: bridge wins when present, fetch is the fallback, and NOTHING
// reaches the network when the bridge answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLocalCapability, type LocalBridge } from "../frontend/lib/local-capability";

// A fetch that fails the test if it is ever called — the point of the bridge is that it isn't.
const forbiddenFetch = (): Promise<Response> => {
  throw new Error("fetch was called even though a desktop bridge was present");
};

// Records what the fallback path asked for, so we can assert the URL/method contract is unchanged.
function recordingFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    }));
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

test("no bridge: falls back to the same /api routes the browser uses today", async () => {
  const { calls, impl } = recordingFetch();
  const cap = makeLocalCapability(undefined, impl);

  await cap.revealAssetFolder();
  await cap.revealResumeFolder("acme");
  await cap.revealPrepFolder("posting-1");
  await cap.getPaths();
  await cap.getResumeDiff("acme");
  await cap.getPrepAssets("posting-1");

  assert.deepEqual(calls.map((c) => c.url), [
    "/api/config/paths",
    "/api/resume/open",
    "/api/applications/posting-1/prep-assets",
    "/api/config/paths",
    "/api/resume/diff?slug=acme",
    "/api/applications/posting-1/prep-assets",
  ]);
  // The three reveals are POSTs; the three reads are plain GETs.
  assert.deepEqual(calls.map((c) => c.init?.method ?? "GET"), ["POST", "POST", "POST", "GET", "GET", "GET"]);
});

test("no bridge: slug and name are URL-encoded, never interpolated raw", async () => {
  const { calls, impl } = recordingFetch();
  const cap = makeLocalCapability(undefined, impl);

  await cap.getResumeDiff("a b&c");
  assert.equal(calls[0].url, "/api/resume/diff?slug=a%20b%26c");
  assert.equal(cap.attachmentUrl("p1", "Offer Letter.pdf"), "/api/applications/p1/attachments/Offer%20Letter.pdf");
});

test("bridge present: every call goes to the bridge and none to the network", async () => {
  const seen: string[] = [];
  const bridge: LocalBridge = {
    revealAssetFolder: async () => { seen.push("revealAssetFolder"); },
    revealResumeFolder: async (slug) => { seen.push(`revealResumeFolder:${slug}`); },
    revealPrepFolder: async (id) => { seen.push(`revealPrepFolder:${id}`); },
    getPaths: async () => { seen.push("getPaths"); return { assetRoot: "/Users/x/Landed", instructionsRoot: "/app/instructions" }; },
    getResumeDiff: async (slug) => {
      seen.push(`getResumeDiff:${slug}`);
      return { ok: true, slug, base: "resume-ref.docx", added: 0, removed: 0, ops: [] };
    },
    getPrepAssets: async (id) => {
      seen.push(`getPrepAssets:${id}`);
      return {
        slug: id,
        emails: { at: null, attachments: [] },
        questions: { researchedAt: null },
        transcripts: [],
        context: { at: null },
      };
    },
    attachmentUrl: (id, name) => `landed-file://attachment/${id}/${name}`,
    baseResumeUrl: () => "landed-file://resume/base",
  };
  const cap = makeLocalCapability(bridge, forbiddenFetch as unknown as typeof fetch);

  await cap.revealAssetFolder();
  await cap.revealResumeFolder("acme");
  await cap.revealPrepFolder("posting-1");
  const paths = await cap.getPaths();

  assert.deepEqual(seen, ["revealAssetFolder", "revealResumeFolder:acme", "revealPrepFolder:posting-1", "getPaths"]);
  assert.equal(paths.assetRoot, "/Users/x/Landed");
  // URL-valued capabilities are the bridge's to define — under Electron they are not http URLs.
  assert.equal(cap.attachmentUrl("p1", "a.pdf"), "landed-file://attachment/p1/a.pdf");
  assert.equal(cap.baseResumeUrl(), "landed-file://resume/base");
});

test("reveals never reject — a dead bridge must not surface as a broken button", async () => {
  const bridge = {
    revealAssetFolder: async () => { throw new Error("IPC channel closed"); },
  } as unknown as LocalBridge;
  const cap = makeLocalCapability(bridge, forbiddenFetch as unknown as typeof fetch);
  await cap.revealAssetFolder(); // resolves rather than throwing
});

test("partial bridge: local-only capabilities use it, DB-backed ones still hit the server", async () => {
  // The shape the first desktop build actually ships: it can reveal folders and resolve paths,
  // but prep assets and the résumé diff read the DB as well as the disk, so they stay on the
  // server until the DB moves. A bridge that omits them must not take them down with it.
  const { calls, impl } = recordingFetch();
  const revealed: string[] = [];
  const cap = makeLocalCapability(
    {
      revealAssetFolder: async () => { revealed.push("asset"); },
      getPaths: async () => ({ assetRoot: "/Users/x/Landed", instructionsRoot: "/app/instructions" }),
    },
    impl,
  );

  await cap.revealAssetFolder();
  await cap.getPaths();
  assert.deepEqual(revealed, ["asset"]);
  assert.equal(calls.length, 0); // neither touched the network
  // (deepEqual against [] would narrow `calls` to never[] for the rest of this test)

  await cap.getPrepAssets("posting-1");
  await cap.getResumeDiff("acme");
  assert.deepEqual(calls.map((c) => c.url), [
    "/api/applications/posting-1/prep-assets",
    "/api/resume/diff?slug=acme",
  ]);
});

test("deep-link transport: reveals navigate to landed:// instead of calling the server", async () => {
  // The cloud-backend shape. A POST to the server would reveal a folder inside a container; the
  // OS-routed URL reaches the machine the files are actually on.
  const { calls, impl } = recordingFetch();
  const navigated: string[] = [];
  const cap = makeLocalCapability(undefined, impl, "deep-link", (url) => navigated.push(url));

  await cap.revealAssetFolder();
  await cap.revealResumeFolder("acme-corp");

  assert.deepEqual(navigated, ["landed://reveal/assets", "landed://reveal/resume/acme-corp"]);
  assert.equal(calls.length, 0);
});

test("deep-link transport: revealPrepFolder still uses the server — it has an id, not a slug", async () => {
  // Resolving a posting id to a company slug is a DB lookup, and a deep link carries no database.
  // Pinned so the asymmetry is a decision on record rather than an oversight someone 'fixes'.
  const { calls, impl } = recordingFetch();
  const navigated: string[] = [];
  const cap = makeLocalCapability(undefined, impl, "deep-link", (url) => navigated.push(url));

  await cap.revealPrepFolder("posting-1");
  assert.equal(navigated.length, 0);
  assert.deepEqual(calls.map((c) => c.url), ["/api/applications/posting-1/prep-assets"]);
});

test("a bridge outranks the deep link — inside the app, no navigation happens", async () => {
  const navigated: string[] = [];
  let revealed = false;
  const cap = makeLocalCapability(
    { revealAssetFolder: async () => { revealed = true; } },
    forbiddenFetch as unknown as typeof fetch,
    "deep-link",
    (url) => navigated.push(url),
  );
  await cap.revealAssetFolder();
  assert.equal(revealed, true);
  assert.equal(navigated.length, 0);
});
