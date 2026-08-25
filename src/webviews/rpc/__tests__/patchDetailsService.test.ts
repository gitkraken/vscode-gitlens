import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { Serialized } from '../../../system/serialize.js';
import type { ApplyPatchParams, DraftDetails, State } from '../../plus/patchDetails/protocol.js';
import { EventVisibilityBuffer } from '../eventVisibilityBuffer.js';
import type { PatchDetailsRpcHandlers } from '../patchDetailsService.js';
import { PatchDetailsService } from '../patchDetailsService.js';
import type { Unsubscribe } from '../services/types.js';

/** Calls an unsubscribe handle — host-side subscriptions always resolve synchronously. */
function unsubscribeNow(unsubscribe: Unsubscribe): void {
	(unsubscribe as () => void)();
}

function createState(mode: 'create' | 'view'): Serialized<State> {
	const state: Serialized<State> = {
		webviewId: 'gitlens.patchDetails',
		webviewInstanceId: 'instance-1',
		timestamp: 0,
		mode: mode,
		preferences: {
			avatars: true,
			dateFormat: 'MMMM Do, YYYY h:mma',
			files: { compact: true, icon: 'type', layout: 'auto', threshold: 5 },
			indentGuides: 'onHover',
			indent: 16,
			aiEnabled: false,
		},
		orgSettings: { ai: false, byob: false },
	};
	return state;
}

function createHandlers(overrides?: Partial<PatchDetailsRpcHandlers>): PatchDetailsRpcHandlers {
	return {
		applyPatch: sinon.stub(),
		archiveDraft: sinon.stub().resolves(),
		createDraft: sinon.stub().resolves(),
		openInCommitGraph: sinon.stub(),
		patchChecked: sinon.stub(),
		openFile: sinon.stub().resolves(),
		openFileComparisonWithWorking: sinon.stub().resolves(),
		openFileComparisonWithPrevious: sinon.stub().resolves(),
		switchMode: sinon.stub(),
		copyCloudLink: sinon.stub(),
		getState: sinon.stub().resolves(createState('view')),
		updateCreateCheckedState: sinon.stub(),
		updateCreateMetadata: sinon.stub(),
		updateDraftMetadata: sinon.stub(),
		updateDraftPermissions: sinon.stub().resolves(),
		inviteUsers: sinon.stub().resolves(),
		updateUserSelection: sinon.stub(),
		updatePreferences: sinon.stub(),
		explain: sinon.stub().resolves({ error: { message: 'unimplemented' } }),
		generate: sinon.stub().resolves({ error: { message: 'unimplemented' } }),
		...overrides,
	};
}

suite('patchDetailsService', () => {
	test('applyPatch delegates verbatim to its handler', async () => {
		const handlers = createHandlers();
		const service = new PatchDetailsService(handlers);
		const details: DraftDetails = {
			draftType: 'cloud',
			id: 'd1',
			type: 'patch',
			createdAt: 0,
			updatedAt: 0,
			author: { id: 'a', name: 'n', email: undefined },
			role: 'owner',
			visibility: 'public',
			title: 't',
			isArchived: false,
		};
		const params: ApplyPatchParams = { details: details, target: 'branch', selected: ['p1'] };

		await service.applyPatch(params);

		assert.ok((handlers.applyPatch as sinon.SinonStub).calledOnceWithExactly(params));
	});

	test('explain forwards the abort signal to its handler', async () => {
		const controller = new AbortController();
		const result = { result: { summary: 's', body: 'b' } };
		const explain = sinon.stub().resolves(result);
		const service = new PatchDetailsService(createHandlers({ explain: explain }));

		const actual = await service.explain(controller.signal);

		assert.strictEqual(actual, result);
		assert.strictEqual(explain.lastCall.args[0], controller.signal);
	});

	suite('save-last events', () => {
		test('deliver live while the webview is visible', () => {
			const service = new PatchDetailsService(createHandlers());
			const received: Serialized<State>[] = [];
			const unsubscribe = service.onStateChanged(state => received.push(state));

			service.fireStateChanged(createState('create'));
			service.fireStateChanged(createState('view'));

			assert.deepStrictEqual(
				received.map(s => s.mode),
				['create', 'view'],
			);

			unsubscribeNow(unsubscribe);
		});

		test('keep only the latest snapshot while hidden and replay it on restore', () => {
			// Mirrors a `retainContextWhenHidden` webview: emissions while hidden collapse to the
			// most recent per event, and restoring visibility replays exactly that snapshot.
			const buffer = new EventVisibilityBuffer();
			buffer.setVisible(false);

			const service = new PatchDetailsService(createHandlers(), buffer);
			const received: Serialized<State>[] = [];
			const unsubscribe = service.onStateChanged(state => received.push(state));

			service.fireStateChanged(createState('create'));
			service.fireStateChanged(createState('view'));
			assert.strictEqual(received.length, 0, 'nothing is delivered while hidden');

			buffer.setVisible(true);

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0].mode, 'view');

			unsubscribeNow(unsubscribe);
		});

		test('buffer each event independently (a full snapshot does not suppress slice events)', () => {
			const buffer = new EventVisibilityBuffer();
			buffer.setVisible(false);

			const service = new PatchDetailsService(createHandlers(), buffer);
			const states: string[] = [];
			const creates: string[] = [];
			const unsubState = service.onStateChanged(s => states.push(s.mode));
			const unsubCreate = service.onCreateChanged(e => creates.push(e.mode));

			service.fireStateChanged(createState('create'));
			service.fireCreateChanged({ mode: 'create', create: undefined });
			buffer.setVisible(true);

			assert.deepStrictEqual(states, ['create']);
			assert.deepStrictEqual(creates, ['create']);

			unsubscribeNow(unsubState);
			unsubscribeNow(unsubCreate);
		});

		test('stop delivering after unsubscribe (including any pending buffered replay)', () => {
			const buffer = new EventVisibilityBuffer();
			buffer.setVisible(false);

			const service = new PatchDetailsService(createHandlers(), buffer);
			const received: Serialized<State>[] = [];
			const unsubscribe = service.onStateChanged(state => received.push(state));

			service.fireStateChanged(createState('view'));
			unsubscribeNow(unsubscribe);
			buffer.setVisible(true);

			assert.strictEqual(received.length, 0);
		});
	});
});
