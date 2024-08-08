import { createDebug } from "@takker/debug-js";
import { type IDBPDatabase, openDB } from "idb";
import type { SchemaV1, Source } from "./schema-v1.ts";

const logger = createDebug("scrapbox-storage:db.ts");

/** リンクデータなどを管理するDatabase */
let db: IDBPDatabase<SchemaV1>;

/** DBを取得する。まだ開いていなければ一度だけ開く */
export const open = async (): Promise<IDBPDatabase<SchemaV1>> => {
  db ??= await openDB<SchemaV1>("scrapbox-storage", 1, {
    upgrade(db) {
      logger.time("update DB");

      for (const name of db.objectStoreNames) {
        db.deleteObjectStore(name);
      }

      db.createObjectStore("links", { keyPath: "project" });
      db.createObjectStore("status", { keyPath: "project" });

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

/** DBの補完ソースを更新する */
export const write = async (data: Source) => (await open()).put("links", data);
