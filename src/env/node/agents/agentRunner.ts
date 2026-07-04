import type {
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewResult,
	AIReviewSeverity,
} from '@gitlens/ai/models/results.js';
import { runSpawn } from '@gitlens/utils/env/node/exec.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { AgentRunUsage, DeepReviewOptions, DeepReviewRunResult } from '../../../plus/agents/agentCapture.js';

/** Whether this environment can spawn-and-capture an agent. Node: yes; the browser twin reports false. */
export const agentCaptureSupported = true;

// Read-only tool allowlist for the review agent — it may read files and inspect git history, but must
// never modify the repo. Combined with `--permission-mode plan` so unlisted tools are auto-denied.
const readOnlyTools = [
	'Read',
	'Grep',
	'Glob',
	'Bash(git diff:*)',
	'Bash(git log:*)',
	'Bash(git show:*)',
	'Bash(git status:*)',
	'Bash(git blame:*)',
];

// Bounds an automated deep review so a runaway exploration can't burn unbounded time/cost. A finish
// pass (see below) recovers structured findings if the first run exhausts these.
const maxTurns = 40;
const maxBudgetUsd = 4;
const finishPassMaxTurns = 3;

const reviewerSystemPrompt =
	'You are operating as an automated, read-only code reviewer. Never modify files or run mutating commands. Always conclude by emitting the required structured review output.';

// JSON Schema mirroring `AIReviewResult` so the CLI returns validated `structured_output` that maps
// 1:1 onto the model the existing review panel already renders.
const reviewSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['overview', 'focusAreas'],
	properties: {
		overview: { type: 'string' },
		focusAreas: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'label', 'rationale', 'severity', 'files', 'findings'],
				properties: {
					id: { type: 'string' },
					label: { type: 'string' },
					rationale: { type: 'string' },
					severity: { enum: ['critical', 'warning', 'suggestion'] },
					files: { type: 'array', items: { type: 'string' } },
					findings: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['id', 'severity', 'title', 'description'],
							properties: {
								id: { type: 'string' },
								severity: { enum: ['critical', 'warning', 'suggestion'] },
								title: { type: 'string' },
								description: { type: 'string' },
								filePath: { type: 'string' },
								lineRange: {
									type: 'object',
									additionalProperties: false,
									properties: { start: { type: 'number' }, end: { type: 'number' } },
								},
							},
						},
					},
				},
			},
		},
	},
};

interface ClaudeEnvelope {
	readonly subtype?: string;
	readonly is_error?: boolean;
	readonly structured_output?: unknown;
	readonly session_id?: string;
	readonly total_cost_usd?: number;
	readonly num_turns?: number;
	readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

/**
 * Runs a deep, agent-orchestrated review by spawning the CLI headless, capturing its validated
 * structured output, and mapping it to the same `AIReviewResult` the built-in review produces.
 * If the first run exhausts its turn/budget before emitting findings, a cheap finish pass resumes
 * the same session and asks only for the structured output.
 */
export async function runDeepReview(options: DeepReviewOptions): Promise<DeepReviewRunResult> {
	try {
		const prompt = buildReviewPrompt(options);

		let envelope = await runClaudeCapture(options.executable, prompt, {
			cwd: options.cwd,
			signal: options.signal,
			resumeSessionId: options.resumeSessionId,
			turns: maxTurns,
		});
		if ('cancelled' in envelope) return { cancelled: true };

		let review = toReview(envelope.structured_output);

		// Ran out of turns/budget before emitting findings — resume and ask only for the output.
		if (review == null && envelope.session_id != null && !options.signal?.aborted) {
			const finish = await runClaudeCapture(
				options.executable,
				'You have run out of turns/budget. Do NOT explore further. Based on your analysis so far, emit your review findings now as the required structured output.',
				{
					cwd: options.cwd,
					signal: options.signal,
					resumeSessionId: envelope.session_id,
					turns: finishPassMaxTurns,
				},
			);
			if ('cancelled' in finish) return { cancelled: true };

			envelope = finish;
			review = toReview(envelope.structured_output);
		}

		if (review == null) {
			return {
				error: {
					message:
						'The deep review agent did not return structured findings. Try again or use a Quick review.',
				},
			};
		}

		return { result: review, sessionId: envelope.session_id, usage: toUsage(envelope) };
	} catch (ex) {
		if (options.signal?.aborted) return { cancelled: true };

		Logger.error(ex, 'agentRunner', 'runDeepReview');
		// Prefer the CLI's stderr (the actual cause) over the opaque "exit code N" RunError message.
		const stderr = (ex as { stderr?: unknown }).stderr;
		const message =
			typeof stderr === 'string' && stderr.trim() ? stderr.trim() : ex instanceof Error ? ex.message : String(ex);
		return { error: { message: message } };
	}
}

interface RunClaudeOptions {
	readonly cwd: string;
	readonly signal?: AbortSignal;
	readonly resumeSessionId?: string;
	readonly turns: number;
}

/** Spawns `claude -p` with the prompt on stdin and returns the parsed JSON envelope. The CLI exits
 *  non-zero on `error_max_turns`/budget, carrying the envelope on the thrown error's stdout — so we
 *  recover it from both the success and failure paths. */
async function runClaudeCapture(
	executable: string,
	prompt: string,
	options: RunClaudeOptions,
): Promise<ClaudeEnvelope | { cancelled: true }> {
	const args = [
		'-p',
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(reviewSchema),
		'--permission-mode',
		'plan',
		'--allowedTools',
		readOnlyTools.join(','),
		'--append-system-prompt',
		reviewerSystemPrompt,
		'--max-turns',
		String(options.turns),
		'--max-budget-usd',
		String(maxBudgetUsd),
	];
	if (options.resumeSessionId != null) {
		args.push('--resume', options.resumeSessionId);
	}

	try {
		const { stdout } = await runSpawn<string>(executable, args, 'utf8', {
			cwd: options.cwd,
			stdin: prompt,
			cancellation: options.signal,
		});
		const envelope = parseEnvelope(stdout);
		if (envelope == null) throw new Error('Agent returned an unparseable response.');
		return envelope;
	} catch (ex) {
		if (options.signal?.aborted) return { cancelled: true };

		// Non-zero exit (e.g. max-turns) still carries the JSON envelope on the error's stdout.
		const stdout = (ex as { stdout?: unknown }).stdout;
		if (typeof stdout === 'string' && stdout.length) {
			const envelope = parseEnvelope(stdout);
			if (envelope != null) return envelope;
		}
		throw ex;
	}
}

function parseEnvelope(stdout: string): ClaudeEnvelope | undefined {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;

	try {
		const parsed: unknown = JSON.parse(trimmed);
		return parsed != null && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function toUsage(envelope: ClaudeEnvelope): AgentRunUsage {
	return {
		inputTokens: envelope.usage?.input_tokens,
		outputTokens: envelope.usage?.output_tokens,
		costUsd: envelope.total_cost_usd,
		numTurns: envelope.num_turns,
	};
}

function toSeverity(value: unknown): AIReviewSeverity {
	return value === 'critical' || value === 'warning' || value === 'suggestion' ? value : 'suggestion';
}

function toReview(raw: unknown): AIReviewResult | undefined {
	if (raw == null || typeof raw !== 'object') return undefined;

	const o = raw as Record<string, unknown>;
	if (typeof o.overview !== 'string') return undefined;

	const areasRaw = Array.isArray(o.focusAreas) ? o.focusAreas : [];
	const focusAreas: AIReviewFocusArea[] = [];
	for (let i = 0; i < areasRaw.length; i++) {
		const area = toArea(areasRaw[i], i);
		if (area != null) {
			focusAreas.push(area);
		}
	}
	return { overview: o.overview, focusAreas: focusAreas, mode: 'two-pass' };
}

function toArea(raw: unknown, index: number): AIReviewFocusArea | undefined {
	if (raw == null || typeof raw !== 'object') return undefined;

	const a = raw as Record<string, unknown>;
	const label = typeof a.label === 'string' ? a.label : undefined;
	if (label == null) return undefined;

	const filesRaw = Array.isArray(a.files) ? a.files : [];
	const files = filesRaw.filter((f): f is string => typeof f === 'string');
	const findingsRaw = Array.isArray(a.findings) ? a.findings : [];
	const findings: AIReviewFinding[] = [];
	for (let j = 0; j < findingsRaw.length; j++) {
		const finding = toFinding(findingsRaw[j], index, j);
		if (finding != null) {
			findings.push(finding);
		}
	}

	return {
		id: typeof a.id === 'string' && a.id ? a.id : `area-${index}`,
		label: label,
		rationale: typeof a.rationale === 'string' ? a.rationale : '',
		severity: toSeverity(a.severity),
		files: files,
		findings: findings,
	};
}

function toFinding(raw: unknown, areaIndex: number, index: number): AIReviewFinding | undefined {
	if (raw == null || typeof raw !== 'object') return undefined;

	const f = raw as Record<string, unknown>;
	const title = typeof f.title === 'string' ? f.title : undefined;
	if (title == null) return undefined;

	let lineRange: { start: number; end: number } | undefined;
	const lr = f.lineRange;
	if (lr != null && typeof lr === 'object') {
		const r = lr as Record<string, unknown>;
		if (typeof r.start === 'number' && typeof r.end === 'number') {
			lineRange = { start: r.start, end: r.end };
		}
	}

	return {
		id: typeof f.id === 'string' && f.id ? f.id : `finding-${areaIndex}-${index}`,
		severity: toSeverity(f.severity),
		title: title,
		description: typeof f.description === 'string' ? f.description : '',
		filePath: typeof f.filePath === 'string' ? f.filePath : undefined,
		lineRange: lineRange,
	};
}

function buildReviewPrompt(options: DeepReviewOptions): string {
	const message = options.message?.trim() || '(no description provided)';
	const context = options.context?.trim() || '(none)';
	const instructions = options.instructions?.trim();

	return `You are an expert code reviewer performing a DEEP review of a set of code changes in the repository at the current working directory. Unlike a diff-only review, you have full read access to the repository — use it.

The changes under review (Git diff):
<diff>
${options.diff}
</diff>

Author's description of the changes:
<message>
${message}
</message>

Related work items (known pull requests and issues for this change set; use for intent, may be empty):
<context>
${context}
</context>

How to review:
- Explore beyond the diff: read the changed files in full, the functions they call and that call them, related types, tests, and configuration. Find issues a diff-only reviewer would miss — broken callers, violated invariants, missing test coverage, inconsistent error handling, concurrency and security problems.
- Use ONLY read-only tools (read files, search, git history). Do not modify anything.
- Identify meaningful problems — bugs, logic errors, security vulnerabilities, regressions, missing error handling. Ignore pure style or linter-level concerns.
- Group related findings into focus areas by theme, not by file. A handful of high-quality findings beats many low-value ones. If the changes look correct and well-structured, say so in the overview and return no focus areas.
- Severity: "critical" = bugs, security issues, data-loss risks; "warning" = logic concerns, missing error handling, regressions; "suggestion" = improvements, maintainability, performance.
- For each finding, set filePath and lineRange to the precise location in the CURRENT files — read the file to get accurate line numbers.
- IMPORTANT: Reserve enough of your turn/budget to emit the final structured findings. Do not exhaust your budget exploring.
${instructions ? `\nAdditional reviewer instructions:\n${instructions}\n` : ''}
Produce your review strictly as the required structured output.`;
}
