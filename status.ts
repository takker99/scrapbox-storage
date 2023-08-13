import { getProject, listProjects, Result } from "./deps/scrapbox-rest.ts";
import {
  NotFoundError,
  NotLoggedInError,
  NotMemberError,
  Project,
} from "./deps/scrapbox.ts";

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

/** projectの情報を一括取得する */
export async function* fetchProjectStatus(
  projects: ProjectStatus[],
): AsyncGenerator<
  Result<
    Project & { checked: number },
    (NotLoggedInError | NotFoundError | NotMemberError) & { project: string }
  >,
  void,
  unknown
> {
  // idがあるものとないものとに分ける
  const projectIds: string[] = [];
  let newProjects: string[] = [];
  const checkedMap = new Map<string, number>();
  for (const project of projects) {
    if (project.id) {
      projectIds.push(project.id);
    } else {
      newProjects.push(project.project);
    }
    checkedMap.set(project.project, project.checked);
  }
  const result = await listProjects(projectIds);
  if (!result.ok) {
    // log inしていないときは、getProject()で全てのprojectのデータを取得する
    newProjects = projects.map((project) => project.project);
  } else {
    for (const project of result.value.projects) {
      if (!checkedMap.has(project.name)) continue;
      yield {
        ok: true,
        value: { ...project, checked: checkedMap.get(project.name) ?? 0 },
      };
    }
  }
  for (const name of newProjects) {
    const res = await getProject(name);
    yield res.ok
      ? {
        ok: true,
        value: { ...res.value, checked: checkedMap.get(name) ?? 0 },
      }
      : { ok: false, value: { ...res.value, project: name } };
  }
}
