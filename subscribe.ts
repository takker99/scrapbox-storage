import type { Link } from "./link.ts";

/**
 * A type representing a function that listens for {@linkcode LinkEvent} events.
 */
export type Listener = (event: LinkEvent) => void;

/** リンク更新時に送られるイベント */
export interface LinkEvent {
  /** event type */
  type: "links:changed";
  /** 更新されたproject */
  project: string;
  /** 更新差分 */
  diff: Diff;
}

/**
 * Represents the differences between two sets of pages.
 */
export interface Diff {
  /**
   * Pages that have been added.
   *
   * The key is the page ID, and the value is the link data for the added page.
   */
  added?: Map<string, Link>;

  /**
   * Pages that have been updated.
   *
   * The key is the page ID, and the value is a tuple containing the old and new link data for the updated page.
   */
  updated?: Map<string, [Link, Link]>;

  /**
   * Pages that have been deleted.
   *
   * The key is the page ID, and the value is the link data for the deleted page.
   */
  deleted?: Map<string, Link>;
}

/** リンクデータの更新を購読する
 *
 * @param projects ここに指定されたprojectの更新のみを受け取る
 * @param listener 更新を受け取るlistener
 * @returm listener解除などをする後始末函数
 */
export const subscribe = (
  projects: Iterable<string>,
  listener: Listener,
): () => void => {
  listeners.set(
    listener,
    new Set(projects).union(listeners.get(listener) ?? new Set()),
  );
  return () => listeners.delete(listener);
};

/** リンクデータの更新を通知する */
export const emitChange = (project: string, diff: Diff): void => {
  if (
    (diff.added?.size ?? 0) + (diff.updated?.size ?? 0) +
        (diff.deleted?.size ?? 0) === 0
  ) return;
  const event: LinkEvent = { type: "links:changed", project, diff };
  emitChangeToListeners(event);
  const bc = new BroadcastChannel(notifyChannelName);
  bc.postMessage(event);
  bc.close();
};

const emitChangeToListeners = (event: LinkEvent) => {
  for (
    const [listener, projects] of listeners
  ) {
    if (!projects.has(event.project)) continue;
    listener(event);
  }
};

/** 更新通知用broadcast channelの名前 */
const notifyChannelName = "scrapbox-storage-notify";
// 他のsessionsでの更新を購読する
const bc = new BroadcastChannel(notifyChannelName);
bc.addEventListener(
  "message",
  (e: MessageEvent<LinkEvent>) => emitChangeToListeners(e.data),
);

/** listenerをkey, listenerが監視するprojectのリストをvalueとしたmap */
const listeners = new Map<Listener, Set<string>>();
