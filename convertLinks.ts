import { SearchedTitle, toTitleLc } from "./deps/scrapbox.ts";
import { CompressedLink, encode, Link } from "./link.ts";

/** Search Title APIから取得したリンクデータを、DBに格納する形式に変換する */
export const convertLinks = (pages: SearchedTitle[]): CompressedLink[] => {
  const linkMap = new Map<string, Link>();

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

  return [...linkMap.values()].map((link) => encode(link));
};
