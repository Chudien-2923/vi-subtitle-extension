interface Activity {
  controller: AbortController;
}
const activities = new Map<string, Set<Activity>>();
const deleting = new Map<string, Promise<void>>();

/** Every producer holds an abortable lease until its final cache transaction completes. */
export function beginVideoCacheActivity(videoId: string): { signal: AbortSignal; close(): void } {
  const activity: Activity = { controller: new AbortController() };
  if (deleting.has(videoId)) activity.controller.abort();
  else {
    let group = activities.get(videoId);
    if (!group) {
      group = new Set();
      activities.set(videoId, group);
    }
    group.add(activity);
  }
  return {
    signal: activity.controller.signal,
    close() {
      const group = activities.get(videoId);
      group?.delete(activity);
      if (group?.size === 0) activities.delete(videoId);
    },
  };
}

/** Abort old producers before deleting; reopening a video explicitly may populate it again later. */
export function deletingVideoCache(videoId: string, remove: () => Promise<void>): Promise<void> {
  const existing = deleting.get(videoId);
  if (existing) return existing;
  const done = Promise.withResolvers<void>();
  deleting.set(videoId, done.promise);
  for (const activity of activities.get(videoId) ?? []) activity.controller.abort();
  activities.delete(videoId);
  void remove().then(
    () => {
      deleting.delete(videoId);
      done.resolve();
    },
    (error: unknown) => {
      deleting.delete(videoId);
      done.reject(error);
    },
  );
  return done.promise;
}
