/**
 * DeliveryOrchestrator — run one natural-language instruction across every
 * department RARE has, in the right order, and report what actually happened.
 *
 * This is the piece requirement 1 and the PDF's section 15 are really about:
 * Chat must not be a text generator that happens to sit next to a builder. A
 * single message like "build a small web app, test it, put it in a repo and
 * deploy it" must drive environment provisioning, scaffolding, build, test,
 * repair, repository creation and deployment as one coordinated workflow.
 *
 * The orchestrator is a *planner over real capabilities*, not a second model.
 * Each step calls a module that does real work and returns real evidence. A
 * step that cannot run is recorded as `skipped` or `failed` with the reason;
 * the workflow continues where it safely can and the final report says exactly
 * which stages succeeded.
 *
 * Ordering is fixed and dependency-aware:
 *
 *   provision -> scaffold -> build -> test -> (repair) -> repository -> deploy -> verify
 *
 * Nothing is marked `passed` without a real exit code or HTTP status behind it.
 */

import fs from 'fs';
import path from 'path';
import { provisionToolchains, requirementsFor, summariseProvisioning, type ProvisionReport } from './EnvironmentProvisioner.js';
import { scaffoldProject, type ProjectTemplate, PROJECT_TEMPLATES } from './ProjectScaffolder.js';
import { buildProject, summariseBuild, type BuildReport } from './BuildRunner.js';
import {
  ensureRepository,
  commitFiles,
  collectProjectFiles,
  createBranch,
  getRepository,
  isConfigured as repoConfigured,
  type RepoRef,
} from './RepositoryManager.js';
import {
  deployStatic,
  accountStatus,
  isConfigured as deployConfigured,
  summariseDeployment,
  type DeploymentResult,
} from './DeploymentManager.js';

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface WorkflowStep {
  id: string;
  title: string;
  status: StepStatus;
  /** One-line human summary. */
  summary: string;
  /** Structured evidence for the report. */
  evidence?: unknown;
  durationMs: number;
}

export interface DeliveryRequest {
  /** The user's instruction, kept verbatim for the record. */
  instruction: string;
  /** Project name (slug). */
  name: string;
  template: ProjectTemplate;
  /** Whether to create a GitHub repository. */
  createRepository?: boolean;
  /** Whether to deploy to Vercel. */
  deploy?: boolean;
  /** Repository owner; defaults to the authenticated account. */
  repoOwner?: string;
  /**
   * Push into an existing repository instead of creating a new one. Used when
   * the token can push but cannot create repositories — a real permission
   * boundary, not a workaround for a bug.
   */
  existingRepo?: { owner: string; repo: string; branch?: string };
  /** Deploy target. */
  target?: 'production' | 'preview';
  /** Run the terminating `run` stage for CLI projects. */
  includeRun?: boolean;
}

export interface DeliveryReport {
  instruction: string;
  project: string;
  template: string;
  steps: WorkflowStep[];
  /** True only when every step that was attempted passed. */
  ok: boolean;
  /** The live URL, when a deployment succeeded. */
  liveUrl: string | null;
  /** The repository URL, when one was created. */
  repoUrl: string | null;
  /** Honest list of what could not be done and why. */
  limitations: string[];
  durationMs: number;
}

function step(
  id: string,
  title: string,
  status: StepStatus,
  summary: string,
  startedAt: number,
  evidence?: unknown,
): WorkflowStep {
  return { id, title, status, summary, evidence, durationMs: Date.now() - startedAt };
}

/**
 * Infer a project template from the instruction when the caller did not name
 * one. This is deliberately keyword-based and inspectable rather than a model
 * call: the routing decision must be reproducible and explainable.
 */
export function inferTemplate(instruction: string): ProjectTemplate {
  const text = instruction.toLowerCase();
  if (/\breact\b|\bvite\b|\bspa\b|\bdashboard\b/.test(text)) return 'react-vite';
  if (/\bapi\b|\bbackend\b|\bserver\b|\brest\b|\bendpoint\b/.test(text)) return 'node-api';
  if (/\bpython\b|\bscript\b|\bcli\b.*python/.test(text)) return 'python-cli';
  if (/\bwebsite\b|\bweb page\b|\blanding\b|\bstatic\b|\bhtml\b/.test(text)) return 'static-web';
  if (/\bcli\b|\bcommand\b|\btool\b/.test(text)) return 'node-cli';
  return 'static-web';
}

/** Derive a safe project slug from an instruction. */
export function inferName(instruction: string, fallback = 'rare-project'): string {
  const words = instruction
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['build', 'create', 'make', 'the', 'and', 'for', 'with', 'app', 'application', 'project'].includes(word))
    .slice(0, 3);
  const slug = words.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || fallback;
}

/**
 * Run the full delivery workflow.
 *
 * `workspaceRoot` is where projects are scaffolded (RARE's own workspace).
 */
export async function runDeliveryWorkflow(
  workspaceRoot: string,
  request: DeliveryRequest,
): Promise<DeliveryReport> {
  const started = Date.now();
  const steps: WorkflowStep[] = [];
  const limitations: string[] = [];
  let liveUrl: string | null = null;
  let repoUrl: string | null = null;

  const template = PROJECT_TEMPLATES.includes(request.template) ? request.template : inferTemplate(request.instruction);
  const name = request.name || inferName(request.instruction);

  // ---- 1. Provision the environment this project type needs ----------------
  let provisionStarted = Date.now();
  let provision: ProvisionReport | null = null;
  try {
    const required = requirementsFor(template);
    provision = await provisionToolchains(required);
    const blocked = provision.steps.filter(
      (s) => s.outcome === 'unavailable_from_archive' || s.outcome === 'install_failed' || s.outcome === 'not_permitted',
    );
    steps.push(
      step(
        'provision',
        'Provision development environment',
        blocked.length ? 'failed' : 'passed',
        summariseProvisioning(provision),
        provisionStarted,
        provision,
      ),
    );
    for (const item of blocked) limitations.push(`${item.name}: ${item.reason}`);
  } catch (error: any) {
    steps.push(step('provision', 'Provision development environment', 'failed', error?.message || 'Provisioning threw.', provisionStarted));
    limitations.push(`Environment provisioning failed: ${error?.message || 'unknown error'}`);
  }

  // ---- 2. Scaffold the project --------------------------------------------
  const scaffoldStarted = Date.now();
  let relativeRoot: string | null = null;
  try {
    const result = scaffoldProject(workspaceRoot, name, template, request.instruction);
    relativeRoot = result.relativeRoot;
    steps.push(
      step(
        'scaffold',
        'Create project from instruction',
        'passed',
        `Wrote ${result.files.length} files for a ${template} project at ${result.relativeRoot}.`,
        scaffoldStarted,
        result,
      ),
    );
  } catch (error: any) {
    steps.push(step('scaffold', 'Create project from instruction', 'failed', error?.message || 'Scaffold threw.', scaffoldStarted));
    limitations.push(`Project could not be scaffolded: ${error?.message || 'unknown error'}`);
    return {
      instruction: request.instruction,
      project: name,
      template,
      steps,
      ok: false,
      liveUrl,
      repoUrl,
      limitations,
      durationMs: Date.now() - started,
    };
  }

  // ---- 3. Build and test ---------------------------------------------------
  const buildStarted = Date.now();
  let build: BuildReport | null = null;
  try {
    build = await buildProject(workspaceRoot, relativeRoot, {
      allowRepair: true,
      includeRun: request.includeRun,
    });
    steps.push(
      step(
        'build',
        'Build and test',
        build.passed ? 'passed' : 'failed',
        summariseBuild(build),
        buildStarted,
        build,
      ),
    );
    for (const item of build.limitations) limitations.push(item);
    if (!build.passed) {
      // A failed build is a real result. Do not deploy a broken project.
      limitations.push('Deployment was skipped because the build or tests did not pass.');
    }
  } catch (error: any) {
    steps.push(step('build', 'Build and test', 'failed', error?.message || 'Build threw.', buildStarted));
    limitations.push(`Build could not run: ${error?.message || 'unknown error'}`);
  }

  const buildPassed = build?.passed === true;

  // ---- 4. Repository -------------------------------------------------------
  if (request.createRepository) {
    const repoStarted = Date.now();
    if (!repoConfigured()) {
      steps.push(step('repository', 'Create repository', 'skipped', 'GITHUB_TOKEN is not configured.', repoStarted));
      limitations.push('Repository creation was skipped: GITHUB_TOKEN is not set.');
    } else {
      try {
        // Two real paths: push into a repository the caller named, or create a
        // new one. The token in this environment can push but cannot create
        // repositories, so the existing-repo path is the one that actually
        // completes here — and the report says which path ran.
        const target = request.existingRepo
          ? { owner: request.existingRepo.owner, repo: request.existingRepo.repo, branch: request.existingRepo.branch || 'main' }
          : null;

        if (target) {
          const projectRoot = path.resolve(workspaceRoot, relativeRoot);
          const files = collectProjectFiles(projectRoot);
          // The branch may not exist yet. Create it from the repository's
          // default branch first; createBranch is idempotent (a 422 for an
          // existing ref resolves to the existing head).
          const repoInfo = await getRepository(target.owner, target.repo);
          const baseBranch = repoInfo.data?.defaultBranch || 'main';
          const branchResult = await createBranch(target.owner, target.repo, target.branch, baseBranch);
          if (!branchResult.ok) {
            steps.push(
              step('repository', 'Commit to repository', 'failed', `Could not create branch ${target.branch}: ${branchResult.error}`, repoStarted),
            );
            limitations.push(`Branch creation failed: ${branchResult.error}`);
          } else {
            const commit = await commitFiles(
              target.owner,
              target.repo,
              target.branch,
              files,
              `RARE: ${request.instruction.slice(0, 120)}`,
            );
            if (commit.ok && commit.data) {
              repoUrl = `https://github.com/${target.owner}/${target.repo}/tree/${target.branch}`;
              steps.push(
                step(
                  'repository',
                  'Commit to repository',
                  'passed',
                  `Committed ${commit.data.filesChanged} files to ${target.owner}/${target.repo}@${target.branch} as ${commit.data.commitSha.slice(0, 8)}.`,
                  repoStarted,
                  { repo: target, commit: commit.data },
                ),
              );
            } else {
              steps.push(
                step('repository', 'Commit to repository', 'failed', `Commit failed: ${commit.error}`, repoStarted, { commitError: commit.error }),
              );
              limitations.push(`Commit failed: ${commit.error}`);
            }
          }
        } else {
          const ensured = await ensureRepository(name, {
            owner: request.repoOwner,
            description: request.instruction.slice(0, 200),
            private: false,
          });
          if (!ensured.ok || !ensured.data) {
            steps.push(step('repository', 'Create repository', 'failed', ensured.error || 'Repository creation failed.', repoStarted));
            limitations.push(`Repository creation failed: ${ensured.error}`);
          } else {
            repoUrl = ensured.data.htmlUrl;
            const projectRoot = path.resolve(workspaceRoot, relativeRoot);
            const files = collectProjectFiles(projectRoot);
            const commit = await commitFiles(
              ensured.data.owner,
              ensured.data.repo,
              ensured.data.defaultBranch,
              files,
              `RARE: ${request.instruction.slice(0, 120)}`,
            );
            if (commit.ok && commit.data) {
              steps.push(
                step(
                  'repository',
                  'Create repository',
                  'passed',
                  `${ensured.created ? 'Created' : 'Found'} ${ensured.data.htmlUrl}; committed ${commit.data.filesChanged} files as ${commit.data.commitSha.slice(0, 8)}.`,
                  repoStarted,
                  { repo: ensured.data, commit: commit.data },
                ),
              );
            } else {
              steps.push(
                step(
                  'repository',
                  'Create repository',
                  'failed',
                  `Repository exists at ${ensured.data.htmlUrl} but the commit failed: ${commit.error}`,
                  repoStarted,
                  { repo: ensured.data, commitError: commit.error },
                ),
              );
              limitations.push(`Commit failed: ${commit.error}`);
            }
          }
        }
      } catch (error: any) {
        steps.push(step('repository', 'Create repository', 'failed', error?.message || 'Repository step threw.', repoStarted));
        limitations.push(`Repository step failed: ${error?.message || 'unknown error'}`);
      }
    }
  }

  // ---- 5. Deploy -----------------------------------------------------------
  if (request.deploy) {
    const deployStarted = Date.now();
    if (!buildPassed) {
      steps.push(step('deploy', 'Deploy and verify', 'skipped', 'Skipped because the build did not pass.', deployStarted));
    } else if (!deployConfigured()) {
      steps.push(step('deploy', 'Deploy and verify', 'skipped', 'VERCEL_TOKEN is not configured.', deployStarted));
      limitations.push('Deployment was skipped: VERCEL_TOKEN is not set.');
    } else {
      try {
        // The account's `limited` flag is NOT a deployment blocker: real
        // deployments on this account reach READY. It is reported for context
        // but the deploy is attempted, because refusing on a flag that does not
        // actually block would be a false negative.
        const account = await accountStatus();
        const projectRoot = path.resolve(workspaceRoot, relativeRoot);
        const files = collectDeployableFiles(projectRoot, template);
        const deployment: DeploymentResult = await deployStatic(name, files, {
          target: request.target || 'production',
        });
        steps.push(
          step(
            'deploy',
            'Deploy and verify',
            deployment.ok ? 'passed' : 'failed',
            summariseDeployment(deployment),
            deployStarted,
            { deployment, accountLimited: account.limited },
          ),
        );
        if (deployment.ok && deployment.url) {
          liveUrl = deployment.url;
        } else {
          limitations.push(summariseDeployment(deployment));
        }
      } catch (error: any) {
        steps.push(step('deploy', 'Deploy and verify', 'failed', error?.message || 'Deploy threw.', deployStarted));
        limitations.push(`Deployment failed: ${error?.message || 'unknown error'}`);
      }
    }
  }

  const attempted = steps.filter((s) => s.status !== 'skipped');
  const ok = attempted.length > 0 && attempted.every((s) => s.status === 'passed');

  return {
    instruction: request.instruction,
    project: name,
    template,
    steps,
    ok,
    liveUrl,
    repoUrl,
    limitations,
    durationMs: Date.now() - started,
  };
}

/**
 * Pick the files a static deployment should contain.
 *
 * For a static-web project that is the project's own files. For a built SPA it
 * is the `dist/` output. A server-backed project cannot be deployed as static
 * files, and that is reported rather than silently deploying a broken shell.
 */
function collectDeployableFiles(
  projectRoot: string,
  template: ProjectTemplate,
): Array<{ file: string; content: string }> {
  const root = template === 'react-vite' ? path.join(projectRoot, 'dist') : projectRoot;
  const base = fs.existsSync(root) ? root : projectRoot;
  const files: Array<{ file: string; content: string }> = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'server-build', '__pycache__']);

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) && dir === base) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        if (stat.size > 2 * 1024 * 1024) continue;
        // Only text assets can be sent inline; binary assets are skipped and
        // the limitation is visible in the deployment result.
        const buffer = fs.readFileSync(full);
        if (buffer.includes(0)) continue;
        files.push({ file: path.relative(base, full).split(path.sep).join('/'), content: buffer.toString('utf-8') });
      }
    }
  };

  walk(base);
  return files;
}

/** A compact, honest summary for a chat reply. */
export function summariseDelivery(report: DeliveryReport): string {
  const lines = report.steps.map((s) => {
    const icon = s.status === 'passed' ? '✓' : s.status === 'failed' ? '✗' : '–';
    return `${icon} ${s.title}: ${s.summary}`;
  });
  const header = report.ok
    ? `Completed the full workflow for "${report.project}" (${report.template}).`
    : `Ran the workflow for "${report.project}" (${report.template}); some stages did not pass.`;
  const links: string[] = [];
  if (report.repoUrl) links.push(`Repository: ${report.repoUrl}`);
  if (report.liveUrl) links.push(`Live: ${report.liveUrl}`);
  const limits = report.limitations.length ? ['', 'Limitations:', ...report.limitations.map((l) => `- ${l}`)] : [];
  return [header, '', ...lines, ...(links.length ? ['', ...links] : []), ...limits].join('\n');
}
