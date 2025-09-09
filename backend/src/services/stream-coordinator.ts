import { log } from '../utils/log';

interface StreamState {
  callSid: string;
  isActive: boolean;
  startedAt: number;
  lastActivity: number;
}

class StreamCoordinator {
  private streams: Map<string, StreamState> = new Map();
  private readonly streamTimeout = 30000; // 30 seconds timeout

  // Check if a stream is currently active for a call
  isStreamActive(callSid: string): boolean {
    const stream = this.streams.get(callSid);
    if (!stream) return false;

    // Check for stale streams (safety mechanism)
    const now = Date.now();
    if (stream.isActive && now - stream.lastActivity > this.streamTimeout) {
      log.warn('[stream-coordinator] Stale stream detected, marking inactive', {
        callSid,
        staleDuration: now - stream.lastActivity,
      });
      stream.isActive = false;
    }

    return stream.isActive;
  }

  // Register the start of a new stream
  registerStreamStart(callSid: string): boolean {
    // Check if already active
    if (this.isStreamActive(callSid)) {
      log.warn('[stream-coordinator] Attempted to start stream while active', {
        callSid,
      });
      return false;
    }

    const now = Date.now();
    const stream: StreamState = {
      callSid,
      isActive: true,
      startedAt: now,
      lastActivity: now,
    };

    this.streams.set(callSid, stream);
    log.info('[stream-coordinator] Stream started', {
      callSid,
    });

    return true;
  }

  // Register the end of a stream
  registerStreamEnd(callSid: string): void {
    const stream = this.streams.get(callSid);
    if (!stream) {
      log.debug('[stream-coordinator] Stream end called for non-existent stream', {
        callSid,
      });
      return;
    }

    const duration = Date.now() - stream.startedAt;
    stream.isActive = false;
    
    log.info('[stream-coordinator] Stream ended', {
      callSid,
      duration,
    });
  }

  // Update stream activity (heartbeat)
  updateActivity(callSid: string): void {
    const stream = this.streams.get(callSid);
    if (stream && stream.isActive) {
      stream.lastActivity = Date.now();
    }
  }

  // Clear all stream data for a call
  clearCall(callSid: string): void {
    this.streams.delete(callSid);
    log.debug('[stream-coordinator] Call streams cleared', { callSid });
  }

  // Get stream status for debugging
  getStreamStatus(callSid: string): { active: boolean; duration?: number } | null {
    const stream = this.streams.get(callSid);
    if (!stream) return null;

    return {
      active: stream.isActive,
      duration: stream.isActive ? Date.now() - stream.startedAt : undefined,
    };
  }

  // Get all active streams (for monitoring)
  getActiveStreams(): string[] {
    const active: string[] = [];
    for (const [callSid, stream] of this.streams.entries()) {
      if (stream.isActive) {
        active.push(callSid);
      }
    }
    return active;
  }

  // Clean up stale entries
  cleanup(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [callSid, stream] of this.streams.entries()) {
      if (!stream.isActive && now - stream.lastActivity > staleThreshold) {
        this.streams.delete(callSid);
        log.debug('[stream-coordinator] Cleaned up stale stream entry', {
          callSid,
        });
      }
    }
  }
}

// Singleton instance
let streamCoordinator: StreamCoordinator | null = null;

export function getStreamCoordinator(): StreamCoordinator {
  if (!streamCoordinator) {
    streamCoordinator = new StreamCoordinator();
    
    // Set up periodic cleanup
    setInterval(() => {
      streamCoordinator?.cleanup();
    }, 30000); // Clean up every 30 seconds
  }
  return streamCoordinator;
}