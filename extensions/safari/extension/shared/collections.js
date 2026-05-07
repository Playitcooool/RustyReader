export function buildCollectionTree(collections) {
  const byParent = new Map();
  for (const collection of collections) {
    const key = collection.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push({ ...collection });
  }

  const sortByName = (items) => items.sort((left, right) => left.name.localeCompare(right.name));

  function attach(parentId = null, depth = 0) {
    const nodes = sortByName(byParent.get(parentId) || []);
    return nodes.map((node) => ({
      ...node,
      depth,
      children: attach(node.id, depth + 1)
    }));
  }

  return attach();
}

export function flattenCollectionTree(tree) {
  const rows = [];
  const visit = (node) => {
    rows.push(node);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return rows;
}

export function collectionLabel(collection, depth) {
  return `${"  ".repeat(depth)}${collection.name}`;
}
