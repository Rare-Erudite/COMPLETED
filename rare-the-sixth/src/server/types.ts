export type ProviderType =
  | 'offline_cognitive'
  | 'local_ollama'
  | 'openai_compatible'
  | 'gemini_coprocessor'
  | 'rare_intelligence';

export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  architecture: string;
  type: ProviderType;
  requires_api_key: boolean;
  is_available: boolean;
  active: boolean;
  weights_location: string;
  execution_environment: string;
  notes: string;
}

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  activeConversationId?: string;
}

export interface ToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface GenerationResult {
  reply: string;
  thought?: string;
  modelUsed: string;
  providerType: ProviderType;
  toolCalls?: ToolCall[];
  actionDetected?: {
    type: 'project_build' | 'document_work' | 'schedule_create' | 'image_create' | 'memory_stored' | 'self_dev';
    data?: any;
    summary?: string;
  };
}

export interface IModelProvider {
  getInfo(): Promise<ModelInfo>;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, context?: string, options?: GenerationOptions): Promise<GenerationResult>;
}

// -----------------------------------------------------------------------------
// Tool Primitives
// -----------------------------------------------------------------------------
export type ToolName =
  | 'READ_FILE'
  | 'WRITE_FILE'
  | 'SEARCH'
  | 'RUN_COMMAND'
  | 'RUN_TEST'
  | 'BUILD_PROJECT'
  | 'INSPECT_ERROR'
  | 'CREATE_CHECKPOINT'
  | 'RESTORE_CHECKPOINT'
  | 'RESEARCH'
  | 'MEMORY_RECALL'
  | 'MEMORY_STORE';

export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  category: 'filesystem' | 'execution' | 'inspection' | 'security' | 'research' | 'memory';
  risk: RiskLevel;
  requiresDeveloperAuth: boolean;
  inputSchema: ToolInputSchema;
}

export interface ToolExecutionResult {
  success: boolean;
  tool: ToolName;
  output?: any;
  error?: string;
  executionTimeMs: number;
  auditId?: string;
}

// -----------------------------------------------------------------------------
// Memory Records
// -----------------------------------------------------------------------------
export interface MemoryRecord {
  id: string;
  kind: 'preference' | 'project_decision' | 'technical_constraint' | 'discussion' | 'fact';
  text: string;
  tags: string[];
  importance: number; // 1 to 5
  timestamp: string;
  source: 'user_stated' | 'system_inferred' | 'session_summary';
  verifiedByUser?: boolean;
}

// -----------------------------------------------------------------------------
// Checkpoints
// -----------------------------------------------------------------------------
export interface CheckpointRecord {
  id: string;
  timestamp: string;
  description: string;
  status: 'known_good' | 'experimental' | 'unverified';
  filesCount: number;
  filesList: string[];
  snapshotDir: string;
  hash: string;
}

// -----------------------------------------------------------------------------
// Learning & Development Trajectories
// -----------------------------------------------------------------------------
export interface DevelopmentTrajectory {
  id: string;
  task: string;
  plan: string;
  actions: string[];
  changedFiles: string[];
  failureDiagnosed?: string;
  repairApplied?: string;
  repairAttempts: number;
  testOutcome: 'passed' | 'failed';
  status: 'VERIFIED_SUCCESS' | 'REVERTED_ON_FAILURE';
  timestamp: string;
  auditTrail: string[];
}

// -----------------------------------------------------------------------------
// Evaluation Vector & Suite
// -----------------------------------------------------------------------------
export interface EvaluationTestCase {
  id: string;
  vector: 'reasoning' | 'coding' | 'debugging_repair' | 'tool_use' | 'memory_recall' | 'safety_sandbox';
  description: string;
  passed: boolean;
  score: number; // 0 to 100
  details: string;
  executionTimeMs: number;
}

export interface EvaluationReport {
  evaluated: boolean;
  timestamp: string;
  runtime_environment: string;
  model_tested: string;
  overallScore: number;
  vectors: {
    reasoning: number;
    coding: number;
    debugging_repair: number;
    tool_use: number;
    memory_recall: number;
    safety_sandbox: number;
  };
  totalTests: number;
  passedTests: number;
  failedTests: number;
  testCases: EvaluationTestCase[];
  methodology: string;
}
