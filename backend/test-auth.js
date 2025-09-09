// Test authentication flow
const BASE_URL = 'http://localhost:3005';

async function testAuth() {
  console.log('Testing Authentication Flow...\n');
  
  // Test 1: Send verification code
  console.log('1. Sending verification code...');
  try {
    const sendResponse = await fetch(`${BASE_URL}/api/auth/send-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+15551234567' })
    });
    
    const sendData = await sendResponse.json();
    console.log('Response:', sendData);
    
    if (sendData.success) {
      console.log('✅ Verification code sent (dev mode - use 123456)\n');
    } else {
      console.log('❌ Failed to send code:', sendData.message, '\n');
    }
  } catch (error) {
    console.error('❌ Error sending code:', error.message, '\n');
  }
  
  // Test 2: Verify code
  console.log('2. Verifying code...');
  try {
    const verifyResponse = await fetch(`${BASE_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phoneNumber: '+15551234567',
        code: '123456' 
      })
    });
    
    const verifyData = await verifyResponse.json();
    console.log('Response:', verifyData);
    
    if (verifyData.success) {
      console.log('✅ Successfully authenticated');
      console.log('Token:', verifyData.token?.substring(0, 20) + '...');
      console.log('Session ID:', verifyData.sessionId, '\n');
      
      // Test 3: Get session
      console.log('3. Getting session info...');
      const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
        headers: { 
          'Authorization': `Bearer ${verifyData.token}`
        }
      });
      
      const sessionData = await sessionResponse.json();
      console.log('Session:', sessionData);
      
      if (sessionData.authenticated) {
        console.log('✅ Session is valid\n');
        
        // Test 4: Get Pokemon queries
        console.log('4. Fetching Pokemon queries...');
        const queriesResponse = await fetch(`${BASE_URL}/api/pokemon-queries`, {
          headers: { 
            'Authorization': `Bearer ${verifyData.token}`
          }
        });
        
        const queriesData = await queriesResponse.json();
        console.log('Queries:', queriesData);
        console.log('✅ Pokemon API accessible\n');
        
        // Test 5: Logout
        console.log('5. Logging out...');
        const logoutResponse = await fetch(`${BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${verifyData.token}`
          }
        });
        
        const logoutData = await logoutResponse.json();
        console.log('Logout:', logoutData);
        console.log('✅ Successfully logged out\n');
      }
    } else {
      console.log('❌ Verification failed:', verifyData.message, '\n');
    }
  } catch (error) {
    console.error('❌ Error verifying code:', error.message, '\n');
  }
  
  console.log('Test complete!');
}

// Run the test
testAuth().catch(console.error);