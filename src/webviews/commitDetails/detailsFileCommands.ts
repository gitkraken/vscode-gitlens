import type { TextDocumentShowOptions } from 'vscode';
import { env, window } from 'vscode';
import { CheckoutError } from '@gitlens/git/errors.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { basename } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CopyDeepLinkCommandArgs, CopyFileDeepLinkCommandArgs } from '../../commands/copyDeepLink.js';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import type { OpenFileOnRemoteCommandArgs } from '../../commands/openFileOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../commands/openOnRemote.js';
import type { CreatePatchCommandArgs } from '../../commands/patches.js';
import type { Container } from '../../container.js';
import type { EventBusSource } from '../../eventBus.js';
import {
	applyChanges,
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileAtRevision,
	openFileOnRemote,
	restoreFile,
} from '../../git/actions/commit.js';
import { showGitErrorMessage } from '../../messages.js';
import { executeCommand } from '../../system/-webview/command.js';
import { getContext, setContext } from '../../system/-webview/context.js';
import type { MergeEditorInputs } from '../../system/-webview/vscode/editors.js';
import { openMergeEditor } from '../../system/-webview/vscode/editors.js';
import { createCommandDecorator } from '../../system/decorators/command.js';
import type { ComparisonContext } from './commitDetailsWebview.utils.js';

const { command, getCommands } = createCommandDecorator<string>();
export { getCommands as getDetailsFileCommands };

export class DetailsFileCommands {
	constructor(
		private readonly container: Container,
		private readonly source?: EventBusSource,
	) {}

	@command('gitlens.views.openChanges:')
	@debug()
	openChanges(
		commit: GitCommit,
		file: GitFileChange,
		showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): void {
		if (comparison != null) {
			void openChanges(
				file,
				{ repoPath: commit.repoPath, lhs: comparison.sha, rhs: commit.sha },
				{ preserveFocus: true, preview: true, ...showOptions },
			);
		} else {
			void openChanges(file, commit, { preserveFocus: true, preview: true, ...showOptions });
		}
		if (this.source != null) {
			this.container.events.fire('file:selected', { uri: file.uri }, { source: this.source });
		}
	}

	@command('gitlens.views.openChangesWithWorking:')
	@debug()
	openChangesWithWorking(
		commit: GitCommit,
		file: GitFileChange,
		showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): void {
		if (comparison != null) {
			void openChangesWithWorking(
				file,
				{ repoPath: commit.repoPath, ref: comparison.sha },
				{ preserveFocus: true, preview: true, ...showOptions },
			);
		} else {
			void openChangesWithWorking(file, commit, { preserveFocus: true, preview: true, ...showOptions });
		}
	}

	@command('gitlens.views.openChangesWithMergeBase:')
	@debug()
	async openChangesWithMergeBase(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		if (comparison == null) return;

		const mergeBase = await this.container.git
			.getRepositoryService(commit.repoPath)
			.refs.getMergeBase(comparison.sha, commit.sha);
		if (mergeBase == null) return;

		void openChanges(
			file,
			{ repoPath: commit.repoPath, lhs: mergeBase, rhs: comparison.sha },
			{ preserveFocus: true, preview: true, lhsTitle: `${basename(file.path)} (Base)` },
		);
	}

	@command('gitlens.views.openPreviousChangesWithWorking:')
	@debug()
	openPreviousChangesWithWorking(
		commit: GitCommit,
		file: GitFileChange,
		showOptions?: TextDocumentShowOptions,
	): void {
		void openChangesWithWorking(
			file,
			{ repoPath: commit.repoPath, ref: commit.unresolvedPreviousSha },
			{ preserveFocus: true, preview: true, ...showOptions },
		);
		if (this.source != null) {
			this.container.events.fire('file:selected', { uri: file.uri }, { source: this.source });
		}
	}

	@command('gitlens.views.openFile:')
	@debug()
	openFile(commit: GitCommit, file: GitFileChange): void {
		void openFile(file, commit, { preserveFocus: true, preview: true });
	}

	@command('gitlens.views.openFileRevision:')
	@debug()
	openFileRevision(commit: GitCommit, file: GitFileChange): void {
		void openFileAtRevision(file, commit, { preserveFocus: true, preview: false });
	}

	@command('gitlens.openFileOnRemote:')
	@debug()
	openFileOnRemote(commit: GitCommit, file: GitFileChange): void {
		void openFileOnRemote(file, commit);
	}
	@command('gitlens.views.stageFile:')
	@debug()
	async stageFile(commit: GitCommit, file: GitFileChange): Promise<void> {
		await this.container.git.getRepositoryService(commit.repoPath).staging?.stageFile(file.uri);
	}

	@command('gitlens.views.unstageFile:')
	@debug()
	async unstageFile(commit: GitCommit, file: GitFileChange): Promise<void> {
		await this.container.git.getRepositoryService(commit.repoPath).staging?.unstageFile(file.uri);
	}
	@command('gitlens.views.applyChanges:')
	@debug()
	applyChanges(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): void {
		if (comparison != null) {
			void applyChanges(
				file,
				createReference(comparison.sha, commit.repoPath),
				createReference(commit.sha, commit.repoPath),
			);
		} else {
			void applyChanges(file, commit);
		}
	}

	@command('gitlens.restore.file:')
	@debug()
	async restoreFile(commit: GitCommit, file: GitFileChange): Promise<void> {
		if (commit.sha == null || isUncommitted(commit.sha)) return;

		try {
			await this.container.git
				.getRepositoryService(commit.repoPath)
				.ops?.checkout(commit.sha, { path: file.path });
		} catch (ex) {
			if (CheckoutError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to restore file');
			}
		}
	}

	@command('gitlens.restorePrevious.file:')
	@debug()
	restorePreviousFile(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): void {
		if (comparison != null) {
			void restoreFile(file, createReference(comparison.sha, commit.repoPath));
		} else {
			void restoreFile(file, commit, true);
		}
	}
	@command('gitlens.views.mergeChangesWithWorking:')
	@debug()
	async mergeChangesWithWorking(commit: GitCommit, file: GitFileChange): Promise<void> {
		const svc = this.container.git.getRepositoryService(commit.repoPath);
		if (svc == null) return;

		const nodeUri = await svc.getBestRevisionUri(file.path, commit.ref);
		if (nodeUri == null) return;

		const input1: MergeEditorInputs['input1'] = {
			uri: nodeUri,
			title: `Incoming`,
			detail: ` ${commit.shortSha}`,
		};

		const [mergeBaseResult, workingUriResult] = await Promise.allSettled([
			svc.refs.getMergeBase(commit.ref, 'HEAD'),
			svc.getWorkingUri(file.uri),
		]);

		const workingUri = getSettledValue(workingUriResult);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open the merge editor, no working file found');
			return;
		}
		const input2: MergeEditorInputs['input2'] = {
			uri: workingUri,
			title: 'Current',
			detail: ' Working Tree',
		};

		const headUri = await svc.getBestRevisionUri(file.path, 'HEAD');
		if (headUri != null) {
			const branch = await svc.branches.getBranch?.();

			input2.uri = headUri;
			input2.detail = ` ${branch?.name || 'HEAD'}`;
		}

		const mergeBase = getSettledValue(mergeBaseResult);
		const baseUri = mergeBase != null ? await svc.getBestRevisionUri(file.path, mergeBase) : undefined;

		return openMergeEditor({
			base: baseUri ?? nodeUri,
			input1: input1,
			input2: input2,
			output: workingUri,
		});
	}

	@command('gitlens.diffWithRevision:')
	@debug()
	diffWithRevision(commit: GitCommit, file: GitFileChange): void {
		const uri = this.getFileUri(commit, file);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevision', uri);
	}

	@command('gitlens.diffWithRevisionFrom:')
	@debug()
	diffWithRevisionFrom(commit: GitCommit, file: GitFileChange): void {
		const uri = this.getFileUri(commit, file);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevisionFrom', uri);
	}

	@command('gitlens.externalDiff:')
	@debug()
	async externalDiff(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		let ref1;
		let ref2;
		if (comparison != null) {
			ref1 = comparison.sha;
			ref2 = commit.sha;
		} else {
			const previousSha = await GitCommit.getPreviousSha(commit);
			ref1 = isUncommitted(previousSha) ? '' : previousSha;
			ref2 = commit.isUncommitted ? '' : commit.sha;
		}

		void executeCommand('gitlens.externalDiff', {
			files: [{ uri: file.uri, staged: commit.isUncommittedStaged, ref1: ref1, ref2: ref2 }],
		});
	}
	@command('gitlens.views.highlightChanges:')
	@debug()
	async highlightChanges(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: comparison?.sha ?? commit.ref },
			true,
		));
	}

	@command('gitlens.views.highlightRevisionChanges:')
	@debug()
	async highlightRevisionChanges(commit: GitCommit, file: GitFileChange): Promise<void> {
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: commit.ref, only: true },
			true,
		));
	}
	@command('gitlens.views.copy:')
	@debug()
	copy(_commit: GitCommit, file: GitFileChange): void {
		void env.clipboard.writeText(file.path);
	}

	@command('gitlens.copyRelativePathToClipboard:')
	@debug()
	copyRelativePath(commit: GitCommit, file: GitFileChange): void {
		const path = this.container.git.getRelativePath(file.uri, commit.repoPath);
		void env.clipboard.writeText(path);
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	async copyPatch(
		commit: GitCommit,
		file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		let args: CreatePatchCommandArgs;
		if (comparison != null) {
			args = {
				repoPath: commit.repoPath,
				to: commit.ref,
				from: comparison.sha,
				uris: [file.uri],
			};
		} else if (commit.isUncommitted) {
			const to = commit.isUncommittedStaged ? uncommittedStaged : uncommitted;
			args = {
				repoPath: commit.repoPath,
				to: to,
				title: to === uncommittedStaged ? 'Staged Changes' : 'Uncommitted Changes',
				uris: [file.uri],
			};
		} else {
			if (commit.message == null) {
				await GitCommit.ensureFullDetails(commit);
			}

			const { summary: title, body: description } = splitCommitMessage(commit.message);

			args = {
				repoPath: commit.repoPath,
				to: commit.ref,
				from: `${commit.ref}^`,
				title: title,
				description: description,
				uris: [file.uri],
			};
		}

		void executeCommand<CreatePatchCommandArgs>('gitlens.copyPatchToClipboard', args);
	}
	@command('gitlens.openFileHistory:')
	@debug()
	openFileHistory(_commit: GitCommit, file: GitFileChange): void {
		void executeCommand('gitlens.openFileHistory', file.uri);
	}

	@command('gitlens.quickOpenFileHistory:')
	@debug()
	quickOpenFileHistory(_commit: GitCommit, file: GitFileChange): void {
		void executeCommand('gitlens.quickOpenFileHistory', file.uri);
	}

	@command('gitlens.visualizeHistory.file:')
	@debug()
	visualizeFileHistory(_commit: GitCommit, file: GitFileChange): void {
		void executeCommand('gitlens.visualizeHistory.file', file.uri);
	}

	@command('gitlens.openFileHistoryInGraph:')
	@debug()
	openFileHistoryInGraph(_commit: GitCommit, file: GitFileChange): void {
		void executeCommand('gitlens.openFileHistoryInGraph', file.uri);
	}
	@command('gitlens.views.selectFileForCompare:')
	@debug()
	selectFileForCompare(commit: GitCommit, file: GitFileChange): void {
		const uri = this.getFileUri(commit, file);
		if (uri == null) return;

		void setContext('gitlens:views:canCompare:file', {
			ref: commit.sha ?? uncommitted,
			repoPath: commit.repoPath,
			uri: uri,
		});
	}

	@command('gitlens.views.compareFileWithSelected:')
	@debug()
	async compareFileWithSelected(commit: GitCommit, file: GitFileChange): Promise<void> {
		const selectedFile = getContext('gitlens:views:canCompare:file');
		if (selectedFile == null) return;

		void setContext('gitlens:views:canCompare:file', undefined);

		if (selectedFile.repoPath !== commit.repoPath) {
			this.selectFileForCompare(commit, file);
			return;
		}

		const uri = this.getFileUri(commit, file);
		if (uri == null) return;

		return executeCommand<DiffWithCommandArgs, void>('gitlens.diffWith', {
			repoPath: commit.repoPath,
			lhs: { sha: selectedFile.ref, uri: selectedFile.uri },
			rhs: { sha: commit.sha ?? uncommitted, uri: uri },
		});
	}
	@command('gitlens.copyDeepLinkToCommit:')
	@debug()
	copyDeepLinkToCommit(commit: GitCommit, _file: GitFileChange): void {
		void executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: commit });
	}

	@command('gitlens.copyDeepLinkToFile:')
	@debug()
	copyDeepLinkToFile(commit: GitCommit, file: GitFileChange): void {
		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFile', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
		});
	}

	@command('gitlens.copyDeepLinkToFileAtRevision:')
	@debug()
	copyDeepLinkToFileAtRevision(commit: GitCommit, file: GitFileChange): void {
		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFileAtRevision', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
			chooseRef: true,
		});
	}
	@command('gitlens.views.copyRemoteCommitUrl:')
	@debug()
	copyRemoteCommitUrl(commit: GitCommit, _file: GitFileChange): void {
		void executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: commit.repoPath,
			resource: { type: RemoteResourceType.Commit, sha: commit.ref },
			clipboard: true,
		});
	}

	@command('gitlens.copyRemoteFileUrlFrom:')
	@debug()
	copyRemoteFileUrlFrom(commit: GitCommit, _file: GitFileChange): void {
		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlFrom', {
			sha: commit.ref,
			clipboard: true,
			pickBranchOrTag: true,
			range: false,
		});
	}

	@command('gitlens.copyRemoteFileUrlWithoutRange:')
	@debug()
	copyRemoteFileUrlWithoutRange(commit: GitCommit, _file: GitFileChange): void {
		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlWithoutRange', {
			sha: commit.ref,
			clipboard: true,
			range: false,
		});
	}
	@command('gitlens.shareAsCloudPatch:')
	@debug()
	async shareAsCloudPatch(
		commit: GitCommit,
		_file: GitFileChange,
		_showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		if (comparison != null) {
			void executeCommand<CreatePatchCommandArgs>('gitlens.createCloudPatch', {
				to: commit.ref,
				from: comparison.sha,
				repoPath: commit.repoPath,
			});
		} else {
			if (commit.message == null) {
				await GitCommit.ensureFullDetails(commit);
			}

			const { summary: title, body: description } = splitCommitMessage(commit.message);

			void executeCommand<CreatePatchCommandArgs>('gitlens.createCloudPatch', {
				to: commit.ref,
				repoPath: commit.repoPath,
				title: title,
				description: description,
			});
		}
	}
	private getFileUri(commit: GitCommit, file: GitFileChange) {
		const svc = this.container.git.getRepositoryService(commit.repoPath);
		if (!isUncommitted(commit.sha)) {
			return svc.getRevisionUri(commit.sha, file.path);
		}
		return svc.getAbsoluteUri(file.path, commit.repoPath);
	}
}
