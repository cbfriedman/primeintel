import type { ExtractedPage } from './extract-pdf-text';

export type PriorityTextResult = {
  text: string;
  totalCharacters: number;
  pagesIncluded: number[];
  wasTruncated: boolean;
};

const DEFAULT_CHAR_LIMIT = 60_000;
const FIRST_PAGES_COUNT = 10;

const KEYWORD_PATTERNS: RegExp[] = [
  /engineer's estimate|engineers estimate|estimated cost|estimate of cost/i,
  /liquidated damages/i,
  /working days|calendar days/i,
  /bid bond/i,
  /performance bond/i,
  /payment bond/i,
  /\bdbe\b|disadvantaged business/i,
  /contractor license|class a|class b|c-/i,
  /night work|night operations|night shift/i,
  /hazardous|hazmat|contaminated/i,
  /retention|retainage/i,
  /insurance|liability insurance/i,
  /prevailing wage/i,
  /subcontractor|subcontracting/i,
];

function pageMatchesKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORD_PATTERNS.some((pattern) => pattern.test(lower));
}

function formatPageBlock(page: ExtractedPage): string {
  return `\n\n=== Page ${page.pageNumber} ===\n\n${page.text}`;
}

export function buildPriorityText(
  pages: ExtractedPage[],
  charLimit = DEFAULT_CHAR_LIMIT,
): PriorityTextResult {
  if (pages.length === 0) {
    return {
      text: '',
      totalCharacters: 0,
      pagesIncluded: [],
      wasTruncated: false,
    };
  }

  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  const included = new Set<number>();

  for (let pageNumber = 1; pageNumber <= Math.min(FIRST_PAGES_COUNT, pages.length); pageNumber += 1) {
    included.add(pageNumber);
  }

  for (const page of pages) {
    if (page.pageNumber <= FIRST_PAGES_COUNT) {
      continue;
    }

    if (!pageMatchesKeywords(page.text)) {
      continue;
    }

    included.add(page.pageNumber);

    if (page.pageNumber > 1) {
      included.add(page.pageNumber - 1);
    }

    if (page.pageNumber < pages.length) {
      included.add(page.pageNumber + 1);
    }
  }

  const sortedPageNumbers = [...included].sort((a, b) => a - b);
  const parts: string[] = [];
  let totalCharacters = 0;
  let wasTruncated = false;
  const pagesIncluded: number[] = [];

  if (pages.length <= FIRST_PAGES_COUNT) {
    for (const page of pages) {
      const block = formatPageBlock(page);
      parts.push(block);
      pagesIncluded.push(page.pageNumber);
      totalCharacters += block.length;
    }

    return {
      text: parts.join('').trimStart(),
      totalCharacters,
      pagesIncluded,
      wasTruncated: false,
    };
  }

  for (const pageNumber of sortedPageNumbers) {
    const page = pageByNumber.get(pageNumber);
    if (!page) {
      continue;
    }

    const block = formatPageBlock(page);
    if (totalCharacters + block.length > charLimit) {
      wasTruncated = true;
      break;
    }

    parts.push(block);
    pagesIncluded.push(pageNumber);
    totalCharacters += block.length;
  }

  return {
    text: parts.join('').trimStart(),
    totalCharacters,
    pagesIncluded,
    wasTruncated,
  };
}
