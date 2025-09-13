import { nanoid } from 'nanoid';
import { log } from '../utils/log';

export interface QueuedMessage {
  id: string;
  type: 'prompt' | 'interrupt' | 'context';
  content: string;
  timestamp: number;
  callSid: string;
  processed: boolean;
  voicePrompt?: string;
}

class MessageQueue {
  private queues: Map<string, QueuedMessage[]> = new Map();
  private readonly maxQueueSize = 10;
  private readonly deduplicationWindow = 500; // 500ms

  // Add message to queue for a specific call
  enqueue(callSid: string, message: Omit<QueuedMessage, 'id' | 'timestamp' | 'processed'>): boolean {
    if (!callSid) return false;

    // Get or create queue for this call
    let queue = this.queues.get(callSid);
    if (!queue) {
      queue = [];
      this.queues.set(callSid, queue);
    }

    // Check queue size limit
    if (queue.length >= this.maxQueueSize) {
      log.warn('[message-queue] Queue full, dropping oldest message', {
        callSid,
        queueSize: queue.length,
      });
      queue.shift(); // Remove oldest message
    }

    // Check for duplicate messages within deduplication window
    const now = Date.now();
    const isDuplicate = queue.some(
      (msg) =>
        msg.content === message.content &&
        msg.type === message.type &&
        now - msg.timestamp < this.deduplicationWindow &&
        !msg.processed
    );

    if (isDuplicate) {
      log.debug('[message-queue] Duplicate message filtered', {
        callSid,
        type: message.type,
        contentPreview: message.content.slice(0, 50),
      });
      return false;
    }

    // Create queued message
    const queuedMessage: QueuedMessage = {
      ...message,
      id: nanoid(6),
      timestamp: now,
      processed: false,
      callSid,
    };

    queue.push(queuedMessage);

    log.info('[message-queue] Message enqueued', {
      callSid,
      messageId: queuedMessage.id,
      type: message.type,
      queueSize: queue.length,
    });

    return true;
  }

  // Get next unprocessed message for a call
  getNext(callSid: string): QueuedMessage | null {
    const queue = this.queues.get(callSid);
    if (!queue || queue.length === 0) return null;

    const nextMessage = queue.find((msg) => !msg.processed);
    if (nextMessage) {
      log.debug('[message-queue] Retrieved next message', {
        callSid,
        messageId: nextMessage.id,
        type: nextMessage.type,
      });
    }
    return nextMessage || null;
  }

  // Mark message as processed
  markProcessed(callSid: string, messageId: string): boolean {
    const queue = this.queues.get(callSid);
    if (!queue) return false;

    const message = queue.find((msg) => msg.id === messageId);
    if (message) {
      message.processed = true;
      log.debug('[message-queue] Message marked as processed', {
        callSid,
        messageId,
      });
      
      // Clean up fully processed queue
      this.cleanQueue(callSid);
      return true;
    }
    return false;
  }

  // Check if there are pending messages
  hasPending(callSid: string): boolean {
    const queue = this.queues.get(callSid);
    if (!queue) return false;
    return queue.some((msg) => !msg.processed);
  }

  // Get pending message count
  getPendingCount(callSid: string): number {
    const queue = this.queues.get(callSid);
    if (!queue) return 0;
    return queue.filter((msg) => !msg.processed).length;
  }

  // Clear all messages for a call
  clear(callSid: string): void {
    const hadMessages = this.queues.has(callSid);
    this.queues.delete(callSid);
    if (hadMessages) {
      log.info('[message-queue] Queue cleared', { callSid });
    }
  }

  // Clean up processed messages
  private cleanQueue(callSid: string): void {
    const queue = this.queues.get(callSid);
    if (!queue) return;

    // Remove all processed messages
    const cleaned = queue.filter((msg) => !msg.processed);
    
    if (cleaned.length === 0) {
      this.queues.delete(callSid);
      log.debug('[message-queue] Empty queue removed', { callSid });
    } else if (cleaned.length < queue.length) {
      this.queues.set(callSid, cleaned);
      log.debug('[message-queue] Queue cleaned', {
        callSid,
        removed: queue.length - cleaned.length,
        remaining: cleaned.length,
      });
    }
  }

  // Get all queues status (for debugging)
  getStatus(): Record<string, { pending: number; total: number }> {
    const status: Record<string, { pending: number; total: number }> = {};
    for (const [callSid, queue] of this.queues.entries()) {
      status[callSid] = {
        pending: queue.filter((msg) => !msg.processed).length,
        total: queue.length,
      };
    }
    return status;
  }
}

// Singleton instance
let messageQueue: MessageQueue | null = null;

export function getMessageQueue(): MessageQueue {
  if (!messageQueue) {
    messageQueue = new MessageQueue();
  }
  return messageQueue;
}