import { createDebug } from "@takker/debug-js";
import { type IDBPDatabase, openDB } from "idb";
import type { Schema } from "./schema.ts";

const logger = createDebug("scrapbox-storage:db.ts");

/** リンクデータなどを管理するDatabase */
let db: IDBPDatabase<Schema>;

/** DBを取得する。まだ開いていなければ一度だけ開く */
export const open = async (): Promise<IDBPDatabase<Schema>> => {
  db ??= await openDB<Schema>("scrapbox-storage", 3, {
    upgrade(db) {
      logger.time("update DB");

      for (const name of db.objectStoreNames) {
        db.deleteObjectStore(name);
      }

      const titles = db.createObjectStore("titles", { keyPath: "id" });
      titles.createIndex("project", "project");

      const projects = db.createObjectStore("projects", {
        keyPath: "id",
      });
      projects.createIndex("checked", "checked");

      logger.timeEnd("update DB");
    },
    blocked(currentVersion, blockedVersion) {
      const message =
        `The database "@takker/cosense-storage"(v${blockedVersion}) is blocked because the older one (v${currentVersion}) is opened in other tabs.\n Please close the other tabs and reload this page.`;
      logger.error(message);
      alert(message);
    },
    blocking(currentVersion, blockingVersion) {
      const message =
        `The database "@takker/cosense-storage"(v${currentVersion}) is blocking the newer one (v${blockingVersion}) opened.\n Please close this page.`;
      logger.error(message);
      alert(message);
    },
  });

  return db;
};
