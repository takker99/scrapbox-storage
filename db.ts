import { IDBPDatabase, openDB } from "./deps/idb.ts";
import { createDebug } from "./deps/debug.ts";
import { LinkDBV2 } from "./schema-v2.ts";

const logger = createDebug("scrapbox-storage:db.ts");

/** リンクデータなどを管理するDatabase */
let db: IDBPDatabase<LinkDBV2>;

/** DBを取得する。まだ開いていなければ一度だけ開く */
export const open = async (): Promise<IDBPDatabase<LinkDBV2>> => {
  db ??= await openDB<LinkDBV2>("scrapbox-storage", 2, {
    upgrade(db) {
      logger.time("update DB");

      for (const name of db.objectStoreNames) {
        db.deleteObjectStore(name);
      }
      db.createObjectStore("links", { keyPath: "path" });
      const projectStore = db.createObjectStore("projects", {
        keyPath: "name",
      });
      projectStore.createIndex("checked", "checked");

      logger.timeEnd("update DB");
    },
    blocked(currentVersion, blockedVersion) {
      const message =
        `The database "scrapbox-storage"(v${blockedVersion}) is blocked because the older one (v${currentVersion}) is opened in other tabs.\n Please close the other tabs and reload this page.`;
      logger.error(message);
      alert(message);
    },
    blocking(currentVersion, blockingVersion) {
      const message =
        `The database "scrapbox-storage"(v${currentVersion}) is blocking the newer one (v${blockingVersion}) opened.\n Please close this page.`;
      logger.error(message);
      alert(message);
    },
  });

  return db;
};
