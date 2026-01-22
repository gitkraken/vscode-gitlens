import { revealContributor } from '../../../git/actions/contributor.js';
import type { GitContributor } from '../../../git/models/contributor.js';
import type { Repository } from '../../../git/models/repository.js';
import type { ContributorQuickPickItem } from '../../../git/utils/-webview/contributor.quickpick.js';
import { createContributorQuickPickItem } from '../../../git/utils/-webview/contributor.quickpick.js';
import { sortContributors } from '../../../git/utils/-webview/sorting.js';
import { isDirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { debounce } from '../../../system/function/debounce.js';
import type { PartialStepState, StepResultGenerator, StepsContext, StepSelection } from '../models/steps.js';
import { StepResultBreak } from '../models/steps.js';
import { RevealInSideBarQuickInputButton } from '../quickButtons.js';
import { appendReposToTitle, canPickStepContinue, createPickStep } from '../utils/steps.utils.js';

export function* pickContributorsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends StepsContext<any> & { repos: Repository[] },
>(
	state: State,
	context: Context,
	options?: { picked?: string | string[]; placeholder?: string },
): StepResultGenerator<GitContributor[]> {
	async function getItems() {
		const message = (await state.repo.git.getOrOpenScmRepository())?.inputBox.value;

		const items = [];

		for (const c of await state.repo.git.contributors.getContributorsLite()) {
			items.push(
				await createContributorQuickPickItem(
					c,
					options?.picked != null
						? typeof options.picked === 'string'
							? c.email === options.picked
							: options.picked.includes(c.email!)
						: message?.includes(c.getCoauthor()),
					{
						buttons: [RevealInSideBarQuickInputButton],
					},
				),
			);
		}

		return sortContributors(items);
	}

	const step = createPickStep<ContributorQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		allowEmpty: true,
		multiselect: true,
		placeholder: options?.placeholder ?? 'Choose contributors',
		matchOnDescription: true,
		items: getItems(),
		canGoBack: context.steps?.canGoBack,
		onDidClickItemButton: (_quickpick, button, { item }) => {
			if (button === RevealInSideBarQuickInputButton) {
				void revealContributor(item, { select: true, focus: false, expand: true });
			}
		},
		onDidChangeSelection: debounce((quickpick, e) => {
			if (!quickpick.canSelectMany || quickpick.busy) return;

			let update = false;
			for (const item of quickpick.items) {
				if (isDirectiveQuickPickItem(item)) continue;

				const picked = e.includes(item);
				if (item.picked !== picked || item.alwaysShow !== picked) {
					item.alwaysShow = item.picked = picked;
					update = true;
				}
			}

			if (update) {
				quickpick.items = sortContributors([...quickpick.items]);
				quickpick.selectedItems = e;
			}
		}, 10),
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: (_quickpick, _key, { item }) => {
			void revealContributor(item, { select: true, focus: false, expand: true });
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	return canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResultBreak;
}
