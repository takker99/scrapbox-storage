/** 圧縮したリンクデータ
 *
 * property nameを省略することでデータ量を減らしている
 */
export type CompressedLink = [
  string, // title; page title
  boolean, // hasIcon; whether to have images
  number, // updated; 空ページのときは-1になる
  ...string[], // links
];

/** link data */
export interface Link {
  /** page title */
  title: string;

  /** links the page has */
  links: string[];

  /** whether to have images */
  hasIcon: boolean;

  /** whether the page exists */
  exists: boolean;

  /** updated time (UNIX time) */
  updated: number;
}

/** 圧縮したリンク情報を見やすくする */
export const decode = (link: CompressedLink): Link => {
  const [title, hasIcon, updated, ...links] = link;

  return {
    title,
    links,
    hasIcon,
    exists: updated >= 0,
    updated: Math.min(0, updated),
  };
};

/** リンク情報をDB用に圧縮する */
export const encode = (
  link: Link,
): CompressedLink => [
  link.title,
  link.hasIcon,
  link.exists ? link.updated : -1,
  ...link.links,
];
