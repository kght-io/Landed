import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupInOrder } from "@landed/shared/pipeline/board";

// The Fit Assessment step's rows arrive ALREADY sorted by the Pipeline comparator (pinned →
// click-sort → new → fitRank). So the grouper's whole job is to bucket them without touching that
// order — every test here is really "the comparator stays authoritative".
const row = (company: string, title: string) => ({ company, title });

test("rows are grouped by company", () => {
  const gs = groupInOrder([row("Shopify", "a"), row("Reddit", "b"), row("Shopify", "c")]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map((g) => g.company), ["Shopify", "Reddit"]);
});

// The point of the whole change: re-sorting inside the grouper would duplicate fitRank's policy and
// let the two drift. Incoming order IS the ranking.
test("incoming row order is preserved within a group", () => {
  const g = groupInOrder([row("Shopify", "best"), row("Shopify", "middle"), row("Shopify", "worst")])[0];
  assert.deepEqual(g.rows.map((r) => r.title), ["best", "middle", "worst"]);
});

// Ordering groups by first appearance gets "the company holding the top-ranked posting leads" for
// free — no second sort key, nothing to keep in sync with fitRank.
test("groups are ordered by first appearance, so the company with the top row leads", () => {
  const gs = groupInOrder([row("Reddit", "top"), row("Shopify", "second"), row("Reddit", "third")]);
  assert.deepEqual(gs.map((g) => g.company), ["Reddit", "Shopify"]);
});

test("companies interleaved through the list coalesce into one group each", () => {
  const gs = groupInOrder([
    row("Shopify", "a"), row("Reddit", "b"), row("Shopify", "c"), row("Reddit", "d"), row("Shopify", "e"),
  ]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map((g) => g.rows.map((r) => r.title)), [["a", "c", "e"], ["b", "d"]]);
});

// The collapsed header answers "is this company worth opening" without expanding it.
test("a group reports its size and its top row", () => {
  const g = groupInOrder([row("Shopify", "best"), row("Shopify", "rest")])[0];
  assert.equal(g.count, 2);
  assert.equal(g.top.title, "best");
});

test("grouping an empty list yields no groups", () => {
  assert.deepEqual(groupInOrder([]), []);
});
