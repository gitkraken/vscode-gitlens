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
import type { ShowQuickFileHistoryCommandArgs } from '../../commands/showQuickFileHistory.js';
import type { Container } from '../../container.js';
import type { EventBusSource } from '../../eventBus.js';
import {
	applyChanges,
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileAtRevision,
	openFileOnRemote,
	openWipChanges,
	restoreFile,
} from '../../git/actions/commit.js';
import * as StashActions from '../../git/actions/stash.js';
import { getReachableWorktrees } from '../../git/utils/-webview/worktree.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { showWorktreePicker } from '../../quickpicks/worktreePicker.js';
import { executeCommand } from '../../system/-webview/command.js';
import { getContext, setContext } from '../../system/-webview/context.js';
import type { MergeEditorInputs } from '../../system/-webview/vscode/editors.js';
import { openMergeEditor } from '../../system/-webview/vscode/editors.js';
import { createCommandDecorator } from '../../system/decorators/command.js';
import { FilesService } from '../rpc/services/files.js';
import { RepositoryService } from '../rpc/services/repository.js';
import type { OpenMultipleChangesArgs } from '../rpc/services/types.js';
import type { ComparisonContext, ResolvedDetailsFile } from './commitDetailsWebview.utils.js';

const { command, getCommands } = createCommandDecorator<string>();
const { command: multiCommand, getCommands: getMultiCommands } = createCommandDecorator<string>();
export { getCommands as getDetailsFileCommands, getMultiCommands as getDetailsFileMultiCommands };

export class DetailsFileCommands {
	// Reuse the WIP discard service (its confirm + trash + restore core) so the context-menu Discard
	// goes through the exact same code path as the inline button and the bulk toolbar — no forked or
	// duplicated discard logic that could drift. The discard methods are self-contained (container +
	// VS Code APIs only), so a standalone instance is safe; the git change it makes is picked up by
	// the webview's own repo-change watcher, which refreshes the tree.
	private readonly _repository: RepositoryService;
	// Standalone FilesService for the context-menu "Open Selected Changes" — its `openMultipleChanges`
	// is the same host entry point the header action uses (one shared multi-diff path).
	private readonly _files: FilesService;

	constructor(
		private readonly container: Container,
		private readonly source?: EventBusSource,
	) {
		this._repository = new RepositoryService(container, undefined);
		this._files = new FilesService(container);
	}

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
		} else if (commit.isUncommitted) {
			// WIP file context: route through openWipChanges so the diff uses SCM-compatible
			// (git: scheme) URIs for the index side, letting VS Code's gutter "Stage Hunk" /
			// "Unstage Hunk" and SCM diff toolbar actions work in the opened editor.
			void openWipChanges(file, commit.repoPath, { preserveFocus: true, preview: true, ...showOptions });
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
		} else if (commit.isUncommitted) {
			// WIP file context: route through openWipChanges so the diff uses SCM-compatible
			// (git: scheme) URIs for the index side, letting VS Code's gutter "Stage Hunk" /
			// "Unstage Hunk" and SCM diff toolbar actions work in the opened editor.
			void openWipChanges(file, commit.repoPath, { preserveFocus: true, preview: true, ...showOptions });
		} else {
			void openChangesWithWorking(file, commit, { preserveFocus: true, preview: true, ...showOptions });
		}
	}

	@command('gitlens.views.openChangesWithMergeBase:')
	@debug()
	async openChangesWithMergeBase(
		commit: GitCommit,
		file: GitFileChange,
		showOptions?: TextDocumentShowOptions,
		comparison?: ComparisonContext,
	): Promise<void> {
		if (comparison == null) return;

		const mergeBase = await this.container.git
			.getRepositoryService(commit.repoPath)
			.refs.getMergeBase(comparison.sha, commit.sha);
		if (mergeBase == null) return;

		// `comparison.sha` is the lhs (Base / older / "from") per the file-context convention; the
		// rhs we want to anchor to is the commit being inspected (`commit.sha`), so this shows the
		// diff from the merge base to the Compare side — matching PR-review semantics ("what does
		// this branch add since divergence").
		void openChanges(
			file,
			{ repoPath: commit.repoPath, lhs: mergeBase, rhs: commit.sha },
			{ preserveFocus: true, preview: true, ...showOptions, lhsTitle: `${basename(file.path)} (Base)` },
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
	openFile(commit: GitCommit, file: GitFileChange, showOptions?: TextDocumentShowOptions): void {
		void openFile(file, commit, { preserveFocus: true, preview: true, ...showOptions });
	}

	@command('gitlens.openWorktreeFile:')
	@debug()
	async openWorktreeFile(
		commit: GitCommit,
		file: GitFileChange,
		showOptions?: TextDocumentShowOptions,
	): Promise<void> {
		const worktrees = await getReachableWorktrees(this.container, commit.repoPath, commit.sha);
		if (!worktrees.length) return;

		let worktree = worktrees[0];
		if (worktrees.length > 1) {
			const picked = await showWorktreePicker(
				'Open Worktree File',
				`Choose which worktree to open ${basename(file.path)} from`,
				worktrees,
			);
			if (picked == null) return;

			worktree = picked;
		}

		// Reuse "Open File", but root the working-file lookup at the worktree path: passing the sha
		// makes `gitlens.openWorkingFile` resolve the working copy inside the worktree's folder.
		void openFile(
			file,
			createReference(commit.sha, worktree.path, { refType: 'revision', name: commit.shortSha }),
			{
				preserveFocus: true,
				preview: true,
				...showOptions,
			},
		);
	}

	@command('gitlens.views.openFileRevision:')
	@debug()
	openFileRevision(commit: GitCommit, file: GitFileChange, showOptions?: TextDocumentShowOptions): void {
		void openFileAtRevision(file, commit, { preserveFocus: true, preview: false, ...showOptions });
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

	@command('gitlens.discardChanges:')
	@debug()
	discardChanges(_commit: GitCommit, file: GitFileChange): void {
		// Shared discard path (confirm + trash + restore). It surfaces its own errors, so swallow the
		// rethrow it does for the RPC caller's error signal (there's no signal on the command path).
		void this._repository.discardFile(file).catch(() => undefined);
	}

	@command('gitlens.stashChanges:')
	@debug()
	async stashChanges(_commit: GitCommit, file: GitFileChange): Promise<void> {
		// `includeUntracked` so an untracked selected file is stashed too; the stash wizard confirms.
		await StashActions.push(file.repoPath, [file.uri], undefined, true);
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
			await this.container.git.getRepositoryService(commit.repoPath).ops?.restore(file.path, { ref: commit.sha });
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
	@command('gitlens.copyPath:')
	@debug()
	copyPath(_commit: GitCommit, file: GitFileChange): void {
		// Absolute path (`file.path` is repo-relative — that's what Copy Relative Path copies).
		void env.clipboard.writeText(this.container.git.getAbsoluteUri(file.path, file.repoPath).fsPath);
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
	openFileHistory(commit: GitCommit, file: GitFileChange): void {
		// Skip the reference for uncommitted (no commit to select) and for stashes (file history view
		// doesn't include stash commits, so the sha would never resolve to a visible row).
		const args: ShowQuickFileHistoryCommandArgs | undefined =
			isUncommitted(commit.sha) || GitCommit.isStash(commit)
				? undefined
				: { reference: createReference(commit.sha, commit.repoPath, { refType: 'revision' }) };
		void executeCommand('gitlens.openFileHistory', file.uri, args);
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
	openFileHistoryInGraph(commit: GitCommit, file: GitFileChange): void {
		// Skip the selection for uncommitted and stashes; the graph doesn't surface either by default,
		// so the sha would never resolve to a visible row.
		const selectSha = isUncommitted(commit.sha) || GitCommit.isStash(commit) ? undefined : commit.sha;
		void executeCommand('gitlens.openFileHistoryInGraph', file.uri, selectSha);
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
	// --- Multi-file actions (right-clicking a multi-selection). Each receives the selected files
	// resolved from `webviewItemsValues`; the host registration loop does the resolution. ---

	@multiCommand('gitlens.copyPath.multi:')
	@debug()
	copyPathMulti(items: ResolvedDetailsFile[]): void {
		if (!items.length) return;

		// Absolute paths (Copy Relative Paths copies the repo-relative `file.path`).
		void env.clipboard.writeText(
			items.map(i => this.container.git.getAbsoluteUri(i.file.path, i.commit.repoPath).fsPath).join('\n'),
		);
	}

	@multiCommand('gitlens.copyRelativePathToClipboard.multi:')
	@debug()
	copyRelativePathMulti(items: ResolvedDetailsFile[]): void {
		if (!items.length) return;

		const paths = items.map(i => this.container.git.getRelativePath(i.file.uri, i.commit.repoPath));
		void env.clipboard.writeText(paths.join('\n'));
	}

	@multiCommand('gitlens.views.openFile.multi:')
	@debug()
	openFilesMulti(items: ResolvedDetailsFile[]): void {
		for (const { commit, file } of items) {
			void openFile(file, commit, { preserveFocus: true, preview: false });
		}
	}

	@multiCommand('gitlens.openFileOnRemote.multi:')
	@debug()
	openFilesOnRemoteMulti(items: ResolvedDetailsFile[]): void {
		for (const { commit, file } of items) {
			void openFileOnRemote(file, commit);
		}
	}

	@multiCommand('gitlens.views.stageFile.multi:')
	@debug()
	async stageFilesMulti(items: ResolvedDetailsFile[]): Promise<void> {
		// A heterogeneous selection (the menu shows if ANY file is unstaged) — stage only the unstaged
		// ones, so already-staged files no-op and conflicted/committed rows aren't touched.
		const files = items.filter(i => i.webviewItem?.includes('+unstaged'));
		if (!files.length) return;

		// All rows in a file tree share a repo; stage them in one git op.
		const svc = this.container.git.getRepositoryService(files[0].commit.repoPath);
		await svc.staging?.stageFiles(files.map(i => i.file.uri));
	}

	@multiCommand('gitlens.views.unstageFile.multi:')
	@debug()
	async unstageFilesMulti(items: ResolvedDetailsFile[]): Promise<void> {
		// Mirror of stage: unstage only the `+staged` files in the selection.
		const files = items.filter(i => i.webviewItem?.includes('+staged'));
		if (!files.length) return;

		const svc = this.container.git.getRepositoryService(files[0].commit.repoPath);
		await svc.staging?.unstageFiles(files.map(i => i.file.uri));
	}

	@multiCommand('gitlens.discardChanges.multi:')
	@debug()
	discardChangesMulti(items: ResolvedDetailsFile[]): void {
		if (!items.length) return;

		// One combined confirm + atomic-per-file discard via the shared service (same path as the inline
		// batch discard); swallow its rethrow (errors are surfaced inside).
		void this._repository.discardFiles(items.map(i => i.file)).catch(() => undefined);
	}

	@multiCommand('gitlens.stashChanges.multi:')
	@debug()
	async stashChangesMulti(items: ResolvedDetailsFile[]): Promise<void> {
		// Union-gated (shows if any file is stashable) — stash only the WIP files, excluding conflicts
		// (stash is unreliable mid-merge) and committed rows.
		const files = items.filter(i => i.webviewItem?.includes('+staged') || i.webviewItem?.includes('+unstaged'));
		if (!files.length) return;

		await StashActions.push(
			files[0].file.repoPath,
			files.map(i => i.file.uri),
			undefined,
			true,
		);
	}

	@multiCommand('gitlens.openSelectedChanges.multi:')
	@debug()
	async openSelectedChangesMulti(items: ResolvedDetailsFile[]): Promise<void> {
		if (!items.length) return;

		// Open the selection in the native multi-diff editor via the same host entry point as the header
		// "Open Selected Changes" action. Derive the diff refs from the resolved anchor (mirrors the
		// panels' `getMultiDiffRefs`): WIP → per-file HEAD↔index↔working; comparison → base↔to; a normal
		// commit → its own changes (parent↔commit).
		const { commit, comparison } = items[0];
		const files = items.map(i => i.file);

		let args: OpenMultipleChangesArgs;
		if (commit.isUncommitted) {
			args = {
				files: files,
				repoPath: commit.repoPath,
				lhs: 'HEAD',
				rhs: '',
				wip: true,
				title: 'Working Changes',
			};
		} else if (comparison != null) {
			args = { files: files, repoPath: commit.repoPath, lhs: comparison.sha, rhs: commit.sha };
		} else {
			args = {
				files: files,
				repoPath: commit.repoPath,
				lhs: commit.parents[0] ?? '',
				rhs: commit.sha,
				title: `Changes in ${commit.shortSha}`,
			};
		}
		await this._files.openMultipleChanges(args);
	}

	private getFileUri(commit: GitCommit, file: GitFileChange) {
		const svc = this.container.git.getRepositoryService(commit.repoPath);
		if (!isUncommitted(commit.sha)) {
			return svc.getRevisionUri(commit.sha, file.path);
		}
		return svc.getAbsoluteUri(file.path, commit.repoPath);
	}
}
