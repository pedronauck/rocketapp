-- Minimal schema for fast caller recognition and conversation storage
-- Optimized for speed with simple structure

-- Callers table - stores phone numbers and names
CREATE TABLE IF NOT EXISTS callers (
  phone_number TEXT PRIMARY KEY,  -- E.164 format (e.g., +1234567890)
  name TEXT,                       -- Caller's name
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Conversations table - stores call history
CREATE TABLE IF NOT EXISTS conversations (
  call_sid TEXT PRIMARY KEY,       -- Twilio's unique call ID
  phone_number TEXT,                -- Link to caller
  messages TEXT,                    -- JSON array of messages
  started_at INTEGER DEFAULT (unixepoch()),
  ended_at INTEGER                  -- NULL while call is active
);

-- Index for faster phone lookups (add after initial testing)
-- CREATE INDEX idx_conversations_phone ON conversations(phone_number);