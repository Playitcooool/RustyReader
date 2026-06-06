export function markdownImagesToLinks(markdown: string): string {
  return markdown.replace(/!\[([^\]\n]*)\]\(([^)\n]*)\)/g, (_match, rawAlt: string, rawUrl: string) => {
    const alt = rawAlt.trim();
    const url = rawUrl.trim();
    if (!url) return alt;
    if (!alt) return url;
    return `[${alt}](${url})`;
  });
}
