import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { CancellationTokenSource } from 'vscode';
import {
	applyResolutions,
	defaultVerifier,
	extractConflict,
	resolveConflict,
	resolveConflicts,
} from '@gitkraken/conflict-tools';
import type { AIChatMessage, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { AiTokenUsage, GitExecOptions } from '../compose/types.js';
import type {
	Conflict,
	ConflictGitPort,
	ConflictModelParams,
	ConflictModelPort,
	ConflictModelResult,
	ConflictProgressEvent,
	Resolution,
	ResolutionContext,
	ResolverConfig,
	StepConfig,
	StepResult,
} from './types.js';

export interface ResolveSingleArgs {
	svc: GitRepositoryService;
	conflict: Conflict;
	context?: ResolutionContext;
	config?: ResolverConfig;
	signal?: AbortSignal;
	onProgress?: (event: ConflictProgressEvent) => void;
}

export interface ExtractArgs {
	svc: GitRepositoryService;
	filePath: string;
	reason?: string;
	signal?: AbortSignal;
}

export interface ResolveBatchArgs {
	svc: GitRepositoryService;
	context?: ResolutionContext;
	config?: StepConfig;
	signal?: AbortSignal;
	onProgress?: (event: ConflictProgressEvent) => void;
}

export interface ApplyBatchArgs {
	svc: GitRepositoryService;
	resolutions: readonly Resolution[];
}

export class ConflictToolsIntegration {
	constructor(protected readonly container: Container) {}

	async extract(args: ExtractArgs): Promise<Conflict | null> {
		const git = createConflictGitPort(args.svc);
		return extractConflict(args.filePath, { git: git, signal: args.signal }, args.reason);
	}

	async resolveSingle(args: ResolveSingleArgs, telemetrySource: Source): Promise<Resolution> {
		const git = createConflictGitPort(args.svc);
		const model = createAiModelPort(this.container, telemetrySource);
		return resolveConflict(args.conflict, args.context ?? {}, {
			git: git,
			model: model,
			verifier: defaultVerifier,
			config: args.config,
			signal: args.signal,
			onProgress: args.onProgress,
		});
	}

	async resolveBatch(args: ResolveBatchArgs, telemetrySource: Source): Promise<StepResult> {
		const git = createConflictGitPort(args.svc);
		const model = createAiModelPort(this.container, telemetrySource);
		return resolveConflicts(
			{
				git: git,
				model: model,
				verifier: defaultVerifier,
				config: args.config,
				signal: args.signal,
				onProgress: args.onProgress,
			},
			args.context,
		);
	}

	async applyBatch(args: ApplyBatchArgs): Promise<void> {
		const git = createConflictGitPort(args.svc);
		await applyResolutions([...args.resolutions], { git: git });
	}
}

function createConflictGitPort(svc: GitRepositoryService): ConflictGitPort {
	const git = svc.createUnsafeGit();
	if (git == null) throw new Error('Conflict resolution is not available in virtual repositories');

	const run = async (args: string[], options?: GitExecOptions): Promise<string> => {
		const result = await git.run(args, {
			env: options?.env,
			stdin: options?.stdin,
			cancellation: options?.signal,
			errors: 'throw',
		});
		return result.stdout;
	};

	// `readFile` and `writeFile` are required because the library has no `exec` fallback for them —
	// they read/write the working-tree file directly, bypassing git. We resolve relative paths
	// against the repo root that the underlying GitRepositoryService is rooted at.
	const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(svc.path, path));

	return {
		exec: run,
		readFile: async (path: string): Promise<string> => {
			// Library's parser splits on '\n' only and matches markers via startsWith — a CRLF file
			// leaves '\r' on each marker line, breaking '=======\r' detection and surfacing the
			// next '<<<<<<<' as a phantom nested marker. Normalize on read; the merge editor pane
			// owns EOL on its own (re-)write.
			const raw = await fs.readFile(resolvePath(path), 'utf8');
			return raw.replace(/\r\n/g, '\n');
		},
		writeFile: async (path: string, content: string): Promise<void> =>
			fs.writeFile(resolvePath(path), content, 'utf8'),
		removeFile: async (path: string): Promise<void> => fs.unlink(resolvePath(path)),
	};
}

function createAiModelPort(container: Container, source: Source): ConflictModelPort {
	return {
		generate: async (params: ConflictModelParams): Promise<ConflictModelResult> => {
			const cancellationSource = new CancellationTokenSource();
			const abortHandler = () => cancellationSource.cancel();
			params.signal?.addEventListener('abort', abortHandler);
			if (params.signal?.aborted) {
				cancellationSource.cancel();
			}

			try {
				const messages: AIChatMessage[] = [];
				if (params.system) {
					messages.push({ role: 'system' as 'user', content: params.system });
				}
				for (const msg of params.messages) {
					if (msg.role === 'tool') {
						messages.push({
							role: 'user' as 'user',
							content: `Tool result (${msg.toolName}): ${msg.content}`,
						});
						continue;
					}
					const text = typeof msg.content === 'string' ? msg.content : '';
					if (text) {
						messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
					}
				}

				const provider = {
					getMessages: (): Promise<AIChatMessage[]> => Promise.resolve(messages),
					getProgressTitle: () => 'Resolving conflicts…',
					getTelemetryInfo: (model: {
						provider: { id: string; name: string };
						id: string;
						name: string;
					}) => ({
						key: 'ai/generate' as const,
						data: {
							type: 'resolveConflicts' as const,
							'model.id': model.id,
							'model.provider.id': model.provider.id,
							'model.provider.name': model.provider.name,
							'retry.count': 0,
							duration: 0,
						},
					}),
				};

				const result = await container.ai.sendRequest(
					'generate-resolveConflicts',
					undefined,
					// biome-ignore lint/suspicious/noExplicitAny: AIRequestProvider telemetry type is deeply private; we supply the minimum shape
					provider as any,
					source,
					{
						cancellation: cancellationSource.token,
						modelOptions: {
							outputTokens: params.maxTokens,
							temperature: params.temperature,
						},
					},
				);

				if (result === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (result == null) {
					throw new Error('AI request returned no result');
				}

				const response = await result.promise;
				if (response === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (response == null) {
					throw new Error('AI request produced no response');
				}

				return {
					text: response.content,
					usage: mapUsage(response),
				};
			} finally {
				params.signal?.removeEventListener('abort', abortHandler);
				cancellationSource.dispose();
			}
		},
	};
}

function mapUsage(response: AIProviderResponse<void>): AiTokenUsage | undefined {
	if (!response.usage) return undefined;
	return {
		inputTokens: response.usage.promptTokens ?? 0,
		outputTokens: response.usage.completionTokens ?? 0,
	};
}
