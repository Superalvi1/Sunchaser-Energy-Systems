/**
 * Cursor-safe live message page repartition.
 * Keeps the newest page bounded while preserving displaced boundary messages.
 */
import type { InboxMessage, InboxMessagesPage } from "../types";

export const INBOX_MESSAGE_PAGE_SIZE = 50;

function sortNewestFirst(rows: InboxMessage[]): InboxMessage[] {
  return [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt < a.createdAt ? -1 : 1;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

function dedupeById(rows: InboxMessage[]): InboxMessage[] {
  const seen = new Set<string>();
  const out: InboxMessage[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function toBase64Url(json: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64url");
  }
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function messageKeysetCursor(message: InboxMessage): string {
  return toBase64Url(JSON.stringify({ at: message.createdAt, id: message.id }));
}

export type InfiniteMessagesData = {
  pages: InboxMessagesPage[];
  pageParams: unknown[];
};

/**
 * Replace the newest page with a fresh server page (bounded), spill any
 * displaced messages into older pages, and preserve the terminal server cursor
 * so older-message pagination remains correct and duplicate-free.
 */
export function repartitionLiveMessagePages(
  freshFirstPage: InboxMessagesPage,
  previous: InfiniteMessagesData | undefined,
  pageSize: number = INBOX_MESSAGE_PAGE_SIZE
): InfiniteMessagesData {
  const freshMessages = sortNewestFirst(
    dedupeById(freshFirstPage.messages)
  ).slice(0, pageSize);
  const freshIds = new Set(freshMessages.map((m) => m.id));

  const priorPages = previous?.pages ?? [];
  const priorMessages = priorPages.flatMap((p) => p.messages);
  const spilled = priorMessages.filter((m) => !freshIds.has(m.id));
  const olderUnique = sortNewestFirst(dedupeById(spilled));

  // Terminal cursor: prefer the oldest loaded page's nextCursor, else server's.
  const terminalCursor =
    priorPages.length > 0
      ? (priorPages[priorPages.length - 1]?.nextCursor ??
        freshFirstPage.nextCursor)
      : freshFirstPage.nextCursor;

  const firstPage: InboxMessagesPage = {
    messages: freshMessages,
    nextCursor:
      olderUnique.length > 0
        ? messageKeysetCursor(freshMessages[freshMessages.length - 1]!)
        : freshFirstPage.nextCursor,
  };

  const olderPages: InboxMessagesPage[] = [];
  for (let i = 0; i < olderUnique.length; i += pageSize) {
    const chunk = olderUnique.slice(i, i + pageSize);
    const isLast = i + pageSize >= olderUnique.length;
    olderPages.push({
      messages: chunk,
      nextCursor: isLast
        ? terminalCursor
        : messageKeysetCursor(chunk[chunk.length - 1]!),
    });
  }

  const pages = [firstPage, ...olderPages];
  const pageParams: unknown[] = pages.map((_, index) => {
    if (index === 0) return null;
    const prev = pages[index - 1]!;
    const oldest = prev.messages[prev.messages.length - 1];
    return oldest ? messageKeysetCursor(oldest) : null;
  });

  return { pages, pageParams };
}

/** Pure helper: newest-page length after many live refresh cycles. */
export function newestPageSize(
  data: InfiniteMessagesData | undefined
): number {
  return data?.pages[0]?.messages.length ?? 0;
}
