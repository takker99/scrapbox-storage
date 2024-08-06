import type { DBSchema } from "idb";
import type { InvalidProjectStatus, ProjectStatus } from "./status.ts";
import type { CompressedLink } from "./link.ts";

export interface Source {
  /** project name (key) */
  project: string;

  /** link data */
  links: CompressedLink[];
}

/** リンクデータDBのschema */
export interface SchemaV1 extends DBSchema {
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
