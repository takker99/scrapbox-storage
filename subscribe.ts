import type { Link } from "./link.ts";

export type Listener = (event: LinkEvent) => void;

/** リンク更新時に送られるイベント */
export interface LinkEvent {
  type: "links:changed";
  /** 更新されたproject */
  project: string;
  /** 更新差分 */
  diff: Diff;
}

export interface Diff {
  /** added pages
   *
   * key is page id
   */
  added: Map<string, Link>;

  /** updated pages
   *
   * key is page id
   */
  updated: Map<string, Link>;

  /** deleted page ids */
  deleted: Set<string>;
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
