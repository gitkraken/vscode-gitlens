import type { TextEditor } from 'vscode';
import { window, workspace } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import type { PatchRevisionRange } from '../git/models/patch';
import { shortenRevision } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import type { Draft, LocalDraft } from '../gk/models/drafts';
import { showPatchesView } from '../plus/drafts/actions';
import type { Change } from '../plus/webviews/patchDetails/protocol';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	Command,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
} from './base';

export interface CreatePatchCommandArgs {
	ref1?: string;
	ref2?: string;
	repoPath?: string;
}

@command()
export class CreatePatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CreatePatch);
	}

	protected override preExecute(context: CommandContext, args?: CreatePatchCommandArgs) {
		if (args == null) {
			if (context.type === 'viewItem') {
				if (isCommandContextViewNodeHasCommit(context)) {
					args = {
						repoPath: context.node.commit.repoPath,
						ref1: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						ref1: context.node.compareWithRef.ref,
						ref2: context.node.compareRef.ref,
					};
				}
			}
		}

		return this.execute(args);
	}

	async execute(args?: CreatePatchCommandArgs) {
		let repo;
		if (args?.repoPath == null) {
			repo = await getRepositoryOrShowPicker('Create Patch');
		} else {
			repo = this.container.git.getRepository(args.repoPath);
		}
		if (repo == null) return undefined;
		if (args?.ref1 == null) return;

		const diff = await getDiffContents(this.container, repo, args);
		if (diff == null) return;

		// let repo;
		// if (args?.repoPath == null) {
		// 	repo = await getRepositoryOrShowPicker('Create Patch');
		// } else {
		// 	repo = this.container.git.getRepository(args.repoPath);
		// }
		// if (repo == null) return;

		// const diff = await this.container.git.getDiff(repo.uri, args?.ref1 ?? 'HEAD', args?.ref2);
		// if (diff == null) return;

		const d = await workspace.openTextDocument({ content: diff.contents, language: 'diff' });
		await window.showTextDocument(d);

		// const uri = await window.showSaveDialog({
		// 	filters: { Patches: ['patch'] },
		// 	saveLabel: 'Create Patch',
		// });
		// if (uri == null) return;

		// await workspace.fs.writeFile(uri, new TextEncoder().encode(patch.contents));
	}
}

async function getDiffContents(
	container: Container,
	repository: Repository,
	args: CreatePatchCommandArgs,
): Promise<{ contents: string; revision: PatchRevisionRange } | undefined> {
	const sha = args.ref1 ?? 'HEAD';

	const diff = await container.git.getDiff(repository.uri, sha, args.ref2);
	if (diff == null) return undefined;

	return {
		contents: diff.contents,
		revision: {
			baseSha: args.ref2 ?? `${sha}^`,
			sha: sha,
		},
	};
}

interface CreateLocalChange {
	title?: string;
	description?: string;
	changes: Change[];
}

async function createLocalChange(
	container: Container,
	repository: Repository,
	args: CreatePatchCommandArgs,
): Promise<CreateLocalChange | undefined> {
	if (args.ref1 == null) return undefined;

	const sha = args.ref1 ?? 'HEAD';
	// const [branchName] = await container.git.getCommitBranches(repository.uri, sha);

	const change: Change = {
		type: 'revision',
		repository: {
			name: repository.name,
			path: repository.path,
			uri: repository.uri.toString(),
		},
		files: undefined!,
		revision: {
			sha: sha,
			baseSha: args.ref2 ?? `${sha}^`,
			// branchName: branchName ?? 'HEAD',
		},
	};

	const create: CreateLocalChange = { changes: [change] };

	const commit = await container.git.getCommit(repository.uri, sha);
	if (commit == null) return undefined;

	const message = commit.message!.trim();
	const index = message.indexOf('\n');
	if (index < 0) {
		create.title = message;
	} else {
		create.title = message.substring(0, index);
		create.description = message.substring(index + 1);
	}

	if (args.ref2 == null) {
		change.files = commit.files != null ? [...commit.files] : [];
	} else {
		const diff = await getDiffContents(container, repository, args);
		if (diff == null) return undefined;

		const result = await container.git.getDiffFiles(repository.uri, diff.contents);
		if (result?.files == null) return;

		create.title = `Comparing ${shortenRevision(args.ref2)} with ${shortenRevision(args.ref1)}`;

		change.files = result.files;
	}

	// const change: Change = {
	// 	type: 'commit',
	// 	repository: {
	// 		name: repository.name,
	// 		path: repository.path,
	// 		uri: repository.uri.toString(),
	// 	},
	// 	files: result.files,
	// 	range: {
	// 		...range,
	// 		branchName: branchName ?? 'HEAD',
	// 	},
	// };

	return create;
}

@command()
export class CreateCloudPatchCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.CreateCloudPatch, Commands.ShareAsCloudPatch]);
	}

	protected override preExecute(context: CommandContext, args?: CreatePatchCommandArgs) {
		if (args == null) {
			if (context.type === 'viewItem') {
				if (isCommandContextViewNodeHasCommit(context)) {
					args = {
						repoPath: context.node.commit.repoPath,
						ref1: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						ref1: context.node.compareWithRef.ref,
						ref2: context.node.compareRef.ref,
					};
				}
			}
		}

		return this.execute(args);
	}

	async execute(args?: CreatePatchCommandArgs) {
		if (args?.repoPath == null) {
			return showPatchesView({ mode: 'create' });
		}

		const repo = this.container.git.getRepository(args.repoPath);
		if (repo == null) {
			return showPatchesView({ mode: 'create' });
		}

		const create = await createLocalChange(this.container, repo, args);
		if (create == null) {
			return showPatchesView({ mode: 'create', create: { repositories: [repo] } });
		}
		return showPatchesView({ mode: 'create', create: create });

		// let changes: Change[] | undefined;
		// if (args?.repoPath != null) {
		// 	const repo = this.container.git.getRepository(args.repoPath);
		// 	if (repo == null) return;

		// 	const diff = await this.container.git.getDiff(repo.uri, args.ref1 ?? 'HEAD', args.ref2);
		// 	if (diff == null) return;

		// 	const result = await this.container.git.getDiffFiles(args.repoPath, diff.contents);
		// 	if (result?.files == null) return;

		// 	const branch = await repo.getBranch();

		// 	changes = [
		// 		{
		// 			type: 'commit',
		// 			repository: {
		// 				name: repo.name,
		// 				path: repo.path,
		// 				uri: repo.uri.toString(true),
		// 			},
		// 			files: result.files,
		// 			range: {
		// 				baseSha: args.ref2 ?? `${args.ref1 ?? 'HEAD'}^`,
		// 				branchName: branch?.name ?? 'HEAD',
		// 				sha: args.ref1 ?? 'HEAD',
		// 			},
		// 		},
		// 	];
		// }

		// let repo;
		// if (args?.repoPath == null) {
		// 	repo = await getRepositoryOrShowPicker('Create Cloud Patch');
		// } else {
		// 	repo = this.container.git.getRepository(args.repoPath);
		// }
		// if (repo == null) return;

		// const diff = await this.container.git.getDiff(repo.uri, args?.ref1 ?? 'HEAD', args?.ref2);
		// if (diff == null) return;

		// const d = await workspace.openTextDocument({ content: diff.contents, language: 'diff' });
		// await window.showTextDocument(d);

		// // ask the user for a title

		// const title = await window.showInputBox({
		// 	title: 'Create Cloud Patch',
		// 	prompt: 'Enter a title for the patch',
		// 	validateInput: value => (value == null || value.length === 0 ? 'A title is required' : undefined),
		// });
		// if (title == null) return;

		// // ask the user for an optional description
		// const description = await window.showInputBox({
		// 	title: 'Create Cloud Patch',
		// 	prompt: 'Enter an optional description for the patch',
		// });

		// const patch = await this.container.drafts.createDraft(
		// 	'patch',
		// 	title,
		// 	{
		// 		contents: diff.contents,
		// 		baseSha: diff.baseSha,
		// 		repository: repo,
		// 	},
		// 	{ description: description },
		// );
		// void this.showPatchNotification(patch);
	}

	// private async showPatchNotification(patch: Draft | undefined) {
	// 	if (patch == null) return;

	// 	await env.clipboard.writeText(patch.deepLinkUrl);

	// 	const copy = { title: 'Copy Link' };
	// 	const result = await window.showInformationMessage(`Created cloud patch ${patch.id}`, copy);

	// 	if (result === copy) {
	// 		await env.clipboard.writeText(patch.deepLinkUrl);
	// 	}
	// }
}

@command()
export class OpenPatchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenPatch);
	}

	async execute(editor?: TextEditor) {
		let document;
		if (editor?.document?.languageId === 'diff') {
			document = editor.document;
		} else {
			const uris = await window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: { Patches: ['diff', 'patch'] },
				openLabel: 'Open Patch',
				title: 'Open Patch File',
			});
			const uri = uris?.[0];
			if (uri == null) return;

			document = await workspace.openTextDocument(uri);
			await window.showTextDocument(document);
		}

		const patch: LocalDraft = {
			draftType: 'local',
			patch: {
				type: 'local',
				uri: document.uri,
				contents: document.getText(),
			},
		};

		void showPatchesView({ mode: 'view', draft: patch });
	}
}

export interface OpenCloudPatchCommandArgs {
	id: string;
	patchId?: string;
	draft?: Draft;
}

@command()
export class OpenCloudPatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenCloudPatch);
	}

	async execute(args?: OpenCloudPatchCommandArgs) {
		if (args?.id == null && args?.draft == null) {
			void window.showErrorMessage('Cannot open cloud patch: no patch or patch id provided');
			return;
		}

		const draft = args?.draft ?? (await this.container.drafts.getDraft(args?.id));
		if (draft == null) {
			void window.showErrorMessage(`Cannot open cloud patch: patch ${args.id} not found`);
			return;
		}

		// let patch: DraftPatch | undefined;
		// if (args?.patchId) {
		// 	patch = await this.container.drafts.getPatch(args.patchId);
		// } else {
		// 	const patches = draft.changesets?.[0]?.patches;

		// 	if (patches == null || patches.length === 0) {
		// 		void window.showErrorMessage(`Cannot open cloud patch: no patch found under id ${args.patchId}`);
		// 		return;
		// 	}

		// 	patch = patches[0];

		// if (patch.repo == null && patch.repoData != null) {
		// 	const repo = await this.container.git.findMatchingRepository({
		// 		firstSha: patch.repoData.initialCommitSha,
		// 		remoteUrl: patch.repoData.remote?.url,
		// 	});
		// 	if (repo != null) {
		// 		patch.repo = repo;
		// 	}
		// }

		// if (patch.repo == null) {
		// 	void window.showErrorMessage(`Cannot open cloud patch: no repository found for patch ${args.patchId}`);
		// 	return;
		// }

		// // Opens the patch repository if it's not already open
		// void this.container.git.getOrOpenRepository(patch.repo.uri);

		// 	const patchContents = await this.container.drafts.getPatchContents(patch.id);
		// 	if (patchContents == null) {
		// 		void window.showErrorMessage(`Cannot open cloud patch: patch not found of contents empty`);
		// 		return;
		// 	}
		// 	patch.contents = patchContents;
		// }

		// if (patch == null) {
		// 	void window.showErrorMessage(`Cannot open cloud patch: patch not found`);
		// 	return;
		// }

		void showPatchesView({ mode: 'view', draft: draft });
	}
}
