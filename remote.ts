import {
  getLinks,
  InvalidFollowingIdError,
  Result,
} from "./deps/scrapbox-rest.ts";
import { CompressedLink } from "./link.ts";
import { createDebug } from "./debug.ts";
import {
  NotFoundError,
  NotLoggedInError,
  SearchedTitle,
} from "./deps/scrapbox.ts";
import { convertLinks } from "./convertLinks.ts";

const logger = createDebug("scrapbox-storage:remote.ts");

/** remoteからリンクデータを取得する */
export const downloadLinks = async (
  project: string,
): Promise<
  Result<
    CompressedLink[],
    NotFoundError | NotLoggedInError | InvalidFollowingIdError
  >
> => {
  let followingId: string | undefined;
  const pages: SearchedTitle[] = [];

  const tag = `download and create Links of "${project}"`;
  logger.time(tag);

  do {
    const res = await getLinks(project, { followingId });
    if (!res.ok) return res;
    followingId = res.value.followingId;
    pages.push(...res.value.pages);
  } while (followingId);
  const result = convertLinks(pages);

  logger.timeEnd(tag);

  return { ok: true, value: result };
};
