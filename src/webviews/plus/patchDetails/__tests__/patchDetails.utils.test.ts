import * as assert from 'node:assert';
import type { GkRepositoryId } from '@gitlens/git/models/repositoryIdentities.js';
import { GlRepository } from '../../../../git/models/repository.js';
import type { Draft, DraftChangeset, DraftPatch } from '../../../../plus/drafts/models/drafts.js';
import { isDraftMissingContent, isRepoLocated, toPatchDetails } from '../patchDetails.utils.js';

function createPatch(overrides?: Partial<DraftPatch>): DraftPatch {
	const patch = {
		type: 'cloud' as const,
		id: 'patch-1',
		createdAt: new Date(),
		updatedAt: new Date(),
		draftId: 'draft-1',
		changesetId: 'cs-1',
		userId: 'user-1',
		baseBranchName: 'main',
		baseRef: 'HEAD',
		gkRepositoryId: 'gk-repo-1' as GkRepositoryId,
		secureLink: undefined,
		commit: { ref: 'abc123' },
		contents: 'diff --git a/a.txt b/a.txt',
		files: [{ path: 'a.txt' }],
		repository: { id: 'identity-1', name: 'origin/repo' },
		...overrides,
	};
	return patch as DraftPatch;
}

/** A minimal stand-in for an open repository — `GlRepository.is()` is an `instanceof` check. */
function createLocatedRepository(name: string): GlRepository {
	const repo: GlRepository = Object.create(GlRepository.prototype);
	// `name` is a getter-only accessor up the prototype chain — shadow it with an own property
	Object.defineProperty(repo, 'name', { value: name, configurable: true, writable: true });
	return repo;
}

function createDraft(patches: DraftPatch[]): Draft {
	const draft = {
		draftType: 'cloud' as const,
		type: 'patch' as const,
		id: 'draft-1',
		createdAt: new Date(),
		updatedAt: new Date(),
		author: { id: 'u', name: 'n', email: undefined },
		isMine: true,
		role: 'owner' as const,
		isPublished: true,
		title: 't',
		deepLinkUrl: 'https://link',
		visibility: 'public' as const,
		isArchived: false,
		latestChangesetId: 'cs-1',
		changesets: [
			{
				id: 'cs-1',
				createdAt: new Date(),
				updatedAt: new Date(),
				draftId: 'draft-1',
				parentChangesetId: undefined,
				userId: 'user-1',
				gitUserName: 'n',
				gitUserEmail: 'e',
				deepLinkUrl: 'https://link',
				patches: patches,
			},
		] as DraftChangeset[],
	};
	return draft;
}

suite('patchDetails utils', () => {
	suite('toPatchDetails', () => {
		test('strips contents and commit', () => {
			const dto = toPatchDetails(createPatch());

			assert.strictEqual('contents' in dto, false);
			assert.strictEqual('commit' in dto, false);
		});

		test('maps an unlocated repository to its identity triple', () => {
			const dto = toPatchDetails(createPatch());

			assert.deepStrictEqual(dto.repository, { id: 'gk-repo-1', name: 'origin/repo', located: false });
		});

		test('marks a located repository and keeps its name', () => {
			const patch = createPatch({ repository: createLocatedRepository('local-repo') });
			const dto = toPatchDetails(patch);

			assert.deepStrictEqual(dto.repository, { id: 'gk-repo-1', name: 'local-repo', located: true });
		});

		test('falls back to an empty name when the patch has no repository yet', () => {
			const dto = toPatchDetails(createPatch({ repository: undefined }));

			assert.deepStrictEqual(dto.repository, { id: 'gk-repo-1', name: '', located: false });
		});

		test('preserves the rest of the patch shape (id, baseRef, files)', () => {
			const dto = toPatchDetails(createPatch({ baseRef: 'refs/heads/main' }));

			assert.strictEqual(dto.id, 'patch-1');
			assert.strictEqual(dto.baseRef, 'refs/heads/main');
			assert.strictEqual(dto.files?.length, 1);
		});
	});

	suite('isRepoLocated', () => {
		test('is false for a plain repository identity', () => {
			const identity = {
				id: 'identity-1' as GkRepositoryId,
				name: 'origin/repo',
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			assert.strictEqual(isRepoLocated(identity), false);
		});

		test('is false for undefined', () => {
			assert.strictEqual(isRepoLocated(undefined), false);
		});

		test('is true for an open repository instance', () => {
			assert.strictEqual(isRepoLocated(createLocatedRepository('local-repo')), true);
		});
	});

	suite('isDraftMissingContent', () => {
		test('a draft without changesets is missing content', () => {
			const draft = createDraft([]);
			draft.changesets = undefined;

			assert.strictEqual(isDraftMissingContent(draft), true);
		});

		test('fully-fetched patches mean content is present', () => {
			assert.strictEqual(isDraftMissingContent(createDraft([createPatch()])), false);
		});

		test('one patch still lacking contents makes the whole draft missing content', () => {
			const draft = createDraft([
				createPatch({ id: 'complete' }),
				createPatch({ id: 'incomplete', contents: undefined }),
			]);

			assert.strictEqual(isDraftMissingContent(draft), true);
		});
	});
});
