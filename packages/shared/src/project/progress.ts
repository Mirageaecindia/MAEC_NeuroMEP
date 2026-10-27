import { PageKeySchema, type PageKey } from './enums.js';

/** Working pages in the order the tabs are opened (A-12). */
export const PAGE_ORDER: readonly PageKey[] = PageKeySchema.options;

export const pageIndex = (page: PageKey): number => PAGE_ORDER.indexOf(page);

/** The later of two pages. */
export const laterPage = (a: PageKey, b: PageKey): PageKey =>
  pageIndex(a) >= pageIndex(b) ? a : b;

/**
 * Furthest page the project has reached (A-12). Tabs up to it can be opened in any order; the next
 * one opens only through Next. Projects saved before A-12 have no `reachedPage`: their last page
 * counts as reached.
 */
export function reachedPage(meta: {
  lastPage: PageKey;
  reachedPage?: PageKey | undefined;
}): PageKey {
  return meta.reachedPage ? laterPage(meta.reachedPage, meta.lastPage) : meta.lastPage;
}

export const canOpenPage = (
  meta: { lastPage: PageKey; reachedPage?: PageKey | undefined },
  page: PageKey,
): boolean => pageIndex(page) <= pageIndex(reachedPage(meta));
