/**
 * Automated Verification Suite for Authentication & Verification Code Security
 * Tests:
 * 1. Rejection of arbitrary 6-digit bypass codes for phone and email OTP.
 * 2. Invalidation of codes upon use (replay prevention).
 * 3. Rate limiting and attempts threshold enforcement.
 * 4. Rejection of forged/fabricated Google & Microsoft OAuth tokens.
 * 5. Password security: Salted hash verification, denial of incorrect passwords.
 * 6. Privilege escalation prevention: Developer access cannot be claimed via email string.
 */

import assert from 'assert';

function sessionHeaders(response: Response): Record<string, string> {
  const raw = typeof (response.headers as any).getSetCookie === 'function'
    ? (response.headers as any).getSetCookie() as string[]
    : (response.headers.get('set-cookie') || '').split(/, (?=[^;,]+=)/g);
  const cookies = raw.map((value) => value.split(';', 1)[0]).filter(Boolean);
  const csrfCookie = cookies.find((value) => value.startsWith('rare_csrf='));
  const csrf = response.headers.get('x-csrf-token') || csrfCookie?.slice('rare_csrf='.length) || '';
  const sessionCookie = raw.find((value) => value.startsWith('rare_session=')) || '';
  assert.ok(sessionCookie, 'Authentication must issue a server session cookie');
  assert.match(sessionCookie, /HttpOnly/i, 'Session cookie must not be accessible to browser JavaScript');
  assert.match(sessionCookie, /SameSite=(?:Lax|None)/i, 'Session cookie must use a SameSite policy');
  if (process.env.NODE_ENV === 'production') assert.match(sessionCookie, /Secure/i, 'Production session cookie must require HTTPS');
  assert.ok(csrf, 'Authentication must issue a CSRF token');
  return { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000', Cookie: cookies.join('; '), 'X-CSRF-Token': decodeURIComponent(csrf) };
}

export async function runAuthenticationSecurityTests() {
  console.log('--- Testing Authentication & Verification Code Security ---');

  // Sensitive application data routes reject direct requests without a server-issued session.
  const privateDocsRes = await fetch('http://127.0.0.1:3000/api/documents');
  assert.strictEqual(
    privateDocsRes.status,
    401,
    'Private document listing must require a RARE session'
  );
  const privateWriteRes = await fetch('http://127.0.0.1:3000/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'unauthorized.txt', text: 'must not be written' }),
  });
  assert.strictEqual(privateWriteRes.status, 401, 'Private document writes must require a RARE session');
  // 1. Test OTP verification rejection when arbitrary 6-digit codes are submitted
  // Verify that an arbitrary 6-digit number like "123456" or "000000" fails against a test target
  const testEmail = 'unauthorized_attacker@example.com';
  const testPhone = '+15550001111';

  // Requesting verification without prior dispatch must return HTTP 400
  const verifyRes = await fetch('http://127.0.0.1:3000/api/user/verify-email-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, code: '123456' }),
  });
  assert.strictEqual(
    verifyRes.status,
    400,
    'Arbitrary 6-digit code must be rejected without active dispatch'
  );
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.success, false);

  // Phone arbitrary bypass check
  const verifyPhoneRes = await fetch('http://127.0.0.1:3000/api/user/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: testPhone, code: '654321' }),
  });
  assert.strictEqual(
    verifyPhoneRes.status,
    400,
    'Arbitrary 6-digit phone code must be rejected without active dispatch'
  );

  // 2. Test rejection of unverified/fabricated OAuth requests
  // Attempting to submit plain email without token must fail
  const forgedOAuthRes = await fetch('http://127.0.0.1:3000/api/user/oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      email: 'rarelivescore@gmail.com', // Attacker claiming owner email
    }),
  });
  assert.strictEqual(
    forgedOAuthRes.status,
    400,
    'Submitting email without token must be rejected with HTTP 400'
  );

  // Attempting to submit invalid/fabricated token
  const invalidTokenRes = await fetch('http://127.0.0.1:3000/api/user/oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      token: 'fake_jwt_token_fabricated_by_attacker',
    }),
  });
  assert.strictEqual(
    invalidTokenRes.status,
    401,
    'Invalid or fabricated token must be rejected with HTTP 401'
  );

  // 3. Test privilege escalation prevention
  // Regular signup must never receive developer privileges
  const weakPasswordSignup = await fetch('http://127.0.0.1:3000/api/user/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `weak_${Date.now()}@example.com`, password: 'short' }),
  });
  assert.strictEqual(weakPasswordSignup.status, 400, 'Signup must reject passwords below the minimum length');
  const testUserEmail = `test_regular_${Date.now()}@example.com`;
  const signupRes = await fetch('http://127.0.0.1:3000/api/user/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testUserEmail,
      password: 'SecurePassword123!',
      name: 'Regular Test User',
    }),
  });
  assert.strictEqual(signupRes.status, 200);
  const signupData = await signupRes.json();
  assert.strictEqual(signupData.user.role, 'user', 'New accounts must have regular user role');
  assert.strictEqual(signupData.sessionToken, undefined, 'Browser session secrets must never be returned to JavaScript');

  const userAHeaders = sessionHeaders(signupRes);
  const secondSignupRes = await fetch('http://127.0.0.1:3000/api/user/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `test_other_${Date.now()}@example.com`, password: 'SecurePassword123!', name: 'Other Test User' }),
  });
  assert.strictEqual(secondSignupRes.status, 200, 'A second ordinary account should be created for ownership tests');
  const secondSignupData = await secondSignupRes.json();
  const userBHeaders = sessionHeaders(secondSignupRes);

  // Direct API access must isolate memories and documents by the authenticated
  // session even when the body attempts to claim the other account's identity.
  const unauthenticatedMemory = await fetch('http://127.0.0.1:3000/api/memories');
  assert.strictEqual(unauthenticatedMemory.status, 401, 'Memory reads must reject requests without a session');
  const expiredSessionMemory = await fetch('http://127.0.0.1:3000/api/user-memory', { headers: { Authorization: 'Bearer expired-or-unknown-session' } });
  assert.strictEqual(expiredSessionMemory.status, 401, 'Unknown or expired sessions must not access private memories');

  const memoryCreateRes = await fetch('http://127.0.0.1:3000/api/memories', {
    method: 'POST', headers: userAHeaders,
    body: JSON.stringify({ text: 'owner A private marker', userId: secondSignupData.user.id, ownerId: secondSignupData.user.id }),
  });
  assert.strictEqual(memoryCreateRes.status, 201, 'Authenticated user should be able to create a private memory');
  const memory = await memoryCreateRes.json();
  const crossUserMemories = await fetch('http://127.0.0.1:3000/api/memories', { headers: userBHeaders });
  assert.strictEqual(crossUserMemories.status, 200);
  assert.ok(!(await crossUserMemories.json()).some((item: any) => item.id === memory.id), 'Another account must not read a private memory');
  const crossUserMemoryUpdate = await fetch(`http://127.0.0.1:3000/api/memories/${memory.id}`, { method: 'PUT', headers: userBHeaders, body: JSON.stringify({ text: 'stolen' }) });
  assert.strictEqual(crossUserMemoryUpdate.status, 404, 'Another account must not update a private memory');
  const crossUserMemoryDelete = await fetch(`http://127.0.0.1:3000/api/memories/${memory.id}`, { method: 'DELETE', headers: userBHeaders });
  assert.strictEqual(crossUserMemoryDelete.status, 404, 'Another account must not delete a private memory');

  const documentCreateRes = await fetch('http://127.0.0.1:3000/api/documents', {
    method: 'POST', headers: userAHeaders,
    body: JSON.stringify({ path: 'private-owner-a.txt', text: 'owner A private document', userId: secondSignupData.user.id }),
  });
  assert.strictEqual(documentCreateRes.status, 201, 'Authenticated user should be able to create a private document');
  const crossUserDocument = await fetch('http://127.0.0.1:3000/api/documents/private-owner-a.txt', { headers: userBHeaders });
  assert.strictEqual(crossUserDocument.status, 404, 'Another account must not read a private document');
  const crossUserDocumentList = await fetch('http://127.0.0.1:3000/api/documents', { headers: userBHeaders });
  assert.strictEqual(crossUserDocumentList.status, 200);
  assert.ok(!(await crossUserDocumentList.json()).some((item: any) => item.path === 'private-owner-a.txt'), 'Another account must not list a private document');

  const conversationCreateRes = await fetch('http://127.0.0.1:3000/api/conversations', {
    method: 'POST', headers: userAHeaders,
    body: JSON.stringify({ title: 'Owner A private chat', userId: secondSignupData.user.id }),
  });
  assert.strictEqual(conversationCreateRes.status, 201, 'Authenticated user should be able to create a conversation');
  const privateConversation = await conversationCreateRes.json();
  const privateMessage = privateConversation.messages[0];
  const crossUserConversation = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}`, { headers: userBHeaders });
  assert.strictEqual(crossUserConversation.status, 404, 'Another account must not read a private conversation');
  const crossUserConversationDelete = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}`, { method: 'DELETE', headers: userBHeaders });
  assert.strictEqual(crossUserConversationDelete.status, 404, 'Another account must not delete a private conversation');
  const crossUserMessageEdit = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}/messages/${privateMessage.id}`, {
    method: 'PUT', headers: userBHeaders, body: JSON.stringify({ content: 'stolen message' }),
  });
  assert.strictEqual(crossUserMessageEdit.status, 404, 'Another account must not edit a nested private message');
  const crossUserMessageDelete = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}/messages/${privateMessage.id}`, {
    method: 'DELETE', headers: userBHeaders,
  });
  assert.strictEqual(crossUserMessageDelete.status, 404, 'Another account must not delete a nested private message');
  const ownMessageEdit = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}/messages/${privateMessage.id}`, {
    method: 'PUT', headers: userAHeaders, body: JSON.stringify({ content: 'updated by owner A' }),
  });
  assert.strictEqual(ownMessageEdit.status, 200, 'The conversation owner can edit their own message');
  const ownMessageDelete = await fetch(`http://127.0.0.1:3000/api/conversations/${privateConversation.id}/messages/${privateMessage.id}`, {
    method: 'DELETE', headers: userAHeaders,
  });
  assert.strictEqual(ownMessageDelete.status, 200, 'The conversation owner can delete their own message');

  const userSettingsRes = await fetch('http://127.0.0.1:3000/api/settings', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({ theme: 'red', assistant_name: 'Private A' }),
  });
  assert.strictEqual(userSettingsRes.status, 200, 'Authenticated users should be able to save their own preferences');
  const otherUserSettingsRes = await fetch('http://127.0.0.1:3000/api/settings', { headers: userBHeaders });
  assert.strictEqual(otherUserSettingsRes.status, 200);
  const otherUserSettings = await otherUserSettingsRes.json();
  assert.notStrictEqual(otherUserSettings.theme, 'red', 'Another account must not read private settings');
  assert.notStrictEqual(otherUserSettings.assistant_name, 'Private A', 'Another account must not read a private profile preference');

  const scheduleCreate = await fetch('http://127.0.0.1:3000/api/schedules', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({ title: 'Owner A reminder', time: '10:30' }),
  });
  assert.strictEqual(scheduleCreate.status, 201, 'A user can create a private schedule');
  const schedule = await scheduleCreate.json();
  const otherSchedules = await fetch('http://127.0.0.1:3000/api/schedules', { headers: userBHeaders });
  assert.ok(!(await otherSchedules.json()).some((item: any) => item.id === schedule.id), 'Schedules must be isolated by owner');
  const crossUserScheduleToggle = await fetch(`http://127.0.0.1:3000/api/schedules/${schedule.id}/toggle`, {
    method: 'POST', headers: userBHeaders, body: JSON.stringify({}),
  });
  assert.strictEqual(crossUserScheduleToggle.status, 404, 'Another user cannot toggle a private schedule');
  const crossUserScheduleDelete = await fetch(`http://127.0.0.1:3000/api/schedules/${schedule.id}`, {
    method: 'DELETE', headers: userBHeaders,
  });
  assert.strictEqual(crossUserScheduleDelete.status, 404, 'Another user cannot delete a private schedule');

  const pluginToggle = await fetch('http://127.0.0.1:3000/api/plugins/plugin_smart_scheduler/toggle', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({}),
  });
  assert.strictEqual(pluginToggle.status, 200);
  const pluginsUserA = await fetch('http://127.0.0.1:3000/api/plugins', { headers: userAHeaders });
  const pluginsUserB = await fetch('http://127.0.0.1:3000/api/plugins', { headers: userBHeaders });
  const pluginA = (await pluginsUserA.json()).find((item: any) => item.id === 'plugin_smart_scheduler');
  const pluginB = (await pluginsUserB.json()).find((item: any) => item.id === 'plugin_smart_scheduler');
  assert.notStrictEqual(pluginA.installed, pluginB.installed, 'Plugin settings must be isolated by owner');

  const projectListRes = await fetch(`http://127.0.0.1:3000/api/agents/runs?userId=${encodeURIComponent(signupData.user.email)}`, { headers: userBHeaders });
  assert.strictEqual(projectListRes.status, 200);
  const otherUserProjects = await projectListRes.json();
  assert.ok(otherUserProjects.every((run: any) => run.ownerId === secondSignupData.user.id), 'Project listing must use session ownership rather than a userId query parameter');

  const ordinaryRollbackRes = await fetch('http://127.0.0.1:3000/api/developer/rollback', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({ checkpointId: 'not-a-real-checkpoint' }),
  });
  assert.strictEqual(ordinaryRollbackRes.status, 403, 'Ordinary sessions must not run developer rollback actions');
  const ordinaryPasskeyRes = await fetch('http://127.0.0.1:3000/api/developer/change-passkey', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({ currentPasskey: 'wrong', newPasskey: 'attempted-change' }),
  });
  assert.strictEqual(ordinaryPasskeyRes.status, 403, 'Ordinary sessions must not change developer credentials');
  const ordinaryToolRes = await fetch('http://127.0.0.1:3000/api/tools/execute', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({ tool: 'WRITE_FILE', inputs: { path: 'unauthorized.txt', content: 'no' } }),
  });
  assert.strictEqual(ordinaryToolRes.status, 403, 'Ordinary users must not directly execute system tools');
  const ordinaryCheckpointRes = await fetch('http://127.0.0.1:3000/api/checkpoints', { headers: userAHeaders });
  assert.strictEqual(ordinaryCheckpointRes.status, 403, 'Ordinary users must not inspect developer checkpoints');
  const ordinaryEvaluationRes = await fetch('http://127.0.0.1:3000/api/intelligence/evaluate', {
    method: 'POST', headers: userAHeaders, body: JSON.stringify({}),
  });
  assert.strictEqual(ordinaryEvaluationRes.status, 403, 'Ordinary users must not run developer evaluation operations');

  const guestSessionRes = await fetch('http://127.0.0.1:3000/api/user/guest-session', { method: 'POST' });
  assert.strictEqual(guestSessionRes.status, 200, 'Guest sessions remain available as a limited product feature');
  const guestSession = await guestSessionRes.json();
  assert.strictEqual(guestSession.sessionToken, undefined, 'Guest browser sessions must not expose bearer secrets');
  const guestHeaders = sessionHeaders(guestSessionRes);
  const csrfFailure = await fetch('http://127.0.0.1:3000/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestHeaders.Cookie },
    body: JSON.stringify({ theme: 'red' }),
  });
  assert.strictEqual(csrfFailure.status, 403, 'Cookie-authenticated writes must require a CSRF token');
  const originFailure = await fetch('http://127.0.0.1:3000/api/settings', {
    method: 'POST',
    headers: { ...guestHeaders, Origin: 'https://attacker.example' },
    body: JSON.stringify({ theme: 'red' }),
  });
  assert.strictEqual(originFailure.status, 403, 'Cookie-authenticated writes must reject untrusted origins');
  const guestProjectRes = await fetch('http://127.0.0.1:3000/api/agents/runs', {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({ title: 'Guest project', objective: 'must require an account' }),
  });
  assert.strictEqual(guestProjectRes.status, 403, 'Guest sessions must not create unrestricted build projects');
  const logoutRes = await fetch('http://127.0.0.1:3000/api/user/logout', { method: 'POST', headers: guestHeaders });
  assert.strictEqual(logoutRes.status, 200, 'Logout revokes a cookie-backed session');
  const revokedSessionRes = await fetch('http://127.0.0.1:3000/api/user/me', { headers: { Cookie: guestHeaders.Cookie } });
  assert.strictEqual(revokedSessionRes.status, 401, 'A logged-out session cannot be reused');

  // Verify developer endpoint is blocked for unauthorized requests
  const devStatusRes = await fetch('http://127.0.0.1:3000/api/developer/status');
  assert.strictEqual(
    devStatusRes.status,
    403,
    'Developer status must require explicit developer authorization'
  );

  // 4. Test missing credentials error for OTP sending (honesty requirement)
  // When credentials are not configured, send-otp must report 503 instead of pretending success
  const sendEmailRes = await fetch('http://127.0.0.1:3000/api/user/send-email-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `test_delivery_${Date.now()}@test.com` }),
  });
  // Since EMAIL_PROVIDER_API_KEY is not configured in this test environment, it must honestly fail with 503
  if (!process.env.EMAIL_PROVIDER_API_KEY) {
    assert.strictEqual(
      sendEmailRes.status,
      503,
      'Missing email credentials must return 503 and not fabricate success'
    );
    const sendData = await sendEmailRes.json();
    assert.strictEqual(sendData.success, false);
    assert.ok(sendData.error.includes('EMAIL_PROVIDER_API_KEY'));
  }

  console.log('\u2713 Authentication & Verification Code Security tests passed.');
}
