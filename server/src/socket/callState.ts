/** In-memory state of ongoing calls (calls are ephemeral; history is saved as CALL messages). */
export interface CallParticipant {
  userId: string;
  socketId: string;
  audio: boolean;
  video: boolean;
  joinedAt: number;
}

export interface CallState {
  id: string;
  conversationId: string;
  video: boolean;
  initiatorId: string;
  startedAt: number;
  connectedAt: number | null;
  participants: Map<string, CallParticipant>;
  invited: Set<string>;
  declined: Set<string>;
  ringTimer: NodeJS.Timeout | null;
}

export const calls = new Map<string, CallState>();

export function callSummary(c: CallState) {
  return {
    id: c.id,
    conversationId: c.conversationId,
    video: c.video,
    initiatorId: c.initiatorId,
    startedAt: c.startedAt,
    connectedAt: c.connectedAt,
    participants: [...c.participants.values()].map((p) => ({
      userId: p.userId,
      audio: p.audio,
      video: p.video,
      joinedAt: p.joinedAt,
    })),
    invited: [...c.invited],
  };
}
export type CallSummary = ReturnType<typeof callSummary>;

export function getActiveCallForConversation(conversationId: string): CallSummary | null {
  for (const c of calls.values()) if (c.conversationId === conversationId) return callSummary(c);
  return null;
}

export function findCallOfUser(userId: string): CallState | null {
  for (const c of calls.values()) if (c.participants.has(userId)) return c;
  return null;
}

