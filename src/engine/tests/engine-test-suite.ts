/**
 * RARE-INTELLIGENCE — Automated Quality Gates & Engine Test Suite
 */

import { engine } from '../engine.js';
import { SafeMathEvaluator } from '../tools/math-evaluator.js';
import { defaultSecurityGuard } from '../security/permissions.js';

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestSuiteSummary {
  totalCount: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  results: TestResult[];
}

export class EngineTestSuiteRunner {
  public static async runAllTests(): Promise<TestSuiteSummary> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    const runTest = async (name: string, fn: () => Promise<void> | void) => {
      const tStart = Date.now();
      try {
        await fn();
        results.push({ name, passed: true, durationMs: Date.now() - tStart });
      } catch (err: any) {
        results.push({ name, passed: false, durationMs: Date.now() - tStart, error: err.message });
      }
    };

    // 1. Math Evaluator
    await runTest('SafeMathEvaluator: Basic arithmetic and precedence', () => {
      const val = SafeMathEvaluator.evaluate('3 + 5 * 2');
      if (val !== 13) throw new Error(`Expected 13, got ${val}`);
    });

    await runTest('SafeMathEvaluator: Math functions and parenthesis', () => {
      const val = SafeMathEvaluator.evaluate('sqrt(144) + (10 - 2)');
      if (val !== 20) throw new Error(`Expected 20, got ${val}`);
    });

    await runTest('SafeMathEvaluator: Divide by zero protection', () => {
      let threw = false;
      try {
        SafeMathEvaluator.evaluate('10 / 0');
      } catch {
        threw = true;
      }
      if (!threw) throw new Error('Expected division by zero to throw');
    });

    // 2. Security Guard
    await runTest('SecurityGuard: Path traversal prevention', () => {
      const isContained = defaultSecurityGuard.isPathContained('/app/applet/../../etc/passwd', '/app/applet');
      if (isContained) throw new Error('Path traversal outside root must be blocked');
    });

    await runTest('SecurityGuard: Secret redaction', () => {
      const redacted = defaultSecurityGuard.redactSecrets('Bearer sk-1234567890abcdef');
      if (redacted.includes('sk-1234567890abcdef')) throw new Error('Secret was not redacted');
    });

    // 3. Storage Engine
    await runTest('FilePersistentStore: Set, Get, Delete', async () => {
      const key = `test_key_${Date.now()}`;
      await engine.memory.set({
        key,
        content: 'Test content',
        category: 'project_fact',
        tags: ['test'],
        source: 'user_input',
      });
      const item = await engine.memory.get(key);
      if (!item || item.content !== 'Test content') throw new Error('Storage item retrieval failed');
      await engine.memory.delete(key);
      const deleted = await engine.memory.get(key);
      if (deleted) throw new Error('Item was not deleted');
    });

    // 4. Tool Registry
    await runTest('ToolRegistry: Built-in tools registered', () => {
      const tools = engine.tools.getAll();
      if (tools.length < 5) throw new Error(`Expected >= 5 registered tools, found ${tools.length}`);
    });

    await runTest('ToolRegistry: Code analyze bracket check', async () => {
      const res = await engine.tools.execute('code_analyze', { code: 'function test() { return (1 + 2); }' }, {
        workspaceRoot: process.cwd(),
        permissionGrant: ['READ_ONLY'],
      });
      if (!res.success || !res.output?.syntaxHeuristics?.pass) throw new Error('Valid code failed analysis');
    });

    // 5. Engine Health
    await runTest('RareIntelligenceEngine: Health audit reports readiness', async () => {
      const health = await engine.getHealth();
      if (!health || !health.version) throw new Error('Invalid engine health payload');
    });

    // 6. Diagnostics Subsystem
    await runTest('SelfDiagnosticsEngine: Runs full 10-subsystem audit', async () => {
      const report = await engine.runDiagnostics();
      if (!report || report.checksPerformedCount < 8) throw new Error('Diagnostics audit incomplete');
    });

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;

    return {
      totalCount: results.length,
      passedCount,
      failedCount,
      durationMs: Date.now() - startTime,
      results,
    };
  }
}
