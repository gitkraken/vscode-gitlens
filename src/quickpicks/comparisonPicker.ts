import type { Container } from '../container';
import type { GitReference } from '../git/models/reference';
import { getBranchTargetInfo } from '../git/utils/-webview/branch.utils';
import { createReference, getReferenceLabel, isBranchReference } from '../git/utils/reference.utils';
import { getRevisionRangeParts, isRevisionRange } from '../git/utils/revision.utils';
import { Directive } from './items/directive';
import { ReferencesQuickPickIncludes, showReferencePicker2 } from './referencePicker';
import { getRepositoryOrShowPicker } from './repositoryPicker';

export interface ComparisonPickerOptions {
	head?: GitReference;
	base?: GitReference;

	getTitleAndPlaceholder?: (
		step: 1 | 2,
		ref?: GitReference,
	) => { title: string | undefined; placeholder: string | undefined };
}

/**
 * Shows a picker for selecting two references to compare
 *
 * @param repoPath Repository path, if not provided will prompt to select one
 * @param title The title of the quick pick
 * @param placeholder The placeholder text for the quick pick
 * @param options Options for the picker
 * @returns A promise resolving to the selected references or undefined if cancelled
 */
export async function showComparisonPicker(
	container: Container,
	repoPath: string | undefined,
	options?: ComparisonPickerOptions,
): Promise<{ repoPath: string; head: GitReference; base: GitReference } | undefined> {
	let { head, base } = options ?? {};

	let force = false;

	while (true) {
		let { title, placeholder } = {
			title: 'Compare',
			placeholder: 'Choose a reference (branch, tag, etc) to compare',
			...options?.getTitleAndPlaceholder?.(1),
		};

		repoPath ??= (await getRepositoryOrShowPicker(title))?.path;
		if (repoPath == null) return undefined;

		if (head == null || force) {
			const pick = await showReferencePicker2(repoPath, title, placeholder, {
				allowRevisions: { ranges: true },
				include: ReferencesQuickPickIncludes.BranchesAndTags | ReferencesQuickPickIncludes.HEAD,
				picked: head?.ref,
				sort: { branches: { current: true } },
			});

			if (pick.value == null) return undefined;

			// Handle if a revision range was provided (e.g. ref1..ref2)
			if (isRevisionRange(pick.value.ref)) {
				const range = getRevisionRangeParts(pick.value.ref);
				if (range != null) {
					head = createReference(range.left || 'HEAD', repoPath, { refType: 'revision' });
					base = createReference(range.right || 'HEAD', repoPath, { refType: 'revision' });
					return { repoPath: repoPath, head: head, base: base };
				}
			}

			head = pick.value;
		}

		if (base == null || force) {
			({ title, placeholder } = {
				title: `Compare ${getReferenceLabel(head)} with`,
				placeholder: 'Choose a reference (branch, tag, etc) to compare with',
				...options?.getTitleAndPlaceholder?.(2, head),
			});

			if (isBranchReference(head)) {
				// get the merge target for the branch
				const repo = container.git.getRepository(repoPath);
				const branch = await repo?.git.branches().getBranch(head.name);
				if (branch != null) {
					const info = await getBranchTargetInfo(container, branch);
					const target = info.targetBranch.paused
						? info.baseBranch
						: info.targetBranch.value ?? info.defaultBranch;
					if (target != null) {
						base = createReference(target, repoPath, { refType: 'revision' });
					}
				}
			}

			const pick = await showReferencePicker2(repoPath, title, placeholder, {
				allowBack: true,
				allowRevisions: true,
				exclude: [head.ref],
				include: ReferencesQuickPickIncludes.BranchesAndTags | ReferencesQuickPickIncludes.HEAD,
				picked: base?.ref,
				sort: { branches: { current: true } },
			});

			if (pick.directive === Directive.Back) {
				force = true;
				continue;
			}
			if (pick.value == null) return undefined;

			base = pick.value;
		}

		break;
	}

	return { repoPath: repoPath, head: head, base: base };
}
