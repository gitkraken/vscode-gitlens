import { css } from 'lit';

/**
 * Entitlement ring shared by the Graph header's account pill and the account panel's avatar, so the two
 * can't drift. Consumers put `data-entitlement` on any ancestor of the ringed element (the values come from
 * `getSubscriptionEntitlement`) and paint the ring themselves with
 * `box-shadow: 0 0 0 var(--gl-account-ring-width) var(--gl-account-ring-color)` — box-shadow rather than a
 * border so the ring takes no layout space, and rather than an outline so it doesn't collide with focus.
 *
 * Emphasis tracks how much the user needs to act rather than tier prestige, so paid is calmest. Trial leads:
 * it's time-boxed and expires whether or not the user notices, where an unpaid account reads the same
 * tomorrow as today.
 *
 * Width separates the two active states from paid; hue separates them from each other. Amber against the
 * accent is a strong pair in its own right — including for dichromats, unlike any two warm hues — so the two
 * don't also need different weights, and a 0.2rem ring read as heavy at this avatar size.
 */
export const accountRingStyles = css`
	[data-entitlement] {
		/* Semantic token first, charts fallback, hex last — the chain --gl-agent-waiting-color uses.
		   Deliberately NOT gitDecoration/--gl-stat-* tokens, which theme.scss reserves for file change states,
		   and deliberately NOT the editorError family: an unpaid account is a standing offer, not a fault, and
		   the Launchpad pill beside this one already uses red to mean "you have blocked PRs". activityBarBadge
		   is VS Code's native "awaiting your attention" register, aliased here as --gl-indicator-color. */
		--gl-account-ring-available: var(--vscode-activityBarBadge-background, var(--vscode-charts-blue, #0969da));
		--gl-account-ring-expiring: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #bf8700));

		/* Calmest treatment is the base, so paid and the not-yet-known state fall through to it; only trial
		   and unpaid override. Paid stays neutral on purpose — a hue would badge the majority of paying
		   customers permanently, and it would fight the accent tier badge beside it. */
		--gl-account-ring-width: 0.1rem;
		--gl-account-ring-color: var(--color-foreground--50);
	}

	/* Amber = running out. The least muted of the three, because it's the only state with a deadline. */
	[data-entitlement='trial'] {
		--gl-account-ring-width: 0.15rem;
		--gl-account-ring-color: color-mix(in srgb, var(--gl-account-ring-expiring) 85%, transparent);
	}

	/* Accent = more available here. Same weight as trial but muted further: a persistent accent ring reads as
	   an affordance, where a persistent warm one would read as a nag on a state the user may never want to
	   change. */
	[data-entitlement='unpaid'] {
		--gl-account-ring-width: 0.15rem;
		--gl-account-ring-color: color-mix(in srgb, var(--gl-account-ring-available) 70%, transparent);
	}
`;
