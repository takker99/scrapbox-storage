/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="dom" />

import { DBSchema, IDBPDatabase, openDB } from "./deps/idb.ts";
import {
  getProject,
  listProjects,
  readLinksBulk,
  Result,
  toTitleLc,
} from "./deps/scrapbox-rest.ts";
import {
  NotFoundError,
  NotLoggedInError,
  NotMemberError,
  Project,
} from "./deps/scrapbox.ts";
import { createDebug } from "./debug.ts";

const logger = createDebug("scrapbox-storage:mod.ts");

/** 圧縮したリンクデータ
 *
 * property nameを省略することでデータ量を減らしている
 */
export type CompressedLink = [
  string, // title; page title
  boolean, // hasIcon; whether to have images
  number, // updated; 空ページのときは-1になる
  ...string[], // links
];

/** link data */
export interface Link {
  /** page title */
  title: string;

  /** links the page has */
  links: string[];

  /** whether to have images */
  hasIcon: boolean;

  /** whether the page exists */
  exists: boolean;

  /** updated time (UNIX time) */
  updated: number;
}

/** 圧縮したリンク情報を見やすくする */
export const decode = (link: CompressedLink): Link => {
  const [title, hasIcon, updated, ...links] = link;

  return {
    title,
    links,
    hasIcon,
    exists: updated >= 0,
    updated: Math.min(0, updated),
  };
};

/** リンク情報をDB用に圧縮する */
export const encode = (
  link: Link,
): CompressedLink => [
  link.title,
  link.hasIcon,
  link.exists ? link.updated : -1,
  ...link.links,
];

export interface Source {
  /** project name (key) */
  project: string;

  /** link data */
  links: CompressedLink[];
}

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

  // 更新する必要のあるデータを探し、フラグを立てる
  logger.debug("check updates of links...");

  const projectsMaybeNeededUpgrade: ProjectStatus[] = [];
  const projectStatus: SourceStatus[] = [];
  try {
    {
      const tx = db.transaction("status", "readwrite");
      await Promise.all(projects.map(async (project) => {
        const status = await tx.store.get(project);

        if (status?.isValid === false) return;

        const checked = status?.checked ?? 0;
        const now = new Date().getTime() / 1000;
        // 更新されたばかりのデータは飛ばす
        if (checked + updateInterval > now) return;
        // 更新中にタブが強制終了した可能性を考慮して、更新中フラグが経った時刻より10分経過していたらデータ更新対称に含める
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
    }
    logger.debug(
      `checked. ${projectsMaybeNeededUpgrade.length} projects maybe need upgrade.`,
    );

    // 更新するprojectsがなければ何もしない
    if (projectsMaybeNeededUpgrade.length === 0) return [];

    /** 更新されたprojects */
    const updatedProjects: string[] = [];
    const result: Source[] = [];
    // 一つづつ更新する
    for await (const res of fetchProjectStatus(projectsMaybeNeededUpgrade)) {
      // project dataを取得できないときは、無効なprojectに分類しておく
      if (!res.ok) {
        projectStatus.push({ project: res.value.project, isValid: false });
        switch (res.value.name) {
          case "NotFoundError":
            logger.warn(`"${res.value.project}" is not found.`);
            continue;
          case "NotMemberError":
            logger.warn(`You are not a member of "${res.value.project}".`);
            continue;
          case "NotLoggedInError":
            logger.warn(
              `You are not a member of "${res.value.project}" or You are not logged in yet.`,
            );
            continue;
        }
      }

      // projectの最終更新日時から、updateの要不要を調べる
      if (res.value.updated < res.value.checked) {
        logger.debug(`no updates in "${res.value.name}"`);
      } else {
        // リンクデータを更新する
        const data: Source = {
          project: res.value.name,
          links: await downloadLinks(res.value.name),
        };
        result.push(data);

        logger.time(`write data of "${res.value.name}"`);
        await write(data);
        updatedProjects.push(res.value.name);
        logger.timeEnd(`write data of "${res.value.name}"`);
      }

      projectStatus.push({
        project: res.value.name,
        isValid: true,
        id: res.value.id,
        checked: new Date().getTime() / 1000,
        updated: res.value.updated,
        updating: false,
      });
    }

    // 更新通知を出す
    if (updatedProjects.length > 0) {
      emitChange(updatedProjects);
      const bc = new BroadcastChannel(notifyChannelName);
      const notify: Notify = { type: "update", projects: updatedProjects };
      bc.postMessage(notify);
      bc.close();
    }
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

export type Listener = (notify: Notify) => void;
/** projectをkey, listenerをvalueとするmap */
const listeners = new Map<string, Set<Listener>>();

/** broadcast channelで流すデータ */
export interface Notify {
  type: "update";
  /** 更新されたproject */
  projects: string[];
}

const emitChange = (projects: string[]) => {
  const notify: Notify = { type: "update", projects };
  for (
    const listener of new Set(
      projects.flatMap((project) => [...(listeners.get(project) ?? [])]),
    )
  ) {
    listener?.(notify);
  }
};

/** 更新通知用broadcast channelの名前 */
const notifyChannelName = "scrapbox-storage-notify";
// 他のsessionsでの更新を購読する
const bc = new BroadcastChannel(notifyChannelName);
bc.addEventListener(
  "message",
  (e: MessageEvent<Notify>) => emitChange(e.data.projects),
);

/** リンクデータの更新を購読する
 *
 * @param projects ここに指定されたprojectの更新のみを受け取る
 * @param listener 更新を受け取るlistener
 * @returm listener解除などをする後始末函数
 */
export const subscribe = (
  projects: readonly string[],
  listener: Listener,
): () => void => {
  for (const project of projects) {
    const listeners2 = listeners.get(project) ?? new Set();
    listeners2.add(listener);
    listeners.set(project, listeners2);
  }
  return () => {
    for (const project of projects) {
      listeners.get(project)?.delete?.(listener);
    }
  };
};

/** リンクデータなどを管理するDatabase */
let db: IDBPDatabase<LinkDB>;

/** DBを取得する。まだ開いていなければ一度だけ開く */
const open = async (): Promise<IDBPDatabase<LinkDB>> => {
  db ??= await openDB<LinkDB>("scrapbox-storage", 1, {
    upgrade(db) {
      logger.time("update DB");

      for (const name of db.objectStoreNames) {
        db.deleteObjectStore(name);
      }

      db.createObjectStore("links", { keyPath: "project" });
      db.createObjectStore("status", { keyPath: "project" });

      logger.timeEnd("update DB");
    },
  });

  return db;
};

/** リンクデータDBのschema */
interface LinkDB extends DBSchema {
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

type SourceStatus = ProjectStatus | InvalidProjectStatus;

interface ProjectStatus {
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

interface InvalidProjectStatus {
  /** project name (key) */
  project: string;

  /** 有効なprojectかどうか
   *
   * アクセス権のないprojectと存在しないprojectの場合はfalseになる
   */
  isValid: false;
}

/** projectの情報を一括取得する */
async function* fetchProjectStatus(
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

/** DBの補完ソースを更新する */
const write = async (data: Source) => (await open()).put("links", data);

/** remoteからリンクデータを取得する */
const downloadLinks = async (
  project: string,
): Promise<CompressedLink[]> => {
  const reader = await readLinksBulk(project);
  if ("name" in reader) {
    console.error(reader);
    throw new Error(`${reader.name}: ${reader.message}`);
  }

  const tag = `download and create Links of "${project}"`;
  logger.time(tag);
  const linkMap = new Map<string, Link>();

  for await (const pages of reader) {
    for (const page of pages) {
      const titleLc = toTitleLc(page.title);
      linkMap.set(titleLc, {
        title: page.title,
        hasIcon: page.hasIcon,
        updated: page.updated,
        links: page.links,
        exists: true,
      });

      for (const link of page.links) {
        const linkLc = toTitleLc(link);

        if (linkMap.has(linkLc)) continue;

        linkMap.set(linkLc, {
          title: link,
          hasIcon: false,
          updated: 0,
          links: [],
          exists: false,
        });
      }
    }
  }
  logger.timeEnd(tag);

  return [...linkMap.values()].map((link) => encode(link));
};
