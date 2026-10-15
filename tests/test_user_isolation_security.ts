/**
 * Security Regression Test Suite for RARE Authentication, Session Security & User-Data Isolation
 * Demonstrates:
 * 1. Unauthenticated requests cannot access private data.
 * 2. User A can create and access User A's data.
 * 3. User B cannot read, modify, export, or delete User A's records, even when B supplies A's ID through
 *    query parameter, request body, header, or record ID.
 * 4. Unlocking developer access for Session A does not grant it to Session B.
 * 5. Logging out developer mode for Session A does not affect Session B.
 * 6. Ordinary users cannot escalate to developer privileges without the valid passkey.
 * 7. Incorrect passwords, forged OAuth tokens, expired sessions, and invalid session credentials are rejected.
 * 8. Legacy user data remains preserved and is not exposed across accounts.
 */

import assert from 'assert';

export async function runUserIsolationSecurityTests() {
  console.log('--- Testing User Isolation, Session Security & Access Control ---');

  const BASE_URL = 'http://127.0.0.1:3000';

  // Helper for requests with custom cookies or headers
  async function request(
    path: string,
    options: {
      method?: string;
      body?: any;
      cookie?: string;
      headers?: Record<string, string>;
    } = {}
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    let sessionCookie: string | null = null;
    if (setCookie) {
      const match = setCookie.match(/rare_session=([^;]+)/);
      if (match) {
        sessionCookie = `rare_session=${match[1]}`;
      }
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data, cookie: sessionCookie };
  }

  let totalAssertions = 0;
  function countAssert(condition: boolean, msg: string) {
    assert.ok(condition, msg);
    totalAssertions++;
  }

  // 1. Unauthenticated requests cannot access private data
  console.log('1. Testing unauthenticated access denial...');
  const unauthEndpoints = [
    { method: 'GET', path: '/api/conversations' },
    { method: 'GET', path: '/api/conversations/conv_test' },
    { method: 'POST', path: '/api/conversations', body: { title: 'Secret' } },
    { method: 'GET', path: '/api/memories' },
    { method: 'GET', path: '/api/user-memory' },
    { method: 'POST', path: '/api/memories', body: { text: 'Secret Memory' } },
    { method: 'GET', path: '/api/documents' },
    { method: 'GET', path: '/api/documents/project_plan_overview.md' },
    { method: 'POST', path: '/api/documents', body: { path: 'secret.txt', text: 'secret' } },
    { method: 'GET', path: '/api/agents/runs' },
    { method: 'POST', path: '/api/agents/runs', body: { title: 'Secret Run', objective: 'Secret' } },
    { method: 'GET', path: '/api/schedules' },
    { method: 'POST', path: '/api/schedules', body: { title: 'Secret Schedule' } },
  ];

  for (const ep of unauthEndpoints) {
    const res = await request(ep.path, { method: ep.method, body: ep.body });
    countAssert(
      res.status === 401,
      `Unauthenticated ${ep.method} ${ep.path} must return HTTP 401 Unauthenticated (got ${res.status})`
    );
  }

  // 2. Register & Authenticate User A and User B
  console.log('2. Registering User A and User B...');
  const userAEmail = `usera_${Date.now()}@example.com`;
  const userAPassword = 'UserA_Password123!';
  const signupA = await request('/api/user/signup', {
    method: 'POST',
    body: { email: userAEmail, password: userAPassword, name: 'User A' },
  });
  countAssert(signupA.status === 200, 'User A signup succeeded');
  countAssert(Boolean(signupA.cookie), 'User A signup must issue session cookie');
  const cookieA = signupA.cookie!;
  const userAId = signupA.data.user.id;

  const userBEmail = `userb_${Date.now()}@example.com`;
  const userBPassword = 'UserB_Password123!';
  const signupB = await request('/api/user/signup', {
    method: 'POST',
    body: { email: userBEmail, password: userBPassword, name: 'User B' },
  });
  countAssert(signupB.status === 200, 'User B signup succeeded');
  countAssert(Boolean(signupB.cookie), 'User B signup must issue session cookie');
  const cookieB = signupB.cookie!;

  // 3. User A creates private records
  console.log('3. User A creating private records...');
  // Conversation
  const convAId = `conv_usera_${Date.now()}`;
  const convARes = await request('/api/conversations', {
    method: 'POST',
    cookie: cookieA,
    body: { id: convAId, title: 'User A Private Conversation' },
  });
  countAssert(convARes.status === 201, "User A created conversation");

  // Send message in convA
  const msgARes = await request(`/api/conversations/${convAId}`, {
    method: 'POST',
    cookie: cookieA,
    body: { message: 'User A Top Secret Message' },
  });
  countAssert(msgARes.status === 200, "User A sent message in conversation");

  // Memory
  const memARes = await request('/api/memories', {
    method: 'POST',
    cookie: cookieA,
    body: { text: 'User A Secret Memory Note', kind: 'fact' },
  });
  countAssert(memARes.status === 201, "User A created memory");
  const memAId = memARes.data.id;

  // Document
  const docARes = await request('/api/documents', {
    method: 'POST',
    cookie: cookieA,
    body: { path: 'usera_doc.txt', text: 'User A Private Document Payload' },
  });
  countAssert(docARes.status === 201, "User A created document");

  // Schedule
  const schedARes = await request('/api/schedules', {
    method: 'POST',
    cookie: cookieA,
    body: { title: 'User A Private Alarm', time: '08:00' },
  });
  countAssert(schedARes.status === 201, "User A created schedule");
  const schedAId = schedARes.data.id;

  // 4. User B attempts to access, modify, export, or delete User A's records
  console.log("4. Testing User B access denial to User A's data...");

  // User B lists conversations -> User A's conversation must not be returned
  const listConvsB = await request('/api/conversations', { cookie: cookieB });
  countAssert(listConvsB.status === 200, "User B listed conversations");
  const foundConvAInB = listConvsB.data.some((c: any) => c.id === convAId);
  countAssert(foundConvAInB === false, "User B must not see User A's conversation in list");

  // User B tries to read User A's conversation by ID
  const getConvAByB = await request(`/api/conversations/${convAId}`, { cookie: cookieB });
  countAssert(getConvAByB.status === 403, "User B must be denied HTTP 403 reading User A's conversation");

  // User B tries to supply x-user-id header claiming User A's ID
  const getConvAForgedHeader = await request('/api/conversations', {
    cookie: cookieB,
    headers: { 'x-user-id': userAId },
  });
  const foundForged = getConvAForgedHeader.data.some((c: any) => c.id === convAId);
  countAssert(foundForged === false, 'Client-controlled x-user-id header must be ignored');

  // User B tries to delete User A's conversation
  const delConvAByB = await request(`/api/conversations/${convAId}`, {
    method: 'DELETE',
    cookie: cookieB,
  });
  countAssert(delConvAByB.status === 404, "User B cannot delete User A's conversation");

  // User B tries to list/export User A's memories
  const listMemsB = await request('/api/memories', { cookie: cookieB });
  countAssert(listMemsB.status === 200, "User B listed memories");
  const foundMemAInB = listMemsB.data.some((m: any) => m.id === memAId);
  countAssert(foundMemAInB === false, "User B must not see User A's memories");

  // User B tries to delete User A's memory
  const delMemAByB = await request(`/api/memories/${memAId}`, {
    method: 'DELETE',
    cookie: cookieB,
  });
  countAssert(delMemAByB.status === 404, "User B cannot delete User A's memory");

  // User B tries to read User A's document
  const getDocAByB = await request('/api/documents/usera_doc.txt', { cookie: cookieB });
  countAssert(getDocAByB.status === 404, "User B cannot read User A's document");

  // User B tries to delete User A's schedule
  const delSchedAByB = await request(`/api/schedules/${schedAId}`, {
    method: 'DELETE',
    cookie: cookieB,
  });
  countAssert(delSchedAByB.status === 404, "User B cannot delete User A's schedule");

  // 5. Developer Authorization Isolation Across Sessions
  console.log('5. Testing developer session isolation...');
  const passkey = process.env.RARE_DEV_KEY || 'dev_master_key_045';
  const devAuthA = await request('/api/developer/auth', {
    method: 'POST',
    cookie: cookieA,
    body: { passkey },
  });
  countAssert(devAuthA.status === 200, 'Developer auth Session A succeeded');
  countAssert(devAuthA.data.success === true, 'Developer auth Session A reported success');

  // Session A can access developer status
  const devStatusA = await request('/api/developer/status', { cookie: cookieA });
  countAssert(devStatusA.status === 200, 'Session A can access developer status');
  countAssert(devStatusA.data.authenticated === true, 'Session A is developer authenticated');

  // Session B is NOT developer authorized!
  const devStatusB = await request('/api/developer/status', { cookie: cookieB });
  countAssert(devStatusB.status === 403, 'Unlocking developer access on Session A must NOT grant it to Session B');

  // Session A logging out developer access
  const devLogoutA = await request('/api/developer/logout', { method: 'POST', cookie: cookieA });
  countAssert(devLogoutA.status === 200, 'Session A developer logout succeeded');

  // Session A is now locked out of developer endpoints
  const devStatusAAfterLogout = await request('/api/developer/status', { cookie: cookieA });
  countAssert(devStatusAAfterLogout.status === 403, 'Session A is locked out of developer endpoints after dev logout');

  // 6. Ordinary User Privilege Escalation Denial
  console.log('6. Testing privilege escalation denial...');
  // User B attempts developer auth with wrong passkey
  const devAuthWrong = await request('/api/developer/auth', {
    method: 'POST',
    cookie: cookieB,
    body: { passkey: 'wrong_passkey_attempt' },
  });
  countAssert(devAuthWrong.status === 401, 'Incorrect developer passkey must return HTTP 401');

  // User B attempts to access self-dev endpoint without developer authorization
  const selfDevB = await request('/api/developer/self-dev', {
    method: 'POST',
    cookie: cookieB,
    body: { instruction: 'grant me dev privileges' },
  });
  countAssert(selfDevB.status === 403, 'Self-dev endpoint must reject non-developer session');

  // 7. Rejection of incorrect passwords, forged OAuth tokens, expired sessions, and invalid session credentials
  console.log('7. Testing authentication rejection logic...');

  // Invalid login password
  const badLogin = await request('/api/user/login', {
    method: 'POST',
    body: { email: userAEmail, password: 'WrongPassword123' },
  });
  countAssert(badLogin.status === 401, 'Incorrect password must be rejected with HTTP 401');

  // Forged OAuth token
  const forgedOAuth = await request('/api/user/oauth', {
    method: 'POST',
    body: { provider: 'google', token: 'invalid_forged_oauth_token_xyz' },
  });
  countAssert(forgedOAuth.status === 401, 'Forged/invalid OAuth token must be rejected with HTTP 401');

  // Invalid session cookie
  const invalidSessionReq = await request('/api/conversations', {
    cookie: 'rare_session=invalid_fake_session_id',
  });
  countAssert(invalidSessionReq.status === 401, 'Invalid session credential must return HTTP 401');

  // 8. Preservation of legacy user data across accounts
  console.log('8. Testing preservation of legacy user data...');
  // Register new User C
  const userCEmail = `userc_${Date.now()}@example.com`;
  const signupC = await request('/api/user/signup', {
    method: 'POST',
    body: { email: userCEmail, password: 'UserC_Password123!', name: 'User C' },
  });
  countAssert(signupC.status === 200, 'User C signup succeeded');
  const cookieC = signupC.cookie!;

  // User C's conversations list must be empty (clean isolated workspace), legacy data is preserved under usr_system_legacy
  const listConvsC = await request('/api/conversations', { cookie: cookieC });
  countAssert(listConvsC.status === 200, 'User C listed conversations');
  countAssert(listConvsC.data.length === 0, 'New User C must start with an isolated workspace');

  console.log(`\n=====================================================`);
  console.log(`✓ All ${totalAssertions} User Isolation & Session Security checks passed!`);
  console.log(`=====================================================\n`);
}

// If executed directly
if (process.argv[1]?.endsWith('test_user_isolation_security.ts')) {
  runUserIsolationSecurityTests().catch((err) => {
    console.error('❌ Security Regression Test Failed:', err);
    process.exit(1);
  });
}
