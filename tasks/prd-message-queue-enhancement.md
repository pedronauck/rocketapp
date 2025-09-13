# PRD: Non-Blocking Message Queue for Voice Calls

## Project Overview

### Objective
Implement a non-blocking message queue system that prevents interruptions during active AI responses, allowing messages to be queued and processed sequentially or in parallel without disrupting the user experience during voice calls.

### Background
Currently, when a user speaks while the AI is responding, the system sends an "interrupt" message that aborts the current AI stream. This creates a jarring experience where responses are cut off mid-sentence. Users often provide additional context or corrections while the AI is speaking, and these should be captured and processed intelligently rather than causing interruptions.

### Success Metrics
- Zero interrupted responses due to user input during AI speech
- All user messages captured and processed in order
- Reduced perceived latency for follow-up questions
- Smooth conversation flow without abrupt cuts

## Current State Analysis

### What Exists
- WebSocket-based real-time communication with Twilio
- Interrupt handling that aborts active AI streams
- Session management for conversation context
- Batch writer for efficient database updates
- Stream-based AI response generation

### Pain Points
- Interrupts abort the current stream completely
- Lost context when users provide clarifications during responses
- Poor experience when users naturally interject
- No queuing mechanism for rapid successive inputs

### Technical Constraints
- Must maintain WebSocket connection stability
- Cannot increase response latency for first message
- Must preserve conversation context and order
- Need to handle Twilio's real-time requirements

## Implementation Plan

### Phase 1: Core Message Queue (HIGH PRIORITY) ✅
**Goal**: Build foundational queue system without disrupting current flow

#### Deliverables
- [x] Create `backend/src/services/message-queue.ts`
  - FIFO queue implementation ✅
  - Message deduplication (prevent duplicate prompts) ✅
  - Queue size limits (prevent memory issues) ✅
  - Message metadata (timestamp, type, priority) ✅

#### Technical Details
```typescript
interface QueuedMessage {
  id: string;
  type: 'prompt' | 'interrupt' | 'context';
  content: string;
  timestamp: number;
  callSid: string;
  processed: boolean;
}
```

#### Acceptance Criteria
- Queue can accept messages without blocking
- Messages maintain order of arrival
- Queue has configurable size limit (default: 10)
- Duplicate messages within 500ms are filtered

### Phase 2: Non-Interrupting Handler (HIGH PRIORITY) ✅
**Goal**: Modify WebSocket handler to queue instead of interrupt

#### Deliverables
- [x] Update `handleInterrupt` in `backend/src/routes/twilio.ts`
  - Convert interrupts to queued messages ✅
  - Maintain abort controller for error cases only ✅
  - Added "stop" command to halt TTS ✅
  
- [x] Update `handlePrompt` in `backend/src/routes/twilio.ts`
  - Check if stream is active before processing ✅
  - Queue message if stream is active ✅
  - Process immediately if no active stream ✅

- [x] Add queue processing after stream completion
  - Check queue after each response ✅
  - Process next message automatically ✅
  - Clear queue on call end ✅

#### Technical Details
```typescript
// Instead of interrupt:
if (isStreamActive) {
  messageQueue.enqueue({
    type: 'prompt',
    content: text,
    callSid: state.callSidRef(),
    // ...
  });
  return; // Don't abort current stream
}
```

#### Acceptance Criteria
- Interrupts no longer abort active streams
- Messages during active streams are queued
- Queue is processed after stream completion
- System remains responsive during queue operations

### Phase 3: Stream State Management (MEDIUM PRIORITY) ✅
**Goal**: Track and coordinate active streams

#### Deliverables
- [x] Create `backend/src/services/stream-coordinator.ts`
  - Track active stream per call session ✅
  - Prevent concurrent streams for same session ✅
  - Provide stream status queries ✅
  - Handle stream lifecycle events ✅
  - Fixed memory leak with singleton timer ✅

- [x] Integrate coordinator with WebSocket handler
  - Register stream start/end ✅
  - Query stream status before processing ✅
  - Coordinate queue processing ✅

#### Technical Details
```typescript
class StreamCoordinator {
  private activeStreams: Map<string, StreamState>;
  
  isStreamActive(callSid: string): boolean;
  registerStreamStart(callSid: string): void;
  registerStreamEnd(callSid: string): void;
  getQueuedMessages(callSid: string): QueuedMessage[];
}
```

#### Acceptance Criteria
- Only one active stream per call session
- Stream state accurately tracked
- Queue processing triggered on stream end
- No race conditions between streams

### Phase 4: Enhanced User Experience (LOW PRIORITY)
**Goal**: Add intelligent message handling and feedback

#### Deliverables
- [ ] Implement smart message merging
  - Combine related sequential messages
  - Filter redundant prompts
  - Preserve important context

- [ ] Add queue status indicators
  - Log queue depth for monitoring
  - Track processing delays
  - Alert on queue overflow

- [ ] Optimize response timing
  - Implement small pause between responses
  - Natural conversation cadence
  - Prevent response collision

#### Acceptance Criteria
- Related messages intelligently combined
- Natural pause between queued responses
- Queue metrics available in logs
- Smooth conversation flow

## Technical Architecture

### Component Diagram
```
[WebSocket Handler] → [Message Queue] → [Stream Coordinator]
                           ↓                    ↓
                    [Session Store]      [AI Service]
                           ↓                    ↓
                    [Batch Writer]       [Response Stream]
```

### Data Flow
1. User speaks → WebSocket receives message
2. Check if stream active via Stream Coordinator
3. If active → Queue message, continue current stream
4. If not active → Process immediately, mark stream active
5. On stream end → Check queue, process next if exists
6. Repeat until queue empty

### State Management
- Queue state: Per call session, in-memory
- Stream state: Per call session, in coordinator
- Session state: Existing session store
- Persistence: Existing batch writer pattern

## Rollout Strategy

### Phase 1 Testing
- Test with single user sessions
- Verify no interruptions occur
- Monitor queue behavior
- Check memory usage

### Phase 2 Testing  
- Test with rapid user inputs
- Verify queue processing order
- Test queue overflow scenarios
- Monitor response timing

### Phase 3 Production
- Enable for subset of calls
- Monitor error rates
- Track user experience metrics
- Full rollout after validation

## Risk Mitigation

### Risks
1. **Memory overflow from large queues**
   - Mitigation: Implement queue size limits
   - Fallback: Drop oldest messages when full

2. **Response delays from queue processing**
   - Mitigation: Process queue items immediately after stream
   - Fallback: Time-based queue flush

3. **Lost messages during failures**
   - Mitigation: Persist critical messages
   - Fallback: Graceful degradation to interrupt mode

4. **WebSocket timeout from long queues**
   - Mitigation: Send periodic ping/pong
   - Fallback: Queue size limits

## Success Criteria

### Minimum Viable Success
- No interrupted responses when user speaks during AI response
- All user messages captured and eventually processed
- No increase in error rates
- No significant latency increase

### Ideal Success
- Seamless conversation flow
- Intelligent message handling
- Parallel processing capability
- Enhanced user satisfaction metrics

## Timeline

### Week 1
- Phase 1: Core Message Queue
- Phase 2: Non-Interrupting Handler
- Basic testing and validation

### Week 2
- Phase 3: Stream State Management
- Integration testing
- Performance optimization

### Week 3 (Optional)
- Phase 4: Enhanced User Experience
- Production testing
- Gradual rollout

## Open Questions

1. Should we implement parallel processing in MVP or keep sequential?
2. What's the optimal queue size limit for voice calls?
3. How should we handle very long messages in queue?
4. Should queue state persist across reconnections?
5. Do we need message priorities for different types?

## Implementation Summary

### Completed Features ✅
1. **Core Message Queue Service**
   - FIFO queue with deduplication
   - Size limits and cleanup
   - Per-session management

2. **Stream Coordinator Service**
   - Active stream tracking
   - Prevents concurrent processing
   - Automatic cleanup with proper timer management

3. **Non-Interrupting WebSocket Handler**
   - Interrupts no longer abort streams
   - "Stop" command halts TTS only
   - Messages queued during active streams
   - Sequential processing with natural delays

### Code Quality Improvements ✅
1. **Fixed Critical Issues**
   - Memory leak in stream coordinator (singleton timer)
   - Unsafe JSON parsing (added try-catch)
   - TypeScript any casting removed (proper types added)

2. **Enhanced Type Safety**
   - Added proper RelayState type definition
   - Removed all `as any` castings
   - Improved TypeScript compliance

3. **Better Error Handling**
   - Safe JSON parsing with error logging
   - Graceful degradation on failures
   - Process exit cleanup handlers

## Appendix

### Current Interrupt Flow
```typescript
// Current behavior - interrupts abort stream
function handleInterrupt(state: RelayState, abortRef: AbortRef) {
  if (abortRef.get()) abortRef.get().abort('interrupt');
  // Stream is completely stopped
}
```

### Proposed Queue Flow
```typescript
// New behavior - interrupts queue message
function handleInterrupt(state: RelayState, messageQueue: MessageQueue) {
  if (streamCoordinator.isActive(state.callSidRef())) {
    messageQueue.enqueue({
      type: 'interrupt',
      callSid: state.callSidRef(),
      // Continue current stream
    });
  }
}
```