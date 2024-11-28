import type { SearchedTitle } from "@cosense/types/rest";
export type { SearchedTitle };

/** link data */
export interface Link extends SearchedTitle {
  /** project name */
  project: string;
}
