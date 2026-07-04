import type { AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GkAgent } from '../../agents/agentService.js';
import type { Container } from '../../container.js';

/** Token/cost accounting surfaced from a captured agent run, for transparency in the UI. */
export interface AgentRunUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly costUsd?: number;
	readonly numTurns?: number;
}

/** Inputs for a deep, agent-orchestrated review run. The diff/message/context mirror what the
 *  built-in (quick) review path already gathers; the agent additionally explores the repo at `cwd`. */
export interface DeepReviewOptions {
	readonly executable: string;
	readonly cwd: string;
	readonly diff: string;
	readonly message?: string;
	readonly context?: string;
	/** Pre-merged user instructions (custom-instructions + per-run guidance). */
	readonly instructions?: string;
	/** Resume a prior captured session for a follow-up (Phase B); omit for a fresh review. */
	readonly resumeSessionId?: string;
	readonly signal?: AbortSignal;
}

/** Result of a deep review run. `sessionId` enables follow-up; the result shape is the SAME
 *  `AIReviewResult` the quick path produces, so the existing panel renders it unchanged. */
export type DeepReviewRunResult =
	| { result: AIReviewResult; sessionId?: string; usage?: AgentRunUsage }
	| { error: { message: string } }
	| { cancelled: true };

// CLI agents we know support headless capture (`-p --json-schema --output-format json`). Phase A
// is Claude Code only. When `gk agents list` reports a real capability flag, swap this allowlist
// for it at this single call site rather than hardening downstream.
const captureCapableAgentNames = new Set<string>(['claude-cli']);

/**
 * Returns a detected, executable-on-disk CLI agent that supports headless run-and-capture, or
 * `undefined` when none is available. Used to gate the Deep review depth option.
 */
export async function getCaptureCapableAgent(container: Container): Promise<GkAgent | undefined> {
	const agents = await container.agents.getDetectedCliAgents();
	return agents.find(a => captureCapableAgentNames.has(a.name) && a.executable != null);
}
