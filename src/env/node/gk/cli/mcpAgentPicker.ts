import type { Disposable } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { defer } from '@gitlens/utils/promise.js';
import { sortCompare } from '@gitlens/utils/string.js';
import type { QuickPickItemOfT } from '../../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../../quickpicks/items/directive.js';
import {
	createDirectiveQuickPickItem,
	Directive,
	isDirectiveQuickPickItem,
} from '../../../../quickpicks/items/directive.js';
import type { GkAgent } from './agents.js';
import { getAllAgents, ideAgentIds } from './agents.js';

type McpAgentQuickPickItem = QuickPickItemOfT<GkAgent>;
type McpAgentPickItem = McpAgentQuickPickItem | DirectiveQuickPickItem;

export async function showMcpAgentPicker(
	cliPath?: string,
	options?: { showEmptyState?: boolean },
): Promise<GkAgent[] | undefined> {
	const all = await getAllAgents(cliPath);
	// Detected, MCP-supported, non-IDE agents — the same population the legacy `getDetectedAgents` produced.
	const detected = all.filter(a => a.detected && a.mcpSupported && !ideAgentIds.has(a.name));
	const selectable = detected.filter(a => !a.mcpInstalled);

	if (selectable.length === 0 && !options?.showEmptyState) return undefined;

	const deferred = defer<GkAgent[] | undefined>();
	const disposables: Disposable[] = [];

	try {
		const quickpick = window.createQuickPick<McpAgentPickItem>();
		disposables.push(
			quickpick,
			quickpick.onDidHide(() => deferred.fulfill(undefined)),
			quickpick.onDidAccept(() => {
				if (quickpick.busy) return;

				const selected = quickpick.selectedItems.filter(
					(i): i is McpAgentQuickPickItem => !isDirectiveQuickPickItem(i),
				);
				deferred.fulfill(selected.length > 0 ? selected.map(i => i.item) : undefined);
			}),
		);

		quickpick.ignoreFocusOut = true;
		quickpick.title = 'Connect GitKraken MCP to Agents';
		quickpick.matchOnDescription = true;

		if (selectable.length === 0) {
			quickpick.placeholder =
				detected.length === 0
					? 'No additional MCP-ready agents were detected on your machine'
					: 'All detected agents have the GitKraken MCP installed';
			quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel)];
		} else {
			quickpick.placeholder = 'Select agents to install the GitKraken MCP server for';
			quickpick.canSelectMany = true;
			quickpick.items = selectable
				.map(agent => ({
					label: agent.displayName,
					iconPath: new ThemeIcon('terminal'),
					item: agent,
				}))
				.sort((a, b) => sortCompare(a.label, b.label));
		}

		quickpick.show();

		return await deferred.promise;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
