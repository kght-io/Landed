// Run-fragmentation-aware text editing for WordprocessingML (`word/document.xml`).
//
// Word splits one visible sentence across several <w:r>/<w:t> runs — the base résumé's
// "Recently built a 0→1 full-stack product" arrives as three runs ("…a 0" | "→" | "1 full-stack…").
// So a plain string search on document.xml misses any `find` that straddles a run boundary, which is
// why the tailor agent used to probe for byte offsets and corrupt the XML. This module concatenates
// each paragraph's runs, matches against that visible text, and splices the replacement back onto the
// runs — never crossing a <w:p> boundary — so the agent can express edits as {find, replace} pairs.

export type Edit = { find: string; replace: string };
export type EditResult = Edit & { matched: boolean };

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const encode = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TEXT_RE = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
const INNER_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/;

type Node = { start: number; end: number; text: string };

// Parse a paragraph's <w:t> nodes (full-tag spans + decoded inner text), in document order.
function textNodes(para: string): Node[] {
  const nodes: Node[] = [];
  for (const m of para.matchAll(TEXT_RE)) {
    const inner = INNER_RE.exec(m[0])?.[1] ?? "";
    nodes.push({ start: m.index!, end: m.index! + m[0].length, text: decode(inner) });
  }
  return nodes;
}

// Apply one edit to the FIRST paragraph whose concatenated visible text contains `find`.
// The whole replacement lands in the first participating run; the rest of the matched span is
// stripped from the trailing runs. Modified runs are rewritten with xml:space="preserve" so
// leading/trailing spaces survive.
function applyOne(xml: string, find: string, replace: string): { xml: string; matched: boolean } {
  for (const pm of xml.matchAll(PARA_RE)) {
    const para = pm[0];
    const base = pm.index!;
    const nodes = textNodes(para);
    if (!nodes.length) continue;

    const starts: number[] = [];
    let acc = 0;
    for (const n of nodes) {
      starts.push(acc);
      acc += n.text.length;
    }
    const concat = nodes.map((n) => n.text).join("");
    const at = concat.indexOf(find);
    if (at < 0) continue;

    const end = at + find.length;
    const next = new Map<number, string>();
    let firstHit = -1;
    for (let i = 0; i < nodes.length; i++) {
      const nodeStart = starts[i];
      const nodeEnd = nodeStart + nodes[i].text.length;
      const overlapStart = Math.max(at, nodeStart);
      const overlapEnd = Math.min(end, nodeEnd);
      if (overlapStart >= overlapEnd) continue; // this run isn't touched by the match
      const before = nodes[i].text.slice(0, overlapStart - nodeStart);
      const after = nodes[i].text.slice(overlapEnd - nodeStart);
      if (firstHit === -1) {
        firstHit = i;
        // If the match is confined to this one run, `after` is its own tail; otherwise the match
        // runs off the end of this run and the tail belongs to a later run.
        next.set(i, before + replace + (overlapEnd === end ? after : ""));
      } else {
        next.set(i, after); // trailing run: keep only what follows the match
      }
    }

    // Splice rewritten runs back in, right-to-left so earlier spans keep their offsets.
    let out = para;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!next.has(i)) continue;
      const tag = `<w:t xml:space="preserve">${encode(next.get(i)!)}</w:t>`;
      out = out.slice(0, nodes[i].start) + tag + out.slice(nodes[i].end);
    }
    return { xml: xml.slice(0, base) + out + xml.slice(base + para.length), matched: true };
  }
  return { xml, matched: false };
}

// Apply edits in order; each re-scans the (possibly already-edited) document. An edit whose `find`
// isn't present — or only spans a paragraph break — is reported matched:false and changes nothing.
export function applyEdits(xml: string, edits: Edit[]): { xml: string; results: EditResult[] } {
  const results: EditResult[] = [];
  let cur = xml;
  for (const e of edits) {
    const r = applyOne(cur, e.find, e.replace);
    cur = r.xml;
    results.push({ ...e, matched: r.matched });
  }
  return { xml: cur, results };
}

// The document's visible text: each paragraph's runs concatenated (entities decoded), paragraphs
// joined by newline. Lets the agent read the résumé as plain text instead of unzipping + regexing.
export function visibleText(xml: string): string {
  const paras: string[] = [];
  for (const pm of xml.matchAll(PARA_RE)) {
    paras.push(textNodes(pm[0]).map((n) => n.text).join(""));
  }
  return paras.join("\n");
}
