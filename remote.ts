import { readLinksBulk, toTitleLc } from "./deps/scrapbox-rest.ts";
import { CompressedLink, encode, Link } from "./link.ts";
import { createDebug } from "./debug.ts";

const logger = createDebug("scrapbox-storage:remote.ts");

/** remoteからリンクデータを取得する */
export const downloadLinks = async (
  project: string,
): Promise<CompressedLink[]> => {
  const reader = await readLinksBulk(project);
  if ("name" in reader) {
    console.error(reader);
    throw new Error(`${reader.name}: ${reader.message}`);
  }

  const tag = `download and create Links of "${project}"`;
  logger.time(tag);
  const linkMap = new Map<string, Link>();

  for await (const pages of reader) {
    for (const page of pages) {
      const titleLc = toTitleLc(page.title);
      linkMap.set(titleLc, {
        title: page.title,
        image: page.image,
        updated: page.updated,
        links: page.links,
        exists: true,
      });

      for (const link of page.links) {
        const linkLc = toTitleLc(link);

        if (linkMap.has(linkLc)) continue;

        linkMap.set(linkLc, {
          title: link,
          updated: 0,
          links: [],
          exists: false,
        });
      }
    }
  }
  logger.timeEnd(tag);

  return [...linkMap.values()].map((link) => encode(link));
};
