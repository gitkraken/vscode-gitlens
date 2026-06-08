import type { Uri } from 'vscode';
import type { GitGraphRow, GitGraphRowContexts, GraphContext, GraphRowProcessor } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { getCachedAvatarUri } from '../avatars.js';
import type { Container } from '../container.js';
import { emojify } from '../emojis.js';
import { serializeWebviewItemContext } from '../system/webview.js';
import type {
	GraphBranchContextValue,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphTagContextValue,
} from '../webviews/plus/graph/protocol.js';
import { formatCurrentUserDisplayName } from './utils/-webview/commit.utils.js';
import { getRemoteIconUri } from './utils/-webview/icons.js';

export class GlGraphRowProcessor implements GraphRowProcessor {
	constructor(
		private readonly container: Container,
		private readonly asWebviewUri: (uri: Uri) => Uri,
		private readonly getPinnedRefId: () => string | undefined = () => undefined,
	) {}

	processRow(row: GitGraphRow, context: GraphContext): void {
		const pinnedRefId = this.getPinnedRefId();
		const groupedRefs = new Map<
			string,
			{ head?: boolean; local?: GitBranchReference; remotes?: GitBranchReference[] }
		>();

		// Enrich tags with serialized webview contexts
		if (row.tags) {
			for (const tag of row.tags) {
				tag.context = serializeWebviewItemContext<GraphItemRefContext<GraphTagContextValue>>({
					webviewItem: 'gitlens:tag',
					webviewItemValue: {
						type: 'tag',
						ref: createReference(tag.name, context.repoPath, {
							id: tag.id,
							refType: 'tag',
							name: tag.name,
						}),
					},
				});
			}
		}

		// Enrich local branch heads with serialized webview contexts
		if (row.heads) {
			for (const head of row.heads) {
				const branch = context.branches.get(head.name);
				const ctx: GraphItemRefContext<GraphBranchContextValue> = {
					webviewItem: `gitlens:branch${head.isCurrentHead ? '+current' : ''}${
						branch?.upstream != null ? '+tracking' : ''
					}${
						head.id != null && context.worktreesByBranch?.has(head.id)
							? '+worktree'
							: context.branchIdOfMainWorktree === head.id
								? '+checkedout'
								: ''
					}${branch?.starred ? '+starred' : ''}${
						branch?.upstream?.state.ahead ? '+ahead' : ''
					}${branch?.upstream?.state.behind ? '+behind' : ''}${pinnedRefId != null && head.id === pinnedRefId ? '+pinned' : ''}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(head.name, context.repoPath, {
							id: head.id,
							refType: 'branch',
							name: head.name,
							remote: false,
							upstream: branch?.upstream,
						}),
					},
				};

				head.context = serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(ctx);

				let group = groupedRefs.get(head.name);
				if (group == null) {
					group = {};
					groupedRefs.set(head.name, group);
				}
				if (head.isCurrentHead) {
					group.head = true;
				}
				group.local = ctx.webviewItemValue.ref;
			}
		}

		// Enrich remote heads with serialized webview contexts and avatar URLs
		if (row.remotes) {
			for (const remoteHead of row.remotes) {
				const remote = context.remotes.get(remoteHead.owner);
				const fullName = `${remoteHead.owner}/${remoteHead.name}`;

				// Set avatar URL from provider data or extension icon URI
				remoteHead.avatarUrl = (
					(context.useAvatars ? remote?.provider?.avatarUri : undefined) ??
					(remote != null ? getRemoteIconUri(this.container, remote, this.asWebviewUri) : undefined)
				)?.toString(true);

				const ctx: GraphItemRefContext<GraphBranchContextValue> = {
					webviewItem: `gitlens:branch+remote${context.branches.get(fullName)?.starred ? '+starred' : ''}${
						pinnedRefId != null && remoteHead.id === pinnedRefId ? '+pinned' : ''
					}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(fullName, context.repoPath, {
							id: remoteHead.id,
							refType: 'branch',
							name: fullName,
							remote: true,
							upstream: { name: remoteHead.owner, missing: false },
						}),
					},
				};

				remoteHead.context = serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(ctx);

				let group = groupedRefs.get(remoteHead.name);
				if (group == null) {
					group = { remotes: [] };
					groupedRefs.set(remoteHead.name, group);
				}
				group.remotes ??= [];
				group.remotes.push(ctx.webviewItemValue.ref);
			}
		}

		// Build contexts object for this row
		const contexts: GitGraphRowContexts = {};

		// Build ref group contexts from grouped local + remote refs
		for (const [groupName, group] of groupedRefs) {
			if (
				group.remotes != null &&
				((group.local != null && group.remotes.length > 0) || group.remotes.length > 1)
			) {
				contexts.refGroups ??= {};
				contexts.refGroups[groupName] = serializeWebviewItemContext<GraphItemRefGroupContext>({
					webviewItemGroup: `gitlens:refGroup${group.head ? '+current' : ''}`,
					webviewItemGroupValue: {
						type: 'refGroup',
						refs: group.local != null ? [group.local, ...group.remotes] : group.remotes,
					},
				});
			}
		}

		// Build row context (stash or commit) and avatar context
		if (row.type === 'stash-node') {
			const stash = context.stashes?.get(row.sha);
			if (stash != null) {
				contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
					webviewItem: 'gitlens:stash',
					webviewItemValue: {
						type: 'stash',
						ref: createReference(row.sha, context.repoPath, {
							refType: 'stash',
							name: stash.name,
							message: stash.message,
							number: stash.stashNumber,
						}),
					},
				});
			}
		} else {
			// Commit `contexts.row` + `contexts.avatar` are NOT serialized here: they duplicated
			// sha/message/repoPath/author/email already present on the row, a meaningful chunk of the
			// per-row payload. Instead ship the two host-only bits as compact flags; the webview
			// reconstructs the full webview-item contexts on demand at right-click/selection time from
			// row fields + repoPath + these flags (see `rowContext.utils` + `graph-wrapper`'s
			// `injectRowContextMenuContext`). `+HEAD`/`+worktreeHEAD` and contributor `+current` are
			// derived webview-side from `row.heads`/`row.isCurrentUser` and need no flag.
			const localBranches = row.reachability?.refs.filter(r => r.refType === 'branch' && !r.remote);
			// Unpublished = reachable from HEAD but not from HEAD's upstream tip. `reachableFromHeadUpstream`
			// is undefined when HEAD has no upstream, so nothing is ever flagged in that case.
			const isUnpublished =
				context.reachableFromHeadUpstream != null &&
				context.reachableFromHEAD.has(row.sha) &&
				!context.reachableFromHeadUpstream.has(row.sha);
			contexts.flags =
				(context.reachableFromHEAD.has(row.sha) ? GitGraphRowContextFlags.ReachableFromHead : 0) |
				(context.rewriteableFromHEAD.has(row.sha) ? GitGraphRowContextFlags.RewriteableFromHead : 0) |
				(localBranches?.length === 1 ? GitGraphRowContextFlags.UniqueToBranch : 0) |
				(context.tipShasWithChildren.has(row.sha) ? GitGraphRowContextFlags.HasChildren : 0) |
				(isUnpublished ? GitGraphRowContextFlags.Unpublished : 0);

			// Populate avatar cache
			if (!context.avatars.has(row.email)) {
				const avatarUri = getCachedAvatarUri(row.email);
				if (avatarUri != null) {
					context.avatars.set(row.email, avatarUri.toString(true));
				}
			}
		}

		row.contexts = contexts;

		// Apply display name formatting for current user (after context building, which uses the raw name)
		if (row.isCurrentUser) {
			row.author = formatCurrentUserDisplayName(row.author);
		}

		// Emojify message (after context building, which uses the raw message)
		row.message = emojify(row.message);
	}
}
