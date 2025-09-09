import { getDatabase } from '../db/database';
import { log } from '../utils/log';
import type { SimpleMessage } from './ai';

interface BatchItem {
  callSid: string;
  messages: SimpleMessage[];
  ended: boolean;
  timestamp: number;
}

class BatchWriter {
  private queue: Map<string, BatchItem> = new Map();
  private timer: Timer | null = null;
  private readonly batchInterval = 2000; // 2 seconds
  private readonly maxBatchSize = 10;

  // Add or update a conversation in the batch queue
  enqueue(callSid: string, messages: SimpleMessage[], ended: boolean = false) {
    this.queue.set(callSid, {
      callSid,
      messages,
      ended,
      timestamp: Date.now(),
    });

    // Start timer if not already running
    if (!this.timer) {
      this.scheduleFlush();
    }

    // Flush immediately if queue is full or conversation ended
    if (this.queue.size >= this.maxBatchSize || ended) {
      this.flush();
    }
  }

  // Schedule a flush operation
  private scheduleFlush() {
    this.timer = setTimeout(() => {
      this.flush();
    }, this.batchInterval);
  }

  // Flush all pending writes to database
  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.size === 0) return;

    // Copy queue and clear it
    const items = Array.from(this.queue.values());
    this.queue.clear();

    // Perform batch writes asynchronously
    setImmediate(() => {
      try {
        const db = getDatabase();
        for (const item of items) {
          db.updateConversationMessages(item.callSid, item.messages, item.ended);
        }
        log.debug('[batch-writer] Flushed batch to database', {
          count: items.length,
          callSids: items.map(i => i.callSid),
        });
      } catch (error) {
        log.error('[batch-writer] Failed to flush batch', { error });
      }
    });

    // Schedule next flush if there are still items
    if (this.queue.size > 0) {
      this.scheduleFlush();
    }
  }

  // Force flush (e.g., on shutdown)
  forceFlush() {
    this.flush();
  }

  // Get pending items count for verification
  getPendingCount(): number {
    return this.queue.size;
  }
}

// Singleton instance
let batchWriter: BatchWriter | null = null;

export function getBatchWriter(): BatchWriter {
  if (!batchWriter) {
    batchWriter = new BatchWriter();
  }
  return batchWriter;
}

// Graceful shutdown with verification
process.on('beforeExit', () => {
  if (batchWriter) {
    const pending = batchWriter.getPendingCount();
    if (pending > 0) {
      log.warn('[batch-writer] Flushing pending items on shutdown', { count: pending });
    }
    batchWriter.forceFlush();
    log.info('[batch-writer] Shutdown complete');
  }
});

// Handle SIGINT/SIGTERM for clean shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    if (batchWriter) {
      const pending = batchWriter.getPendingCount();
      if (pending > 0) {
        log.warn(`[batch-writer] Flushing ${pending} items on ${signal}`);
      }
      batchWriter.forceFlush();
    }
    // Give time for flush to complete
    setTimeout(() => process.exit(0), 100);
  });
});