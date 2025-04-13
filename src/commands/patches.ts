import { EntityIdentifierUtils } from '@gitkraken/provider-apis/entity-identifiers';
import type { TextEditor } from 'vscode';
import { env, Uri, window, workspace } from 'vscode';
import type { ScmResource } from '../@types/vscode.git.resources';
import { ScmResourceGroupType, ScmStatus } from '../@types/vscode.git.resources.enums';
import type { GlCommands } from '../constants.commands';
import type { IntegrationId } from '../constants.integrations';
import type { Container } from '../container';
import { CancellationError } from '../errors';
import { ApplyPatchCommitError, ApplyPatchCommitErrorReason } from '../git/errors';
import type { GitDiff } from '../git/models/diff';
import type { Repository } from '../git/models/repository';
import { uncommitted, uncommittedStaged } from '../git/models/revision';
import { splitCommitMessage } from '../git/utils/commit.utils';
import { isSha, shortenRevision } from '../git/utils/revision.utils';
import { showPatchesView } from '../plus/drafts/actions';
import type { ProviderAuth } from '../plus/drafts/draftsService';
import type { Draft, LocalDraft } from '../plus/drafts/models/drafts';
import { getProviderIdFromEntityIdentifier } from '../plus/integrations/providers/utils';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { map } from '../system/iterable';
import { Logger } from '../system/logger';
import { isViewRefFileNode } from '../views/nodes/utils/-webview/node.utils';
import type { Change, CreateDraft } from '../webviews/plus/patchDetails/protocol';
import { ActiveEditorCommand, GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
	isCommandContextViewNodeHasFileCommit,
	isCommandContextViewNodeHasFileRefs,
} from './commandContext.utils';

export interface CreatePatchCommandArgs {
	to?: string;
	from?: string;
	repoPath?: string;
	uris?: Uri[];

	includeUntracked?: boolean;

	title?: string;
	description?: string;
}

abstract class CreatePatchCommandBase extends GlCommandBase {
	constructor(
		protected readonly container: Container,
		command: GlCommands | GlCommands[],
	) {
		super(command);
	}

	protected override async preExecute(context: CommandContext, args?: CreatePatchCommandArgs) {
		if (args == null) {
			if (context.type === 'scm-states') {
				const resourcesByGroup = new Map<ScmResourceGroupType, ScmResource[]>();
				const uris = new Set<string>();

				let includeUntracked = false;

				let repo;
				for (const resource of context.scmResourceStates as ScmResource[]) {
					repo ??= await this.container.git.getOrOpenRepository(resource.resourceUri);

					includeUntracked = includeUntracked || resource.type === ScmStatus.UNTRACKED;
					uris.add(resource.resourceUri.toString());

					let groupResources = resourcesByGroup.get(resource.resourceGroupType!);
					if (groupResources == null) {
						groupResources = [];
						resourcesByGroup.set(resource.resourceGroupType!, groupResources);
					} else {
						groupResources.push(resource);
					}
				}

				const to =
					resourcesByGroup.size === 1 && resourcesByGroup.has(ScmResourceGroupType.Index)
						? uncommittedStaged
						: uncommitted;
				args = {
					repoPath: repo?.path,
					to: to,
					from: 'HEAD',
					uris: [...map(uris, u => Uri.parse(u))],
					title: to === uncommittedStaged ? 'Staged Changes' : 'Uncommitted Changes',
					includeUntracked: includeUntracked ? true : undefined,
				};
			} else if (context.type === 'scm-groups') {
				const group = context.scmResourceGroups[0];
				if (!group?.resourceStates?.length) return;

				const repo = await this.container.git.getOrOpenRepository(group.resourceStates[0].resourceUri);

				const to = group.id === 'index' ? uncommittedStaged : uncommitted;
				args = {
					repoPath: repo?.path,
					to: to,
					from: 'HEAD',
					title: to === uncommittedStaged ? 'Staged Changes' : 'Uncommitted Changes',
				};
			} else if (context.type === 'viewItem') {
				if (isCommandContextViewNodeHasCommit(context)) {
					const { commit } = context.node;
					if (commit.message == null) {
						await commit.ensureFullDetails();
					}

					const { summary: title, body: description } = splitCommitMessage(commit.message);

					args = {
						repoPath: context.node.commit.repoPath,
						to: context.node.commit.ref,
						from: `${context.node.commit.ref}^`,
						title: title,
						description: description,
					};
					if (isCommandContextViewNodeHasFileCommit(context)) {
						args.uris = [context.node.uri];
					}
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						to: context.node.compareRef.ref,
						from: context.node.compareWithRef.ref,
						title: `Changes between ${shortenRevision(context.node.compareRef.ref)} and ${shortenRevision(
							context.node.compareWithRef.ref,
						)}`,
					};
				} else if (isCommandContextViewNodeHasFileRefs(context)) {
					args = {
						repoPath: context.node.repoPath,
						to: context.node.ref2,
						from: context.node.ref1,
						uris: [context.node.uri],
					};
				}
			} else if (context.type === 'viewItems') {
				if (isViewRefFileNode(context.node)) {
					args = {
						repoPath: context.node.repoPath,
						to: context.node.ref.sha,
						from: `${context.node.ref.sha}^`,
						uris: [context.node.uri],
						title: `Changes (partial) in ${shortenRevision(context.node.ref.sha)}`,
					};

					for (const node of context.nodes) {
						if (isViewRefFileNode(node) && node !== context.node && node.ref.sha === args.to) {
							args.uris!.push(node.uri);
						}
					}
				}
			}
		}

		return this.execute(args);
	}

	protected async getDiff(title: string, args?: CreatePatchCommandArgs): Promise<GitDiff | undefined> {
		let repo;
		if (args?.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		}
		repo ??= await getRepositoryOrShowPicker(title);
		if (repo == null) return;

		return repo.git.diff().getDiff?.(args?.to ?? uncommitted, args?.from ?? 'HEAD', {
			includeUntracked: args?.includeUntracked ?? (args?.to != null || args?.to === uncommitted),
			uris: args?.uris,
		});
	}

	abstract override execute(args?: CreatePatchCommandArgs): Promise<void>;
}

@command()
export class CreatePatchCommand extends CreatePatchCommandBase {
	constructor(container: Container) {
		super(container, 'gitlens.createPatch');
	}

	async execute(args?: CreatePatchCommandArgs): Promise<void> {
		const diff = await this.getDiff('Create Patch', args);
		if (diff == null) return;

		debugger;
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
export class CopyPatchToClipboardCommand extends CreatePatchCommandBase {
	constructor(container: Container) {
		super(container, 'gitlens.copyPatchToClipboard');
	}

	async execute(args?: CreatePatchCommandArgs): Promise<void> {
		const diff = await this.getDiff('Copy as Patch', args);
		if (diff == null) return;

		await env.clipboard.writeText(diff.contents);
		void window.showInformationMessage(
			"Copied patch \u2014 use 'Apply Copied Patch' in another window to apply it",
		);
	}
}

@command()
export class ApplyPatchFromClipboardCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.applyPatchFromClipboard', 'gitlens.pastePatchFromClipboard']);
	}

	async execute(): Promise<void> {
		const patch = await env.clipboard.readText();
		let repo = this.container.git.highlander;

		const patchProvider = repo?.uri != null ? this.container.git.patch(repo.uri) : undefined;

		// Make sure it looks like a valid patch
		const valid = patch.length ? await patchProvider?.validatePatch(patch) : false;
		if (!valid) {
			void window.showWarningMessage('No valid patch found in the clipboard');
			return;
		}

		repo ??= await getRepositoryOrShowPicker('Apply Copied Patch');
		if (repo == null) return;

		try {
			const commit = await patchProvider?.createUnreachableCommitForPatch('HEAD', 'Pasted Patch', patch);
			if (commit == null) return;

			await patchProvider?.applyUnreachableCommitForPatch(commit.sha, { stash: false });
			void window.showInformationMessage(`Patch applied successfully`);
		} catch (ex) {
			if (ex instanceof CancellationError) return;

			if (ex instanceof ApplyPatchCommitError) {
				if (ex.reason === ApplyPatchCommitErrorReason.AppliedWithConflicts) {
					void window.showWarningMessage('Patch applied with conflicts');
				} else {
					void window.showErrorMessage(ex.message);
				}
			} else {
				void window.showErrorMessage(`Unable to apply patch: ${ex.message}`);
			}
		}
	}
}

@command()
export class CreateCloudPatchCommand extends CreatePatchCommandBase {
	constructor(container: Container) {
		super(container, ['gitlens.createCloudPatch', 'gitlens.shareAsCloudPatch']);
	}

	async execute(args?: CreatePatchCommandArgs): Promise<void> {
		if (args?.repoPath == null) {
			return showPatchesView({ mode: 'create' });
		}

		const repo = this.container.git.getRepository(args.repoPath);
		if (repo == null) {
			return showPatchesView({ mode: 'create' });
		}

		const create = await createDraft(repo, args);
		if (create == null) {
			return showPatchesView({ mode: 'create', create: { repositories: [repo] } });
		}
		return showPatchesView({ mode: 'create', create: create });
	}
}

@command()
export class OpenPatchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.openPatch');
	}

	async execute(editor?: TextEditor): Promise<void> {
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

export type OpenCloudPatchCommandArgs =
	| {
			type: 'patch' | 'code_suggestion';
			id: string;
			draft?: Draft;
			patchId?: string;
			prEntityId?: string;
	  }
	| {
			type: 'patch' | 'code_suggestion';
			id?: string;
			draft: Draft;
			patchId?: string;
			prEntityId?: string;
	  };

@command()
export class OpenCloudPatchCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openCloudPatch');
	}

	async execute(args?: OpenCloudPatchCommandArgs): Promise<void> {
		const type = args?.type === 'code_suggestion' ? 'Code Suggestion' : 'Cloud Patch';
		if (args?.id == null && args?.draft == null) {
			void window.showErrorMessage(`Cannot open ${type}; no patch or patch id provided`);
			return;
		}

		let providerAuth: ProviderAuth | undefined;
		if (args.prEntityId != null && args.type === 'code_suggestion') {
			let providerId: IntegrationId | undefined;
			let providerDomain: string | undefined;
			try {
				const identifier = EntityIdentifierUtils.decode(args.prEntityId);
				providerId = getProviderIdFromEntityIdentifier(identifier);
				providerDomain = identifier.domain ?? undefined;
			} catch {
				void window.showErrorMessage(`Cannot open ${type}; invalid provider details.`);
				return;
			}

			if (providerId == null) {
				void window.showErrorMessage(`Cannot open ${type}; unsupported provider.`);
				return;
			}

			const integration = await this.container.integrations.get(providerId, providerDomain);
			if (integration == null) {
				void window.showErrorMessage(`Cannot open ${type}; provider not found.`);
				return;
			}

			const session = await integration.getSession('cloud-patches');
			if (session == null) {
				void window.showErrorMessage(`Cannot open ${type}; provider not connected.`);
				return;
			}

			providerAuth = { provider: integration.id, token: session.accessToken };
		}

		try {
			const draft =
				args.draft ?? (await this.container.drafts.getDraft(args.id!, { providerAuth: providerAuth }));
			void showPatchesView({ mode: 'view', draft: draft });
		} catch (ex) {
			Logger.error(ex, 'OpenCloudPatchCommand');
			void window.showErrorMessage(`Unable to open ${type} '${args.id}'`);
		}
	}
}

async function createDraft(repository: Repository, args: CreatePatchCommandArgs): Promise<CreateDraft | undefined> {
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

	const create: CreateDraft = { changes: [change], title: args.title, description: args.description };

	const commitsProvider = repository.git.commits();

	const commit = await commitsProvider.getCommit(to);
	if (commit == null) return undefined;

	if (args.from == null) {
		if (commit.fileset?.files == null) return;

		change.files = [...commit.fileset.files];
	} else {
		const diff = await repository.git.diff().getDiff?.(to, args.from);
		if (diff == null) return;

		const result = await repository.git.diff().getDiffFiles?.(diff.contents);
		if (result?.files == null) return;

		change.files = result.files;

		if (!isSha(args.to)) {
			const commit = await commitsProvider.getCommit(args.to);
			if (commit != null) {
				change.revision.to = commit.sha;
			}
		}

		if (!isSha(args.from)) {
			const commit = await commitsProvider.getCommit(args.from);
			if (commit != null) {
				change.revision.from = commit.sha;
			}
		}
	}

	return create;
}
