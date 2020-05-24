'use strict';
import { commands, env, TextDocumentShowOptions, Uri, window } from 'vscode';
import {
	Commands,
	DiffWithCommandArgs,
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	findOrOpenEditor,
	GitActions,
	OpenFileAtRevisionCommandArgs,
	OpenFileOnRemoteCommandArgs,
	OpenWorkingFileCommandArgs,
} from '../commands';
import { FileAnnotationType } from '../config';
import { BuiltInCommands, CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitReference, GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import {
	BranchNode,
	BranchTrackingStatusNode,
	CommitFileNode,
	CommitNode,
	CompareBranchNode,
	CompareResultsNode,
	ContributorNode,
	ContributorsNode,
	FileHistoryNode,
	FolderNode,
	LineHistoryNode,
	PageableViewNode,
	PagerNode,
	RemoteNode,
	RepositoryNode,
	ResultsFileNode,
	ResultsFilesNode,
	StashFileNode,
	StashNode,
	StatusFileNode,
	TagNode,
	ViewNode,
	ViewRefFileNode,
	ViewRefNode,
	viewSupportsNodeDismissal,
} from './nodes';
import { debug } from '../system';
import { runGitCommandInTerminal } from '../terminal';

interface CompareSelectedInfo {
	ref: string;
	repoPath: string | undefined;
	uri?: Uri;
}

export class ViewCommands {
	constructor() {
		commands.registerCommand(
			'gitlens.views.copy',
			async (selection: ViewNode[]) => {
				if (selection.length === 0) return;

				const data = selection
					.filter(n => n.toClipboard !== undefined)
					.map(n => n.toClipboard!())
					.join(',');
				await env.clipboard.writeText(data);
			},
			this,
		);
		commands.registerCommand(
			'gitlens.views.refreshNode',
			(node: ViewNode, reset?: boolean) => {
				if (reset == null && PageableViewNode.is(node)) {
					node.limit = undefined;
					node.view.resetNodeLastKnownLimit(node);
				}

				return node.view.refreshNode(node, reset == null ? true : reset);
			},
			this,
		);
		commands.registerCommand(
			'gitlens.views.expandNode',
			(node: ViewNode) => node.view.reveal(node, { select: false, focus: false, expand: 3 }),
			this,
		);
		commands.registerCommand(
			'gitlens.views.dismissNode',
			(node: ViewNode) => viewSupportsNodeDismissal(node.view) && node.view.dismissNode(node),
			this,
		);
		commands.registerCommand('gitlens.views.executeNodeCallback', (fn: <R>() => Promise<R>) => fn(), this);
		commands.registerCommand('gitlens.views.showMoreChildren', (node: PagerNode) => node.showMore(), this);
		commands.registerCommand('gitlens.views.showAllChildren', (node: PagerNode) => node.showAll(), this);

		commands.registerCommand('gitlens.views.fetch', this.fetch, this);
		commands.registerCommand('gitlens.views.pull', this.pull, this);
		commands.registerCommand('gitlens.views.push', this.push, this);
		commands.registerCommand('gitlens.views.pushWithForce', n => this.push(n, true), this);
		commands.registerCommand('gitlens.views.closeRepository', this.closeRepository, this);

		commands.registerCommand('gitlens.views.setAsDefault', this.setAsDefault, this);
		commands.registerCommand('gitlens.views.unsetAsDefault', this.unsetAsDefault, this);

		commands.registerCommand('gitlens.views.openInTerminal', this.openInTerminal, this);
		commands.registerCommand('gitlens.views.star', this.star, this);
		commands.registerCommand('gitlens.views.unstar', this.unstar, this);

		commands.registerCommand('gitlens.views.browseRepoAtRevision', this.browseRepoAtRevision, this);
		commands.registerCommand(
			'gitlens.views.browseRepoAtRevisionInNewWindow',
			n => this.browseRepoAtRevision(n, true),
			this,
		);

		commands.registerCommand('gitlens.views.contributors.addAuthors', this.contributorsAddAuthors, this);
		commands.registerCommand('gitlens.views.contributor.addAuthor', this.contributorsAddAuthors, this);
		commands.registerCommand('gitlens.views.contributor.copyToClipboard', this.contributorCopyToClipboard, this);

		commands.registerCommand('gitlens.views.openChanges', this.openChanges, this);
		commands.registerCommand('gitlens.views.openChangesWithWorking', this.openChangesWithWorking, this);
		commands.registerCommand('gitlens.views.openFile', this.openFile, this);
		commands.registerCommand('gitlens.views.openFileRevision', this.openRevision, this);
		commands.registerCommand('gitlens.views.openFileRevisionInRemote', this.openRevisionOnRemote, this);
		commands.registerCommand('gitlens.views.openChangedFiles', this.openFiles, this);
		commands.registerCommand('gitlens.views.openChangedFileDiffs', this.openAllChanges, this);
		commands.registerCommand('gitlens.views.openChangedFileDiffsWithWorking', this.openAllChangesWithWorking, this);
		commands.registerCommand('gitlens.views.openChangedFileRevisions', this.openRevisions, this);
		commands.registerCommand('gitlens.views.applyChanges', this.applyChanges, this);
		commands.registerCommand('gitlens.views.highlightChanges', this.highlightChanges, this);
		commands.registerCommand('gitlens.views.highlightRevisionChanges', this.highlightRevisionChanges, this);
		commands.registerCommand('gitlens.views.restore', this.restore, this);
		commands.registerCommand('gitlens.views.switchToBranch', this.switch, this);
		commands.registerCommand('gitlens.views.switchToCommit', this.switch, this);
		commands.registerCommand('gitlens.views.switchToTag', this.switch, this);
		commands.registerCommand('gitlens.views.addRemote', this.addRemote, this);
		commands.registerCommand('gitlens.views.pruneRemote', this.pruneRemote, this);

		commands.registerCommand('gitlens.views.stageDirectory', this.stageDirectory, this);
		commands.registerCommand('gitlens.views.stageFile', this.stageFile, this);
		commands.registerCommand('gitlens.views.unstageDirectory', this.unstageDirectory, this);
		commands.registerCommand('gitlens.views.unstageFile', this.unstageFile, this);

		commands.registerCommand('gitlens.views.compareAncestryWithWorking', this.compareAncestryWithWorking, this);
		commands.registerCommand('gitlens.views.compareWithHead', this.compareWithHead, this);
		commands.registerCommand('gitlens.views.compareWithRemote', this.compareWithRemote, this);
		commands.registerCommand('gitlens.views.compareWithSelected', this.compareWithSelected, this);
		commands.registerCommand('gitlens.views.selectForCompare', this.selectForCompare, this);
		commands.registerCommand('gitlens.views.compareFileWithSelected', this.compareFileWithSelected, this);
		commands.registerCommand('gitlens.views.selectFileForCompare', this.selectFileForCompare, this);
		commands.registerCommand('gitlens.views.compareWithWorking', this.compareWithWorking, this);

		commands.registerCommand('gitlens.views.setComparisonToTwoDot', n => this.setComparisonNotation(n, '..'), this);
		commands.registerCommand(
			'gitlens.views.setComparisonToThreeDot',
			n => this.setComparisonNotation(n, '...'),
			this,
		);

		commands.registerCommand('gitlens.views.cherryPick', this.cherryPick, this);
		commands.registerCommand('gitlens.views.createBranch', this.createBranch, this);
		commands.registerCommand('gitlens.views.deleteBranch', this.deleteBranch, this);
		commands.registerCommand('gitlens.views.renameBranch', this.renameBranch, this);
		commands.registerCommand('gitlens.views.deleteStash', this.deleteStash, this);
		commands.registerCommand('gitlens.views.createTag', this.createTag, this);
		commands.registerCommand('gitlens.views.deleteTag', this.deleteTag, this);

		commands.registerCommand('gitlens.views.mergeBranchInto', this.merge, this);

		commands.registerCommand('gitlens.views.rebaseOntoBranch', this.rebase, this);
		commands.registerCommand('gitlens.views.rebaseOntoUpstream', this.rebaseToRemote, this);
		commands.registerCommand('gitlens.views.rebaseOntoCommit', this.rebase, this);

		commands.registerCommand('gitlens.views.reset', this.reset, this);
		commands.registerCommand('gitlens.views.revert', this.revert, this);

		commands.registerCommand('gitlens.views.terminalPushCommit', this.terminalPushCommit, this);

		commands.registerCommand('gitlens.views.terminalRemoveRemote', this.terminalRemoveRemote, this);
	}

	@debug()
	private async addRemote(node: RemoteNode) {
		return GitActions.Remote.add(node.repo);
	}

	@debug()
	private async applyChanges(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return undefined;

		if (node instanceof ResultsFileNode) {
			return GitActions.Commit.applyChanges(
				node.file,
				GitReference.create(node.ref1, node.repoPath),
				GitReference.create(node.ref2, node.repoPath),
			);
		}

		if (node.ref == null || node.ref === 'HEAD') return undefined;

		return GitActions.Commit.applyChanges(node.file, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	private async cherryPick(node: CommitNode) {
		if (!(node instanceof CommitNode)) return undefined;

		return GitActions.cherryPick(node.repoPath, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	private closeRepository(node: RepositoryNode) {
		if (!(node instanceof RepositoryNode)) return;

		node.repo.closed = true;
	}

	@debug()
	private async contributorsAddAuthors(node: ContributorNode | ContributorsNode) {
		if (!(node instanceof ContributorNode) && !(node instanceof ContributorsNode)) return undefined;

		return GitActions.Contributor.addAuthors(
			node.uri.repoPath,
			node instanceof ContributorNode ? node.contributor : undefined,
		);
	}

	@debug()
	private async contributorCopyToClipboard(node: ContributorNode) {
		if (!(node instanceof ContributorNode)) return undefined;

		return GitActions.Contributor.copyToClipboard(node.contributor);
	}

	@debug()
	async createBranch(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return GitActions.Branch.create(
			node.repoPath,
			node instanceof BranchNode ? node.branch : GitReference.create(node.ref, node.repoPath),
		);
	}

	@debug()
	async createTag(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return GitActions.Branch.create(node.repoPath, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	async deleteBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return undefined;

		return GitActions.Branch.remove(node.repoPath, node.branch);
	}

	@debug()
	async deleteStash(node: StashNode) {
		if (!(node instanceof StashNode)) return undefined;

		return GitActions.Stash.drop(node.repoPath, node.commit);
	}

	@debug()
	async deleteTag(node: TagNode) {
		if (!(node instanceof TagNode)) return undefined;

		return GitActions.Tag.remove(node.repoPath, node.tag);
	}

	@debug()
	private browseRepoAtRevision(node: ViewRefNode, openInNewWindow: boolean = false) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return GitActions.browseAtRevision(node.uri, { openInNewWindow: openInNewWindow });
	}

	@debug()
	private fetch(node: RemoteNode | RepositoryNode) {
		if (node instanceof RepositoryNode) return GitActions.fetch(node.repo);
		if (node instanceof RemoteNode) return GitActions.Remote.fetch(node.remote.repoPath, node.remote.name);

		return undefined;
	}

	@debug()
	private async highlightChanges(node: CommitFileNode | ResultsFileNode | StashFileNode) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof ResultsFileNode)
		) {
			return;
		}

		void (await this.openFile(node));
		void (await Container.fileAnnotations.toggle(
			window.activeTextEditor,
			FileAnnotationType.RecentChanges,
			node.ref,
			true,
		));
	}

	@debug()
	private async highlightRevisionChanges(node: CommitFileNode | ResultsFileNode | StashFileNode) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof ResultsFileNode)
		) {
			return;
		}

		void (await this.openRevision(node, { showOptions: { preserveFocus: true, preview: true } }));
		void (await Container.fileAnnotations.toggle(
			window.activeTextEditor,
			FileAnnotationType.RecentChanges,
			node.ref,
			true,
		));
	}

	@debug()
	private async merge(node: BranchNode | TagNode) {
		if (!(node instanceof BranchNode) && !(node instanceof TagNode)) return undefined;

		return GitActions.merge(node.repoPath, node instanceof BranchNode ? node.branch : node.tag);
	}

	@debug()
	private openInTerminal(node: RepositoryNode) {
		if (!(node instanceof RepositoryNode)) return undefined;

		return commands.executeCommand(BuiltInCommands.OpenInTerminal, Uri.file(node.repo.path));
	}

	@debug()
	private async pruneRemote(node: RemoteNode) {
		return GitActions.Remote.prune(node.repo, node.remote.name);
	}

	@debug()
	private pull(node: RepositoryNode | BranchNode | BranchTrackingStatusNode) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			node = node.getParent() as RepositoryNode;
		}
		if (!(node instanceof RepositoryNode)) return undefined;

		return GitActions.pull(node.repo);
	}

	@debug()
	private push(node: RepositoryNode | BranchNode | BranchTrackingStatusNode, force?: boolean) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			node = node.getParent() as RepositoryNode;
		}
		if (!(node instanceof RepositoryNode)) return undefined;

		return GitActions.push(node.repo, force);
	}

	@debug()
	private async rebase(node: BranchNode | CommitNode | TagNode) {
		if (!(node instanceof BranchNode) && !(node instanceof CommitNode) && !(node instanceof TagNode)) {
			return undefined;
		}

		return GitActions.rebase(
			node.repoPath,
			node instanceof CommitNode
				? GitReference.create(node.ref, node.repoPath)
				: node instanceof BranchNode
				? node.branch
				: node.tag,
		);
	}

	@debug()
	private async rebaseToRemote(node: BranchNode | BranchTrackingStatusNode) {
		if (!(node instanceof BranchNode) && !(node instanceof BranchTrackingStatusNode)) return undefined;

		const upstream = node instanceof BranchNode ? node.branch.tracking : node.status.upstream;
		if (upstream == null) return undefined;

		return GitActions.rebase(
			node.repoPath,
			GitReference.create(upstream, node.repoPath, {
				refType: 'branch',
				name: upstream,
				remote: true,
			}),
		);
	}

	@debug()
	async renameBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return undefined;

		return GitActions.Branch.rename(node.repoPath, node.branch);
	}

	@debug()
	private async reset(node: CommitNode) {
		if (!(node instanceof CommitNode)) return undefined;

		return GitActions.reset(node.repoPath, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	private async restore(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return undefined;

		return GitActions.Commit.restoreFile(node.fileName, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	private async revert(node: CommitNode) {
		if (!(node instanceof CommitNode)) return undefined;

		return GitActions.revert(node.repoPath, GitReference.create(node.ref, node.repoPath));
	}

	@debug()
	private setAsDefault(node: RemoteNode) {
		if (node instanceof RemoteNode) return node.setAsDefault();
		return undefined;
	}

	@debug()
	private setComparisonNotation(node: ViewNode, comparisonNotation: '...' | '..') {
		if (!(node instanceof CompareResultsNode) && !(node instanceof CompareBranchNode)) return undefined;

		return node.setComparisonNotation(comparisonNotation);
	}

	@debug()
	private async stageFile(node: CommitFileNode | StatusFileNode) {
		if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

		void (await Container.git.stageFile(node.repoPath, node.file.fileName));
		void node.triggerChange();
	}

	@debug()
	private async stageDirectory(node: FolderNode) {
		if (!(node instanceof FolderNode) || !node.relativePath) return;

		void (await Container.git.stageDirectory(node.repoPath, node.relativePath));
		void node.triggerChange();
	}

	@debug()
	private star(node: BranchNode | RepositoryNode) {
		if (node instanceof BranchNode || node instanceof RepositoryNode) return node.star();
		return undefined;
	}

	@debug()
	private async switch(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return GitActions.switchTo(
			node.repoPath,
			node instanceof BranchNode
				? node.branch.current
					? undefined
					: node.branch
				: node instanceof TagNode
				? node.tag
				: GitReference.create(node.ref, node.repoPath),
		);
	}

	@debug()
	private unsetAsDefault(node: RemoteNode) {
		if (node instanceof RemoteNode) return node.setAsDefault(false);
		return undefined;
	}

	@debug()
	private async unstageFile(node: CommitFileNode | StatusFileNode) {
		if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

		void (await Container.git.unStageFile(node.repoPath, node.file.fileName));
		void node.triggerChange();
	}

	@debug()
	private async unstageDirectory(node: FolderNode) {
		if (!(node instanceof FolderNode) || !node.relativePath) return;

		void (await Container.git.unStageDirectory(node.repoPath, node.relativePath));
		void node.triggerChange();
	}

	@debug()
	private unstar(node: BranchNode | RepositoryNode) {
		if (node instanceof BranchNode || node instanceof RepositoryNode) return node.unstar();
		return undefined;
	}

	@debug()
	private compareWithHead(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return Container.compareView.compare(node.repoPath, node.ref, 'HEAD');
	}

	@debug()
	private compareWithRemote(node: BranchNode) {
		if (!(node instanceof BranchNode)) return undefined;
		if (!node.branch.tracking) return undefined;

		return Container.compareView.compare(node.repoPath, node.branch.tracking, node.ref);
	}

	@debug()
	private compareWithWorking(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return undefined;

		return Container.compareView.compare(node.repoPath, node.ref, '');
	}

	@debug()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!(node instanceof BranchNode)) return undefined;

		const branch = await Container.git.getBranch(node.repoPath);
		if (branch === undefined) return undefined;

		const commonAncestor = await Container.git.getMergeBase(node.repoPath, branch.ref, node.ref);
		if (commonAncestor === undefined) return undefined;

		return Container.compareView.compare(
			node.repoPath,
			{ ref: commonAncestor, label: `ancestry with ${node.ref} (${GitRevision.shorten(commonAncestor)})` },
			'',
		);
	}

	@debug()
	private compareWithSelected(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return;

		Container.compareView.compareWithSelected(node.repoPath, node.ref);
	}

	@debug()
	private selectForCompare(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return;

		Container.compareView.selectForCompare(node.repoPath, node.ref);
	}

	@debug()
	private compareFileWithSelected(node: ViewRefFileNode) {
		if (this._selectedFile === undefined || !(node instanceof ViewRefFileNode) || node.ref === undefined) {
			return undefined;
		}

		if (this._selectedFile.repoPath !== node.repoPath) {
			this.selectFileForCompare(node);
			return undefined;
		}

		const selected = this._selectedFile;

		this._selectedFile = undefined;
		void setCommandContext(CommandContext.ViewsCanCompareFile, false);

		const diffArgs: DiffWithCommandArgs = {
			repoPath: selected.repoPath,
			lhs: {
				sha: selected.ref,
				uri: selected.uri!,
			},
			rhs: {
				sha: node.ref,
				uri: node.uri,
			},
		};
		return commands.executeCommand(Commands.DiffWith, diffArgs);
	}

	private _selectedFile: CompareSelectedInfo | undefined;

	@debug()
	private selectFileForCompare(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode) || node.ref === undefined) return;

		this._selectedFile = {
			ref: node.ref,
			repoPath: node.repoPath,
			uri: node.uri,
		};
		void setCommandContext(CommandContext.ViewsCanCompareFile, true);
	}

	@debug()
	private async openAllChanges(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return GitActions.Commit.openAllChanges(
				diff,
				{
					repoPath: node.repoPath,
					ref1: node.ref1,
					ref2: node.ref2,
				},
				options,
			);
		}

		return GitActions.Commit.openAllChanges(node.commit, options);
	}

	@debug()
	private openChanges(node: ViewRefFileNode | StatusFileNode) {
		if (!(node instanceof ViewRefFileNode) && !(node instanceof StatusFileNode)) return undefined;

		const command = node.getCommand();
		if (command === undefined || command.arguments === undefined) return undefined;

		const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
		args.showOptions!.preview = false;
		return commands.executeCommand(command.command, uri, args);

		// TODO@eamodio Revisit this
		// return GitActions.Commit.openChanges(node.file, node instanceof ViewRefFileNode ? node.ref : node.commit, {
		// 	preserveFocus: true,
		// 	preview: false,
		// });
	}

	@debug()
	private async openAllChangesWithWorking(
		node: CommitNode | StashNode | ResultsFilesNode,
		options?: TextDocumentShowOptions,
	) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return GitActions.Commit.openAllChangesWithWorking(
				diff,
				{
					repoPath: node.repoPath,
					ref: node.ref1 || node.ref2,
				},
				options,
			);
		}

		return GitActions.Commit.openAllChangesWithWorking(node.commit, options);

		// options = { preserveFocus: false, preview: false, ...options };

		// let repoPath: string;
		// let files;
		// let ref: string;

		// if (node instanceof ResultsFilesNode) {
		// 	const { diff } = await node.getFilesQueryResults();
		// 	if (diff == null || diff.length === 0) return;

		// 	repoPath = node.repoPath;
		// 	files = diff;
		// 	ref = node.ref1 || node.ref2;
		// } else {
		// 	repoPath = node.commit.repoPath;
		// 	files = node.commit.files;
		// 	ref = node.commit.sha;
		// }

		// if (files.length > 20) {
		// 	const result = await window.showWarningMessage(
		// 		`Are your sure you want to open all ${files.length} files?`,
		// 		{ title: 'Yes' },
		// 		{ title: 'No', isCloseAffordance: true },
		// 	);
		// 	if (result === undefined || result.title === 'No') return;
		// }

		// for (const file of files) {
		// 	if (file.status === 'A' || file.status === 'D') continue;

		// 	const args: DiffWithWorkingCommandArgs = {
		// 		showOptions: options,
		// 	};

		// 	const uri = GitUri.fromFile(file, repoPath, ref);
		// 	await commands.executeCommand(Commands.DiffWithWorking, uri, args);
		// }
	}

	@debug()
	private openChangesWithWorking(node: ViewRefFileNode | StatusFileNode) {
		if (!(node instanceof ViewRefFileNode) && !(node instanceof StatusFileNode)) return undefined;

		if (node instanceof StatusFileNode) {
			const args: DiffWithWorkingCommandArgs = {
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			};
			return commands.executeCommand(Commands.DiffWithWorking, node.uri, args);
		}

		return GitActions.Commit.openChangesWithWorking(node.file, { repoPath: node.repoPath, ref: node.ref });
	}

	@debug()
	private async openFile(node: ViewRefFileNode | StatusFileNode | FileHistoryNode | LineHistoryNode) {
		if (
			!(node instanceof ViewRefFileNode) &&
			!(node instanceof StatusFileNode) &&
			!(node instanceof FileHistoryNode) &&
			!(node instanceof LineHistoryNode)
		) {
			return;
		}

		const args: OpenWorkingFileCommandArgs = {
			uri: node.uri,
			showOptions: {
				preserveFocus: true,
				preview: false,
			},
		};
		void (await commands.executeCommand(Commands.OpenWorkingFile, undefined, args));
	}

	@debug()
	private async openFiles(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return;
		}

		options = { preserveFocus: false, preview: false, ...options };

		let repoPath: string;
		let files;
		let ref: string;

		if (node instanceof ResultsFilesNode) {
			const { diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return;

			repoPath = node.repoPath;
			files = diff;
			ref = node.ref1 || node.ref2;
		} else {
			repoPath = node.commit.repoPath;
			files = node.commit.files;
			ref = node.commit.sha;
		}

		if (files.length > 20) {
			const result = await window.showWarningMessage(
				`Are your sure you want to open all ${files.length} files?`,
				{ title: 'Yes' },
				{ title: 'No', isCloseAffordance: true },
			);
			if (result === undefined || result.title === 'No') return;
		}

		for (const file of files) {
			const uri = GitUri.fromFile(file, repoPath, ref);

			const args: OpenWorkingFileCommandArgs = {
				uri: uri,
				showOptions: options,
			};
			await commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
		}
	}

	@debug()
	private openRevision(
		node: CommitFileNode | ResultsFileNode | StashFileNode | StatusFileNode,
		options?: OpenFileAtRevisionCommandArgs,
	) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof ResultsFileNode) &&
			!(node instanceof StatusFileNode)
		) {
			return undefined;
		}

		options = { showOptions: { preserveFocus: true, preview: false }, ...options };

		let uri = options.revisionUri;
		if (uri == null) {
			if (node instanceof ResultsFileNode) {
				uri = GitUri.toRevisionUri(node.uri);
			} else {
				uri =
					node.commit.status === 'D'
						? GitUri.toRevisionUri(
								node.commit.previousSha!,
								node.commit.previousUri.fsPath,
								node.commit.repoPath,
						  )
						: GitUri.toRevisionUri(node.uri);
			}
		}

		return findOrOpenEditor(uri, options.showOptions ?? { preserveFocus: true, preview: false });
	}

	@debug()
	private async openRevisions(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return;
		}

		options = { preserveFocus: false, preview: false, ...options };

		let repoPath: string;
		let files;
		let ref1: string;
		let ref2: string;

		if (node instanceof ResultsFilesNode) {
			const { diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return;

			repoPath = node.repoPath;
			files = diff;
			ref1 = node.ref1;
			ref2 = node.ref2;
		} else {
			repoPath = node.commit.repoPath;
			files = node.commit.files;
			ref1 = node.commit.sha;
			ref2 = node.commit.previousFileSha;
		}

		if (files.length > 20) {
			const result = await window.showWarningMessage(
				`Are your sure you want to open all ${files.length} files?`,
				{ title: 'Yes' },
				{ title: 'No', isCloseAffordance: true },
			);
			if (result === undefined || result.title === 'No') return;
		}

		for (const file of files) {
			const uri = GitUri.toRevisionUri(file.status === 'D' ? ref2 : ref1, file, repoPath);

			await findOrOpenEditor(uri, options);
		}
	}

	@debug()
	private openRevisionOnRemote(node: CommitFileNode) {
		if (!(node instanceof CommitFileNode) || node instanceof StashFileNode) return undefined;

		const args: OpenFileOnRemoteCommandArgs = {
			range: false,
		};
		return commands.executeCommand(
			Commands.OpenFileInRemote,
			node.commit.toGitUri(node.commit.status === 'D'),
			args,
		);
	}

	async terminalPushCommit(node: CommitNode) {
		if (!(node instanceof CommitNode)) return;

		const branch = node.branch ?? (await Container.git.getBranch(node.repoPath));
		if (branch === undefined) return;

		runGitCommandInTerminal(
			'push',
			`${branch.getRemoteName()} ${node.ref}:${branch.getNameWithoutRemote()}`,
			node.repoPath,
		);
	}

	terminalRemoveRemote(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return;

		runGitCommandInTerminal('remote', `remove ${node.remote.name}`, node.remote.repoPath);
	}
}
