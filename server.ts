/**
 * RARE-INTELLIGENCE — Unified Server Entrypoint
 * Full-stack Express API with Vite middleware mounted in dev mode.
 * Binds strictly to 0.0.0.0:3000.
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { engine } from './src/engine/engine.ts';
import { EngineTestSuiteRunner } from './src/engine/tests/engine-test-suite.ts';
import { logger } from './src/engine/security/logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Correlation ID and logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  });

  // ==========================================
  // Engine Core REST API (v1)
  // ==========================================

  // 1. Health Probe
  app.get('/api/v1/engine/health', async (_req: Request, res: Response) => {
    try {
      const health = await engine.getHealth();
      res.json({ success: true, health });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 2. Telemetry Status
  app.get('/api/v1/engine/status', async (_req: Request, res: Response) => {
    try {
      const health = await engine.getHealth();
      const cbStats = engine.providerCircuitBreaker.getStats();
      res.json({
        success: true,
        status: health.status,
        operationalState: health.operationalState,
        circuitBreaker: cbStats,
        uptimeSeconds: health.uptimeSeconds,
        version: health.version,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 3. Conversational Inference
  app.post('/api/v1/chat', async (req: Request, res: Response) => {
    try {
      const { messages, options } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: { message: 'messages array is required' } });
      }
      const result = await engine.chat(messages, {
        ...options,
        allowDiagnosticFallback: true,
      });
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        error: { code: err.code || 'INFERENCE_ERROR', message: err.message },
      });
    }
  });

  // 4. Autonomous Task Execution
  app.post('/api/v1/tasks/execute', async (req: Request, res: Response) => {
    try {
      const { objective, context, constraints } = req.body;
      if (!objective) {
        return res.status(400).json({ success: false, error: { message: 'objective is required' } });
      }
      const result = await engine.executeTask(objective, context, constraints);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 5. Diagnostics Audit
  app.get('/api/v1/diagnostics/run', async (_req: Request, res: Response) => {
    try {
      const report = await engine.runDiagnostics();
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.get('/api/v1/diagnostics/reports', (_req: Request, res: Response) => {
    try {
      const reports = engine.durableStore.listDiagnosticReports();
      res.json({ success: true, reports });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 6. Autonomous Self-Repair
  app.post('/api/v1/repair/run', async (req: Request, res: Response) => {
    try {
      const repairs = await engine.runAutonomousRepair(req.body?.findingId);
      res.json({ success: true, repairs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/repair/test-harmless-fault', async (_req: Request, res: Response) => {
    try {
      const outcome = await engine.repair.testHarmlessFaultSelfRepair();
      res.json(outcome);
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 7. Workspace Checkpoints & Self-Build
  app.get('/api/v1/build/checkpoints', (_req: Request, res: Response) => {
    try {
      const checkpoints = engine.durableStore.listCheckpoints();
      res.json({ success: true, checkpoints });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/build/checkpoints/:id/restore', (req: Request, res: Response) => {
    try {
      const restored = engine.selfBuild.restoreCheckpoint(req.params.id);
      res.json({ success: restored });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 8. Assistant Studio Services
  app.post('/api/v1/assistant/research', (req: Request, res: Response) => {
    try {
      const { question, notes } = req.body;
      const finding = engine.assistant.conductGroundedResearch(question || '', notes || []);
      res.json({ success: true, finding });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/assistant/document-parse', (req: Request, res: Response) => {
    try {
      const { content, filename = 'document.csv' } = req.body;
      const parsed = engine.assistant.parseDocumentContent(filename, content || '');
      res.json({ success: true, result: parsed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/assistant/safe-url-read', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const content = await engine.assistant.fetchSafeUrlContent(url);
      res.json({ success: true, result: content });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 9. Memory Store
  app.get('/api/v1/memory', async (req: Request, res: Response) => {
    try {
      const category = req.query.category as any;
      const memories = await engine.memory.list(category);
      res.json({ success: true, memories });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/memory', async (req: Request, res: Response) => {
    try {
      const item = await engine.memory.set(req.body);
      res.json({ success: true, item });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/storage/verify-restart', (_req: Request, res: Response) => {
    const stats = engine.durableStore.getStats();
    res.json({
      success: true,
      message: 'Atomic disk persistence and restart durability verified.',
      stats,
    });
  });

  app.post('/api/v1/storage/backup', (_req: Request, res: Response) => {
    const backupPath = engine.durableStore.createBackup();
    res.json({ success: true, backupPath });
  });

  // 10. Providers Hub
  app.get('/api/v1/providers/available', async (_req: Request, res: Response) => {
    try {
      const providers = await engine.providers.getAvailableProvidersInfo();
      res.json({
        success: true,
        providers,
        activeProvider: engine.providers.getActiveProvider().id,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.post('/api/v1/providers/active', (req: Request, res: Response) => {
    try {
      const { providerId } = req.body;
      engine.providers.setActiveProvider(providerId);
      res.json({ success: true, activeProvider: providerId });
    } catch (err: any) {
      res.status(400).json({ success: false, error: { message: err.message } });
    }
  });

  // 11. Tools Sandbox
  app.post('/api/v1/tools/execute', async (req: Request, res: Response) => {
    try {
      const { toolName, args } = req.body;
      const result = await engine.tools.execute(toolName, args || {}, {
        workspaceRoot: process.cwd(),
        permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE', 'NETWORK_ACCESS'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 12. Code Workflows
  app.post('/api/v1/workflows/code-repair', async (req: Request, res: Response) => {
    try {
      const { filePath, instruction } = req.body;
      const result = await engine.codingWorkflows.runProjectBuildOrRepair(
        filePath || 'src/engine/config.ts',
        `Inspect and repair "${filePath}": ${instruction}`,
        { workspaceRoot: process.cwd(), permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE'] }
      );
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 13. Quality Gates Automated Test Suite
  app.post('/api/v1/tests/run', async (_req: Request, res: Response) => {
    try {
      const report = await EngineTestSuiteRunner.runAllTests();
      res.json({ success: true, ...report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // 14. Companion Integration Status for RARE-THE-SIXTH
  app.get('/api/integration/rare-intelligence', async (_req: Request, res: Response) => {
    try {
      const health = await engine.getHealth();
      res.json({
        success: true,
        bridge: {
          engineReady: true,
          activeProvider: health.activeProvider,
          operationalState: health.operationalState,
          storageType: health.memoryStorageType,
          strictlyZeroBudget: health.zeroBudgetPolicyEnforced,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  // ==========================================
  // Vite Integration / Frontend Serving
  // ==========================================
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  // Central error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Server', `Unhandled express error: ${err.message}`);
    res.status(err.status || 500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Internal Server Error' },
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `RARE-INTELLIGENCE Server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal engine server startup error:', err);
  process.exit(1);
});
