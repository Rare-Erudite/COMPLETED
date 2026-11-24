/**
 * RARE — Department capability bindings
 *
 * This module is the bridge between the CapabilityRegistry and the real
 * department implementations. Every handler below calls the SAME service the
 * department's own HTTP route calls — DocumentsService, DeepResearchEngine,
 * DeliveryOrchestrator, RepositoryManager, DeploymentManager, McpClientManager,
 * DevicePlanner, BenchmarkSuite, ToolchainRegistry.
 *
 * That is the whole point: a capability registered here cannot be a stub,
 * because there is no stub to call. If the underlying service is unavailable
 * (no GitHub token, no Vercel token, no MCP server configured) the handler
 * returns `ok: false` with the real reason instead of pretending.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { capabilityRegistry, type CapabilityDescriptor, type CapabilityResult } from './CapabilityRegistry.js';
import type { DocumentsService } from '../services/DocumentsService.js';
import type { DeepResearchEngine } from '../services/DeepResearchEngine.js';
import { exportDocument, EXPORT_FORMATS, type ExportFormat } from '../content/DocumentExporter.js';
import { chunkContent } from '../content/ContentEngine.js';
import { summariseHierarchically, type GroundingProvider } from '../content/DocumentIntelligence.js';
import { runDeliveryWorkflow, inferTemplate, inferName, type DeliveryReport } from '../builder/DeliveryOrchestrator.js';
import { detectToolchains } from '../builder/ToolchainRegistry.js';
import {
  ensureRepository,
  commitFiles,
  collectProjectFiles,
  isConfigured as repoConfigured,
} from '../builder/RepositoryManager.js';
import { deployStatic, isConfigured as deployConfigured } from '../builder/DeploymentManager.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import type { DevicePlanner } from '../device/DevicePlanner.js';
import type { BenchmarkSuite } from '../evaluation/BenchmarkSuite.js';
import type { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { ModelCatalogue, type ModelTask } from '../intelligence/ModelCatalogue.js';
import { MODEL_CATALOGUE } from '../intelligence/ModelCatalogue.js';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';

export interface DepartmentBindings {
  documents: () => DocumentsService | undefined;
  research: DeepResearchEngine;
  mcp: McpClientManager;
  devicePlanner: DevicePlanner;
  benchmark: BenchmarkSuite;
  providers: ProviderRegistry;
  /** Where scaffolded projects are written. */
  workspaceRoot: string;
  /** Model catalogue for discovery, acquisition and routing. */
  modelCatalogue: ModelCatalogue;
  /** Plugin lifecycle registry (install/configure/execute/health). */
  pluginRegistry: PluginRegistry;
}

function ok(summary: string, data: unknown, started: number, limitations?: string[]): CapabilityResult {
  return { ok: true, summary, data, durationMs: Date.now() - started, limitations };
}

function fail(summary: string, code: string, started: number): CapabilityResult {
  return { ok: false, summary, error: { message: summary, code }, durationMs: Date.now() - started };
}

/** A grounding provider backed by the real ProviderRegistry (never a fake). */
function groundingProvider(providers: ProviderRegistry): GroundingProvider {
  return {
    async generate(prompt, context, options) {
      const result = await providers.generate(prompt, context, {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        systemPrompt: options?.systemPrompt,
      });
      return { reply: result.reply, modelUsed: result.modelUsed };
    },
  };
}

/**
 * Register every department capability. Safe to call once at boot; calling
 * again replaces the descriptors (hot reload) rather than duplicating them.
 */
export function registerDepartmentCapabilities(bindings: DepartmentBindings): void {
  const { documents, research, mcp, devicePlanner, benchmark, providers, workspaceRoot, modelCatalogue, pluginRegistry } = bindings;

  const requireDocuments = (): DocumentsService => {
    const service = documents();
    if (!service) throw new Error('Documents service is not ready yet (storage still initialising).');
    return service;
  };

  const descriptors: CapabilityDescriptor[] = [
    // ---------------------------------------------------------------- Documents
    {
      id: 'documents.list',
      department: 'documents',
      title: 'List documents',
      description: 'List every document in the owner\'s library with size, format and origin.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler(_args, ctx) {
        const started = Date.now();
        const items = await requireDocuments().list(ctx.ownerId);
        return ok(`${items.length} document(s) in the library.`, { count: items.length, items }, started);
      },
    },
    {
      id: 'documents.read',
      department: 'documents',
      title: 'Read a document',
      description: 'Read a stored document\'s extracted text, format and provenance.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [{ name: 'path', type: 'string', required: true, description: 'Document path, e.g. notes/meeting.md' }],
      async handler(args, ctx) {
        const started = Date.now();
        const record = await requireDocuments().read(ctx.ownerId, String(args.path));
        if (!record) return fail(`No document at "${args.path}".`, 'not_found', started);
        return ok(`Read ${record.path} (${record.content.length} chars).`, {
          path: record.path,
          format: record.format,
          chars: record.content.length,
          content: record.content,
          title: record.title,
          sourceUrl: record.sourceUrl,
          method: record.method,
          ocr: record.ocr ?? false,
          version: record.version,
        }, started);
      },
    },
    {
      id: 'documents.write',
      department: 'documents',
      title: 'Create or update a document',
      description: 'Write text to a document path, creating a new version if it exists.',
      permission: 'write',
      idempotent: false,
      cost: 'free',
      args: [
        { name: 'path', type: 'string', required: true, description: 'Target document path.' },
        { name: 'content', type: 'string', required: true, description: 'Text content to store.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const saved = await requireDocuments().save(ctx.ownerId, String(args.path), String(args.content), {
          origin: 'manual',
        });
        return ok(`Saved ${saved.path} (version ${saved.version ?? 1}).`, {
          path: saved.path,
          version: saved.version,
          chars: saved.content.length,
        }, started);
      },
    },
    {
      id: 'documents.import_url',
      department: 'documents',
      title: 'Import a document from a URL',
      description: 'Fetch a public URL, extract its real text (PDF/HTML/DOCX/OCR) and store it.',
      permission: 'write',
      idempotent: false,
      cost: 'network',
      timeoutMs: 180_000,
      args: [
        { name: 'url', type: 'string', required: true, description: 'Public http(s) URL to import.' },
        { name: 'path', type: 'string', required: false, description: 'Optional target path.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const outcome = await requireDocuments().importUrl(ctx.ownerId, String(args.url), {
          requestedPath: args.path ? String(args.path) : undefined,
        });
        if (!outcome.ok) {
          return fail(
            `Import failed: ${outcome.error?.message || 'unknown error'}`,
            outcome.error?.code || 'import_failed',
            started,
          );
        }
        return ok(`Imported ${outcome.path} (${outcome.chars ?? 0} chars, method ${outcome.method || 'unknown'}).`, outcome, started, outcome.warnings);
      },
    },
    {
      id: 'documents.convert',
      department: 'documents',
      title: 'Convert a document',
      description: 'Convert a stored document to txt, md, json, html or csv.',
      permission: 'write',
      idempotent: false,
      cost: 'free',
      args: [
        { name: 'path', type: 'string', required: true, description: 'Source document path.' },
        { name: 'format', type: 'string', required: true, description: 'Target format: txt|md|json|html|csv' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const result = await requireDocuments().convert(ctx.ownerId, String(args.path), String(args.format));
        return ok(`Converted ${result.originalPath} -> ${result.convertedPath}.`, result, started);
      },
    },
    {
      id: 'documents.export',
      department: 'documents',
      title: 'Export a document to a file format',
      description: 'Render a stored document to PDF, DOCX, XLSX, HTML, MD, TXT, JSON or CSV and save it.',
      permission: 'write',
      idempotent: false,
      cost: 'compute',
      timeoutMs: 180_000,
      args: [
        { name: 'path', type: 'string', required: true, description: 'Source document path.' },
        { name: 'format', type: 'string', required: true, description: `One of: ${EXPORT_FORMATS.join(', ')}` },
        { name: 'outputPath', type: 'string', required: false, description: 'Where to store the exported file.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const service = requireDocuments();
        const record = await service.read(ctx.ownerId, String(args.path));
        if (!record) return fail(`No document at "${args.path}".`, 'not_found', started);
        const format = String(args.format).toLowerCase().replace(/^\./, '') as ExportFormat;
        if (!EXPORT_FORMATS.includes(format)) {
          return fail(`Unsupported export format "${format}". Supported: ${EXPORT_FORMATS.join(', ')}.`, 'unsupported_format', started);
        }
        const exported = await exportDocument(record.content, format, {
          title: record.title || path.basename(record.path),
          filename: path.basename(record.path),
        });
        const target = String(
          args.outputPath ||
            record.path.replace(/\.[^/.]+$/, '') + '.' + format,
        );
        // Binary formats are written to the workspace exports dir; text formats
        // are stored as documents so they stay editable and searchable.
        if (['pdf', 'docx', 'xlsx'].includes(format)) {
          const dir = path.join(workspaceRoot, 'exports');
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, exported.filename);
          fs.writeFileSync(filePath, exported.buffer);
          return ok(`Exported ${record.path} to ${filePath} (${exported.buffer.length} bytes).`, {
            path: filePath,
            format,
            bytes: exported.buffer.length,
            mimeType: exported.mimeType,
            filename: exported.filename,
          }, started);
        }
        const saved = await service.save(ctx.ownerId, target, exported.buffer.toString('utf8'), {
          origin: 'conversion',
          derivedFrom: record.path,
        });
        return ok(`Exported ${record.path} to ${saved.path}.`, {
          path: saved.path,
          format,
          bytes: exported.buffer.length,
          mimeType: exported.mimeType,
        }, started);
      },
    },
    {
      id: 'documents.summarise',
      department: 'documents',
      title: 'Summarise a document',
      description: 'Produce a hierarchical summary of a stored document using the active model.',
      permission: 'read',
      idempotent: false,
      cost: 'compute',
      timeoutMs: 240_000,
      args: [
        { name: 'path', type: 'string', required: true, description: 'Document path to summarise.' },
        { name: 'maxSections', type: 'number', required: false, description: 'Cap on sections read (default 40).' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const record = await requireDocuments().read(ctx.ownerId, String(args.path));
        if (!record) return fail(`No document at "${args.path}".`, 'not_found', started);
        const chunks = chunkContent({
          ok: true,
          text: record.content,
          kind: (record.kind || 'text') as any,
          label: record.label || 'Document',
          family: 'text' as any,
          mimeType: 'text/plain',
          identification: 'stored document',
          method: record.method || 'stored',
          ocr: record.ocr ?? false,
          warnings: record.warnings || [],
          pages: record.pages,
        } as any);
        const summary = await summariseHierarchically(chunks, groundingProvider(providers), {
          maxSections: typeof args.maxSections === 'number' ? args.maxSections : 40,
          title: record.title || path.basename(record.path),
        });
        return ok(`Summarised ${record.path} across ${chunks.length} section(s).`, summary, started);
      },
    },

    // ----------------------------------------------------------------- Research
    {
      id: 'research.run',
      department: 'research',
      title: 'Run multi-source research',
      description: 'Search several providers, retrieve and read full pages, extract claims with citations.',
      permission: 'read',
      idempotent: false,
      cost: 'network',
      timeoutMs: 300_000,
      args: [
        { name: 'question', type: 'string', required: true, description: 'The research question.' },
        { name: 'depth', type: 'string', required: false, description: 'quick|standard|deep' },
        { name: 'seedUrls', type: 'array', required: false, description: 'URLs to read first.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const depth = ['quick', 'standard', 'deep'].includes(String(args.depth)) ? (String(args.depth) as any) : 'standard';
        const report = await research.research(
          {
            question: String(args.question),
            depth,
            seedUrls: Array.isArray(args.seedUrls) ? (args.seedUrls as string[]) : undefined,
          },
          (progress) => ctx.report?.(progress.stage, progress.detail),
        );
        return ok(
          `Researched "${report.question}": ${report.stats.retrieved} source(s) retrieved, ${report.stats.fullText} read in full.`,
          report,
          started,
          report.limitations,
        );
      },
    },
    {
      id: 'research.report_to_document',
      department: 'research',
      title: 'Research and save a report document',
      description: 'Run research, then store the cited markdown report as a document and export it to PDF.',
      permission: 'write',
      idempotent: false,
      cost: 'network',
      timeoutMs: 420_000,
      args: [
        { name: 'question', type: 'string', required: true, description: 'The research question.' },
        { name: 'path', type: 'string', required: false, description: 'Document path for the report.' },
        { name: 'exportPdf', type: 'boolean', required: false, description: 'Also export a PDF (default true).' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const service = requireDocuments();
        const report = await research.research(
          { question: String(args.question), depth: 'standard' },
          (progress) => ctx.report?.(progress.stage, progress.detail),
        );
        const slug = String(args.question)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'research-report';
        const target = String(args.path || `research/${slug}.md`);
        const saved = await service.save(ctx.ownerId, target, report.report, { origin: 'research' });

        let pdfPath: string | null = null;
        if (args.exportPdf !== false) {
          const exported = await exportDocument(report.report, 'pdf', {
            title: `Research: ${report.question}`,
            filename: slug,
          });
          const dir = path.join(workspaceRoot, 'exports');
          fs.mkdirSync(dir, { recursive: true });
          pdfPath = path.join(dir, exported.filename);
          fs.writeFileSync(pdfPath, exported.buffer);
        }

        return ok(
          `Research report saved to ${saved.path}${pdfPath ? ` and exported to ${pdfPath}` : ''}.`,
          {
            documentPath: saved.path,
            pdfPath,
            sources: report.sources.length,
            fullTextSources: report.stats.fullText,
            claims: report.claims.length,
            limitations: report.limitations,
          },
          started,
          report.limitations,
        );
      },
    },

    // ------------------------------------------------------------------ Builder
    {
      id: 'builder.deliver',
      department: 'builder',
      title: 'Build, test, repository and deploy a project',
      description: 'Provision the toolchain, scaffold, build, test, repair, create a repository and deploy.',
      permission: 'execute',
      idempotent: false,
      cost: 'compute',
      timeoutMs: 900_000,
      args: [
        { name: 'instruction', type: 'string', required: true, description: 'What to build, in natural language.' },
        { name: 'name', type: 'string', required: false, description: 'Project slug.' },
        { name: 'template', type: 'string', required: false, description: 'static-web|react-vite|node-api|python-cli|node-cli' },
        { name: 'createRepository', type: 'boolean', required: false, description: 'Create a GitHub repository.' },
        { name: 'deploy', type: 'boolean', required: false, description: 'Deploy to Vercel.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const instruction = String(args.instruction);
        const report: DeliveryReport = await runDeliveryWorkflow(workspaceRoot, {
          instruction,
          name: String(args.name || inferName(instruction)),
          template: (args.template as any) || inferTemplate(instruction),
          createRepository: args.createRepository === true,
          deploy: args.deploy === true,
        });
        return {
          ok: report.ok,
          summary: `${report.project}: ${report.steps.filter((s) => s.status === 'passed').length}/${report.steps.length} stage(s) passed${report.liveUrl ? `, live at ${report.liveUrl}` : ''}.`,
          data: report,
          limitations: report.limitations,
          durationMs: Date.now() - started,
        };
      },
    },
    {
      id: 'builder.toolchains',
      department: 'builder',
      title: 'Probe development toolchains',
      description: 'Probe every known toolchain and report what is actually installed with versions.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      timeoutMs: 120_000,
      args: [{ name: 'force', type: 'boolean', required: false, description: 'Bypass the per-process cache.' }],
      async handler(args) {
        const started = Date.now();
        const toolchains = await detectToolchains(args.force === true);
        const ready = toolchains.filter((t) => t.detected);
        return ok(`${ready.length}/${toolchains.length} toolchain(s) detected.`, {
          ready: ready.length,
          total: toolchains.length,
          toolchains,
        }, started);
      },
    },

    // --------------------------------------------------------------- Repository
    {
      id: 'repository.create',
      department: 'repository',
      title: 'Create a GitHub repository',
      description: 'Create (or reuse) a repository and optionally commit a project directory into it.',
      permission: 'write',
      idempotent: false,
      cost: 'network',
      timeoutMs: 180_000,
      args: [
        { name: 'name', type: 'string', required: true, description: 'Repository name.' },
        { name: 'description', type: 'string', required: false, description: 'Repository description.' },
        { name: 'private', type: 'boolean', required: false, description: 'Create as private (default true).' },
        { name: 'projectDir', type: 'string', required: false, description: 'Local project directory to commit.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        if (!repoConfigured()) {
          return fail('No GitHub token is configured, so repository creation cannot run.', 'not_configured', started);
        }
        const created = await ensureRepository(String(args.name), {
          description: args.description ? String(args.description) : undefined,
          private: args.private !== false,
        });
        if (!created.ok || !created.data) {
          return fail(
            `Repository creation failed: ${created.error || 'unknown error'}${created.permissionDenied ? ' (token lacks repository creation permission)' : ''}`,
            created.permissionDenied ? 'permission_denied' : 'repo_failed',
            started,
          );
        }
        let commit: unknown = null;
        if (args.projectDir) {
          const dir = path.resolve(workspaceRoot, String(args.projectDir));
          if (!fs.existsSync(dir)) return fail(`Project directory "${args.projectDir}" does not exist.`, 'not_found', started);
          const files = collectProjectFiles(dir);
          commit = await commitFiles(
            created.data.owner,
            created.data.repo,
            created.data.defaultBranch,
            files,
            `RARE: add ${path.basename(dir)}`,
          );
        }
        return ok(
          `Repository ${created.data.owner}/${created.data.repo} ${created.created ? 'created' : 'already existed'}${commit ? ' and populated' : ''}.`,
          { repository: created.data, created: created.created, commit },
          started,
        );
      },
    },

    // --------------------------------------------------------------- Deployment
    {
      id: 'deployment.static',
      department: 'deployment',
      title: 'Deploy a static site',
      description: 'Deploy a directory of static files to Vercel and verify the resulting URL.',
      permission: 'execute',
      idempotent: false,
      cost: 'network',
      timeoutMs: 600_000,
      args: [
        { name: 'projectName', type: 'string', required: true, description: 'Vercel project name.' },
        { name: 'directory', type: 'string', required: true, description: 'Local directory to deploy.' },
        { name: 'target', type: 'string', required: false, description: 'production|preview' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        if (!deployConfigured()) {
          return fail('No Vercel token is configured, so deployment cannot run.', 'not_configured', started);
        }
        const dir = path.resolve(workspaceRoot, String(args.directory));
        if (!fs.existsSync(dir)) return fail(`Directory "${args.directory}" does not exist.`, 'not_found', started);
        const files = collectProjectFiles(dir).map((file) => ({
          file: file.path,
          content: file.content.toString('utf8'),
        }));
        const result = await deployStatic(String(args.projectName), files, {
          target: args.target === 'preview' ? 'preview' : 'production',
        });
        return {
          ok: result.ok,
          summary: result.ok
            ? `Deployed to ${result.url}.`
            : `Deployment failed: ${result.errorMessage || result.errorCode || 'unknown error'}`,
          data: result,
          durationMs: Date.now() - started,
        };
      },
    },

    // ------------------------------------------------------------------ Plugins
    {
      id: 'plugins.list',
      department: 'plugins',
      title: 'List MCP plugin servers and tools',
      description: 'Report every configured MCP server, its real connection state and discovered tools.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler(_args, ctx) {
        const started = Date.now();
        const plugins = await pluginRegistry.list(ctx.ownerId);
        const tools = mcp.listTools();
        return ok(
          `${plugins.filter((p) => p.connected).length}/${plugins.length} plugin(s) connected, ${tools.length} tool(s) discovered.`,
          { configurationError: mcp.configurationError ?? null, plugins, tools },
          started,
        );
      },
    },
    {
      id: 'plugins.install',
      department: 'plugins',
      title: 'Install an MCP plugin',
      description: 'Register an MCP server, connect it for real and record it durably.',
      permission: 'write',
      idempotent: false,
      cost: 'network',
      timeoutMs: 60_000,
      args: [
        { name: 'name', type: 'string', required: true, description: 'Human name for the plugin.' },
        { name: 'transport', type: 'string', required: true, description: 'stdio|sse|http' },
        { name: 'target', type: 'string', required: true, description: 'Command (stdio) or URL (sse/http).' },
        { name: 'args', type: 'array', required: false, description: 'Arguments for a stdio command.' },
        { name: 'permissions', type: 'array', required: false, description: 'Declared scopes, e.g. ["files:read"].' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const transport = String(args.transport);
        if (!['stdio', 'sse', 'http'].includes(transport)) {
          return fail(`Unsupported transport "${transport}".`, 'unsupported_transport', started);
        }
        const plugin = await pluginRegistry.install(ctx.ownerId, {
          name: String(args.name),
          transport: transport as any,
          target: String(args.target),
          args: Array.isArray(args.args) ? (args.args as string[]) : undefined,
          permissions: Array.isArray(args.permissions) ? (args.permissions as string[]) : undefined,
        });
        return {
          ok: plugin.connected,
          summary: plugin.connected
            ? `Installed "${plugin.name}" with ${plugin.toolCount} tool(s).`
            : `Installed "${plugin.name}" but it did not connect: ${plugin.error || 'unknown error'}`,
          data: plugin,
          durationMs: Date.now() - started,
        };
      },
    },
    {
      id: 'plugins.execute',
      department: 'plugins',
      title: 'Execute a plugin tool',
      description: 'Call a discovered MCP tool by its qualified name and return the real result.',
      permission: 'execute',
      idempotent: false,
      cost: 'network',
      timeoutMs: 60_000,
      args: [
        { name: 'tool', type: 'string', required: true, description: 'Qualified tool name: serverId__toolName' },
        { name: 'args', type: 'object', required: false, description: 'Tool arguments.' },
      ],
      async handler(args, ctx) {
        const started = Date.now();
        const result = await pluginRegistry.execute(
          ctx.ownerId,
          String(args.tool),
          (args.args as Record<string, unknown>) || {},
        );
        return {
          ok: result.ok,
          summary: result.ok ? `Plugin tool "${args.tool}" executed.` : `Plugin tool "${args.tool}" failed: ${result.error}`,
          data: result,
          durationMs: Date.now() - started,
        };
      },
    },
    {
      id: 'plugins.health',
      department: 'plugins',
      title: 'Probe plugin health',
      description: 'Probe every plugin and record its real connection state.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler(_args, ctx) {
        const started = Date.now();
        const plugins = await pluginRegistry.health(ctx.ownerId);
        return ok(`${plugins.filter((p) => p.connected).length}/${plugins.length} plugin(s) healthy.`, { plugins }, started);
      },
    },
    {
      id: 'plugins.uninstall',
      department: 'plugins',
      title: 'Uninstall a plugin',
      description: 'Disconnect a plugin and remove its durable record.',
      permission: 'destructive',
      idempotent: false,
      cost: 'free',
      args: [{ name: 'id', type: 'string', required: true, description: 'Plugin id.' }],
      async handler(args, ctx) {
        const started = Date.now();
        const removed = await pluginRegistry.uninstall(ctx.ownerId, String(args.id));
        return removed
          ? ok(`Uninstalled plugin "${args.id}".`, { id: args.id }, started)
          : fail(`No plugin "${args.id}" was installed.`, 'not_found', started);
      },
    },
    {
      id: 'plugins.call',
      department: 'plugins',
      title: 'Call an MCP plugin tool',
      description: 'Execute a discovered MCP tool by its qualified name and return the real result.',
      permission: 'execute',
      idempotent: false,
      cost: 'network',
      timeoutMs: 60_000,
      args: [
        { name: 'tool', type: 'string', required: true, description: 'Qualified tool name: serverId__toolName' },
        { name: 'args', type: 'object', required: false, description: 'Tool arguments.' },
      ],
      async handler(args) {
        const started = Date.now();
        const result = await mcp.callTool(String(args.tool), (args.args as Record<string, unknown>) || {});
        return {
          ok: result.ok,
          summary: result.ok ? `MCP tool "${args.tool}" executed.` : `MCP tool "${args.tool}" failed: ${result.error || 'unknown error'}`,
          data: result,
          durationMs: Date.now() - started,
        };
      },
    },

    // ------------------------------------------------------------------- Device
    {
      id: 'device.plan',
      department: 'device',
      title: 'Plan the next Android device action',
      description: 'Given an objective and the current screen, decide the next concrete device action.',
      permission: 'read',
      idempotent: false,
      cost: 'compute',
      timeoutMs: 90_000,
      args: [
        { name: 'objective', type: 'string', required: true, description: 'What the user wants on the phone.' },
        { name: 'screen', type: 'string', required: false, description: 'Current screen description.' },
        { name: 'step', type: 'number', required: false, description: 'Current step index.' },
        { name: 'maxSteps', type: 'number', required: false, description: 'Step cap.' },
      ],
      async handler(args) {
        const started = Date.now();
        const decision = await devicePlanner.planNextAction({
          objective: String(args.objective),
          screen: String(args.screen || ''),
          history: [],
          approved: false,
          step: typeof args.step === 'number' ? args.step : 0,
          maxSteps: typeof args.maxSteps === 'number' ? args.maxSteps : 8,
        });
        return ok(`Planned device action: ${(decision as any).action?.type || 'none'}.`, decision, started);
      },
    },

    // ------------------------------------------------------------- Intelligence
    {
      id: 'intelligence.evaluate',
      department: 'intelligence',
      title: 'Evaluate the active model',
      description: 'Run the real benchmark suite against the active model and return per-case results.',
      permission: 'read',
      idempotent: false,
      cost: 'compute',
      timeoutMs: 300_000,
      args: [{ name: 'model', type: 'string', required: false, description: 'Label for the model under test.' }],
      async handler(args) {
        const started = Date.now();
        const report = await benchmark.runSuite(args.model ? String(args.model) : undefined);
        return ok(`Evaluation complete: ${report.passedTests}/${report.totalTests} case(s) passed (score ${report.overallScore}).`, report, started);
      },
    },
    {
      id: 'intelligence.providers',
      department: 'intelligence',
      title: 'List model providers',
      description: 'Report every registered model provider with real availability and free-tier status.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler() {
        const started = Date.now();
        const list = await providers.getAllProviders();
        return ok(`${list.filter((p) => p.is_available).length}/${list.length} provider(s) available.`, {
          providers: list,
          preferred: providers.getPreferredProvider(),
          lastUsed: providers.getLastUsed(),
        }, started);
      },
    },

    // ------------------------------------------------------------- Model catalogue
    {
      id: 'intelligence.models',
      department: 'intelligence',
      title: 'List the model catalogue',
      description: 'List every catalogued open-weight model with licence, format, size and tasks, plus what is installed.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler() {
        const started = Date.now();
        const installed = modelCatalogue.installed();
        return ok(`${MODEL_CATALOGUE.length} model(s) catalogued, ${installed.length} installed locally.`, {
          catalogue: modelCatalogue.list(),
          installed,
        }, started);
      },
    },
    {
      id: 'intelligence.acquire_model',
      department: 'intelligence',
      title: 'Acquire a model',
      description: 'Download a catalogued model file into the local cache, verify its size and record its SHA-256.',
      permission: 'write',
      idempotent: true,
      cost: 'network',
      timeoutMs: 600_000,
      args: [
        { name: 'id', type: 'string', required: true, description: 'Catalogue model id.' },
        { name: 'maxMb', type: 'number', required: false, description: 'Refuse downloads larger than this (default 2048).' },
      ],
      async handler(args) {
        const started = Date.now();
        const maxMb = typeof args.maxMb === 'number' ? args.maxMb : 2048;
        const result = await modelCatalogue.acquire(String(args.id), {
          token: process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN,
          maxBytes: maxMb * 1024 * 1024,
        });
        if (!result.ok) return fail(result.error || 'Acquisition failed.', 'acquire_failed', started);
        return ok(
          `${result.alreadyPresent ? 'Already present' : 'Downloaded'} ${result.id} (${((result.sizeBytes || 0) / 1024 / 1024).toFixed(1)} MB, sha256 ${result.sha256?.slice(0, 12)}…).`,
          result,
          started,
        );
      },
    },
    {
      id: 'intelligence.route_model',
      department: 'intelligence',
      title: 'Route a task to a model',
      description: 'Choose the best available model for a task kind and explain the decision.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [{ name: 'task', type: 'string', required: true, description: 'chat|reasoning|coding|research|documents|speech|vision|embedding' }],
      async handler(args) {
        const started = Date.now();
        const task = String(args.task) as ModelTask;
        const installedIds = modelCatalogue.installed().map((m) => m.id);
        const providerList = await providers.getAllProviders();
        const providerIds = providerList.filter((p) => p.is_available).map((p) => p.id);
        // The provider's real model identifier is what proves it serves a
        // catalogued repository; `weights_location`/`name` carry it.
        const providerModels = providerList
          .filter((p) => p.is_available)
          .flatMap((p) => [p.weights_location, p.name, p.architecture].filter(Boolean) as string[]);
        const hostRamGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
        const decision = modelCatalogue.route(task, { installedIds, providerIds, providerModels, hostRamGb });
        return ok(decision.reason, decision, started);
      },
    },

    // ------------------------------------------------------------------- System
    {
      id: 'system.capabilities',
      department: 'system',
      title: 'List all capabilities',
      description: 'Return the full capability catalogue grouped by department.',
      permission: 'read',
      idempotent: true,
      cost: 'free',
      args: [],
      async handler() {
        const started = Date.now();
        return ok(`${capabilityRegistry.list().length} capability(ies) registered.`, {
          departments: capabilityRegistry.departments(),
          capabilities: capabilityRegistry.list(),
        }, started);
      },
    },
  ];

  capabilityRegistry.registerAll(descriptors);
}
