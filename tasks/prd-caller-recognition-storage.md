# PRD: Caller Recognition & Conversation Storage

## Project Overview

### Objective
Implement persistent caller recognition and conversation storage for the Twilio voice AI application, enabling personalized greetings for returning callers and maintaining conversation history.

### Background
Currently, the application treats every call as a new interaction with no memory of previous callers. This limits the ability to provide personalized experiences and maintain context across calls.

### Success Metrics
- **Response Latency**: First response maintains < 500ms latency
- **Recognition Rate**: 95% successful caller identification
- **Name Capture**: 90% successful name extraction on first call
- **Storage Reliability**: 100% conversation persistence
- **User Experience**: Seamless personalized greetings without delays

## Current State Analysis

### What Exists
- In-memory session management (non-persistent)
- WebSocket-based real-time communication with Twilio
- AI-powered conversation handling via OpenAI
- Call session tracking via `callSid`

### What's Missing
- Caller identification by phone number
- Persistent storage of caller information
- Conversation history tracking
- Personalized greetings for returning callers
- Name capture workflow for new callers

### Technical Constraints
- **Critical**: Must maintain sub-second response times for voice interactions
- WebSocket message flow cannot be blocked by database operations
- Bun runtime environment (use native capabilities)
- Must handle concurrent calls without performance degradation

## Implementation Plan

### Phase 1: Database Foundation (Priority: HIGH)
**Goal**: Set up minimal SQLite database for caller and conversation storage

#### Deliverables
- [ ] Database schema with `callers` and `conversations` tables
- [ ] Database initialization script using `bun:sqlite`
- [ ] Simple database service wrapper with async methods

#### Technical Decisions
- Use `bun:sqlite` (built-in, fastest option for Bun)
- Store conversations as JSON for flexibility
- Minimal schema to start (optimize later)

#### Acceptance Criteria
- Database file created at `backend/data/calls.db`
- Tables created successfully on startup
- Basic CRUD operations working

---

### Phase 2: Phone Number Extraction (Priority: HIGH)
**Goal**: Capture caller phone numbers from Twilio requests

#### Deliverables
- [ ] Extract phone number from POST `/twilio/voice` request body
- [ ] Pass phone number through WebSocket connection
- [ ] Store phone number in relay handler state

#### Technical Approach
```typescript
// Extract from Twilio POST body
const formData = await c.req.parseBody();
const phoneNumber = formData.From; // E.164 format

// Pass via WebSocket setup message
```

#### Acceptance Criteria
- Phone number successfully extracted from Twilio webhook
- Phone number available in WebSocket relay handler
- No impact on connection setup time

---

### Phase 3: Caller Recognition Flow (Priority: HIGH)
**Goal**: Identify returning callers and personalize greetings

#### Deliverables
- [ ] Non-blocking database lookup for caller information
- [ ] Dynamic greeting based on caller status
- [ ] Fallback to default greeting if lookup is slow

#### Implementation Strategy
```typescript
// Async lookup - don't block
const callerPromise = getCallerByPhone(phoneNumber);

// Use result if available quickly
Promise.race([
  callerPromise,
  sleep(100) // 100ms timeout
]).then(result => {
  if (result?.name) {
    // Update greeting
  }
});
```

#### Acceptance Criteria
- Returning callers hear "Welcome back, {name}"
- New callers receive standard greeting
- Zero blocking on greeting delivery
- < 100ms additional latency for lookup

---

### Phase 4: Name Capture Workflow (Priority: HIGH)
**Goal**: Capture and store names for first-time callers

#### Deliverables
- [ ] Detect first-time callers
- [ ] Modify initial AI prompt to ask for name
- [ ] Extract name from user response
- [ ] Store name in database (non-blocking)

#### Name Extraction Patterns
- "My name is [Name]"
- "I'm [Name]"
- "This is [Name]"
- "Call me [Name]"
- Single word after name question

#### System Prompt Updates
```text
First-time caller: "Hello! Welcome to the Pokédex Call Center. I'm here to help with any Pokémon questions. May I have your name?"

After name received: "Nice to meet you, {name}! What Pokémon would you like to know about?"

Returning caller: "Welcome back, {name}! What Pokémon information can I help you with today?"
```

#### Acceptance Criteria
- Name question asked naturally in first interaction
- Name extracted successfully 90% of the time
- Name stored without blocking conversation
- Smooth transition to normal conversation after name capture

---

### Phase 5: Conversation Persistence (Priority: MEDIUM)
**Goal**: Store conversation history for future reference

#### Deliverables
- [ ] Store messages in database asynchronously
- [ ] Link conversations to callers
- [ ] Implement batch writes for efficiency

#### Storage Strategy
- Keep in-memory session as primary (speed)
- Write to database in background (persistence)
- Batch updates every few messages or on call end

#### Acceptance Criteria
- All conversations persisted to database
- No impact on conversation flow
- Messages recoverable after restart
- Proper cleanup on call end

---

## Technical Architecture

### Database Schema
```sql
-- Minimal schema for speed
CREATE TABLE callers (
  phone_number TEXT PRIMARY KEY,  -- E.164 format
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE conversations (
  call_sid TEXT PRIMARY KEY,
  phone_number TEXT,
  messages TEXT,  -- JSON array
  started_at INTEGER DEFAULT (unixepoch()),
  ended_at INTEGER
);

-- Indexes added after initial implementation
CREATE INDEX idx_conversations_phone ON conversations(phone_number);
```

### Data Flow
1. Call arrives → Extract phone number
2. WebSocket connects → Pass phone number
3. Setup message → Async caller lookup
4. First prompt → Include name question if new
5. User responds → Extract and store name
6. Conversation continues → Batch store messages
7. Call ends → Finalize storage

### Performance Considerations
- **All database operations must be non-blocking**
- Use `Promise.race()` for time-bounded lookups
- Implement fire-and-forget for writes
- Keep in-memory cache for active sessions
- Use prepared statements for speed

## Rollout Strategy

### Development Phases
1. **Day 1**: Database setup, phone extraction
2. **Day 2**: Caller recognition, personalized greetings
3. **Day 3**: Name capture, conversation storage

### Testing Plan
- Unit tests for database operations
- Integration tests for Twilio webhook handling
- End-to-end tests with multiple phone numbers
- Load testing for concurrent calls
- Manual testing of name extraction scenarios

### Monitoring
- Track response latencies
- Monitor database query times
- Log name extraction success rates
- Track caller recognition accuracy

## Future Enhancements (Post-MVP)

### Phase 6: Performance Optimization
- [ ] In-memory LRU cache for frequent callers
- [ ] Database connection pooling
- [ ] Query optimization and indexing
- [ ] WAL mode for better concurrency

### Phase 7: Advanced Features
- [ ] Conversation summarization
- [ ] Caller preferences and context
- [ ] Multi-language support
- [ ] Export conversation transcripts
- [ ] Analytics dashboard

### Phase 8: Data Management
- [ ] Automatic archival of old conversations
- [ ] GDPR compliance (data deletion)
- [ ] Backup and recovery procedures
- [ ] Data migration tools

## Risk Mitigation

### Performance Risks
- **Risk**: Database operations slow down responses
- **Mitigation**: All operations async, timeouts on lookups

### Data Risks
- **Risk**: Database corruption or loss
- **Mitigation**: Regular backups, WAL mode, transaction logs

### Privacy Risks
- **Risk**: Storing personal information (phone numbers, names)
- **Mitigation**: Encryption at rest, secure access controls

## Success Criteria Checklist

### MVP Completion
- [ ] Database setup and initialization working
- [ ] Phone numbers extracted from Twilio webhooks
- [ ] Returning callers receive personalized greetings
- [ ] First-time callers asked for their name
- [ ] Names successfully captured and stored
- [ ] Conversations persisted to database
- [ ] No performance degradation (< 500ms first response)
- [ ] System handles concurrent calls

### Quality Metrics
- [ ] 95% caller recognition success rate
- [ ] 90% name extraction success rate
- [ ] Zero blocking operations in conversation flow
- [ ] 100% conversation persistence
- [ ] < 100ms database lookup time

## Dependencies

### Technical Dependencies
- Bun runtime with `bun:sqlite` support
- Twilio ConversationRelay API
- OpenAI API for conversation handling

### Information Dependencies
- Twilio webhook payload structure
- Phone number format (E.164)
- ConversationRelay message format

## Timeline

### Week 1
- **Monday**: Database setup, schema creation
- **Tuesday**: Phone number extraction, WebSocket integration
- **Wednesday**: Caller recognition, personalized greetings
- **Thursday**: Name capture workflow
- **Friday**: Conversation persistence, testing

### Week 2
- **Monday-Tuesday**: Bug fixes, optimization
- **Wednesday**: Load testing, performance tuning
- **Thursday**: Documentation, deployment prep
- **Friday**: Production deployment

## Appendix

### Sample Code Snippets

#### Database Service
```typescript
// backend/src/db/database.ts
import { Database } from "bun:sqlite";

class CallDatabase {
  private db: Database;
  
  async getCallerByPhone(phoneNumber: string) {
    // Non-blocking lookup
    return this.db.prepare(
      "SELECT name FROM callers WHERE phone_number = ?"
    ).get(phoneNumber);
  }
  
  async saveCallerName(phoneNumber: string, name: string) {
    // Fire and forget
    setImmediate(() => {
      this.db.prepare(
        "INSERT OR REPLACE INTO callers (phone_number, name) VALUES (?, ?)"
      ).run(phoneNumber, name);
    });
  }
}
```

#### Modified AI Service
```typescript
// Check if first-time caller
const caller = await getCallerQuickly(phoneNumber);

const systemPrompt = caller?.name 
  ? `Welcome back, ${caller.name}! I'm your Pokédex assistant.`
  : `Hello! I'm your Pokédex assistant. What's your name?`;
```

### Testing Scenarios

1. **New Caller Flow**
   - Call from unknown number
   - Receive standard greeting with name request
   - Provide name in various formats
   - Verify name stored correctly
   - Hang up and call back
   - Receive personalized greeting

2. **Returning Caller Flow**
   - Call from known number
   - Receive personalized greeting immediately
   - Continue normal conversation
   - Verify conversation stored

3. **Performance Testing**
   - Multiple concurrent calls
   - Rapid succession calls
   - Database under load
   - Network latency simulation