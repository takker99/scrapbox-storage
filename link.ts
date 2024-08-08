import type { SearchedTitle } from "@cosense/types/rest";

/** link data */
export interface Link extends SearchedTitle {
  /** project name */
  project: string;
}
