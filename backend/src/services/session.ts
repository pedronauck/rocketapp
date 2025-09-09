import type { SimpleMessage } from './ai';

// Simple in-memory session store keyed by callSid
// Not persisted; cleared when process restarts.
class SessionStore {
  private store = new Map<string, SimpleMessage[]>();

  get(callSid: string): SimpleMessage[] | undefined {
    return this.store.get(callSid);
  }

  getOrInit(callSid: string, initial?: SimpleMessage[]): SimpleMessage[] {
    const existing = this.store.get(callSid);
    if (existing) return existing;
    const seed = initial ? [...initial] : [];
    this.store.set(callSid, seed);
    return seed;
  }

  set(callSid: string, messages: SimpleMessage[]) {
    this.store.set(callSid, messages);
  }

  clear(callSid: string) {
    this.store.delete(callSid);
  }
}

export const sessions = new SessionStore();

