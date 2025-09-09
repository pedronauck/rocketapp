#!/usr/bin/env bun

import { initDatabase, getDatabase } from './src/db/database';

async function testConversationContext() {
  console.log('Testing conversation context retrieval...\n');
  
  // Initialize database first with proper path
  initDatabase('./data/calls.db');
  const db = getDatabase();
  
  // Test phone number (you can change this to a number with existing conversations)
  const testPhoneNumber = '+17275157107';
  
  try {
    // Get caller info
    const caller = await db.getCallerByPhone(testPhoneNumber);
    console.log('Caller Info:', caller);
    
    // Get recent conversations
    const recentConvs = await db.getRecentConversation(testPhoneNumber, 5);
    console.log(`\nFound ${recentConvs.length} recent conversations`);
    
    // Get conversation context
    const context = await db.getConversationContext(testPhoneNumber, 24);
    console.log('\nConversation Context:');
    console.log('- Recent Topics:', context.recentTopics);
    console.log('- Conversation Count:', context.conversationCount);
    console.log('- Last Call Time:', context.lastCallTime ? new Date(context.lastCallTime * 1000).toLocaleString() : 'N/A');
    
    if (context.lastCallTime) {
      const hoursAgo = Math.floor((Date.now() / 1000 - context.lastCallTime) / 3600);
      console.log(`- Hours Since Last Call: ${hoursAgo}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    db.close();
  }
}

testConversationContext();