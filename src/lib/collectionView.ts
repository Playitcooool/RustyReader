import type { Collection } from "./contracts";

export const childCollectionsFor = (collections: Collection[], parentId: number | null) =>
  collections
    .filter((collection) => collection.parent_id === parentId)
    .sort((left, right) => left.name.localeCompare(right.name));
