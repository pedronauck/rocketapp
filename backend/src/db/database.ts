import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/log';

export interface Caller {
  phone_number: string;
  name: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface Conversation {
  call_sid: string;
  phone_number: string;
  messages: string; // JSON string
  started_at?: number;
  ended_at?: number | null;
}

class CallDatabase {
  private db: Database;
  private getCallerStmt: any;
  private upsertCallerStmt: any;
  private createConversationStmt: any;
  private updateConversationStmt: any;

  constructor(dbPath: string) {
    try {
      // Open database connection
      this.db = new Database(dbPath, { create: true });
      
      // Enable WAL mode for better concurrency
      this.db.exec('PRAGMA journal_mode = WAL');
      
      // Initialize schema
      this.initializeSchema();
      
      // Prepare statements for performance
      this.prepareStatements();
      
      log.info('[db] Database initialized successfully', { path: dbPath });
    } catch (error) {
      log.error('[db] Failed to initialize database', error);
      throw error;
    }
  }

  private initializeSchema() {
    // Read and execute schema
    const schemaPath = join(import.meta.dir, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  private prepareStatements() {
    // Prepare frequently used statements for speed
    this.getCallerStmt = this.db.prepare(
      'SELECT phone_number, name FROM callers WHERE phone_number = ?'
    );
    
    this.upsertCallerStmt = this.db.prepare(`
      INSERT INTO callers (phone_number, name, updated_at) 
      VALUES (?, ?, unixepoch())
      ON CONFLICT(phone_number) 
      DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `);
    
    this.createConversationStmt = this.db.prepare(`
      INSERT INTO conversations (call_sid, phone_number, messages)
      VALUES (?, ?, ?)
    `);
    
    this.updateConversationStmt = this.db.prepare(`
      UPDATE conversations 
      SET messages = ?, ended_at = ?
      WHERE call_sid = ?
    `);
  }

  // Fast, non-blocking caller lookup
  async getCallerByPhone(phoneNumber: string): Promise<Caller | null> {
    return new Promise((resolve) => {
      try {
        const result = this.getCallerStmt.get(phoneNumber) as Caller | undefined;
        resolve(result || null);
      } catch (error) {
        log.error('[db] Error getting caller', { phoneNumber, error });
        resolve(null);
      }
    });
  }

  // Fire-and-forget caller name update
  async saveCallerName(phoneNumber: string, name: string): Promise<void> {
    // Use setImmediate for truly non-blocking operation
    setImmediate(() => {
      try {
        this.upsertCallerStmt.run(phoneNumber, name);
        log.debug('[db] Saved caller name', { phoneNumber, name });
      } catch (error) {
        log.error('[db] Error saving caller name', { phoneNumber, error });
      }
    });
  }

  // Create new conversation record
  async createConversation(callSid: string, phoneNumber: string): Promise<void> {
    setImmediate(() => {
      try {
        const initialMessages = JSON.stringify([]);
        this.createConversationStmt.run(callSid, phoneNumber, initialMessages);
        log.debug('[db] Created conversation', { callSid, phoneNumber });
      } catch (error) {
        log.error('[db] Error creating conversation', { callSid, error });
      }
    });
  }

  // Update conversation messages (batched writes)
  async updateConversationMessages(
    callSid: string, 
    messages: any[], 
    ended: boolean = false
  ): Promise<void> {
    setImmediate(() => {
      try {
        const messagesJson = JSON.stringify(messages);
        const endedAt = ended ? Math.floor(Date.now() / 1000) : null;
        this.updateConversationStmt.run(messagesJson, endedAt, callSid);
        log.debug('[db] Updated conversation', { callSid, messageCount: messages.length, ended });
      } catch (error) {
        log.error('[db] Error updating conversation', { callSid, error });
      }
    });
  }

  // Get caller with timeout for fast response
  async getCallerQuickly(phoneNumber: string, timeoutMs: number = 100): Promise<Caller | null> {
    return Promise.race([
      this.getCallerByPhone(phoneNumber),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  // Get recent conversation for a phone number (for context recovery)
  async getRecentConversation(phoneNumber: string, limit: number = 1): Promise<Conversation[]> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          SELECT call_sid, phone_number, messages, started_at, ended_at
          FROM conversations
          WHERE phone_number = ?
          ORDER BY started_at DESC
          LIMIT ?
        `);
        const results = stmt.all(phoneNumber, limit) as Conversation[];
        resolve(results || []);
      } catch (error) {
        log.error('[db] Error getting recent conversations', { phoneNumber, error });
        resolve([]);
      }
    });
  }

  // Get conversation by call SID (for recovery after restart)
  async getConversationBySid(callSid: string): Promise<Conversation | null> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          SELECT call_sid, phone_number, messages, started_at, ended_at
          FROM conversations
          WHERE call_sid = ?
        `);
        const result = stmt.get(callSid) as Conversation | undefined;
        resolve(result || null);
      } catch (error) {
        log.error('[db] Error getting conversation by SID', { callSid, error });
        resolve(null);
      }
    });
  }

  // Mark all open conversations as ended (for cleanup)
  closeAllOpenConversations(): number {
    try {
      const stmt = this.db.prepare(`
        UPDATE conversations 
        SET ended_at = unixepoch() 
        WHERE ended_at IS NULL
      `);
      const result = stmt.run();
      const count = result.changes;
      if (count > 0) {
        log.info('[db] Closed open conversations on shutdown', { count });
      }
      return count;
    } catch (error) {
      log.error('[db] Error closing open conversations', error);
      return 0;
    }
  }

  // Close database connection
  close() {
    try {
      // Close any open conversations first
      this.closeAllOpenConversations();
      this.db.close();
      log.info('[db] Database connection closed');
    } catch (error) {
      log.error('[db] Error closing database', error);
    }
  }
}

// Singleton instance
let dbInstance: CallDatabase | null = null;

export function initDatabase(dbPath: string): CallDatabase {
  if (!dbInstance) {
    dbInstance = new CallDatabase(dbPath);
  }
  return dbInstance;
}

export function getDatabase(): CallDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}