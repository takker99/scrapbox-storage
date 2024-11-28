import { createDebug } from "@takker/debug-js";
import { readProjects } from "./project.ts";
import { open } from "./db.ts";
import { type Diff, emitChange } from "./subscribe.ts";
import type { ProjectForDB, ValidProject } from "./schema.ts";
import { getUnixTime } from "date-fns/getUnixTime";
import { isErr, unwrapErr, unwrapOk } from "option-t/plain_result";
import { readLinksBulk } from "@cosense/std/rest";
import type { Link } from "./link.ts";
export * from "./link.ts";
export * from "./subscribe.ts";

const logger = /*@__PURE__*/ createDebug("scrapbox-storage:mod.ts");

/** 手動で更新を確認する。更新があればDBに反映する。
 *
 * @param projects 更新を確認したい補完ソースのproject names
 * @param maxAge 最後に更新を確認してからどのくらい経過したデータを更新すべきか (単位は秒)
 */
export const check = async (
  projects: readonly string[],
  maxAge: number,
): Promise<void> => {
  const db = await open();

  /** project id がkey */
  const projectStatus = new Map<string, ProjectForDB>();
  try {
    // 更新する必要のあるデータを探し、更新中フラグを立てる
    {
      logger.debug("check updates of links...");

      const loadedProjectNames = new Set<string>();
      const tx = db.transaction("projects", "readwrite");
      const now = getUnixTime(new Date());
      const lower = now - 600;
      for await (
        const cursor of tx.store.index("checked").iterate(
          IDBKeyRange.lowerBound(lower, true),
        )
      ) {
        const status = cursor.value;
        if (status.isValid === false) {
          loadedProjectNames.add(status.id);
          continue;
        }
        loadedProjectNames.add(status.name);

        const prevChecked = status.checked;
        // 更新されたばかりのデータは飛ばす
        if (prevChecked + maxAge > now) continue;
        // 更新中にタブが強制終了した可能性を考慮して、更新中フラグが経った時刻より10分経過していたらデータ更新対象に含める
        if (status?.updating && prevChecked > lower) continue;

        const tempStatus = structuredClone(status);
        tempStatus.updating = true;

        projectStatus.set(status.id, tempStatus);
        cursor.update(tempStatus);
      }
      await tx.done;

      for (const project of projects) {
        if (loadedProjectNames.has(project)) continue;
        projectStatus.set(project, makeDummyValidProject(project));
      }

      // 更新するprojectsがなければ何もしない
      if (projectStatus.size === 0) {
        logger.debug("checked. No project needs upgrade.");
        return;
      }
      logger.debug(
        `checked. ${projectStatus.size} projects maybe need upgrade.`,
      );
    }

    const now = getUnixTime(new Date());

    // 一つづつ更新する
    for await (const res of readProjects(projectStatus.values())) {
      // project dataを取得できないときは、無効なprojectに分類しておく
      // FetchErrorは一時的なエラーである可能性が高いので、無効にせず無視する
      if (isErr(res)) {
        const { project, name } = unwrapErr(res);
        switch (name) {
          default:
            continue;
          case "NotFoundError":
            logger.warn(`"${project}" is not found.`);
            break;
          case "NotMemberError":
            logger.warn(`You are not a member of "${project}".`);
            break;
          case "NotLoggedInError":
            logger.warn(
              `You are not a member of "${project}" or You are not logged in yet.`,
            );
            break;
        }
        projectStatus.set(project, {
          id: project,
          checked: now,
          updating: false,
          isValid: false,
          reason: name,
        });
        continue;
      }

      const { checked, ...project } = unwrapOk(res);

      // projectの最終更新日時から、updateの要不要を調べる
      if (project.updated < checked) {
        logger.debug(`no updates in "${project.name}"`);
        projectStatus.set(project.name, {
          ...project,
          isValid: true,
          checked: now,
          updating: false,
        });
        continue;
      }

      const tag = `download and store links of "${project.name}"`;
      logger.time(tag);
      const titleIds = new Set(
        await db.getAllKeysFromIndex(
          "titles",
          "project",
          project.name,
        ),
      );
      let addedCount = 0;
      let updatedCount = 0;
      // pagesを取得し、更新分をDBに反映する
      for await (const result of readLinksBulk(project.name)) {
        if (isErr(result)) {
          const { name, message } = unwrapErr(result);
          logger.error(
            `Failed to get links of "${project.name}" with ${name}: ${message}`,
          );
          break;
        }
        const titles = unwrapOk(result);

        const diff: Diff = {};

        const tx = db.transaction("titles", "readwrite");
        await Promise.all(
          titles.map(async (title) => {
            const link = { ...title, project: project.name };
            if (!titleIds.has(title.id)) {
              diff.added?.set?.(title.id, link) ??
                (diff.added = new Map([[title.id, link]]));
              return tx.store.add(link);
            }
            titleIds.delete(title.id);
            const fromLocal = await tx.store.get(title.id);
            if (!fromLocal) {
              diff.added?.set?.(title.id, link) ??
                (diff.added = new Map([[title.id, link]]));
              return tx.store.add(link);
            }
            if (fromLocal.updated >= link.updated) return;
            diff.updated?.set?.(title.id, [fromLocal, link]) ??
              (diff.updated = new Map([[title.id, [fromLocal, link]]]));
            return tx.store.put(link);
          }),
        );
        await tx.done;

        addedCount += diff.added?.size ?? 0;
        updatedCount += diff.updated?.size ?? 0;

        logger.debug(
          `Updating "/${project.name}": +${addedCount} pages, ~${updatedCount} pages`,
        );

        emitChange(project.name, diff);
      }

      const tx = db.transaction("titles", "readwrite");
      const deleted = new Map(
        (await Promise.all(
          // delete dropped titles
          [...titleIds].map(async (id) => {
            const link = await tx.store.get(id);
            if (!link) return [];
            const entry = [[id, link]] as const;
            await tx.store.delete(id);
            return entry;
          }),
        )).flat(),
      );
      await tx.done;
      logger.timeEnd(tag);
      logger.debug(
        `Update "/${project.name}": +${addedCount} pages, ~${updatedCount} pages, -${deleted.size} pages`,
      );

      projectStatus.set(project.name, {
        ...project,
        isValid: true,
        checked: now,
        updating: false,
      });

      // リンクの差分を通知する
      emitChange(project.name, { deleted });
    }
  } finally {
    // エラーが起きた場合も含め、フラグをもとに戻しておく
    const tx = db.transaction("projects", "readwrite");
    await Promise.all(
      [...projectStatus].map(([, status]) => {
        status.updating = false;
        return tx.store.put({ ...status });
      }),
    );
    await tx.done;
  }
};

/** リンクデータをDBから取得する。データの更新は行わない。
 *
 * @param projects 取得したいリンクデータのproject nameのリスト
 */
export const load = async (
  projects: Iterable<string>,
): Promise<Link[]> => {
  const keys = [...new Set(projects)];
  if (keys.length === 0) return [];

  const start = Date.now();
  const db = await open();
  const tx = db.transaction("titles", "readonly");
  const index = tx.store.index("project");
  const links =
    (await Promise.all(keys.map((project) => index.getAll(project)))).flat();
  await tx.done;
  logger.debug(
    `Read ${links.length} links from ${keys.length} projects in ${
      Date.now() - start
    }ms`,
  );

  return links;
};

const makeDummyValidProject = (name: string): ValidProject => ({
  name,
  displayName: name,
  id: "",
  isValid: true,
  publicVisible: true,
  isMember: true,
  loginStrategies: [],
  theme: "default",
  gyazoTeamsName: null,
  translation: true,
  infobox: true,
  checked: 0,
  updated: 0,
  created: 0,
  updating: true,
});
