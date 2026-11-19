/** In-memory presence registry: which users have at least one live socket. */
const sockets = new Map<string, Set<string>>();

export const presence = {
  add(userId: string, socketId: string): boolean {
    let set = sockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) sockets.set(userId, (set = new Set()));
    set.add(socketId);
    return wasOffline;
  },
  remove(userId: string, socketId: string): boolean {
    const set = sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      sockets.delete(userId);
      return true;
    }
    return false;
  },
  isOnline(userId: string) {
    return (sockets.get(userId)?.size ?? 0) > 0;
  },
  onlineUserIds(): string[] {
    return [...sockets.keys()];
  },
  socketsOf(userId: string): string[] {
    return [...(sockets.get(userId) ?? [])];
  },
  connectionCount(): number {
    let n = 0;
    for (const s of sockets.values()) n += s.size;
    return n;
  },
};

