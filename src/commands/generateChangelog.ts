import type { CancellationToken, ProgressOptions, Uri } from 'vscode';
import { ProgressLocation, window, workspace } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { GitReference } from '../git/models/reference';
import { getChangesForChangelog } from '../git/utils/-webview/log.utils';
import { createRevisionRange, shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import type { AIGenerateChangelogChanges, AIResultContext } from '../plus/ai/aiProviderService';
import { getAIResultContext } from '../plus/ai/utils/-webview/ai.utils';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { command } from '../system/-webview/command';
import { setContext } from '../system/-webview/context';
import type { Deferrable } from '../system/function/debounce';
import { debounce } from '../system/function/debounce';
import type { Lazy } from '../system/lazy';
import { lazy } from '../system/lazy';
import { Logger } from '../system/logger';
import { pluralize } from '../system/string';
import { GlCommandBase } from './commandBase';

export interface GenerateChangelogCommandArgs {
	repoPath?: string;
	head?: GitReference;
	source?: Source;
}

// Storage for AI feedback context associated with changelog documents
const changelogFeedbackContexts = new Map<string, AIResultContext>();
export function getChangelogFeedbackContext(documentUri: string): AIResultContext | undefined {
	return changelogFeedbackContexts.get(documentUri);
}
function setChangelogFeedbackContext(documentUri: string, context: AIResultContext): void {
	changelogFeedbackContexts.set(documentUri, context);
}
function clearChangelogFeedbackContext(documentUri: string): void {
	changelogFeedbackContexts.delete(documentUri);
}

// Storage for changelog document URIs
const changelogUris = new Set<Uri>();
let _updateChangelogContextDebounced: Deferrable<() => void> | undefined;
function updateChangelogContext(): void {
	_updateChangelogContextDebounced ??= debounce(() => {
		void setContext('gitlens:tabs:ai:changelog', [...changelogUris]);
	}, 100);
	_updateChangelogContextDebounced();
}
function addChangelogUri(uri: Uri): void {
	changelogUris.add(uri);
	updateChangelogContext();
}
function removeChangelogUri(uri: Uri): void {
	changelogUris.delete(uri);
	updateChangelogContext();
}

@command()
export class GenerateChangelogCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.generateChangelog');
	}

	async execute(args?: GenerateChangelogCommandArgs): Promise<void> {
		try {
			const result = await showComparisonPicker(this.container, args?.repoPath, {
				head: args?.head,
				getTitleAndPlaceholder: step => {
					switch (step) {
						case 1:
							return {
								title: 'Generate Changelog',
								placeholder: 'Choose a reference (branch, tag, etc) to generate a changelog for',
							};
						case 2:
							return {
								title: `Generate Changelog \u2022 Select Base to Start From`,
								placeholder:
									'Choose a base reference (branch, tag, etc) to generate the changelog from',
							};
					}
				},
			});
			if (result == null) return;

			const svc = this.container.git.getRepositoryService(result.repoPath);

			const mergeBase = await svc.refs.getMergeBase(result.head.ref, result.base.ref);

			await generateChangelogAndOpenMarkdownDocument(
				this.container,
				lazy(async () => {
					const range: AIGenerateChangelogChanges['range'] = {
						base: mergeBase
							? {
									ref: mergeBase,
									label:
										mergeBase === result.base.ref
											? `\`${shortenRevision(mergeBase)}\``
											: `\`${result.base.ref}@${shortenRevision(mergeBase)}\``,
								}
							: { ref: result.base.ref, label: `\`${result.base.ref}\`` },
						head: { ref: result.head.ref, label: `\`${result.head.ref}\`` },
					};

					const log = await svc.commits.getLog(
						createRevisionRange(mergeBase ?? result.base.ref, result.head.ref, '..'),
					);
					if (!log?.commits?.size) return { changes: [], range: range };

					const changes = getChangesForChangelog(this.container, range, log);
					return changes;
				}),
				args?.source ?? { source: 'commandPalette' },
				{ progress: { location: ProgressLocation.Notification } },
			);
		} catch (ex) {
			Logger.error(ex, 'GenerateChangelogCommand', 'execute');
			void showGenericErrorMessage('Unable to generate changelog');
		}
	}
}

export async function generateChangelogAndOpenMarkdownDocument(
	container: Container,
	changes: Lazy<Promise<AIGenerateChangelogChanges>>,
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<void> {
	const result = await container.ai.generateChangelog(changes, source, options);

	if (result === 'cancelled') return;

	const { range, changes: { length: count } = [] } = await changes.value;
	const feedbackContext = result && getAIResultContext(result);

	let content = `# Changelog for ${range.head.label ?? range.head.ref}\n`;
	if (result != null) {
		content += `> Generated by ${result.model.name} from ${pluralize('commit', count)} between ${
			range.head.label ?? range.head.ref
		} and ${range.base.label ?? range.base.ref}\n`;

		// Add feedback note if telemetry is enabled
		if (feedbackContext && container.telemetry.enabled) {
			content += '\n\n';
			content += 'Use the 👍 and 👎 buttons in the editor toolbar to provide feedback on this AI response. ';
			content += '*Your feedback helps us improve our AI features.*';
		}

		content += `\n\n----\n\n${result.content}\n`;
	} else {
		content += `> No changes found between ${range.head.label ?? range.head.ref} and ${
			range.base.label ?? range.base.ref
		}\n`;
	}

	// open an untitled editor
	const document = await workspace.openTextDocument({ language: 'markdown', content: content });
	if (feedbackContext) {
		// Store feedback context for this document
		setChangelogFeedbackContext(document.uri.toString(), feedbackContext);
		// Add to changelog URIs context even for no-results documents
		addChangelogUri(document.uri);
		// Clean up context when document is closed
		const disposable = workspace.onDidCloseTextDocument(closedDoc => {
			if (closedDoc.uri.toString() === document.uri.toString()) {
				clearChangelogFeedbackContext(document.uri.toString());
				removeChangelogUri(document.uri);
				disposable.dispose();
			}
		});
	}
	await window.showTextDocument(document);
}
