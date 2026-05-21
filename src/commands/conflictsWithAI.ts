import type { TextEditor } from 'vscode';
import { ProgressLocation, Uri, window } from 'vscode';
import { createConflictToolsIntegration } from '@env/coretools/conflict.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { stageConflictResolution } from '../git/utils/-webview/conflictResolution.utils.js';
import { showGitErrorMessage } from '../messages.js';
import type { ConflictProgressEvent } from '../plus/coretools/conflict/types.js';
import { command, executeCoreCommand } from '../system/-webview/command.js';
import { ActiveEditorCommand, GlCommandBase } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';

@command()
export class ResolveConflictWithAICommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.conflicts.resolveWithAI', 'gitlens.conflicts.resolveWithAI:webview']);
	}

	async execute(editor?: TextEditor, uriArg?: Uri | unknown): Promise<void> {
		let uri = getCommandUri(uriArg as Uri | undefined, editor);
		if (uri == null) {
			// Webview context-menu invocation: arg is the typed DetailsItemTypedContext shape.
			const ctx = uriArg as
				| {
						webviewItemValue?: { type?: string; path?: string; repoPath?: string };
				  }
				| undefined;
			const value = ctx?.webviewItemValue;
			if (value?.type === 'file' && value.path && value.repoPath) {
				uri = Uri.joinPath(Uri.file(value.repoPath), value.path);
			}
		}

		if (uri == null) {
			void window.showWarningMessage('No file is currently active to resolve with AI.');
			return;
		}

		this.container.mergeConflictEditor.queueAIResolve(uri);
		await executeCoreCommand('vscode.openWith', uri, 'gitlens.mergeConflict');
	}
}

@command()
export class AutoResolveAllConflictsWithAICommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.conflicts.autoResolveAllWithAI']);
	}

	async execute(repoPath?: string): Promise<void> {
		const integration = createConflictToolsIntegration(this.container);
		if (integration == null) {
			void window.showWarningMessage('AI-assisted conflict resolution is unavailable in this environment.');
			return;
		}

		// Default to the active editor's repo when no explicit arg is supplied (command palette path).
		if (repoPath == null) {
			const activeUri = window.activeTextEditor?.document.uri;
			if (activeUri != null) {
				repoPath = this.container.git.getRepository(activeUri)?.path;
			}
		}
		if (repoPath == null) {
			void window.showWarningMessage('No repository context for Auto-Resolve All with AI.');
			return;
		}

		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.pausedOps?.getPausedOperationStatus?.();
		if (status == null) {
			void window.showInformationMessage(
				'No paused merge, rebase, or cherry-pick was detected for this repository.',
			);
			return;
		}

		const refs = {
			ours: status.HEAD?.ref ?? 'HEAD',
			theirs: status.incoming?.ref ?? 'MERGE_HEAD',
			...(status.mergeBase != null ? { base: status.mergeBase } : {}),
		};

		const abort = new AbortController();
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				cancellable: true,
				title: 'Auto-Resolving conflicts with AI…',
			},
			async (progress, token) => {
				token.onCancellationRequested(() => abort.abort());

				let currentFile: string | undefined;
				const onProgress = (event: ConflictProgressEvent) => {
					switch (event.type) {
						case 'conflict:found':
							currentFile = event.filePath;
							progress.report({ message: `Resolving ${event.filePath}…` });
							break;
						case 'resolution:applied':
							progress.report({ message: `Resolved ${event.filePath} (${event.strategy}).` });
							break;
						case 'resolution:failed':
							progress.report({ message: `Failed to resolve ${event.filePath} — will skip.` });
							break;
						case 'resolver:tool-call':
							if (currentFile != null) {
								progress.report({ message: `${currentFile}: inspecting ${event.tool}…` });
							}
							break;
					}
				};

				try {
					const result = await integration.resolveBatch(
						{
							svc: svc,
							context: { refs: refs },
							signal: abort.signal,
							onProgress: onProgress,
							// No fallback — failed files are surfaced for manual handling.
							config: { defaultStrategy: 'ai' },
						},
						{ source: 'mergeConflictEditor', detail: 'autoResolveAll' },
					);

					if (abort.signal.aborted) return;

					if (result.resolutions.length > 0) {
						await integration.applyBatch({ svc: svc, resolutions: result.resolutions });
						// applyResolutions writes and stages via the port — but for any 'merged' results
						// we want the file staged in the index so `git status` reflects resolved state.
						// Library does stage via stageFiles, this is belt+suspenders for non-text cases.
						for (const r of result.resolutions) {
							try {
								await stageConflictResolution(
									this.container,
									{ path: r.filePath, repoPath: repoPath, status: 'UU' },
									r.strategy === 'take-theirs' ? 'incoming' : 'current',
								).catch(() => {
									/* library may have already staged */
								});
							} catch {
								/* ignore — staging is best-effort here */
							}
						}
					}

					const succeeded = result.resolutions.length;
					const failed = result.errors?.length ?? 0;
					if (failed > 0) {
						const message = `Auto-Resolve completed: ${succeeded} resolved, ${failed} remaining for manual handling.`;
						const failedFiles = result.errors?.map(e => e.filePath).join(', ') ?? '';
						void window.showWarningMessage(`${message}\n${failedFiles}`);
					} else if (succeeded > 0) {
						void window.showInformationMessage(`Auto-Resolve completed: ${succeeded} file(s) resolved.`);
					} else {
						void window.showInformationMessage('No conflicts were resolved.');
					}
				} catch (ex) {
					if (abort.signal.aborted) return;
					Logger.error(ex, 'AutoResolveAllConflictsWithAICommand', 'Batch resolve failed');
					void showGitErrorMessage(ex);
				}
			},
		);
	}
}
