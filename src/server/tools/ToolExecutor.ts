import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolName, ToolSpec, ToolExecutionResult, RiskLevel } from '../types.js';
import { MemoryStore } from '../storage/MemoryStore.js';
import { CheckpointStore } from '../storage/CheckpointStore.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || process.cwd());

// Allowlist from rare.config.json
const COMMAND_ALLOWLIST = new Set([
  'node',
  'npm',
  'npx',
  'git',
  'python',
  'python3',
  'tsc',
  'vite',
  'echo',
]);

const PROTECTED_CORE_PATHS = [
  'server.ts',
  'src/App.tsx',
  'package.json',
  'rare.config.json',
  'metadata.json',
  '.rare/checkpoints',
];

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  READ_FILE: {
    name: 'READ_FILE',
    description: 'Read file content safely within project boundaries',
    category: 'filesystem',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of file to read' },
      },
      required: ['path'],
    },
  },
  WRITE_FILE: {
    name: 'WRITE_FILE',
    description: 'Write file content to workspace. Modifying core files requires developer authorization.',
    category: 'filesystem',
    risk: 'medium',
    requiresDeveloperAuth: false, // Core files are checked conditionally
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of file to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  SEARCH: {
    name: 'SEARCH',
    description: 'Search workspace files or memory records for matching text/regex',
    category: 'research',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or pattern to search for' },
        scope: { type: 'string', description: 'Scope: files, memory, or all', enum: ['files', 'memory', 'all'] },
      },
      required: ['query'],
    },
  },
  RUN_COMMAND: {
    name: 'RUN_COMMAND',
    description: 'Execute allowlisted command in safe sandbox without raw shell interpretation',
    category: 'execution',
    risk: 'high',
    requiresDeveloperAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command binary name from allowlist' },
        args: { type: 'array', description: 'Array of command string arguments' },
      },
      required: ['command'],
    },
  },
  RUN_TEST: {
    name: 'RUN_TEST',
    description: 'Run automated tests or test files and return real output and exit code',
    category: 'execution',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        testPath: { type: 'string', description: 'Optional specific test file path' },
      },
      required: [],
    },
  },
  BUILD_PROJECT: {
    name: 'BUILD_PROJECT',
    description: 'Compile and verify build assets using Vite or TypeScript compiler',
    category: 'execution',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Build command name (e.g. build, lint)' },
      },
      required: [],
    },
  },
  INSPECT_ERROR: {
    name: 'INSPECT_ERROR',
    description: 'Analyze error text or stacktrace to identify file, line, and root cause diagnosis',
    category: 'inspection',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        errorText: { type: 'string', description: 'Stacktrace or error message to inspect' },
      },
      required: ['errorText'],
    },
  },
  CREATE_CHECKPOINT: {
    name: 'CREATE_CHECKPOINT',
    description: 'Create an atomic snapshot of workspace state before making changes',
    category: 'security',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Description of the checkpoint' },
        status: { type: 'string', description: 'Status tag (known_good, experimental)', enum: ['known_good', 'experimental'] },
      },
      required: ['description'],
    },
  },
  RESTORE_CHECKPOINT: {
    name: 'RESTORE_CHECKPOINT',
    description: 'Rollback workspace to a previously saved checkpoint snapshot',
    category: 'security',
    risk: 'high',
    requiresDeveloperAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: { type: 'string', description: 'ID of checkpoint to restore' },
      },
      required: ['checkpointId'],
    },
  },
  RESEARCH: {
    name: 'RESEARCH',
    description: 'Query knowledge base, documentation, and local evidence with relevance scoring',
    category: 'research',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic or technical question to investigate' },
        maxResults: { type: 'number', description: 'Maximum items to return' },
      },
      required: ['query'],
    },
  },
  MEMORY_RECALL: {
    name: 'MEMORY_RECALL',
    description: 'Retrieve persistent memories and facts across previous chats and projects',
    category: 'memory',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Memory search query' },
        tags: { type: 'array', description: 'Optional tags filter' },
      },
      required: [],
    },
  },
  MEMORY_STORE: {
    name: 'MEMORY_STORE',
    description: 'Persist a verified fact, user preference, or project decision to disk',
    category: 'memory',
    risk: 'low',
    requiresDeveloperAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Durable fact or preference statement' },
        kind: { type: 'string', description: 'Category: preference, project_decision, technical_constraint, fact', enum: ['preference', 'project_decision', 'technical_constraint', 'fact'] },
        tags: { type: 'array', description: 'Tags for categorization' },
        importance: { type: 'number', description: 'Importance level (1 to 5)' },
      },
      required: ['text'],
    },
  },
};

export class ToolExecutor {
  constructor(
    private memoryStore: MemoryStore,
    private checkpointStore: CheckpointStore
  ) {}

  public getSpecs(): ToolSpec[] {
    return Object.values(TOOL_SPECS);
  }

  public resolveSafePath(relPath: string): { fullPath: string; isSafe: boolean; isCoreProtected: boolean } {
    const cleaned = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.resolve(PROJECT_ROOT, cleaned);
    const isSafe = fullPath.startsWith(PROJECT_ROOT);

    const relativeToRoot = path.relative(PROJECT_ROOT, fullPath);
    const isCoreProtected = PROTECTED_CORE_PATHS.some((p) =>
      relativeToRoot === p || relativeToRoot.startsWith(p + path.sep)
    );

    return { fullPath, isSafe, isCoreProtected };
  }

  public async execute(
    name: ToolName,
    inputs: Record<string, any>,
    options?: { isDeveloperAuth?: boolean; actor?: string }
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const spec = TOOL_SPECS[name];
    if (!spec) {
      return {
        success: false,
        tool: name,
        error: `Unknown tool: ${name}`,
        executionTimeMs: Date.now() - start,
      };
    }

    // Permission Check
    const isDev = Boolean(options?.isDeveloperAuth);
    if (spec.requiresDeveloperAuth && !isDev) {
      return {
        success: false,
        tool: name,
        error: `Tool ${name} requires Developer Authorization passkey. Access denied.`,
        executionTimeMs: Date.now() - start,
      };
    }

    try {
      let output: any;

      switch (name) {
        case 'READ_FILE': {
          const { path: filePath } = inputs;
          if (!filePath || typeof filePath !== 'string') {
            throw new Error('path is required and must be a string');
          }
          const { fullPath, isSafe } = this.resolveSafePath(filePath);
          if (!isSafe) {
            throw new Error('Path traversal outside workspace root is blocked');
          }
          if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
          }
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            output = {
              isDirectory: true,
              entries: fs.readdirSync(fullPath).slice(0, 50),
            };
          } else {
            const content = fs.readFileSync(fullPath, 'utf-8');
            output = {
              path: filePath,
              sizeBytes: stat.size,
              content: content.length > 50000 ? content.slice(0, 50000) + '\n...[truncated]' : content,
            };
          }
          break;
        }

        case 'WRITE_FILE': {
          const { path: filePath, content } = inputs;
          if (!filePath || typeof content !== 'string') {
            throw new Error('path and content are required');
          }
          const { fullPath, isSafe, isCoreProtected } = this.resolveSafePath(filePath);
          if (!isSafe) {
            throw new Error('Path traversal outside workspace root is blocked');
          }
          if (isCoreProtected && !isDev) {
            throw new Error(`Modifying core self-development file "${filePath}" requires Developer Authorization.`);
          }
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf-8');
          output = {
            path: filePath,
            bytesWritten: Buffer.byteLength(content, 'utf-8'),
            status: 'written',
          };
          break;
        }

        case 'SEARCH': {
          const { query, scope = 'all' } = inputs;
          if (!query || typeof query !== 'string') throw new Error('query is required');
          const results: any[] = [];
          const q = query.toLowerCase();

          if (scope === 'all' || scope === 'memory') {
            const memoryHits = this.memoryStore.search(query);
            for (const m of memoryHits.slice(0, 10)) {
              results.push({ type: 'memory', id: m.id, text: m.text, tags: m.tags });
            }
          }

          if (scope === 'all' || scope === 'files') {
            // Search text in knowledge and docs
            const searchDirs = ['docs', 'knowledge', 'src'];
            for (const d of searchDirs) {
              const fullDir = path.resolve(PROJECT_ROOT, d);
              if (fs.existsSync(fullDir)) {
                const files = fs.readdirSync(fullDir);
                for (const file of files) {
                  const fp = path.resolve(fullDir, file);
                  if (fs.statSync(fp).isFile() && (file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.ts'))) {
                    try {
                      const text = fs.readFileSync(fp, 'utf-8');
                      if (text.toLowerCase().includes(q)) {
                        results.push({
                          type: 'file',
                          path: `${d}/${file}`,
                          snippet: text.slice(0, 180),
                        });
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              }
            }
          }
          output = { query, count: results.length, results: results.slice(0, 15) };
          break;
        }

        case 'RUN_COMMAND': {
          const { command, args = [] } = inputs;
          if (!COMMAND_ALLOWLIST.has(command)) {
            throw new Error(`Command "${command}" is not in the security allowlist: [${Array.from(COMMAND_ALLOWLIST).join(', ')}]`);
          }
          // Sanitized execution via execFile
          const res = await execFileAsync(command, args, {
            cwd: PROJECT_ROOT,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              // Strip secrets from child execution environment
              OPENAI_API_KEY: '',
              ANTHROPIC_API_KEY: '',
              GEMINI_API_KEY: '',
              RARE_API_TOKEN: '',
              RARE_DEV_KEY: '',
            },
          });
          output = {
            command: `${command} ${args.join(' ')}`,
            stdout: res.stdout.slice(0, 5000),
            stderr: res.stderr.slice(0, 5000),
          };
          break;
        }

        case 'RUN_TEST': {
          const { testPath } = inputs;
          let testCmd = 'npm';
          let testArgs = ['run', 'lint'];
          if (testPath) {
            testCmd = 'npx';
            testArgs = ['tsx', testPath];
          }
          try {
            const res = await execFileAsync(testCmd, testArgs, {
              cwd: PROJECT_ROOT,
              timeout: 45000,
            });
            output = {
              success: true,
              exitCode: 0,
              stdout: res.stdout.slice(0, 4000),
            };
          } catch (err: any) {
            output = {
              success: false,
              exitCode: err.code || 1,
              stdout: err.stdout ? err.stdout.slice(0, 2000) : '',
              stderr: err.stderr ? err.stderr.slice(0, 2000) : err.message,
            };
          }
          break;
        }

        case 'BUILD_PROJECT': {
          try {
            const res = await execFileAsync('npx', ['vite', 'build'], {
              cwd: PROJECT_ROOT,
              timeout: 60000,
            });
            output = {
              success: true,
              output: res.stdout.slice(0, 3000),
            };
          } catch (err: any) {
            output = {
              success: false,
              error: err.stderr || err.message,
            };
          }
          break;
        }

        case 'INSPECT_ERROR': {
          const { errorText } = inputs;
          if (!errorText) throw new Error('errorText is required');
          const lines = errorText.split('\n');
          let parsedFile = '';
          let parsedLine = 0;
          let parsedMsg = '';

          for (const line of lines) {
            const match = line.match(/([a-zA-Z0-9_\-./\\]+\.(ts|tsx|js|py|json)):(\d+):?(\d+)?/);
            if (match) {
              parsedFile = match[1];
              parsedLine = parseInt(match[3], 10);
              parsedMsg = line;
              break;
            }
          }

          output = {
            detectedFile: parsedFile || undefined,
            detectedLine: parsedLine || undefined,
            rawErrorSummary: lines[0]?.slice(0, 200),
            diagnosis: parsedFile
              ? `Syntax or typing exception in ${parsedFile} around line ${parsedLine}. Verify imports and signatures.`
              : 'Runtime exception detected. Trace stacktrace elements.',
          };
          break;
        }

        case 'CREATE_CHECKPOINT': {
          const { description, status = 'experimental' } = inputs;
          const cp = this.checkpointStore.createCheckpoint(description, status);
          output = {
            checkpointId: cp.id,
            timestamp: cp.timestamp,
            filesCount: cp.filesCount,
            hash: cp.hash,
          };
          break;
        }

        case 'RESTORE_CHECKPOINT': {
          const { checkpointId } = inputs;
          if (!checkpointId) throw new Error('checkpointId is required');
          const res = this.checkpointStore.restoreCheckpoint(checkpointId);
          if (!res.success) {
            throw new Error(res.error || 'Failed to restore checkpoint');
          }
          output = {
            restoredCheckpointId: checkpointId,
            restoredFiles: res.restoredFiles,
          };
          break;
        }

        case 'RESEARCH': {
          const { query, maxResults = 5 } = inputs;
          if (!query) throw new Error('query is required');
          const q = query.toLowerCase();

          // Search knowledge base
          const knowledgePath = path.resolve(PROJECT_ROOT, 'knowledge', 'knowledge.json');
          const hits: any[] = [];
          if (fs.existsSync(knowledgePath)) {
            const kb = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8'));
            for (const entry of kb.entries || []) {
              const full = `${entry.title} ${entry.text}`.toLowerCase();
              if (q.split(' ').some((word: string) => word.length > 3 && full.includes(word))) {
                hits.push({
                  title: entry.title,
                  source: entry.category || 'knowledge_base',
                  credibility: 0.95,
                  snippet: entry.text,
                });
              }
            }
          }

          // Search docs
          const docsDir = path.resolve(PROJECT_ROOT, 'docs');
          if (fs.existsSync(docsDir)) {
            const docFiles = fs.readdirSync(docsDir).slice(0, 15);
            for (const docFile of docFiles) {
              if (docFile.endsWith('.md')) {
                const content = fs.readFileSync(path.resolve(docsDir, docFile), 'utf-8');
                if (q.split(' ').some((w: string) => w.length > 3 && content.toLowerCase().includes(w))) {
                  hits.push({
                    title: docFile.replace('.md', ''),
                    source: `docs/${docFile}`,
                    credibility: 0.9,
                    snippet: content.slice(0, 250).replace(/\n/g, ' '),
                  });
                }
              }
            }
          }

          output = {
            query,
            totalHits: hits.length,
            findings: hits.slice(0, maxResults),
          };
          break;
        }

        case 'MEMORY_RECALL': {
          const { query, tags } = inputs;
          const records = this.memoryStore.search(query, tags);
          output = {
            count: records.length,
            records: records.slice(0, 10),
          };
          break;
        }

        case 'MEMORY_STORE': {
          const { text, kind = 'fact', tags = [], importance = 3 } = inputs;
          if (!text || typeof text !== 'string') throw new Error('text is required');
          const stored = this.memoryStore.store({
            text,
            kind: kind as any,
            tags,
            importance,
            source: 'user_stated',
            verifiedByUser: true,
          });
          output = stored;
          break;
        }
      }

      return {
        success: true,
        tool: name,
        output,
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        tool: name,
        error: err.message || String(err),
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
