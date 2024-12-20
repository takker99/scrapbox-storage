import type { DBSchema } from "idb";
import type { Project } from "@cosense/types/rest";
import type { Link } from "./link.ts";

/** リンクデータDBのschema */
export interface Schema extends DBSchema {
  /** link dataを格納するstore */
  titles: {
    value: Link;
    /** page id */
    key: string;
    indexes: {
      project: string;
    };
  };

  /** projectの更新状況を格納するstore */
  projects: {
    value: ProjectForDB;
    /** project id */
    key: string;
    indexes: {
      name: string;
      checked: number;
    };
  };
}

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
  /** project id (key)
   *
   * If the project id cannot be obtained because of NotFoundError and so on, the project name is used as the key.
   */
  id: string;

  /** project name */
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

  /** the reason why the project is invalid */
  reason: "NotFoundError" | "NotMemberError" | "NotLoggedInError";
}
