import type { TextEditor } from 'vscode';
import { window, workspace } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { isSha, shortenRevision } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import type { Draft, LocalDraft } from '../gk/models/drafts';
import { showPatchesView } from '../plus/drafts/actions';
import type { Change, CreateDraft } from '../plus/webviews/patchDetails/protocol';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	Command,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
} from './base';

export interface CreatePatchCommandArgs {
	to?: string;
	from?: string;
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
						to: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						to: context.node.compareRef.ref,
						from: context.node.compareWithRef.ref,
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
		if (args?.to == null) return;

		const diff = await this.container.git.getDiff(repo.uri, args.to ?? 'HEAD', args.from);
		if (diff == null) return;

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
						to: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						to: context.node.compareRef.ref,
						from: context.node.compareWithRef.ref,
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

		const create = await createDraft(this.container, repo, args);
		if (create == null) {
			return showPatchesView({ mode: 'create', create: { repositories: [repo] } });
		}
		return showPatchesView({ mode: 'create', create: create });
	}
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
			void window.showErrorMessage('Cannot open Cloud Patch; no patch or patch id provided');
			return;
		}

		try {
			const draft = args?.draft ?? (await this.container.drafts.getDraft(args?.id));
			void showPatchesView({ mode: 'view', draft: draft });
		} catch (ex) {
			Logger.error(ex, 'OpenCloudPatchCommand');
			void window.showErrorMessage(`Unable to open Cloud Patch '${args.id}'`);
		}
	}
}

async function createDraft(
	container: Container,
	repository: Repository,
	args: CreatePatchCommandArgs,
): Promise<CreateDraft | undefined> {
	if (args.to == null) return undefined;

	const to = args.to ?? 'HEAD';

	const change: Change = {
		type: 'revision',
		repository: {
			name: repository.name,
			path: repository.path,
			uri: repository.uri.toString(),
		},
		files: undefined!,
		revision: { to: to, from: args.from ?? `${to}^` },
	};

	const create: CreateDraft = { changes: [change] };

	const commit = await container.git.getCommit(repository.uri, to);
	if (commit == null) return undefined;

	const message = commit.message!.trim();
	const index = message.indexOf('\n');
	if (index < 0) {
		create.title = message;
	} else {
		create.title = message.substring(0, index);
		create.description = message.substring(index + 1).trim();
	}

	if (args.from == null) {
		if (commit.files == null) return;

		change.files = [...commit.files];
	} else {
		const diff = await container.git.getDiff(repository.uri, to, args.from);
		if (diff == null) return;

		const result = await container.git.getDiffFiles(repository.uri, diff.contents);
		if (result?.files == null) return;

		change.files = result.files;

		create.title = `Comparing ${shortenRevision(args.to)} with ${shortenRevision(args.from)}`;

		if (!isSha(args.to)) {
			const commit = await container.git.getCommit(repository.uri, args.to);
			if (commit != null) {
				change.revision.to = commit.sha;
			}
		}

		if (!isSha(args.from)) {
			const commit = await container.git.getCommit(repository.uri, args.from);
			if (commit != null) {
				change.revision.from = commit.sha;
			}
		}
	}

	return create;
}
