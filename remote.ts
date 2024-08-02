import {
  type FetchError,
  type LinksError,
  readLinksBulk,
} from "@cosense/std/rest";
import type { CompressedLink } from "./link.ts";
import { createDebug } from "@takker/debug-js";
import type { SearchedTitle } from "@cosense/types/rest";
import { convertLinks } from "./convertLinks.ts";
import { createOk, isErr, type Result, unwrapOk } from "option-t/plain_result";

const logger = createDebug("scrapbox-storage:remote.ts");

/** remoteからリンクデータを取得する */
export const downloadLinks = async (
  project: string,
): Promise<Result<CompressedLink[], LinksError | FetchError>> => {
  const pages: SearchedTitle[] = [];

  const tag = `download and create Links of "${project}"`;
  logger.time(tag);
  for await (const result of readLinksBulk(project)) {
    if (isErr(result)) return result;
    pages.push(...unwrapOk(result));
  }

  const links = convertLinks(pages);

  logger.timeEnd(tag);

  return createOk(links);
};
