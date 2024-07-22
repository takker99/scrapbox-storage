import { SearchedTitle } from "./deps/scrapbox.ts";

export type Listener = (event: LinkEvent) => void;

/** リンク更新時に送られるイベント */
export interface LinkEvent {
  type: "links:changed";
  /** 更新されたproject */
  pages: (UpdatedPage | DeletedPage)[];
}

export interface UpdatedPage extends SearchedTitle {
  deleted: false;
}
export interface DeletedPage {
  title: string;
  deleted: true;
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
export const emitChange = (
  diffs: Map<string, (UpdatedPage | DeletedPage)[]>,
) => {
  const event: LinkEventInBC = { type: "links:changed", diffs };
  emitChange_(event);
  const bc = new BroadcastChannel(notifyChannelName);
  bc.postMessage(event);
  bc.close();
};

interface LinkEventInBC {
  type: "links:changed";
  diffs: Map<string, (UpdatedPage | DeletedPage)[]>;
}

const emitChange_ = (event: LinkEventInBC) => {
  for (
    const [listener, projects] of listeners
  ) {
    listener({
      type: "links:changed",
      pages: [...projects].flatMap((project) => event.diffs.get(project) ?? []),
    });
  }
};

/** 更新通知用broadcast channelの名前 */
const notifyChannelName = "scrapbox-storage-notify";
// 他のsessionsでの更新を購読する
const bc = new BroadcastChannel(notifyChannelName);
bc.addEventListener(
  "message",
  (e: MessageEvent<LinkEventInBC>) => emitChange_(e.data),
);

/** listenerをkey, listenerが監視するprojectのリストをvalueとしたmap */
const listeners = new Map<Listener, Set<string>>();
