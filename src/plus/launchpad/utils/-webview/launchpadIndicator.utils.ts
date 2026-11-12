import { l10n } from 'vscode';
import { formatPlural } from '@gitlens/utils/plural.js';

export function getBlockedSummaryLabel(
	reviewersCount: number | undefined,
	failedChecksCount: number | undefined,
	conflictsCount: number | undefined,
	queueFailingCount?: number,
): string {
	// The nested-plural labels below would need a fourth dimension for the queue, so a queue-failing count
	// composes the same per-reason phrasing the Graph summary uses instead
	if (queueFailingCount != null) {
		const reasons: string[] = [];
		if (reviewersCount != null) {
			reasons.push(
				formatPlural(l10n.t('{count, plural, one{{count} needs reviewers} other{{count} need reviewers}}'), {
					count: reviewersCount,
				}),
			);
		}
		if (failedChecksCount != null) {
			reasons.push(
				formatPlural(
					l10n.t('{count, plural, one{{count} has failed CI checks} other{{count} have failed CI checks}}'),
					{ count: failedChecksCount },
				),
			);
		}
		if (conflictsCount != null) {
			reasons.push(
				formatPlural(l10n.t('{count, plural, one{{count} has conflicts} other{{count} have conflicts}}'), {
					count: conflictsCount,
				}),
			);
		}
		reasons.push(
			formatPlural(
				l10n.t(
					'{count, plural, one{{count} is failing in the merge queue} other{{count} are failing in the merge queue}}',
				),
				{ count: queueFailingCount },
			),
		);

		return l10n.t(
			'({0})',
			reasons.reduce((acc, r) => l10n.t('{0}, {1}', acc, r)),
		);
	}

	if (reviewersCount != null) {
		if (failedChecksCount != null) {
			if (conflictsCount != null) {
				return formatPlural(
					l10n.t(
						'{reviewers, plural, one{{conflicts, plural, one{({reviewers} needs reviewers, {failedChecks} failed CI checks, {conflicts} has conflicts)} other{({reviewers} needs reviewers, {failedChecks} failed CI checks, {conflicts} have conflicts)}}} other{{conflicts, plural, one{({reviewers} need reviewers, {failedChecks} failed CI checks, {conflicts} has conflicts)} other{({reviewers} need reviewers, {failedChecks} failed CI checks, {conflicts} have conflicts)}}}}',
					),
					{ reviewers: reviewersCount, failedChecks: failedChecksCount, conflicts: conflictsCount },
				);
			}

			return formatPlural(
				l10n.t(
					'{reviewers, plural, one{({reviewers} needs reviewers, {failedChecks} failed CI checks)} other{({reviewers} need reviewers, {failedChecks} failed CI checks)}}',
				),
				{ reviewers: reviewersCount, failedChecks: failedChecksCount },
			);
		}

		if (conflictsCount != null) {
			return formatPlural(
				l10n.t(
					'{reviewers, plural, one{{conflicts, plural, one{({reviewers} needs reviewers, {conflicts} has conflicts)} other{({reviewers} needs reviewers, {conflicts} have conflicts)}}} other{{conflicts, plural, one{({reviewers} need reviewers, {conflicts} has conflicts)} other{({reviewers} need reviewers, {conflicts} have conflicts)}}}}',
				),
				{ reviewers: reviewersCount, conflicts: conflictsCount },
			);
		}

		return formatPlural(
			l10n.t('{reviewers, plural, one{({reviewers} needs reviewers)} other{({reviewers} need reviewers)}}'),
			{ reviewers: reviewersCount },
		);
	}

	if (failedChecksCount != null) {
		if (conflictsCount != null) {
			return formatPlural(
				l10n.t(
					'{conflicts, plural, one{({failedChecks} failed CI checks, {conflicts} has conflicts)} other{({failedChecks} failed CI checks, {conflicts} have conflicts)}}',
				),
				{ failedChecks: failedChecksCount, conflicts: conflictsCount },
			);
		}

		return l10n.t('({failedChecks} failed CI checks)', { failedChecks: failedChecksCount });
	}

	if (conflictsCount != null) {
		return formatPlural(
			l10n.t('{conflicts, plural, one{({conflicts} has conflicts)} other{({conflicts} have conflicts)}}'),
			{ conflicts: conflictsCount },
		);
	}

	return '';
}
