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
import type { ProjectForDB } from "./schema-v2.ts";

export interface ProjectStatus extends Omit<Project, "plan" | "trialing"> {
  checked: number;
}

/** projectの情報を一括取得する */
export async function* fetchProjectStatus(
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
  const projectIds: string[] = [];
  let newProjects: string[] = [];
  const checkedMap = new Map<string, number>();
  const names: string[] = [];
  for (const project of projects) {
    if (!project.isValid) continue;
    if (project.id) {
      projectIds.push(project.id);
    } else {
      newProjects.push(project.name);
    }
    names.push(project.name);
    checkedMap.set(project.name, project.checked);
  }
  const result = await listProjects(projectIds);
  if (isErr(result)) {
    // log inしていないときは、getProject()で全てのprojectのデータを取得する
    newProjects = names;
  } else {
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
