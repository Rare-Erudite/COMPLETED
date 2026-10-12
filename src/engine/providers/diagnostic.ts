/**
 * RARE-INTELLIGENCE — Diagnostic / Sandbox Provider
 * Deterministic offline provider for test suites, benchmarks, and offline sandbox execution.
 * TRUTHFUL LABELING: Always explicitly tags isSimulated: true and is clearly labeled in audit logs.
 */

import { IModelProvider } from './base.js';
import {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
  ModelToolCall,
} from '../types.js';

export class DiagnosticMockProvider implements IModelProvider {
  public readonly id: ModelProviderType = 'diagnostic-mock';
  public readonly name = 'RARE Diagnostic Sandbox (Deterministic Mock)';
  public readonly modelIdentifier: string = 'rare-diagnostic-engine-v1';

  public async checkAvailability(): Promise<ModelProviderInfo> {
    return {
      id: this.id,
      name: this.name,
      modelIdentifier: this.modelIdentifier,
      isAvailable: true,
      isConfigured: true,
      supportsFunctionCalling: true,
      supportsStreaming: true,
      license: 'MIT / Open Source Diagnostic Suite',
      freeTierStatus: {
        isFree: true,
        quotaNotes: 'Unlimited deterministic sandbox inference (100% Free & Offline)',
        rateLimitNotes: 'No rate limits',
      },
      statusMessage: 'Operational [DIAGNOSTIC / SIMULATED]. Ready for offline verification and testing.',
    };
  }

  public async generate(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig
  ): Promise<ModelGenerationResult> {
    const startTime = Date.now();
    const promptText =
      typeof prompt === 'string'
        ? prompt
        : prompt.map((m) => m.content).join(' ');

    const lower = promptText.toLowerCase();

    // Check if tool declarations were passed and prompt requests a tool operation
    const toolCalls: ModelToolCall[] = [];
    if (config?.tools && config.tools.length > 0) {
      if (lower.includes('read') || lower.includes('inspect file') || lower.includes('cat ')) {
        const fileTool = config.tools.find((t) => t.name === 'file_read');
        if (fileTool) {
          toolCalls.push({
            id: 'mock_call_' + Math.random().toString(36).substring(2, 7),
            name: 'file_read',
            args: { path: 'package.json' },
          });
        }
      } else if (lower.includes('calculate') || lower.includes('math') || lower.includes('+') || lower.includes('*')) {
        const mathTool = config.tools.find((t) => t.name === 'calculator_eval');
        if (mathTool) {
          toolCalls.push({
            id: 'mock_call_' + Math.random().toString(36).substring(2, 7),
            name: 'calculator_eval',
            args: { expression: '42 * 10' },
          });
        }
      }
    }

    // Deterministic intelligence response synthesis
    let responseText = '';
    if (toolCalls.length > 0) {
      responseText = `I need to execute a tool to complete this request: calling ${toolCalls.map((t) => t.name).join(', ')}.`;
    } else if (lower.includes('decompose') || lower.includes('plan')) {
      responseText = `Decomposition Plan:\n1. Inspect system environment and dependencies.\n2. Execute core logic step with bounded verification.\n3. Validate outputs against constraints and finalize status.`;
    } else if (lower.includes('hello') || lower.includes('hi') || lower.includes('howdy') || lower.includes('hey')) {
      responseText = `Hello! I am RARE — your autonomous intelligence engine and software building partner. All systems and core modules are active. How can I assist you today?`;
    } else if (lower.includes('how are you') || lower.includes('how are you doing')) {
      responseText = `I'm operating at peak performance! All internal systems, persistence layers, and tool pipelines are nominal. Ready to build software, answer questions, or process tasks. What's on your mind?`;
    } else if (lower.includes('what can you do') || lower.includes('what are your capabilities') || lower.includes('features')) {
      responseText = `Here is what I can do as RARE:\n\n1. **Autonomous Software Building**: Scaffold and build web applications, backend APIs, mobile components, and export signed Android APKs.\n2. **Multi-Agent Orchestration**: Coordinate specialist agents (Architect, Frontend, Backend, Database, QA/Test, Security, Self-Repair) to complete complex objectives.\n3. **Document & Media Processing**: Transcribe audio recordings, convert documents, extract structured data, and analyze files.\n4. **Persistent Memory**: Maintain cross-session memories, preferences, and project context across restarts.\n5. **Task Automation & Scheduling**: Manage scheduled alarms, recurring cron automation, and background workflows.\n6. **Live Voice Transcription & Audio**: Real-time speech-to-text transcription and selective audio playback.\n\nTell me what you'd like to work on and we can get started!`;
    } else if (lower.includes('test') || lower.includes('ping')) {
      responseText = `PONG: Diagnostic sandbox verified and operational. Latency nominal.`;
    } else {
      responseText = `I have analyzed your request regarding "${promptText.slice(0, 100)}". All system verification gates are active. Whether you'd like to write code, design an application, process documents, or automate a workflow, tell me your specific requirements and I'll execute them for you.`;
    }

    const latencyMs = Math.max(15, Date.now() - startTime);

    return {
      text: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      provider: this.id,
      model: this.modelIdentifier,
      latencyMs,
      tokenUsage: {
        promptTokens: Math.ceil(promptText.length / 4),
        completionTokens: Math.ceil(responseText.length / 4),
        totalTokens: Math.ceil((promptText.length + responseText.length) / 4),
      },
      isSimulated: true, // HONEST TRUTHFUL LABEL
      costEstimateUSD: 0,
      rawResponseMeta: {
        mode: 'diagnostic_sandbox',
        notice: 'This response was generated by the internal diagnostic provider, not an external LLM.',
      },
    };
  }

  public async generateStream(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig,
    onChunk?: (chunk: string) => void
  ): Promise<ModelGenerationResult> {
    const result = await this.generate(prompt, config);
    if (onChunk) {
      onChunk(result.text);
    }
    return result;
  }
}
