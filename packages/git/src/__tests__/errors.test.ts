import * as assert from 'assert';
import { BranchError, TagError } from '../errors.js';

suite('Git command errors', () => {
	test('BranchError `message` is the English sentence, `localizedMessage` the translated one', () => {
		const ex = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
		assert.strictEqual(ex.message, "Unable to create branch 'main' because it already exists");
		assert.strictEqual(ex.localizedMessage, "Unable to create branch 'main' because it already exists");
		assert.strictEqual(String(ex), "BranchError: Unable to create branch 'main' because it already exists");
	});

	test('TagError `message` is the English sentence, `localizedMessage` the translated one', () => {
		const ex = new TagError({ action: 'create', tag: 'v1', reason: 'alreadyExists' });
		assert.strictEqual(ex.message, "Unable to create tag 'v1' because it already exists");
		assert.strictEqual(ex.localizedMessage, "Unable to create tag 'v1' because it already exists");
	});

	test('preserves optional BranchError details', () => {
		assert.strictEqual(new BranchError({}).localizedMessage, 'Unable to perform action on branch');
		assert.strictEqual(
			new BranchError({ branch: 'main' }).localizedMessage,
			"Unable to perform action with branch 'main'",
		);
		assert.strictEqual(new BranchError({ action: 'create' }).localizedMessage, 'Unable to create branch');
	});

	test('preserves optional TagError details', () => {
		assert.strictEqual(new TagError({}).localizedMessage, 'Unable to perform action on tag');
		assert.strictEqual(new TagError({ tag: 'v1' }).localizedMessage, "Unable to perform action with tag 'v1'");
		assert.strictEqual(new TagError({ action: 'create' }).localizedMessage, 'Unable to create tag');
	});

	test('BranchError `message` stays the English sentence even with a gitCommand present', () => {
		const ex = new BranchError({ action: 'delete', branch: 'main', gitCommand: { repoPath: '/repo', args: [] } });
		assert.strictEqual(ex.message, "Unable to delete branch 'main'");
	});
});
