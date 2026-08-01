// coerce.ts hardens untyped agent/JSON records (fields arrive as `unknown`) into
// usable primitives. The contract that matters to callers: `num` returns either a
// real number or `null` — NEVER NaN. Call sites lean on that with the `?? fallback`
// idiom (e.g. `num(r.confidence) ?? 40`), and `NaN ?? 40` is NaN, not 40 — so a
// leaked NaN silently defeats every downstream default. These tests pin that contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { num, str } from "@landed/shared/util/coerce";

test("num: parses numeric values and numeric strings", () => {
  assert.equal(num(5), 5);
  assert.equal(num("5"), 5);
  assert.equal(num(0), 0);
  assert.equal(num("0"), 0);
  assert.equal(num(-3.5), -3.5);
});

test("num: empty/nullish inputs are null", () => {
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(""), null);
});

test("num: non-numeric strings are null, never NaN", () => {
  // The core contract: an agent that returns prose where a number was expected
  // ("high", "N/A", "unknown") must coerce to null, not NaN.
  assert.equal(num("high"), null);
  assert.equal(num("N/A"), null);
  assert.equal(num("12px"), null);
  assert.equal(num("abc"), null);
});

test("num: never leaks NaN, so `?? fallback` defaults hold", () => {
  // This is the call-site idiom used across ingest/registry. If num leaks NaN,
  // the fallback is silently defeated (NaN ?? 40 === NaN).
  assert.equal(num("high") ?? 40, 40);
  assert.equal(num("N/A") ?? 0, 0);
  assert.ok(!Number.isNaN(num("nope") ?? 0));
});

test("str: nullish/empty are undefined, everything else stringifies", () => {
  assert.equal(str(null), undefined);
  assert.equal(str(undefined), undefined);
  assert.equal(str(""), undefined);
  assert.equal(str("hi"), "hi");
  assert.equal(str(0), "0");
  assert.equal(str(false), "false");
});
