import type { AsyncStepResultGenerator } from '../../commands/quick-wizard/models/steps.js';
import { proBadge } from '../../constants.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GitBranchReference } from '../../git/models/reference.js';
import { addAssociatedIssueToBranch } from '../../git/utils/-webview/branch.issue.utils.js';
import { showBranchPicker } from '../../quickpicks/branchPicker.js';
import { getIssueOwner } from '../integrations/providers/utils.js';
import type { StartWorkContext, StartWorkOverrides, StartWorkStepState } from './startWorkBase.js';
import { StartWorkBaseCommand } from './startWorkBase.js';

export interface AssociateIssueWithBranchCommandArgs {
	readonly command: 'associateIssueWithBranch';
	branch?: GitBranchReference;
	source?: Sources;
}

export class AssociateIssueWithBranchCommand extends StartWorkBaseCommand {
	private branch: GitBranchReference | undefined;
	protected override overrides: StartWorkOverrides = {
		ownSource: 'associateIssueWithBranch',
		placeholders: {
			cloudIntegrationConnectHasConnected:
				'Connect additional integrations to associate their issues with your branches',
			cloudIntegrationConnectNoConnected: 'Connect an integration to associate its issues with your branches',
			localIntegrationConnect: 'Connect an integration to associate its issues with your branches',
			issueSelection: 'Choose an issue to associate with your branch',
		},
	};

	constructor(container: Container, args?: AssociateIssueWithBranchCommandArgs) {
		super(
			container,
			{ command: 'associateIssueWithBranch', source: args?.source ?? 'commandPalette' },
			'associateIssueWithBranch',
			'associateIssueWithBranch',
			`Associate Issue with Branch\u00a0\u00a0${proBadge}`,
			'Associate an issue with your branch',
			'associateIssueWithBranch',
		);
		this.branch = args?.branch;
	}

	// eslint-disable-next-line require-yield
	protected override async *continuation(
		state: StartWorkStepState,
		_context: StartWorkContext,
	): AsyncStepResultGenerator<void> {
		if (!this.container.git.openRepositories.length) return;

		const issue = state.item.issue;

		this.branch ??= await showBranchPicker(
			`Associate Issue with Branch\u00a0\u00a0${proBadge}`,
			'Choose a branch to associate the issue with',
			this.container.git.openRepositories,
			{ filter: b => !b.remote },
		);
		if (this.branch == null) return;

		const owner = getIssueOwner(issue);
		if (owner == null) return;

		await addAssociatedIssueToBranch(this.container, this.branch, { ...issue, type: 'issue' }, owner);
	}
}
