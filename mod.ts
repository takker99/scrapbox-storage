/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="dom" />

import { createDebug } from "./deps/debug.ts";
import { fetchProjectStatus } from "./status.ts";
import { open } from "./db.ts";
import { DeletedPage, emitChange, UpdatedPage } from "./subscribe.ts";
import { PageForDB, ProjectForDB, ValidProject } from "./schema-v2.ts";
import { getUnixTime } from "./deps/date-fns.ts";
import { isErr, unwrapErr, unwrapOk } from "./deps/option-t.ts";
import { getLinks } from "./deps/scrapbox.ts";
import { decode, encode, Link } from "./link.ts";
export type { Link } from "./link.ts";
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
      await Promise.all(projects.map(async (name) => {
        const status = await tx.store.get(name);

        if (status?.isValid === false) return;

        const prevChecked = status?.checked ?? 0;
        const now = getUnixTime(new Date());
        // 更新されたばかりのデータは飛ばす
        if (prevChecked + maxAge > now) return;
        // 更新中にタブが強制終了した可能性を考慮して、更新中フラグが経った時刻より10分経過していたらデータ更新対象に含める
        if (status?.updating && prevChecked + 600 > now) return;

        const tempStatus: ValidProject = {
          name,
          displayName: status?.displayName ?? name,
          id: status?.id ?? "",
          isValid: true,
          publicVisible: status?.publicVisible ?? true,
          isMember: status?.isMember ?? true,
          loginStrategies: status?.loginStrategies ?? [],
          theme: status?.theme ?? "default",
          gyazoTeamsName: status?.gyazoTeamsName ?? null,
          translation: status?.translation ?? true,
          infobox: status?.infobox ?? true,
          checked: prevChecked,
          updated: status?.updated ?? 0,
          created: status?.created ?? 0,
          updating: true,
        };

        projectStatus.set(name, tempStatus);
        tx.store.put(tempStatus);
      }));
      await tx.done;

      // 更新するprojectsがなければ何もしない
      if (projectStatus.size === 0) {
        logger.debug("checked. No project needs upgrade.");
        return;
      }
      logger.debug(
        `checked. ${projectStatus.size} projects maybe need upgrade.`,
      );
    }

    /** 更新・新規作成されたlinks
     *
     * project nameをkey、linksをvalueとする
     */
    const updatedLinks = new Map<string, PageForDB[]>();
    /** 削除されたlinks
     *
     * project nameをkey、titlesをvalueとする
     */
    const deletedLinks = new Map<string, Set<string>>();

    const now = getUnixTime(new Date());

    // 一つづつ更新する
    for await (const res of fetchProjectStatus(projectStatus.values())) {
      // project dataを取得できないときは、無効なprojectに分類しておく
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
        }
      }

      const { checked, ...project } = unwrapOk(res);
      // projectの最終更新日時から、updateの要不要を調べる
      if (project.updated < checked) {
        logger.debug(`no updates in "${project.name}"`);
      } else {
        let followingId: string | undefined;

        const query = IDBKeyRange.bound([project, ""], [project, []]);
        const LinksToDelete = new Set(
          (await db.getAllKeys("links", query)).map(([, title]) => title),
        );
        deletedLinks.set(project.name, LinksToDelete);
        const updatedLinksInTheProject: PageForDB[] = [];
        updatedLinks.set(project.name, updatedLinksInTheProject);

        const tag = `download and store links of "${project.name}"`;
        logger.time(tag);
        while (true) {
          const result = await getLinks(project.name, { followingId });
          if (!result.ok) {
            logger.error(
              `Failed to get links of "${project.name}" with ${result.value.name}: ${result.value.message}`,
            );
            LinksToDelete.clear();
            break;
          }
          // Put only updated records
          const tx = db.transaction("links", "readwrite");
          await Promise.all(
            result.value.pages.map(
              async (page) => {
                const prev = await tx.store.get([project.name, page.title]);
                if (prev) LinksToDelete.delete(page.title);
                if (prev && decode(prev).updated >= page.updated) return;
                const encoded = encode({ project: project.name, ...page });
                updatedLinksInTheProject.push(encoded);
                await tx.store.put(encoded);
              },
            ),
          );
          await tx.done;
          if (!result.value.followingId) {
            followingId = undefined;
            break;
          }
          followingId = result.value.followingId;
        }

        // delete dropped links
        const tx = db.transaction("links", "readwrite");
        await Promise.all(
          [...LinksToDelete].map(
            (title) => tx.store.delete([project.name, title]),
          ),
        );
        await tx.done;
        deletedLinks.set(project.name, LinksToDelete);
        logger.timeEnd(tag);
        logger.debug(
          `Updated ${updatedLinksInTheProject.length} links and deleted ${LinksToDelete.size} links from "${project.name}"`,
        );
      }

      projectStatus.set(project.name, {
        ...project,
        isValid: true,
        checked: now,
        updating: false,
      });
    }

    // リンクの差分を通知する
    {
      const diffs = new Map<string, (UpdatedPage | DeletedPage)[]>();
      for (const [project, links] of updatedLinks) {
        const list = diffs.get(project) ?? [];
        list.push(
          ...links.map((link) => ({ deleted: false, ...decode(link) })),
        );
        diffs.set(project, list);
      }
      for (const [project, titles] of deletedLinks) {
        const list = diffs.get(project) ?? [];
        list.push(
          ...[...titles].map((title) => ({
            project,
            title,
            deleted: true as const,
          })),
        );
        diffs.set(project, list);
      }
      if (diffs.size > 0) emitChange(diffs);
    }
  } finally {
    // エラーが起きた場合も含め、フラグをもとに戻しておく
    const tx = db.transaction("projects", "readwrite");
    await Promise.all(
      [...projectStatus.values()].map((status) => {
        status.updating = false;
        return tx.store.put(status);
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
  const keys = [...new Set(projects)].sort();
  if (keys.length === 0) return [];

  const first = keys[0];
  const last = keys[keys.length - 1];
  const range = IDBKeyRange.bound([first, ""], [last, []]);

  const start = Date.now();
  const links = await (await open()).getAll("links", range);
  logger.debug(
    `Read ${links.length} links from ${keys.length} projects in ${
      Date.now() - start
    }ms`,
  );

  return links.flatMap((page) => {
    const decoded = decode(page);
    return keys.includes(decoded.project) ? [decoded] : [];
  });
};
