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
  });

  return db;
};

/** DBの補完ソースを更新する */
export const write = async (data: Source) => (await open()).put("links", data);
