import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { downloadPdfFromR2 } from '@/lib/r2/client';
import type { TextQuality } from '@/types/bid';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');

pdfjs.GlobalWorkerOptions.workerSrc = join(
  dirname(require.resolve('pdfjs-dist/package.json')),
  'legacy/build/pdf.worker.js',
);

const LOG_PREFIX = '[extract-pdf-text]';

export type ExtractedPage = {
  pageNumber: number;
  text: string;
  charCount: number;
};

export type PdfExtractionInput = {
  documentId: string;
  bidId: string;
  r2Key: string;
  r2Bucket: string;
};

export type PdfExtractionResult = {
  documentId: string;
  bidId: string;
  pageCount: number;
  pages: ExtractedPage[];
  totalCharacterCount: number;
  textQuality: TextQuality;
  requiresOcr: boolean;
};

function pageTextFromContent(
  items: Array<{ str?: string }>,
): string {
  return items
    .map((item) => (typeof item.str === 'string' ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTextQuality(
  pages: ExtractedPage[],
): { textQuality: TextQuality; requiresOcr: boolean } {
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { textQuality: 'poor', requiresOcr: true };
  }

  const textRichPages = pages.filter((page) => page.charCount >= 100);
  const textRichRatio = textRichPages.length / pageCount;
  const totalChars = pages.reduce((sum, page) => sum + page.charCount, 0);

  if (totalChars >= 5000 && textRichRatio >= 0.5) {
    return { textQuality: 'good', requiresOcr: false };
  }

  if (totalChars >= 500 || textRichRatio >= 0.2) {
    return { textQuality: 'medium', requiresOcr: false };
  }

  return { textQuality: 'poor', requiresOcr: true };
}

async function extractPagesFromBuffer(buffer: Buffer): Promise<ExtractedPage[]> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = pageTextFromContent(content.items as Array<{ str?: string }>);
    const charCount = text.length;

    pages.push({
      pageNumber,
      text: charCount < 10 ? '' : text,
      charCount: charCount < 10 ? 0 : charCount,
    });
  }

  return pages;
}

export async function extractPdfText(
  input: PdfExtractionInput,
): Promise<PdfExtractionResult> {
  const buffer = await downloadPdfFromR2(input.r2Bucket, input.r2Key);

  if (buffer.length === 0) {
    throw new Error('PDF buffer is empty (0 bytes)');
  }

  const pages = await extractPagesFromBuffer(buffer);
  const totalCharacterCount = pages.reduce((sum, page) => sum + page.charCount, 0);
  const { textQuality, requiresOcr } = scoreTextQuality(pages);

  if (requiresOcr) {
    console.log(
      `${LOG_PREFIX} Document ${input.documentId}: text quality = poor, requires OCR — marked for future OCR pass`,
    );
  }

  return {
    documentId: input.documentId,
    bidId: input.bidId,
    pageCount: pages.length,
    pages,
    totalCharacterCount,
    textQuality,
    requiresOcr,
  };
}
