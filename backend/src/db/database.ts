import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/log';
import type { SimpleMessage } from '../services/ai';

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

export interface Session {
  id: string;
  phone_number: string;
  token: string;
  expires_at: number;
  created_at?: number;
  last_used_at?: number;
}

export interface VerificationAttempt {
  phone_number: string;
  attempt_count: number;
  last_attempt_at: number;
  blocked_until?: number | null;
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

  // Upsert caller (for auth)
  async upsertCaller(phoneNumber: string, name: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.upsertCallerStmt.run(phoneNumber, name);
        resolve();
      } catch (error) {
        log.error('[db] Error upserting caller', { phoneNumber, error });
        reject(error);
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

  // Get conversation history with summaries for context (Phase 7)
  async getConversationContext(phoneNumber: string, hoursBack: number = 24): Promise<{
    recentTopics: string[];
    conversationCount: number;
    lastCallTime: number | null;
  }> {
    return new Promise((resolve) => {
      try {
        const cutoffTime = Math.floor(Date.now() / 1000) - (hoursBack * 3600);
        
        // Get recent conversations
        const stmt = this.db.prepare(`
          SELECT messages, started_at, ended_at
          FROM conversations
          WHERE phone_number = ? 
            AND started_at > ?
            AND ended_at IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 10
        `);
        
        const conversations = stmt.all(phoneNumber, cutoffTime) as Conversation[];
        
        if (!conversations || conversations.length === 0) {
          resolve({ recentTopics: [], conversationCount: 0, lastCallTime: null });
          return;
        }

        // Extract topics from conversations
        const topics = new Set<string>();
        let lastCallTime = conversations[0].started_at;
        
        for (const conv of conversations) {
          try {
            const messages = JSON.parse(conv.messages) as SimpleMessage[];
            
            // Extract Pokemon names and topics mentioned
            for (const msg of messages) {
              if (msg.role === 'user') {
                // Look for Pokemon names (capitalized words)
                const pokemonMatches = msg.content.match(/\b[A-Z][a-z]+(?:[-\s][A-Z]?[a-z]+)*\b/g);
                if (pokemonMatches) {
                  pokemonMatches.forEach(match => {
                    // Common Pokemon names to track
                    const commonPokemon = ['Pikachu', 'Charizard', 'Bulbasaur', 'Squirtle', 'Jigglypuff', 
                                          'Mewtwo', 'Mew', 'Eevee', 'Snorlax', 'Dragonite'];
                    if (commonPokemon.some(p => match.toLowerCase().includes(p.toLowerCase()))) {
                      topics.add(match);
                    }
                  });
                }
                
                // Look for specific topics
                if (msg.content.toLowerCase().includes('evolution')) topics.add('evolution');
                if (msg.content.toLowerCase().includes('type')) topics.add('types');
                if (msg.content.toLowerCase().includes('move')) topics.add('moves');
                if (msg.content.toLowerCase().includes('ability')) topics.add('abilities');
                if (msg.content.toLowerCase().includes('stat')) topics.add('stats');
              }
            }
          } catch (err) {
            log.debug('[db] Error parsing conversation messages for context', { err });
          }
        }
        
        resolve({
          recentTopics: Array.from(topics).slice(0, 5), // Top 5 topics
          conversationCount: conversations.length,
          lastCallTime
        });
        
      } catch (error) {
        log.error('[db] Error getting conversation context', { phoneNumber, error });
        resolve({ recentTopics: [], conversationCount: 0, lastCallTime: null });
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

  // Session management methods
  async createSession(session: Session): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO sessions (id, phone_number, token, expires_at, created_at, last_used_at)
          VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
        `);
        stmt.run(session.id, session.phone_number, session.token, session.expires_at);
        resolve();
      } catch (error) {
        log.error('[db] Error creating session', { error });
        reject(error);
      }
    });
  }

  async getSessionByToken(token: string): Promise<Session | null> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          SELECT id, phone_number, token, expires_at, created_at, last_used_at
          FROM sessions
          WHERE token = ?
        `);
        const result = stmt.get(token) as Session | undefined;
        resolve(result || null);
      } catch (error) {
        log.error('[db] Error getting session by token', { error });
        resolve(null);
      }
    });
  }

  async updateSessionLastUsed(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          UPDATE sessions SET last_used_at = unixepoch() WHERE id = ?
        `);
        stmt.run(sessionId);
        resolve();
      } catch (error) {
        log.error('[db] Error updating session last used', { error });
        resolve();
      }
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
        stmt.run(sessionId);
        resolve();
      } catch (error) {
        log.error('[db] Error deleting session', { error });
        resolve();
      }
    });
  }

  // Rate limiting methods
  async getVerificationAttempts(phoneNumber: string): Promise<VerificationAttempt | null> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          SELECT phone_number, attempt_count, last_attempt_at, blocked_until
          FROM verification_attempts
          WHERE phone_number = ?
        `);
        const result = stmt.get(phoneNumber) as VerificationAttempt | undefined;
        resolve(result || null);
      } catch (error) {
        log.error('[db] Error getting verification attempts', { error });
        resolve(null);
      }
    });
  }

  async incrementVerificationAttempts(phoneNumber: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO verification_attempts (phone_number, attempt_count, last_attempt_at)
          VALUES (?, 1, unixepoch() * 1000)
          ON CONFLICT(phone_number)
          DO UPDATE SET 
            attempt_count = attempt_count + 1,
            last_attempt_at = unixepoch() * 1000
        `);
        stmt.run(phoneNumber);
        resolve();
      } catch (error) {
        log.error('[db] Error incrementing verification attempts', { error });
        resolve();
      }
    });
  }

  async resetVerificationAttempts(phoneNumber: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare('DELETE FROM verification_attempts WHERE phone_number = ?');
        stmt.run(phoneNumber);
        resolve();
      } catch (error) {
        log.error('[db] Error resetting verification attempts', { error });
        resolve();
      }
    });
  }

  async blockVerificationAttempts(phoneNumber: string, blockedUntil: number): Promise<void> {
    return new Promise((resolve) => {
      try {
        const stmt = this.db.prepare(`
          UPDATE verification_attempts 
          SET blocked_until = ? 
          WHERE phone_number = ?
        `);
        stmt.run(blockedUntil, phoneNumber);
        resolve();
      } catch (error) {
        log.error('[db] Error blocking verification attempts', { error });
        resolve();
      }
    });
  }

  // Get all Pokemon queries for a user
  async getPokemonQueries(phoneNumber: string, limit: number = 50, offset: number = 0): Promise<{
    queries: Array<{
      call_sid: string;
      pokemon_names: string[];
      timestamp: number;
      duration?: number;
    }>;
    total: number;
  }> {
    return new Promise((resolve) => {
      try {
        // Get total count
        const countStmt = this.db.prepare(`
          SELECT COUNT(*) as total 
          FROM conversations 
          WHERE phone_number = ? AND ended_at IS NOT NULL
        `);
        const countResult = countStmt.get(phoneNumber) as { total: number };
        
        // Get paginated results
        const stmt = this.db.prepare(`
          SELECT call_sid, messages, started_at, ended_at
          FROM conversations
          WHERE phone_number = ? AND ended_at IS NOT NULL
          ORDER BY started_at DESC
          LIMIT ? OFFSET ?
        `);
        
        const conversations = stmt.all(phoneNumber, limit, offset) as Conversation[];
        
        const queries = conversations.map(conv => {
          const pokemonNames = new Set<string>();
          
          try {
            const messages = JSON.parse(conv.messages) as SimpleMessage[];
            
            // Extract Pokemon names from messages
            for (const msg of messages) {
              // Look for Pokemon names in both user and assistant messages
              const pokemonPattern = /\b(Pikachu|Charizard|Bulbasaur|Squirtle|Charmander|Wartortle|Blastoise|Caterpie|Metapod|Butterfree|Weedle|Kakuna|Beedrill|Pidgey|Pidgeotto|Pidgeot|Rattata|Raticate|Spearow|Fearow|Ekans|Arbok|Sandshrew|Sandslash|Nidoran|Nidorina|Nidoqueen|Nidorino|Nidoking|Clefairy|Clefable|Vulpix|Ninetales|Jigglypuff|Wigglytuff|Zubat|Golbat|Oddish|Gloom|Vileplume|Paras|Parasect|Venonat|Venomoth|Diglett|Dugtrio|Meowth|Persian|Psyduck|Golduck|Mankey|Primeape|Growlithe|Arcanine|Poliwag|Poliwhirl|Poliwrath|Abra|Kadabra|Alakazam|Machop|Machoke|Machamp|Bellsprout|Weepinbell|Victreebel|Tentacool|Tentacruel|Geodude|Graveler|Golem|Ponyta|Rapidash|Slowpoke|Slowbro|Magnemite|Magneton|Farfetch|Doduo|Dodrio|Seel|Dewgong|Grimer|Muk|Shellder|Cloyster|Gastly|Haunter|Gengar|Onix|Drowzee|Hypno|Krabby|Kingler|Voltorb|Electrode|Exeggcute|Exeggutor|Cubone|Marowak|Hitmonlee|Hitmonchan|Lickitung|Koffing|Weezing|Rhyhorn|Rhydon|Chansey|Tangela|Kangaskhan|Horsea|Seadra|Goldeen|Seaking|Staryu|Starmie|Scyther|Jynx|Electabuzz|Magmar|Pinsir|Tauros|Magikarp|Gyarados|Lapras|Ditto|Eevee|Vaporeon|Jolteon|Flareon|Porygon|Omanyte|Omastar|Kabuto|Kabutops|Aerodactyl|Snorlax|Articuno|Zapdos|Moltres|Dratini|Dragonair|Dragonite|Mewtwo|Mew)\b/gi;
              const matches = msg.content.match(pokemonPattern);
              if (matches) {
                matches.forEach(match => pokemonNames.add(match));
              }
            }
          } catch (err) {
            log.debug('[db] Error parsing messages for Pokemon names', { err });
          }
          
          return {
            call_sid: conv.call_sid,
            pokemon_names: Array.from(pokemonNames),
            timestamp: conv.started_at || 0,
            duration: (conv.ended_at && conv.started_at) 
              ? conv.ended_at - conv.started_at 
              : undefined
          };
        });
        
        resolve({ queries, total: countResult.total });
      } catch (error) {
        log.error('[db] Error getting Pokemon queries', { error });
        resolve({ queries: [], total: 0 });
      }
    });
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

  // Expose database for demo seeding (development only)
  getDbConnection() {
    return this.db;
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