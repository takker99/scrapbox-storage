import { createDebug } from "@takker/debug-js";
import { downloadLinks } from "./remote.ts";
import { fetchProjectStatus, type ProjectStatus } from "./status.ts";
import { open, write } from "./db.ts";
import { emitChange } from "./subscribe.ts";
import { isErr, unwrapErr, unwrapOk } from "option-t/plain_result";
import type { Source, SourceStatus } from "./schema-v1.ts";
export { subscribe } from "./subscribe.ts";
export type { LinkEvent, Listener } from "./subscribe.ts";
export type { Source };
export * from "./link.ts";

const logger = createDebug("scrapbox-storage:mod.ts");

/** 手動で更新を確認する。更新があればDBに反映する。
 *
 * @param projects 更新を確認したい補完ソースのproject names
 * @param updateInterval 最後に更新を確認してからどのくらい経過したデータを更新すべきか (単位は秒)
 * @return 更新があったprojectのリンクデータ
 */
export const check = async (
  projects: readonly string[],
  updateInterval: number,
): Promise<Source[]> => {
  const db = await open();

  const projectsMaybeNeededUpgrade: ProjectStatus[] = [];
  const projectStatus: SourceStatus[] = [];
  try {
    // 更新する必要のあるデータを探し、更新中フラグを立てる
    {
      logger.debug("check updates of links...");

      const tx = db.transaction("status", "readwrite");
      await Promise.all(projects.map(async (project) => {
        const status = await tx.store.get(project);

        if (status?.isValid === false) return;

        const checked = status?.checked ?? 0;
        const now = new Date().getTime() / 1000;
        // 更新されたばかりのデータは飛ばす
        if (checked + updateInterval > now) return;
        // 更新中にタブが強制終了した可能性を考慮して、更新中フラグが経った時刻より10分経過していたらデータ更新対象に含める
        if (status?.updating && checked + 600 > now) return;

        const tempStatus: ProjectStatus = {
          project,
          id: status?.id,
          isValid: true,
          checked,
          updated: status?.updated ?? 0,
          updating: true,
        };

        projectsMaybeNeededUpgrade.push(tempStatus);
        tx.store.put(tempStatus);
      }));
      await tx.done;

      logger.debug(
        `checked. ${projectsMaybeNeededUpgrade.length} projects maybe need upgrade.`,
      );
    }

    // 更新するprojectsがなければ何もしない
    if (projectsMaybeNeededUpgrade.length === 0) return [];

    /** 更新されたprojects */
    const updatedProjects: string[] = [];
    const result: Source[] = [];

    // 一つづつ更新する
    for await (const res of fetchProjectStatus(projectsMaybeNeededUpgrade)) {
      // project dataを取得できないときは、無効なprojectに分類しておく
      if (isErr(res)) {
        const { project, name } = unwrapErr(res);
        projectStatus.push({ project, isValid: false });
        switch (name) {
          case "NotFoundError":
            logger.warn(`"${project}" is not found.`);
            continue;
          case "NotMemberError":
            logger.warn(`You are not a member of "${project}".`);
            continue;
          case "NotLoggedInError":
            logger.warn(
              `You are not a member of "${project}" or You are not logged in yet.`,
            );
            continue;
        }
      }

      const { name, updated, checked, id } = unwrapOk(res);
      // projectの最終更新日時から、updateの要不要を調べる
      if (updated < checked) {
        logger.debug(`no updates in "${name}"`);
      } else {
        const res2 = await downloadLinks(name);
        if (isErr(res2)) {
          const { name, message } = unwrapErr(res2);
          throw Error(`${name} ${message}`);
        }
        // リンクデータを更新する
        const data: Source = {
          project: name,
          links: unwrapOk(res2),
        };
        result.push(data);

        logger.time(`write data of "${name}"`);
        await write(data);
        updatedProjects.push(name);
        logger.timeEnd(`write data of "${name}"`);
      }

      projectStatus.push({
        project: name,
        isValid: true,
        id,
        checked: new Date().getTime() / 1000,
        updated,
        updating: false,
      });
    }

    // 更新通知を出す
    if (updatedProjects.length > 0) emitChange(updatedProjects);

    return result;
  } finally {
    // エラーが起きた場合も含め、フラグをもとに戻しておく
    const tx = db.transaction("status", "readwrite");
    const store = tx.store;
    await Promise.all(
      projectStatus.map((status) => store.put(status)),
    );
    await tx.done;
  }
};

/** リンクデータをDBから取得する。データの更新は行わない。
 *
 * @param projects 取得したい補完ソースのproject nameのリスト
 * @return リンクデータのリスト projectsと同じ順番で並んでいる
 */
export const load = async (
  projects: readonly string[],
): Promise<Source[]> => {
  const list: Source[] = [];

  const start = new Date();
  {
    const tx = (await open()).transaction("links", "readonly");
    await Promise.all(projects.map(async (project) => {
      const source = await tx.store.get(project);
      list.push(source ?? { project, links: [] });
    }));
    await tx.done;
  }
  const ms = new Date().getTime() - start.getTime();
  logger.debug(`Read links of ${projects.length} projects in ${ms}ms`);

  return list;
};
