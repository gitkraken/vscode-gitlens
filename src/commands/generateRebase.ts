import type { CancellationToken, ProgressOptions } from 'vscode';
import { ProgressLocation, window, workspace } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { GitReference } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';

export interface GenerateRebaseCommandArgs {
	repoPath?: string;
	head?: GitReference;
	base?: GitReference;
	source?: Source;
}

interface CommitHunk {
	hunk: number;
}

interface ReorganizedCommit {
	message: string;
	explanation: string;
	hunks: CommitHunk[];
}

@command()
export class GenerateChangelogCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.generateRebase');
	}

	async execute(args?: GenerateRebaseCommandArgs): Promise<void> {
		try {
			const result = await showComparisonPicker(this.container, args?.repoPath, {
				head: args?.head,
				base: args?.base,
				getTitleAndPlaceholder: step => {
					switch (step) {
						case 1:
							return {
								title: 'Rebase with AI',
								placeholder: 'Choose a reference (branch, tag, etc) to rebase',
							};
						case 2:
							return {
								title: `Rebase with AI \u2022 Select Base to Start From`,
								placeholder: 'Choose a base reference (branch, tag, etc) to rebase from',
							};
					}
				},
			});
			if (result == null) return;

			const mergeBase = await this.container.git
				.refs(result.repoPath)
				.getMergeBase(result.head.ref, result.base.ref);

			const repo = this.container.git.getRepository(result.repoPath)!;

			await generateRebase(
				this.container,
				repo,
				result.head,
				mergeBase ? createReference(mergeBase, result.repoPath, { refType: 'revision' }) : result.base,
				args?.source ?? { source: 'commandPalette' },
				{ progress: { location: ProgressLocation.Notification } },
			);
		} catch (ex) {
			Logger.error(ex, 'GenerateRebaseCommand', 'execute');
			void showGenericErrorMessage('Unable to generate rebase');
		}
	}
}

export async function generateRebase(
	container: Container,
	repo: Repository,
	head: GitReference,
	base: GitReference,
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<void> {
	const result = await container.ai.generateRebase(repo, base.ref, head.ref, source, options);
	if (result == null) return;

	// if it is wrapped in markdown, we need to strip it
	const content = result.content.replace(/^\s*```json\s*/, '').replace(/\s*```$/, '');

	try {
		// Parse the JSON content from the result
		const commits = JSON.parse(content) as ReorganizedCommit[];

		// Generate the markdown content that shows each commit and its diffs
		const markdownContent = generateRebaseMarkdown(commits, result.diff, result.hunkMap);

		// open an untitled editor with the markdown content
		const document = await workspace.openTextDocument({ language: 'markdown', content: markdownContent });
		await window.showTextDocument(document);
	} catch (ex) {
		Logger.error(ex, 'GenerateRebaseCommand', 'execute');
		void showGenericErrorMessage('Unable to parse rebase result');
	}
}

/**
 * Formats the reorganized commits into a readable markdown document with proper git diff format
 */
function generateRebaseMarkdown(
	commits: ReorganizedCommit[],
	originalDiff: string,
	hunkMap: { index: number; hunkHeader: string }[],
): string {
	let markdown = `# Rebase Commits\n\n`;

	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];

		markdown += `## Commit ${i + 1}: ${commit.message}\n\n`;
		markdown += `### Explanation\n${commit.explanation}\n\n`;
		markdown += `### Changes\n`;

		// Group hunks by file (diff header)
		const fileHunks = new Map<string, string[]>();
		for (const { hunk: hunkIndex } of commit.hunks) {
			if (hunkIndex < 1 || hunkIndex > hunkMap.length) continue;
			const matchingHunk = hunkMap[hunkIndex - 1];
			// find the index of the hunk header in the original diff
			const hunkHeaderIndex = originalDiff.indexOf(matchingHunk.hunkHeader);
			// extract the matching file diff header from the original diff, which is the last line in the diff starting with 'diff --git' before the hunk header. Use a regex to get the single diff header line out
			const diffHeader = originalDiff
				.substring(0, hunkHeaderIndex)
				.split('\n')
				.reverse()
				.find(line => line.startsWith('diff --git'));
			if (diffHeader == null) continue;
			if (!fileHunks.has(diffHeader)) {
				fileHunks.set(diffHeader, []);
			}
			fileHunks.get(diffHeader)!.push(matchingHunk.hunkHeader);
		}

		// Output each file with its hunks in git patch format
		for (const [diffHeader, hunkHeaders] of fileHunks.entries()) {
			markdown += '```diff\n';
			markdown += `${diffHeader}\n`;

			// Extract and include the actual content for each hunk from the original diff
			for (const hunkHeader of hunkHeaders) {
				markdown += `${hunkHeader}\n`;
				// Find the hunk content in the original diff
				const hunkContent = extractHunkContent(originalDiff, diffHeader, hunkHeader);
				if (hunkContent) {
					markdown += `${hunkContent}\n`;
				} else {
					markdown += `Unable to extract hunk content for ${hunkHeader}\n`;
				}
			}

			markdown += '```\n\n';
		}
	}

	markdown += `\n\n----\n\n## Original Diff\n\n\`\`\`${originalDiff}\`\`\`\n`;

	return markdown;
}

/**
 * Extracts the content of a specific hunk from the original diff
 */
function extractHunkContent(originalDiff: string, diffHeader: string, hunkHeader: string): string | null {
	// Find the file section in the original diff
	const diffIndex = originalDiff.indexOf(diffHeader);
	if (diffIndex === -1) {
		debugger;
		return null;
	}

	// Find the file section end
	const nextDiffIndex = originalDiff.indexOf('diff --git', diffIndex + 1);

	// Find the hunk within the file content
	let hunkIndex = originalDiff.indexOf(hunkHeader, diffIndex);
	if (hunkIndex === -1) {
		const newHunkHeader = hunkHeader.replace(/^@@ -\d+?,\d+? \+\d+?,\d+? @@/, ' @@');
		hunkIndex = originalDiff.indexOf(newHunkHeader, diffIndex);
	}

	if (hunkIndex === -1 || (nextDiffIndex !== -1 && hunkIndex > nextDiffIndex)) {
		debugger;

		return null;
	}

	const nextHunkIndex = originalDiff.indexOf('@@ -', hunkIndex + 1);
	const nextIndex =
		nextHunkIndex !== -1 && nextHunkIndex < nextDiffIndex
			? nextHunkIndex - 1
			: nextDiffIndex > 0
			  ? nextDiffIndex - 1
			  : undefined;

	// Extract the content lines (excluding the hunk header)
	return originalDiff.substring(hunkIndex, nextIndex);
}
