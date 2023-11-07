import type { DraftSelectedEvent } from '../../../eventBus';
import type { Repository } from '../../../git/models/repository';
import { setContext } from '../../../system/context';
import type { Serialized } from '../../../system/serialize';
import type { WebviewsController } from '../../../webviews/webviewsController';
import type { Change, State } from './protocol';

interface CreateDraftFromChanges {
	title?: string;
	description?: string;
	changes: Change[];
	repositories?: never;
}

interface CreateDraftFromRepositories {
	title?: string;
	description?: string;
	changes?: never;
	repositories: Repository[] | undefined;
}

export type CreateDraft = CreateDraftFromChanges | CreateDraftFromRepositories;
export type OpenDraft = DraftSelectedEvent['data']['draft'];

export type ShowCreateDraft = {
	mode: 'create';
	create?: CreateDraft;
};

export type ShowOpenDraft = {
	mode: 'open';
	open: OpenDraft;
};

export type PatchDetailsWebviewShowingArgs = [ShowCreateDraft | ShowOpenDraft];

export function registerPatchDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>, PatchDetailsWebviewShowingArgs>(
		{
			id: 'gitlens.views.patchDetails',
			fileName: 'patchDetails.html',
			title: 'Patch',
			contextKeyPrefix: `gitlens:webviewView:patchDetails`,
			trackingFeature: 'patchDetailsView',
			plusFeature: true,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { PatchDetailsWebviewProvider } = await import(
				/* webpackChunkName: "patchDetails" */ './patchDetailsWebview'
			);
			return new PatchDetailsWebviewProvider(container, host);
		},
		async (...args) => {
			const arg = args[0];
			if (arg == null) return;

			await setContext('gitlens:views:patchDetails:mode', 'state' in arg ? arg.state.mode : arg.mode);
		},
	);
}
