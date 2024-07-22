import { SearchedTitle } from "./deps/scrapbox.ts";
import { PageForDB } from "./schema-v2.ts";

/** link data */
export interface Link extends SearchedTitle {
  /** project name */
  project: string;
}

/** 圧縮したリンク情報を見やすくする */
export const decode = (page: PageForDB): Link => {
  const { path: [project, title], link: [id, image, updated, ...links] } = page;

  return { project, title, id, image, updated, links };
};

/** リンク情報をDB用に圧縮する */
export const encode = (
  link: Link,
): PageForDB => ({
  path: [link.project, link.title],
  link: [link.id, link.image, link.updated, ...link.links],
});
