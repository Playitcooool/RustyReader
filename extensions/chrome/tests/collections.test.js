import test from "node:test";
import assert from "node:assert/strict";

import { buildCollectionTree, collectionLabel, flattenCollectionTree } from "../extension/shared/collections.js";

test("buildCollectionTree nests by parent_id and sorts by name", () => {
  const tree = buildCollectionTree([
    { id: 2, name: "Zoo", parent_id: null },
    { id: 3, name: "Alpha child", parent_id: 2 },
    { id: 1, name: "Alpha", parent_id: null }
  ]);

  assert.equal(tree[0].name, "Alpha");
  assert.equal(tree[1].children[0].name, "Alpha child");
});

test("flattenCollectionTree preserves depth-first order", () => {
  const rows = flattenCollectionTree([
    { id: 1, name: "Root", depth: 0, children: [{ id: 2, name: "Leaf", depth: 1, children: [] }] }
  ]);

  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
  assert.equal(collectionLabel(rows[1], rows[1].depth), "  Leaf");
});
