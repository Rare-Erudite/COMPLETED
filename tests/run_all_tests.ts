/**
 * Test runner — boots a real server, runs every suite against it, and fails
 * loudly.
 *
 * Previously the auth suite fetched http://127.0.0.1:3000 assuming a server was
 * already running. From a clean checkout nothing was listening, every request
 * threw, and the runner still exited 0 — so a broken build looked green.
 *
 * Now the runner:
 *   1. picks a free port,
 *   2. starts `server.ts` with local storage fallback enabled,
 *   3. waits for the health endpoint (with a hard timeout),
 *   4. exports RARE_TEST_BASE_URL for the suites,
 *   5. tears the server down and exits non-zero on any failure.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

import { runModelProviderTests } from './test_model_providers.js';
import { runToolTests } from './test_tools.js';
import { runMemoryTests } from './test_memory.js';
import { runDevelopmentTests } from './test_development.js';
import { runRealSelfDevelopmentTests } from './test_real_self_development.js';
import { runDiagnosticsTests } from './test_diagnostics.js';
import { runEvaluationTests } from './test_evaluation.js';
import { runApiConfigurationTests } from './test_api_configuration.js';
import { runRareIntelligenceBridgeTests } from './test_rare_intelligence_bridge.js';
import { runAuthenticationSecurityTests } from './test_authentication_security.js';
import { runPersistentWorkflowTests } from './test_persistent_workflows.js';
import { runOAuthValidationTests } from './test_oauth_validation.js';
import { runStandaloneResearchTests } from './test_standalone_research.js';
import { runToolchainRegistryTests, runAssistantCommandTests } from './test_builder_and_assistant.js';
import { runServerlessFrontendAvailabilityTests } from './test_serverless_frontend.js';
import { runContentEngineTests } from './test_content_engine.js';

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a test port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  while (Date.now() < deadline) {
    if (exited) throw new Error('The test server exited before it became reachable.');
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The test server did not become reachable at ${baseUrl} within ${timeoutMs}ms.`);
}

async function main() {
  console.log('=====================================================');
  console.log('  RARE CORE INTELLIGENCE — AUTOMATED VERIFICATION SUITE');
  console.log('=====================================================\n');

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[runner] Starting test server on ${baseUrl}`);

  const child = spawn('npx', ['tsx', 'server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV || 'test',
      // Tests must run from a clean checkout with no database configured.
      RARE_ALLOW_LOCAL_STORAGE_FALLBACK: 'true',
      // The server pins allowed origins; register the ephemeral test origin
      // through the existing configuration rather than weakening the check.
      RARE_ALLOWED_ORIGINS: [process.env.RARE_ALLOWED_ORIGINS, baseUrl].filter(Boolean).join(','),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog: string[] = [];
  child.stdout?.on('data', (chunk) => serverLog.push(String(chunk)));
  child.stderr?.on('data', (chunk) => serverLog.push(String(chunk)));

  let exitCode = 0;
  try {
    await waitForServer(baseUrl, child);
    console.log('[runner] Server is reachable.\n');
    process.env.RARE_TEST_BASE_URL = baseUrl;

    await runApiConfigurationTests();
    console.log();
    await runStandaloneResearchTests();
    console.log();
    await runAuthenticationSecurityTests();
    console.log();
    await runPersistentWorkflowTests();
    console.log();
    await runOAuthValidationTests();
    console.log();
    await runModelProviderTests();
    console.log();
    await runRareIntelligenceBridgeTests();
    console.log();
    await runToolTests();
    console.log();
    await runMemoryTests();
    console.log();
    await runDevelopmentTests();
    console.log();
    // Behavioural proof that self-build really mutates and verifies files,
    // rather than reporting a step name.
    await runRealSelfDevelopmentTests();
    console.log();
    await runDiagnosticsTests();
    console.log();
    await runEvaluationTests();
    console.log();
    await runToolchainRegistryTests();
    console.log();
    await runAssistantCommandTests();
    console.log();
    await runServerlessFrontendAvailabilityTests();
    console.log();
    await runContentEngineTests();
    console.log();
    console.log('=====================================================');
    console.log('  ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY');
    console.log('=====================================================');
  } catch (err: any) {
    exitCode = 1;
    console.error('\n❌ Test suite failed with error:', err);
    if (serverLog.length > 0) {
      console.error('\n--- server output (last 40 lines) ---');
      console.error(serverLog.join('').split('\n').slice(-40).join('\n'));
    }
  } finally {
    child.kill('SIGTERM');
    // Give the server a moment to release the port, then force it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!child.killed) child.kill('SIGKILL');
  }

  process.exit(exitCode);
}

main();
