import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { createDebug } from "@takker/debug-js";
import type { InvalidProjectStatus, ProjectStatus } from "./status.ts";
import type { CompressedLink } from "./link.ts";

const logger = createDebug("scrapbox-storage:db.ts");

/** リンクデータなどを管理するDatabase */
let db: IDBPDatabase<LinkDB>;

/** DBを取得する。まだ開いていなければ一度だけ開く */
export const open = async (): Promise<IDBPDatabase<LinkDB>> => {
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

/** DBの補完ソースを更新する */
export const write = async (data: Source) => (await open()).put("links", data);

export interface Source {
  /** project name (key) */
  project: string;

  /** link data */
  links: CompressedLink[];
}

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

export type SourceStatus = ProjectStatus | InvalidProjectStatus;
