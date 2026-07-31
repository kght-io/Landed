export const dynamic = "force-dynamic";

// GET /api/embeddable?url=… -> { embeddable } — whether a URL can be shown in an iframe. The browser
// can't tell us cross-origin (a blocked frame still fires `load`), so we read the target's
// X-Frame-Options / CSP frame-ancestors headers server-side. Used by the title-column job preview.
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return Response.json({ error: "missing url" }, { status: 400 });
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
    res.body?.cancel(); // headers are all we need — don't download the page body
    const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
    const frameAncestors = /frame-ancestors\s+([^;]*)/.exec(csp)?.[1]?.trim() ?? "";
    // Cross-origin embedding is blocked by XFO deny/sameorigin, or a frame-ancestors that isn't a
    // wildcard (our origin won't be on a specific allowlist, and 'none'/'self' exclude us).
    const blocked =
      xfo.includes("deny") || xfo.includes("sameorigin") ||
      (frameAncestors !== "" && !frameAncestors.includes("*"));
    return Response.json({ embeddable: !blocked });
  } catch (err) {
    return Response.json({ embeddable: false, error: String(err) });
  }
}
