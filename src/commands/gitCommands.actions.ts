import { env, Range, TextDocumentShowOptions, Uri, window } from 'vscode';
import {
	BrowseRepoAtRevisionCommandArgs,
	Commands,
	DiffWithCommandArgs,
	DiffWithWorkingCommandArgs,
	executeCommand,
	executeEditorCommand,
	findOrOpenEditor,
	GitCommandsCommandArgs,
	OpenWorkingFileCommandArgs,
} from '../commands';
import { Container } from '../container';
import {
	GitBranchReference,
	GitContributor,
	GitFile,
	GitLogCommit,
	GitReference,
	GitRevision,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
	Repository,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import { FileAnnotationType } from '../configuration';

export async function executeGitCommand(args: GitCommandsCommandArgs): Promise<void> {
	void (await executeCommand<GitCommandsCommandArgs>(Commands.GitCommands, args));
}

async function ensureRepo(repo: string | Repository): Promise<Repository> {
	return typeof repo === 'string' ? (await Container.git.getRepository(repo))! : repo;
}

export namespace GitActions {
	export async function browseAtRevision(uri: Uri, options?: { openInNewWindow?: boolean }) {
		void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>(Commands.BrowseRepoAtRevision, undefined, {
			uri: uri,
			openInNewWindow: options?.openInNewWindow,
		}));
	}

	export async function cherryPick(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
		return executeGitCommand({
			command: 'cherry-pick',
			state: { repo: repo, references: refs },
		});
	}

	export function fetch(repos?: string | string[] | Repository | Repository[]) {
		return executeGitCommand({ command: 'fetch', state: { repos: repos } });
	}

	export async function merge(repo?: string | Repository, ref?: GitReference) {
		return executeGitCommand({ command: 'merge', state: { repo: repo, reference: ref } });
	}

	export function pull(repos?: string | string[] | Repository | Repository[]) {
		return executeGitCommand({ command: 'pull', state: { repos: repos } });
	}

	export function push(repos?: string | string[] | Repository | Repository[], force?: boolean) {
		return executeGitCommand({ command: 'push', state: { repos: repos, flags: force ? ['--force'] : [] } });
	}

	export async function rebase(repo?: string | Repository, ref?: GitReference, interactive: boolean = true) {
		return executeGitCommand({
			command: 'rebase',
			state: { repo: repo, reference: ref, flags: interactive ? ['--interactive'] : [] },
		});
	}

	export async function reset(repo?: string | Repository, ref?: GitRevisionReference) {
		return executeGitCommand({
			command: 'reset',
			state: { repo: repo, reference: ref },
		});
	}

	export async function revert(repo?: string | Repository, refs?: GitRevisionReference | GitRevisionReference[]) {
		return executeGitCommand({
			command: 'revert',
			state: { repo: repo, references: refs },
		});
	}

	export async function switchTo(repos?: string | string[] | Repository | Repository[], ref?: GitReference) {
		return executeGitCommand({
			command: 'switch',
			state: { repos: repos, reference: ref },
		});
	}

	// 	@debug()
	// 	private async highlightChanges(node: CommitFileNode | ResultsFileNode | StashFileNode) {
	// 		if (
	// 			!(node instanceof CommitFileNode) &&
	// 			!(node instanceof StashFileNode) &&
	// 			!(node instanceof ResultsFileNode)
	// 		) {
	// 			return;
	// 		}

	// 		void (await this.openFile(node));
	// 		void (await Container.fileAnnotations.toggle(
	// 			window.activeTextEditor,
	// 			FileAnnotationType.RecentChanges,
	// 			node.ref,
	// 			true,
	// 		));
	// 	}

	// 	@debug()
	// 	private async highlightRevisionChanges(node: CommitFileNode | ResultsFileNode | StashFileNode) {
	// 		if (
	// 			!(node instanceof CommitFileNode) &&
	// 			!(node instanceof StashFileNode) &&
	// 			!(node instanceof ResultsFileNode)
	// 		) {
	// 			return;
	// 		}

	// 		void (await this.openFileRevision(node, { showOptions: { preserveFocus: true, preview: true } }));
	// 		void (await Container.fileAnnotations.toggle(
	// 			window.activeTextEditor,
	// 			FileAnnotationType.RecentChanges,
	// 			node.ref,
	// 			true,
	// 		));
	// 	}

	// 	@debug()
	// 	private openInTerminal(node: RepositoryNode) {
	// 		if (!(node instanceof RepositoryNode)) return undefined;

	// 		return commands.executeCommand(BuiltInCommands.OpenInTerminal, Uri.file(node.repo.path));
	// 	}

	// 	@debug()
	// 	private async rebaseToRemote(node: BranchNode | BranchTrackingStatusNode) {
	// 		if (!(node instanceof BranchNode) && !(node instanceof BranchTrackingStatusNode)) return undefined;

	// 		const upstream = node instanceof BranchNode ? node.branch.tracking : node.status.upstream;
	// 		if (upstream == null) return undefined;

	// 		const repo = await Container.git.getRepository(node.repoPath);

	// 		const args: GitCommandsCommandArgs = {
	// 			command: 'rebase',
	// 			state: {
	// 				repo: repo!,
	// 				reference: GitReference.create(upstream, repo!.path, {
	// 					refType: 'branch',
	// 					name: upstream,
	// 					remote: true,
	// 				}),
	// 			},
	// 		};
	// 		return commands.executeCommand(Commands.GitCommands, args);
	// 	}

	// 	@debug()
	// 	private setAsDefault(node: RemoteNode) {
	// 		if (node instanceof RemoteNode) return node.setAsDefault();
	// 		return undefined;
	// 	}

	// 	@debug()
	// 	private setComparisonNotation(node: ViewNode, comparisonNotation: '...' | '..') {
	// 		if (!(node instanceof CompareResultsNode) && !(node instanceof CompareBranchNode)) return undefined;

	// 		return node.setComparisonNotation(comparisonNotation);
	// 	}

	// 	@debug()
	// 	private async stageFile(node: CommitFileNode | StatusFileNode) {
	// 		if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

	// 		void (await Container.git.stageFile(node.repoPath, node.file.fileName));
	// 		void node.triggerChange();
	// 	}

	// 	@debug()
	// 	private async stageDirectory(node: FolderNode) {
	// 		if (!(node instanceof FolderNode) || !node.relativePath) return;

	// 		void (await Container.git.stageDirectory(node.repoPath, node.relativePath));
	// 		void node.triggerChange();
	// 	}

	// 	@debug()
	// 	private star(node: BranchNode | RepositoryNode) {
	// 		if (node instanceof BranchNode || node instanceof RepositoryNode) return node.star();
	// 		return undefined;
	// 	}

	// 	@debug()
	// 	private unsetAsDefault(node: RemoteNode) {
	// 		if (node instanceof RemoteNode) return node.setAsDefault(false);
	// 		return undefined;
	// 	}

	// 	@debug()
	// 	private async unstageFile(node: CommitFileNode | StatusFileNode) {
	// 		if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

	// 		void (await Container.git.unStageFile(node.repoPath, node.file.fileName));
	// 		void node.triggerChange();
	// 	}

	// 	@debug()
	// 	private async unstageDirectory(node: FolderNode) {
	// 		if (!(node instanceof FolderNode) || !node.relativePath) return;

	// 		void (await Container.git.unStageDirectory(node.repoPath, node.relativePath));
	// 		void node.triggerChange();
	// 	}

	// 	@debug()
	// 	private unstar(node: BranchNode | RepositoryNode) {
	// 		if (node instanceof BranchNode || node instanceof RepositoryNode) return node.unstar();
	// 		return undefined;
	// 	}

	// 	@debug()
	// 	private compareWithHead(node: ViewRefNode) {
	// 		if (!(node instanceof ViewRefNode)) return undefined;

	// 		return Container.compareView.compare(node.repoPath, node.ref, 'HEAD');
	// 	}

	// 	@debug()
	// 	private compareWithRemote(node: BranchNode) {
	// 		if (!(node instanceof BranchNode)) return undefined;
	// 		if (!node.branch.tracking) return undefined;

	// 		return Container.compareView.compare(node.repoPath, node.branch.tracking, node.ref);
	// 	}

	// 	@debug()
	// 	private compareWithWorking(node: ViewRefNode) {
	// 		if (!(node instanceof ViewRefNode)) return undefined;

	// 		return Container.compareView.compare(node.repoPath, node.ref, '');
	// 	}

	// 	@debug()
	// 	private async compareAncestryWithWorking(node: BranchNode) {
	// 		if (!(node instanceof BranchNode)) return undefined;

	// 		const branch = await Container.git.getBranch(node.repoPath);
	// 		if (branch == null) return undefined;

	// 		const commonAncestor = await Container.git.getMergeBase(node.repoPath, branch.ref, node.ref);
	// 		if (commonAncestor == null) return undefined;

	// 		return Container.compareView.compare(
	// 			node.repoPath,
	// 			{ ref: commonAncestor, label: `ancestry with ${node.ref} (${GitRevision.shorten(commonAncestor)})` },
	// 			'',
	// 		);
	// 	}

	// 	@debug()
	// 	private compareWithSelected(node: ViewRefNode) {
	// 		if (!(node instanceof ViewRefNode)) return;

	// 		Container.compareView.compareWithSelected(node.repoPath, node.ref);
	// 	}

	// 	@debug()
	// 	private selectForCompare(node: ViewRefNode) {
	// 		if (!(node instanceof ViewRefNode)) return;

	// 		Container.compareView.selectForCompare(node.repoPath, node.ref);
	// 	}

	// 	@debug()
	// 	private compareFileWithSelected(node: ViewRefFileNode) {
	// 		if (this._selectedFile == null || !(node instanceof ViewRefFileNode) || node.ref == null) {
	// 			return undefined;
	// 		}

	// 		if (this._selectedFile.repoPath !== node.repoPath) {
	// 			this.selectFileForCompare(node);
	// 			return undefined;
	// 		}

	// 		const selected = this._selectedFile;

	// 		this._selectedFile = undefined;
	// 		setCommandContext(CommandContext.ViewsCanCompareFile, false);

	// 		const diffArgs: DiffWithCommandArgs = {
	// 			repoPath: selected.repoPath,
	// 			lhs: {
	// 				sha: selected.ref,
	// 				uri: selected.uri!,
	// 			},
	// 			rhs: {
	// 				sha: node.ref,
	// 				uri: node.uri,
	// 			},
	// 		};
	// 		return commands.executeCommand(Commands.DiffWith, diffArgs);
	// 	}

	// 	private _selectedFile: CompareSelectedInfo | undefined;

	// 	@debug()
	// 	private selectFileForCompare(node: ViewRefFileNode) {
	// 		if (!(node instanceof ViewRefFileNode) || node.ref == null) return;

	// 		this._selectedFile = {
	// 			ref: node.ref,
	// 			repoPath: node.repoPath,
	// 			uri: node.uri,
	// 		};
	// 		setCommandContext(CommandContext.ViewsCanCompareFile, true);
	// 	}

	// 	@debug()
	// 	private openChanges(node: ViewRefFileNode | StatusFileNode) {
	// 		if (!(node instanceof ViewRefFileNode) && !(node instanceof StatusFileNode)) return undefined;

	// 		const command = node.getCommand();
	// 		if (command == null || command.arguments == null) return undefined;

	// 		const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
	// 		args.showOptions!.preview = false;
	// 		return commands.executeCommand(command.command, uri, args);
	// 	}

	// 	@debug()
	// 	private openChangesWithWorking(node: ViewRefFileNode | StatusFileNode) {
	// 		if (!(node instanceof ViewRefFileNode) && !(node instanceof StatusFileNode)) return undefined;

	// 		const args: DiffWithWorkingCommandArgs = {
	// 			showOptions: {
	// 				preserveFocus: true,
	// 				preview: false,
	// 			},
	// 		};
	// 		return commands.executeCommand(Commands.DiffWithWorking, node.uri, args);
	// 	}

	// 	@debug()
	// 	private openFile(node: ViewRefFileNode | StatusFileNode | FileHistoryNode | LineHistoryNode) {
	// 		if (
	// 			!(node instanceof ViewRefFileNode) &&
	// 			!(node instanceof StatusFileNode) &&
	// 			!(node instanceof FileHistoryNode) &&
	// 			!(node instanceof LineHistoryNode)
	// 		) {
	// 			return undefined;
	// 		}

	// 		const args: OpenWorkingFileCommandArgs = {
	// 			uri: node.uri,
	// 			showOptions: {
	// 				preserveFocus: true,
	// 				preview: false,
	// 			},
	// 		};
	// 		return commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
	// 	}

	// 	@debug()
	// 	private openFileRevision(
	// 		node: CommitFileNode | ResultsFileNode | StashFileNode | StatusFileNode,
	// 		options?: OpenFileRevisionCommandArgs,
	// 	) {
	// 		if (
	// 			!(node instanceof CommitFileNode) &&
	// 			!(node instanceof StashFileNode) &&
	// 			!(node instanceof ResultsFileNode) &&
	// 			!(node instanceof StatusFileNode)
	// 		) {
	// 			return undefined;
	// 		}

	// 		options = { showOptions: { preserveFocus: true, preview: false }, ...options };

	// 		let uri = options.uri;
	// 		if (uri == null) {
	// 			if (node instanceof ResultsFileNode) {
	// 				uri = GitUri.toRevisionUri(node.uri);
	// 			} else {
	// 				uri =
	// 					node.commit.status === 'D'
	// 						? GitUri.toRevisionUri(
	// 								node.commit.previousSha!,
	// 								node.commit.previousUri.fsPath,
	// 								node.commit.repoPath,
	// 						  )
	// 						: GitUri.toRevisionUri(node.uri);
	// 			}
	// 		}

	// 		return findOrOpenEditor(uri, options.showOptions || { preserveFocus: true, preview: false });
	// 	}

	// 	@debug()
	// 	private openFileRevisionInRemote(node: CommitFileNode) {
	// 		if (!(node instanceof CommitFileNode) || node instanceof StashFileNode) return undefined;

	// 		const args: OpenFileInRemoteCommandArgs = {
	// 			range: false,
	// 		};
	// 		return commands.executeCommand(
	// 			Commands.OpenFileInRemote,
	// 			node.commit.toGitUri(node.commit.status === 'D'),
	// 			args,
	// 		);
	// 	}

	// 	@debug()
	// 	private async openChangedFiles(
	// 		node: CommitNode | StashNode | ResultsFilesNode,
	// 		options?: TextDocumentShowOptions,
	// 	) {
	// 		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
	// 			return;
	// 		}

	// 		options = { preserveFocus: false, preview: false, ...options };

	// 		let repoPath: string;
	// 		let files;
	// 		let ref: string;

	// 		if (node instanceof ResultsFilesNode) {
	// 			const { diff } = await node.getFilesQueryResults();
	// 			if (diff == null || diff.length === 0) return;

	// 			repoPath = node.repoPath;
	// 			files = diff;
	// 			ref = node.ref1 || node.ref2;
	// 		} else {
	// 			repoPath = node.commit.repoPath;
	// 			files = node.commit.files;
	// 			ref = node.commit.sha;
	// 		}

	// 		if (files.length > 20) {
	// 			const result = await window.showWarningMessage(
	// 				`Are your sure you want to open all ${files.length} files?`,
	// 				{ title: 'Yes' },
	// 				{ title: 'No', isCloseAffordance: true },
	// 			);
	// 			if (result == null || result.title === 'No') return;
	// 		}

	// 		for (const file of files) {
	// 			const uri = GitUri.fromFile(file, repoPath, ref);

	// 			const args: OpenWorkingFileCommandArgs = {
	// 				uri: uri,
	// 				showOptions: options,
	// 			};
	// 			await commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
	// 		}
	// 	}

	// 	@debug()
	// 	private async openChangedFileDiffs(
	// 		node: CommitNode | StashNode | ResultsFilesNode,
	// 		options?: TextDocumentShowOptions,
	// 	) {
	// 		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
	// 			return;
	// 		}

	// 		options = { preserveFocus: false, preview: false, ...options };

	// 		let repoPath: string;
	// 		let files;
	// 		let ref1: string;
	// 		let ref2: string;

	// 		if (node instanceof ResultsFilesNode) {
	// 			const { diff } = await node.getFilesQueryResults();
	// 			if (diff == null || diff.length === 0) return;

	// 			repoPath = node.repoPath;
	// 			files = diff;
	// 			ref1 = node.ref1;
	// 			ref2 = node.ref2;
	// 		} else {
	// 			repoPath = node.commit.repoPath;
	// 			files = node.commit.files;
	// 			ref1 = node.commit.previousSha != null ? node.commit.previousSha : GitRevision.deletedOrMissing;
	// 			ref2 = node.commit.sha;
	// 		}

	// 		if (files.length > 20) {
	// 			const result = await window.showWarningMessage(
	// 				`Are your sure you want to open all ${files.length} files?`,
	// 				{ title: 'Yes' },
	// 				{ title: 'No', isCloseAffordance: true },
	// 			);
	// 			if (result == null || result.title === 'No') return;
	// 		}

	// 		let diffArgs: DiffWithCommandArgs;
	// 		for (const file of files) {
	// 			if (file.status === 'A') continue;

	// 			const uri1 = GitUri.fromFile(file, repoPath);
	// 			const uri2 =
	// 				file.status === 'R' || file.status === 'C' ? GitUri.fromFile(file, repoPath, ref2, true) : uri1;

	// 			diffArgs = {
	// 				repoPath: repoPath,
	// 				lhs: { uri: uri1, sha: ref1 },
	// 				rhs: { uri: uri2, sha: ref2 },
	// 				showOptions: options,
	// 			};
	// 			void (await commands.executeCommand(Commands.DiffWith, diffArgs));
	// 		}
	// 	}

	// 	@debug()
	// 	private async openChangedFileDiffsWithWorking(
	// 		node: CommitNode | StashNode | ResultsFilesNode,
	// 		options?: TextDocumentShowOptions,
	// 	) {
	// 		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
	// 			return;
	// 		}

	// 		options = { preserveFocus: false, preview: false, ...options };

	// 		let repoPath: string;
	// 		let files;
	// 		let ref: string;

	// 		if (node instanceof ResultsFilesNode) {
	// 			const { diff } = await node.getFilesQueryResults();
	// 			if (diff == null || diff.length === 0) return;

	// 			repoPath = node.repoPath;
	// 			files = diff;
	// 			ref = node.ref1 || node.ref2;
	// 		} else {
	// 			repoPath = node.commit.repoPath;
	// 			files = node.commit.files;
	// 			ref = node.commit.sha;
	// 		}

	// 		if (files.length > 20) {
	// 			const result = await window.showWarningMessage(
	// 				`Are your sure you want to open all ${files.length} files?`,
	// 				{ title: 'Yes' },
	// 				{ title: 'No', isCloseAffordance: true },
	// 			);
	// 			if (result == null || result.title === 'No') return;
	// 		}

	// 		for (const file of files) {
	// 			if (file.status === 'A' || file.status === 'D') continue;

	// 			const args: DiffWithWorkingCommandArgs = {
	// 				showOptions: options,
	// 			};

	// 			const uri = GitUri.fromFile(file, repoPath, ref);
	// 			await commands.executeCommand(Commands.DiffWithWorking, uri, args);
	// 		}
	// 	}

	// 	@debug()
	// 	private async openChangedFileRevisions(
	// 		node: CommitNode | StashNode | ResultsFilesNode,
	// 		options?: TextDocumentShowOptions,
	// 	) {
	// 		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
	// 			return;
	// 		}

	// 		options = { preserveFocus: false, preview: false, ...options };

	// 		let repoPath: string;
	// 		let files;
	// 		let ref1: string;
	// 		let ref2: string;

	// 		if (node instanceof ResultsFilesNode) {
	// 			const { diff } = await node.getFilesQueryResults();
	// 			if (diff == null || diff.length === 0) return;

	// 			repoPath = node.repoPath;
	// 			files = diff;
	// 			ref1 = node.ref1;
	// 			ref2 = node.ref2;
	// 		} else {
	// 			repoPath = node.commit.repoPath;
	// 			files = node.commit.files;
	// 			ref1 = node.commit.sha;
	// 			ref2 = node.commit.previousFileSha;
	// 		}

	// 		if (files.length > 20) {
	// 			const result = await window.showWarningMessage(
	// 				`Are your sure you want to open all ${files.length} files?`,
	// 				{ title: 'Yes' },
	// 				{ title: 'No', isCloseAffordance: true },
	// 			);
	// 			if (result == null || result.title === 'No') return;
	// 		}

	// 		for (const file of files) {
	// 			const uri = GitUri.toRevisionUri(file.status === 'D' ? ref2 : ref1, file, repoPath);

	// 			await findOrOpenEditor(uri, options);
	// 		}
	// 	}

	// 	terminalCheckoutCommit(node: CommitNode) {
	// 		if (!(node instanceof CommitNode)) return;

	// 		runGitCommandInTerminal('checkout', `${node.ref}`, node.repoPath);
	// 	}

	// 	async terminalPushCommit(node: CommitNode) {
	// 		if (!(node instanceof CommitNode)) return;

	// 		const branch = node.branch || (await Container.git.getBranch(node.repoPath));
	// 		if (branch == null) return;

	// 		runGitCommandInTerminal(
	// 			'push',
	// 			`${branch.getRemoteName()} ${node.ref}:${branch.getNameWithoutRemote()}`,
	// 			node.repoPath,
	// 		);
	// 	}

	// 	terminalRemoveRemote(node: RemoteNode) {
	// 		if (!(node instanceof RemoteNode)) return;

	// 		runGitCommandInTerminal('remote', `remove ${node.remote.name}`, node.remote.repoPath);
	// 	}

	export namespace Branch {
		export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'create',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}

		export async function remove(repo?: string | Repository, refs?: GitBranchReference | GitBranchReference[]) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'delete',
					repo: repo,
					references: refs,
				},
			});
		}

		export async function rename(repo?: string | Repository, ref?: GitBranchReference, name?: string) {
			return executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'rename',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}
	}

	export namespace Commit {
		export async function applyChanges(
			file: string | GitFile,
			ref1: GitRevisionReference,
			ref2?: GitRevisionReference,
		) {
			// Open the working file to ensure undo will work
			void (await GitActions.Commit.openFile(file, ref1, { preserveFocus: true, preview: false }));
			void (await Container.git.applyChangesToWorkingFile(
				GitUri.fromFile(file, ref1.repoPath, ref1.ref),
				ref1.ref,
				ref2?.ref,
			));
		}

		export async function copyIdToClipboard(ref: { repoPath: string; ref: string } | GitLogCommit) {
			void (await env.clipboard.writeText(ref.ref));
		}

		export async function copyMessageToClipboard(ref: { repoPath: string; ref: string } | GitLogCommit) {
			let message;
			if (GitLogCommit.is(ref)) {
				message = ref.message;
			} else {
				const commit = await Container.git.getCommit(ref.repoPath, ref.ref);
				if (commit == null) return;

				message = commit.message;
			}

			void (await env.clipboard.writeText(message));
		}

		export async function openAllChanges(commit: GitLogCommit, options?: TextDocumentShowOptions): Promise<void>;
		export async function openAllChanges(
			files: GitFile[],
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChanges(
			commitOrFiles: GitLogCommit | GitFile[],
			refsOrOptions: { repoPath: string; ref1: string; ref2: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let refs;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				refs = {
					repoPath: commitOrFiles.repoPath,
					ref1: commitOrFiles.previousSha != null ? commitOrFiles.previousSha : GitRevision.deletedOrMissing,
					ref2: commitOrFiles.sha,
				};

				options = refsOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				refs = refsOrOptions as { repoPath: string; ref1: string; ref2: string };
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of files) {
				await openChanges(file, refs, options);
			}
		}

		export async function openAllChangesWithDiffTool(commit: GitLogCommit): Promise<void>;
		export async function openAllChangesWithDiffTool(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
		): Promise<void>;
		export async function openAllChangesWithDiffTool(
			commitOrFiles: GitLogCommit | GitFile[],
			ref?: { repoPath: string; ref: string },
		) {
			let files;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};
			} else {
				files = commitOrFiles;
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			for (const file of files) {
				void openChangesWithDiffTool(file, ref!);
			}
		}

		export async function openAllChangesWithWorking(
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			files: GitFile[],
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openAllChangesWithWorking(
			commitOrFiles: GitLogCommit | GitFile[],
			refOrOptions: { repoPath: string; ref: string } | TextDocumentShowOptions | undefined,
			options?: TextDocumentShowOptions,
		) {
			let files;
			let ref;
			if (GitLogCommit.is(commitOrFiles)) {
				files = commitOrFiles.files;
				ref = {
					repoPath: commitOrFiles.repoPath,
					ref: commitOrFiles.sha,
				};

				options = refOrOptions as TextDocumentShowOptions | undefined;
			} else {
				files = commitOrFiles;
				ref = refOrOptions as { repoPath: string; ref: string };
			}

			if (files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${files.length} changes?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of files) {
				void (await openChangesWithWorking(file, ref, options));
			}
		}

		export async function openChanges(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: GitFile,
			refs: { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChanges(
			file: string | GitFile,
			commitOrRefs: GitLogCommit | { repoPath: string; ref1: string; ref2: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRefs)) throw new Error('Invalid arguments');

				const f = commitOrRefs.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (file.status === 'A') return;

			const refs = GitLogCommit.is(commitOrRefs)
				? {
						repoPath: commitOrRefs.repoPath,
						ref1:
							commitOrRefs.previousSha != null ? commitOrRefs.previousSha : GitRevision.deletedOrMissing,
						ref2: commitOrRefs.sha,
				  }
				: commitOrRefs;

			options = { preserveFocus: true, preview: false, ...options };

			const uri1 = GitUri.fromFile(file, refs.repoPath);
			const uri2 =
				file.status === 'R' || file.status === 'C'
					? GitUri.fromFile(file, refs.repoPath, refs.ref2, true)
					: uri1;

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
				repoPath: refs.repoPath,
				lhs: { uri: uri1, sha: refs.ref1 },
				rhs: { uri: uri2, sha: refs.ref2 },
				showOptions: options,
			}));
		}

		export async function openChangesWithDiffTool(
			file: string | GitFile,
			commit: GitLogCommit,
			tool?: string,
		): Promise<void>;
		export async function openChangesWithDiffTool(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			tool?: string,
		): Promise<void>;
		export async function openChangesWithDiffTool(
			file: string | GitFile,
			commitOrRef: GitLogCommit | { repoPath: string; ref: string },
			tool?: string,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRef)) throw new Error('Invalid arguments');

				const f = commitOrRef.findFile(file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (!tool) {
				tool = await Container.git.getDiffTool(commitOrRef.repoPath);
				if (tool == null) {
					const result = await window.showWarningMessage(
						'Unable to open changes in diff tool. No Git diff tool is configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);

					return;
				}
			}

			void Container.git.openDiffTool(
				commitOrRef.repoPath,
				GitUri.fromFile(file, file.repoPath ?? commitOrRef.repoPath),
				{
					ref1: GitRevision.isUncommitted(commitOrRef.ref) ? '' : `${commitOrRef.ref}^`,
					ref2: GitRevision.isUncommitted(commitOrRef.ref) ? '' : commitOrRef.ref,
					staged: GitRevision.isUncommittedStaged(commitOrRef.ref) || file.indexStatus != null,
					tool: tool,
				},
			);
		}

		export async function openChangesWithWorking(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: GitFile,
			ref: { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		): Promise<void>;
		export async function openChangesWithWorking(
			file: string | GitFile,
			commitOrRef: GitLogCommit | { repoPath: string; ref: string },
			options?: TextDocumentShowOptions,
		) {
			if (typeof file === 'string') {
				if (!GitLogCommit.is(commitOrRef)) throw new Error('Invalid arguments');

				const f = commitOrRef.files.find(f => f.fileName === file);
				if (f == null) throw new Error('Invalid arguments');

				file = f;
			}

			if (file.status === 'A' || file.status === 'D') return;

			let ref;
			if (GitLogCommit.is(commitOrRef)) {
				ref = {
					repoPath: commitOrRef.repoPath,
					ref: commitOrRef.sha,
				};
			} else {
				ref = commitOrRef;
			}

			options = { preserveFocus: true, preview: false, ...options };

			void (await executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
				uri: GitUri.fromFile(file, ref.repoPath, ref.ref),
				showOptions: options,
			}));
		}

		export async function openDirectoryCompare(
			ref: { repoPath: string; ref: string } | GitLogCommit,
		): Promise<void> {
			try {
				void (await Container.git.openDirectoryCompare(ref.repoPath, ref.ref, `${ref.ref}^`));
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg === 'No diff tool found') {
					const result = await window.showWarningMessage(
						'Unable to open directory compare because there is no Git diff tool configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}
			}
		}

		export async function openDirectoryCompareWithWorking(
			ref: { repoPath: string; ref: string } | GitLogCommit,
		): Promise<void> {
			try {
				void (await Container.git.openDirectoryCompare(ref.repoPath, ref.ref, undefined));
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg === 'No diff tool found') {
					const result = await window.showWarningMessage(
						'Unable to open directory compare because there is no Git diff tool configured',
						'View Git Docs',
					);
					if (!result) return;

					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}
			}
		}

		export async function openFile(
			file: string | GitFile,
			ref: GitRevisionReference,
			options?: TextDocumentShowOptions,
		) {
			options = { preserveFocus: true, preview: false, ...options };

			void (await executeEditorCommand<OpenWorkingFileCommandArgs>(Commands.OpenWorkingFile, undefined, {
				uri: GitUri.fromFile(file, ref.repoPath, ref.ref),
				showOptions: options,
			}));
		}

		export async function openFileAtRevision(
			revisionUri: Uri,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void>;
		export async function openFileAtRevision(
			file: string | GitFile,
			commit: GitLogCommit,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void>;
		export async function openFileAtRevision(
			fileOrRevisionUri: string | GitFile | Uri,
			commitOrOptions?: GitLogCommit | TextDocumentShowOptions,
			options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
		): Promise<void> {
			let uri;
			if (fileOrRevisionUri instanceof Uri) {
				if (GitLogCommit.is(commitOrOptions)) throw new Error('Invalid arguments');

				uri = fileOrRevisionUri;
				options = commitOrOptions;
			} else {
				if (!GitLogCommit.is(commitOrOptions)) throw new Error('Invalid arguments');

				const commit = commitOrOptions;

				let file;
				if (typeof fileOrRevisionUri === 'string') {
					const f = commit.findFile(fileOrRevisionUri);
					if (f == null) throw new Error('Invalid arguments');

					file = f;
				} else {
					file = fileOrRevisionUri;
				}

				uri = GitUri.toRevisionUri(
					file.status === 'D' ? commit.previousFileSha : commit.sha,
					file,
					commit.repoPath,
				);
			}

			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
			const { annotationType, line, ...opts } = {
				preserveFocus: true,
				preview: false,
				...options,
			} as Exclude<typeof options, undefined>;

			if (line != null && line !== 0) {
				opts.selection = new Range(line, 0, line, 0);
			}

			const editor = await findOrOpenEditor(uri, opts);
			if (annotationType != null && editor != null) {
				void (await Container.fileAnnotations.show(editor, annotationType, line));
			}
		}

		export async function openFiles(commit: GitLogCommit, options?: TextDocumentShowOptions) {
			if (commit.files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${commit.files.length} files?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of commit.files) {
				void (await openFile(file, commit, options));
			}
		}

		export async function openFilesAtRevision(commit: GitLogCommit, options?: TextDocumentShowOptions) {
			if (commit.files.length > 20) {
				const result = await window.showWarningMessage(
					`Are your sure you want to open all ${commit.files.length} revisions?`,
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result == null || result.title === 'No') return;
			}

			options = { preserveFocus: true, preview: false, ...options };

			for (const file of commit.files) {
				void (await openFileAtRevision(file, commit, options));
			}
		}

		export async function restoreFile(file: string | GitFile, ref: GitRevisionReference) {
			void (await Container.git.checkout(ref.repoPath, ref.ref, {
				fileName: typeof file === 'string' ? file : file.fileName,
			}));
		}
	}

	export namespace Contributor {
		export async function addAuthors(repo?: string | Repository, contributors?: GitContributor | GitContributor[]) {
			return executeGitCommand({
				command: 'co-authors',
				state: { repo: repo, contributors: contributors },
			});
		}

		export async function copyToClipboard(contributor: GitContributor) {
			await env.clipboard.writeText(`${contributor.name}${contributor.email ? ` <${contributor.email}>` : ''}`);
		}
	}

	export namespace Tag {
		export function create(repo?: string | Repository, ref?: GitReference, name?: string) {
			return executeGitCommand({
				command: 'tag',
				state: {
					subcommand: 'create',
					repo: repo,
					reference: ref,
					name: name,
				},
			});
		}

		export function remove(repo?: string | Repository, refs?: GitTagReference | GitTagReference[]) {
			return executeGitCommand({
				command: 'tag',
				state: {
					subcommand: 'delete',
					repo: repo,
					references: refs,
				},
			});
		}
	}

	export namespace Remote {
		export async function add(repo: string | Repository) {
			const name = await window.showInputBox({
				prompt: 'Please provide a name for the remote',
				placeHolder: 'Remote name',
				value: undefined,
				ignoreFocusOut: true,
			});
			if (name == null || name.length === 0) return undefined;

			const url = await window.showInputBox({
				prompt: 'Please provide the repository url for the remote',
				placeHolder: 'Remote repository url',
				value: undefined,
				ignoreFocusOut: true,
			});
			if (url == null || url.length === 0) return undefined;

			repo = await ensureRepo(repo);
			void (await Container.git.addRemote(repo.path, name, url));
			void (await repo.fetch({ remote: name }));

			return name;
		}

		export async function fetch(repo: string | Repository, remote: string) {
			if (typeof repo === 'string') {
				const r = await Container.git.getRepository(repo);
				if (r == null) return;

				repo = r;
			}

			void (await repo.fetch({ remote: remote }));
		}

		export async function prune(repo: string | Repository, remote: string) {
			void (await Container.git.pruneRemote(typeof repo === 'string' ? repo : repo.path, remote));
		}
	}

	export namespace Stash {
		export async function apply(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'apply', repo: repo, reference: ref },
			});
		}

		export async function drop(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'drop', repo: repo, reference: ref },
			});
		}

		export async function pop(repo?: string | Repository, ref?: GitStashReference) {
			return executeGitCommand({
				command: 'stash',
				state: { subcommand: 'pop', repo: repo, reference: ref },
			});
		}

		export async function push(
			repo?: string | Repository,
			uris?: Uri[],
			message?: string,
			keepStaged: boolean = false,
		) {
			return executeGitCommand({
				command: 'stash',
				state: {
					subcommand: 'push',
					repo: repo,
					uris: uris,
					message: message,
					flags: keepStaged ? ['--keep-index'] : undefined,
				},
			});
		}
	}
}
