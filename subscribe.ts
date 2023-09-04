export type Listener = (notify: LinkEvent) => void;
/** projectをkey, listenerをvalueとするmap */
const listeners = new Map<string, Set<Listener>>();

/** broadcast channelで流すデータ */
export interface LinkEvent {
  type: "update";
  /** 更新されたproject */
  projects: string[];
}

/** リンクデータの更新を通知する */
export const emitChange = (projects: string[]) => {
  const event: LinkEvent = { type: "update", projects };
  emitChange_(event);
  const bc = new BroadcastChannel(notifyChannelName);
  bc.postMessage(event);
  bc.close();
};

const emitChange_ = (event: LinkEvent) => {
  for (
    const listener of new Set(
      event.projects.flatMap((project) => [...(listeners.get(project) ?? [])]),
    )
  ) {
    listener?.(event);
  }
};

/** 更新通知用broadcast channelの名前 */
const notifyChannelName = "scrapbox-storage-notify";
// 他のsessionsでの更新を購読する
const bc = new BroadcastChannel(notifyChannelName);
bc.addEventListener(
  "message",
  (e: MessageEvent<LinkEvent>) => emitChange_(e.data),
);

/** リンクデータの更新を購読する
 *
 * @param projects ここに指定されたprojectの更新のみを受け取る
 * @param listener 更新を受け取るlistener
 * @returm listener解除などをする後始末函数
 */
export const subscribe = (
  projects: readonly string[],
  listener: Listener,
): () => void => {
  for (const project of projects) {
    const listeners2 = listeners.get(project) ?? new Set();
    listeners2.add(listener);
    listeners.set(project, listeners2);
  }
  return () => {
    for (const project of projects) {
      listeners.get(project)?.delete?.(listener);
    }
  };
};
