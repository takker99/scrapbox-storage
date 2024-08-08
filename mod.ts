import { createDebug } from "@takker/debug-js";
import { readProjects } from "./project.ts";
import { open } from "./db.ts";
import { type Diff, emitChange } from "./subscribe.ts";
import type { ProjectForDB, ValidProject } from "./schema-v2.ts";
import { getUnixTime } from "date-fns/getUnixTime";
import { isErr, unwrapErr, unwrapOk } from "option-t/plain_result";
import { readLinksBulk } from "@cosense/std/rest";
import type { Link } from "./link.ts";
export * from "./link.ts";
export * from "./subscribe.ts";

const logger = createDebug("scrapbox-storage:mod.ts");

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

  /** project name がkey */
  const projectStatus = new Map<string, ProjectForDB>();
  try {
    // 更新する必要のあるデータを探し、更新中フラグを立てる
    {
      logger.debug("check updates of links...");

      const tx = db.transaction("projects", "readwrite");
      const now = getUnixTime(new Date());
      const lower = now - 600;
      for await (
        const cursor of tx.store.index("checked").iterate(
          IDBKeyRange.lowerBound(lower, true),
        )
      ) {
        const status = cursor.value;
        if (status?.isValid === false) continue;

        const prevChecked = status?.checked ?? 0;
        // 更新されたばかりのデータは飛ばす
        if (prevChecked + maxAge > now) continue;
        // 更新中にタブが強制終了した可能性を考慮して、更新中フラグが経った時刻より10分経過していたらデータ更新対象に含める
        if (status?.updating && prevChecked > lower) continue;

        const name = status?.name ?? "";
        const tempStatus = structuredClone(status);
        tempStatus.updating = true;

        projectStatus.set(name, tempStatus);
        cursor.update(tempStatus);
      }
      await tx.done;

      for (const project of projects) {
        if (projectStatus.has(project)) continue;
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
        projectStatus.set(project, {
          name: project,
          checked: now,
          updating: false,
          isValid: false,
        });
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
          case "HTTPError":
          case "NetworkError":
          case "AbortError":
            continue;
        }
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

      const diff: Diff = {
        added: new Map(),
        updated: new Map(),
        deleted: new Set(),
      };
      let prevLower = 0;

      const tag = `download and store links of "${project.name}"`;
      logger.time(tag);
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
        for (const title of titles) {
          diff.added.set(title.id, { ...title, project: project.name });
        }

        // 取得したページは更新日時順に並んでいる。
        // よって、その範囲と同じ範囲のデータだけをDBから逐次読み込んでいけば、
        // 一度にDB全体のキーを走査することなく、削除されたページを特定できる。
        const upper = Math.max(...titles.map((title) => title.updated));
        const range = IDBKeyRange.bound(
          prevLower,
          upper,
          true,
        );
        prevLower = upper;

        const tx = db.transaction("titles", "readwrite");
        for await (const cursor of tx.store.index("updated").iterate(range)) {
          const page = cursor.value;
          if (page.project !== project.name) continue;
          const newPage = diff.added.get(page.id);
          if (!newPage) {
            diff.deleted.add(page.id);
            continue;
          }
          diff.deleted.delete(page.id);
          if (page.updated < newPage.updated) {
            diff.updated.set(page.id, newPage);
            cursor.update(newPage);
          }
          diff.added.delete(page.id);
        }
        await tx.done;
      }

      const tx = db.transaction("titles", "readwrite");
      await Promise.all([
        // add new pages
        ...[...diff.added].map(([pageId, page]) => tx.store.put(page, pageId)),
        // delete dropped pages
        ...[...diff.deleted].map((pageId) => tx.store.delete(pageId)),
      ]);
      await tx.done;
      logger.timeEnd(tag);
      logger.debug(
        `Update "/${project.name}": +${diff.added.size} pages, ~${diff.updated.size} pages, -${diff.deleted.size} pages`,
      );

      projectStatus.set(project.name, {
        ...project,
        isValid: true,
        checked: now,
        updating: false,
      });

      // リンクの差分を通知する
      emitChange(project.name, diff);
    }
  } finally {
    // エラーが起きた場合も含め、フラグをもとに戻しておく
    const tx = db.transaction("projects", "readwrite");
    await Promise.all(
      [...projectStatus.values()].map((status) => {
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
