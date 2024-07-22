import { createErr, createOk, Result } from "./deps/option-t.ts";
import {
  getProject,
  listProjects,
  NotFoundError,
  NotLoggedInError,
  NotMemberError,
  Project,
} from "./deps/scrapbox.ts";
import { ProjectForDB } from "./schema-v2.ts";

export interface ProjectStatus extends Omit<Project, "plan" | "trialing"> {
  checked: number;
}

/** projectの情報を一括取得する */
export async function* fetchProjectStatus(
  projects: Iterable<ProjectForDB>,
): AsyncGenerator<
  Result<
    ProjectStatus,
    (NotLoggedInError | NotFoundError | NotMemberError) & { project: string }
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
  if (!result.ok) {
    // log inしていないときは、getProject()で全てのprojectのデータを取得する
    newProjects = names;
  } else {
    for (const project of result.value.projects) {
      if (!checkedMap.has(project.name)) continue;
      yield createOk({
        ...project,
        checked: checkedMap.get(project.name) ?? 0,
      });
    }
  }
  for (const name of newProjects) {
    const res = await getProject(name);
    yield res.ok
      ? createOk({ ...res.value, checked: checkedMap.get(name) ?? 0 })
      : createErr({ ...res.value, project: name });
  }
}
