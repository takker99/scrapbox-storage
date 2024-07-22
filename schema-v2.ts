import { DBSchema } from "./deps/idb.ts";
import { Project } from "./deps/scrapbox.ts";

/** リンクデータDBのschema */
export interface LinkDBV2 extends DBSchema {
  /** link dataを格納するstore */
  links: {
    value: PageForDB;
    key: [string, string];
  };

  /** projectの更新状況を格納するstore */
  projects: {
    value: ProjectForDB;
    key: string;
    indexes: {
      /** データの最終確認日時で検索するためのindex */
      checked: number;
    };
  };
}

export interface PageForDB {
  /** project name and page title (key) */
  path: readonly [string, string];
  link: CompressedLink;
}

/** 圧縮したリンクデータ
 *
 * property nameを省略することでデータ量を減らしている
 */
export type CompressedLink = [
  string, // page id
  string | undefined, // image page thumbnail
  number, // updated
  ...string[], // links
];

export type ProjectForDB = ValidProject | InvalidProject;

export interface ValidProject extends Omit<Project, "trialing"> {
  /** データの最終確認日時 */
  checked: number;

  /** 更新中フラグ */
  updating: boolean;

  /** 有効なprojectかどうか */
  isValid: true;
}

export interface InvalidProject {
  /** project name (key) */
  name: string;

  /** データの最終確認日時 */
  checked: number;

  /** 更新中フラグ */
  updating: boolean;

  /** 有効なprojectかどうか
   *
   * アクセス権のないprojectと存在しないprojectの場合はfalseになる
   */
  isValid: false;
}
