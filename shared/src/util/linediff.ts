// A minimal line-level diff (LCS backtrack) — enough for a git-style resume diff. Pure + sync, so
// it's trivially testable and runs server-side over the textutil-extracted resume text.
// `comment` is the optional per-line annotation — *why* the line changed — that the agent supplies on a
// tailored-resume diff it produced itself (the computed textutil fallback leaves it undefined).
export type DiffOp = { type: "eq" | "add" | "del"; text: string; comment?: string };

// Split into content lines: normalize newlines, trim each line, drop blanks (textutil emits a lot
// of structural blank lines from .docx — keeping them would swamp the diff with noise).
export function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
}

// Longest-common-subsequence diff over two line arrays → a flat op list (eq/del/add), del-before-add
// within a change so the renderer reads top-to-bottom like `git diff`.
export function lineDiff(aText: string, bText: string): DiffOp[] {
  const a = toLines(aText);
  const b = toLines(bText);
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "eq", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: a[i] }); i++; }
    else { ops.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });
  return ops;
}

// Validate an untrusted op array (the agent's submitted annotated diff) into clean DiffOp[]. Drops
// malformed entries; returns undefined when nothing usable remains so callers fall back to the
// computed textutil diff. Keeps only the known op types and coerces text/comment to strings.
export function coerceDiff(raw: unknown): DiffOp[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ops: DiffOp[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const { type, text, comment } = o as Record<string, unknown>;
    if (type !== "eq" && type !== "add" && type !== "del") continue;
    if (typeof text !== "string") continue;
    const op: DiffOp = { type, text };
    if (typeof comment === "string" && comment.trim()) op.comment = comment.trim();
    ops.push(op);
  }
  return ops.length ? ops : undefined;
}
