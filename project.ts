import {
  type FetchError,
  getProject,
  listProjects,
  type ProjectError,
} from "@cosense/std/rest";
import {
  createErr,
  createOk,
  isErr,
  isOk,
  type Result,
  unwrapErr,
  unwrapOk,
} from "option-t/plain_result";
import type { Project } from "@cosense/types/rest";
import type { ProjectForDB } from "./schema.ts";

export interface ProjectStatus extends Omit<Project, "plan" | "trialing"> {
  checked: number;
}

/** projectの情報を一括取得する */
export async function* readProjects(
  projects: Iterable<ProjectForDB>,
): AsyncGenerator<
  Result<
    Omit<Project, "plan" | "trialing"> & { checked: number },
    (ProjectError | FetchError) & { project: string }
  >,
  void,
  unknown
> {
  // idがあるものとないものとに分ける
  const notMemberProjectIds: string[] = [];
  let newProjects: string[] = [];
  const checkedMap = new Map<string, number>();
  const names: string[] = [];
  for (const project of projects) {
    if (!project.isValid) continue;
    if (project.id) {
      // memberであるprojectはidを指定しなくても取得できるので除外する
      if (!project.isMember) notMemberProjectIds.push(project.id);
    } else {
      newProjects.push(project.name);
    }
    names.push(project.name);
    checkedMap.set(project.name, project.checked);
  }
  // projectIdsを50個ずつに分割してfetchする
  // 414 Request-URI Too Longを避けるための処理
  for (let i = 0; i < notMemberProjectIds.length; i += 50) {
    const ids = notMemberProjectIds.slice(i, i + 50);
    if (ids.length === 0) break;
    // idは2つ以上必要なので、1つしかない場合は2つにする
    if (ids.length === 1) ids.push(ids[0]);
    const result = await listProjects(ids);
    if (isErr(result)) {
      // log inしていないときは、getProject()で全てのprojectのデータを取得する
      newProjects = names;
      break;
    }
    for (const project of unwrapOk(result).projects) {
      if (!checkedMap.has(project.name)) continue;
      yield createOk({
        ...project,
        checked: checkedMap.get(project.name) ?? 0,
      });
    }
  }
  for (const name of newProjects) {
    const res = await getProject(name);
    yield isOk(res)
      ? createOk({ ...unwrapOk(res), checked: checkedMap.get(name) ?? 0 })
      : createErr({ ...unwrapErr(res), project: name });
  }
}
