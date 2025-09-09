#!/usr/bin/env bun
// Quick test script to verify database setup
import { initDatabase, getDatabase } from './src/db/database';
import { getEnv } from './src/config/env';

async function testDatabase() {
  console.log('Testing database setup...\n');
  
  try {
    // Initialize database
    const env = getEnv();
    const db = initDatabase(env.DATABASE_PATH);
    console.log('✅ Database initialized successfully');
    console.log(`   Path: ${env.DATABASE_PATH}\n`);
    
    // Test caller operations
    const testPhone = '+1234567890';
    const testName = 'Test User';
    
    // Check if caller exists
    const existingCaller = await db.getCallerByPhone(testPhone);
    console.log('🔍 Checking for existing caller:', existingCaller ? 'Found' : 'Not found');
    
    // Save caller name
    await db.saveCallerName(testPhone, testName);
    console.log('💾 Saved caller name (async)');
    
    // Wait a bit for async operation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check again
    const savedCaller = await db.getCallerByPhone(testPhone);
    console.log('✅ Caller retrieved:', savedCaller);
    
    // Test conversation operations
    const testCallSid = 'CA' + Date.now();
    await db.createConversation(testCallSid, testPhone);
    console.log('📞 Created conversation:', testCallSid);
    
    // Update conversation
    const messages = [
      { role: 'system', content: 'Welcome!' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];
    await db.updateConversationMessages(testCallSid, messages);
    console.log('💬 Updated conversation messages');
    
    // Test quick lookup with timeout
    console.log('\n⚡ Testing quick lookup (100ms timeout)...');
    const quickResult = await db.getCallerQuickly(testPhone, 100);
    console.log('   Result:', quickResult ? `Found ${quickResult.name}` : 'Timeout or not found');
    
    console.log('\n✅ All database tests passed!');
    
    // Close database
    db.close();
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  }
}

testDatabase();