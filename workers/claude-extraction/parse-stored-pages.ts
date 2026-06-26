import type { ExtractedPage } from '../text-extraction/extract-pdf-text';

// Parses bid_documents.extracted_text back into page-aware records.
// Storage format: "=== Page N ===\n{text}\n\n=== Page N+1 ===\n{text}..."
export function parseStoredTextToPages(extractedText: string): ExtractedPage[] {
  const lines = extractedText.split('\n');
  const pages: ExtractedPage[] = [];

  let currentPageNumber: number | null = null;
  const currentLines: string[] = [];

  const flush = () => {
    if (currentPageNumber === null) return;
    const text = currentLines.join('\n').replace(/^\n+|\n+$/g, '');
    pages.push({ pageNumber: currentPageNumber, text, charCount: text.length });
    currentLines.length = 0;
  };

  for (const line of lines) {
    const match = line.match(/^=== Page (\d+) ===$/);
    if (match) {
      flush();
      currentPageNumber = parseInt(match[1], 10);
    } else if (currentPageNumber !== null) {
      currentLines.push(line);
    }
  }

  flush();

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}
