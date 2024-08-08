import type { DBSchema } from "idb";

/** 圧縮したリンクデータ
 *
 * property nameを省略することでデータ量を減らしている
 */
export type CompressedLink = [
  string, // title; page title
  string | undefined, // image page thumbnail
  number, // updated; 空ページのときは-1になる
  ...string[], // links
];

export interface Source {
  /** project name (key) */
  project: string;

  /** link data */
  links: CompressedLink[];
}

/** リンクデータDBのschema */
export interface SchemaV1 extends DBSchema {
  /** link dataを格納するstore */
  links: {
    value: Source;
    key: string;
  };

  /** projectの更新状況を格納するstore */
  status: {
    value: SourceStatus;
    key: string;
  };
}

export interface Source {
  /** project name (key) */
  project: string;

  /** link data */
  links: CompressedLink[];
}

export type SourceStatus = ProjectStatus | InvalidProjectStatus;

export interface ProjectStatus {
  /** project name (key) */
  project: string;

  /** project id
   *
   * projectsの更新日時を一括取得するときに使う
   */
  id?: string;

  /** 有効なprojectかどうか
   *
   * アクセス権のないprojectと存在しないprojectの場合はfalseになる
   */
  isValid: true;

  /** projectの最終更新日時
   *
   * リンクデータの更新を確認するときに使う
   */
  updated: number;

  /** データの最終確認日時 */
  checked: number;

  /** 更新中フラグ */
  updating: boolean;
}

export interface InvalidProjectStatus {
  /** project name (key) */
  project: string;

  /** 有効なprojectかどうか
   *
   * アクセス権のないprojectと存在しないprojectの場合はfalseになる
   */
  isValid: false;
}
