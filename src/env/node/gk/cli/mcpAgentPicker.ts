import type { Disposable } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { defer } from '@gitlens/utils/promise.js';
import { sortCompare } from '@gitlens/utils/string.js';
import type { QuickPickItemOfT } from '../../../../quickpicks/items/common.js';
import type { McpAgent } from './mcpAgents.js';
import { getSelectableAgents } from './mcpAgents.js';

type McpAgentQuickPickItem = QuickPickItemOfT<McpAgent>;

export async function showMcpAgentPicker(cliPath?: string): Promise<McpAgent[] | undefined> {
	const agents = await getSelectableAgents(cliPath);

	if (agents.length === 0) return undefined;

	const deferred = defer<McpAgent[] | undefined>();
	const disposables: Disposable[] = [];

	try {
		const quickpick = window.createQuickPick<McpAgentQuickPickItem>();
		disposables.push(
			quickpick,
			quickpick.onDidHide(() => deferred.fulfill(undefined)),
			quickpick.onDidAccept(() => {
				if (!quickpick.busy) {
					deferred.fulfill(quickpick.selectedItems.map(i => i.item));
				}
			}),
		);

		quickpick.ignoreFocusOut = true;
		quickpick.title = 'Connect GitKraken MCP to Agents';
		quickpick.placeholder = 'Select agents to install the GitKraken MCP server for';
		quickpick.canSelectMany = true;
		quickpick.matchOnDescription = true;

		const items: McpAgentQuickPickItem[] = agents
			.map(agent => ({
				label: agent.displayName,
				iconPath: new ThemeIcon('terminal'),
				item: agent,
			}))
			.sort((a, b) => sortCompare(a.label, b.label));

		quickpick.items = items;
		quickpick.show();

		const picks = await deferred.promise;
		return picks;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
