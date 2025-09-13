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

-- Sessions table - stores authentication sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- Unique session ID
  phone_number TEXT NOT NULL,             -- Associated phone number
  token TEXT NOT NULL UNIQUE,             -- JWT token
  expires_at INTEGER NOT NULL,            -- Expiration timestamp
  created_at INTEGER DEFAULT (unixepoch()),
  last_used_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (phone_number) REFERENCES callers(phone_number)
);

-- Verification attempts table - track OTP attempts for rate limiting
CREATE TABLE IF NOT EXISTS verification_attempts (
  phone_number TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 1,
  last_attempt_at INTEGER DEFAULT (unixepoch()),
  blocked_until INTEGER,
  PRIMARY KEY (phone_number)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);