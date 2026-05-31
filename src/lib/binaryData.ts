export const blobFromBytes = (bytes: Uint8Array, type: string) =>
  new Blob([bytes.slice()], { type });
