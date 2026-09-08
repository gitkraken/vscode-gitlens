import * as l10n from '@vscode/l10n';
import { html, nothing } from 'lit';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import { createCommandLink } from '../../../../../system/commands.js';
import './action-chip.js';

export function renderLearnAboutAutolinks(opts: {
	hasIntegrationsConnected: boolean;
	hasAccount: boolean;
	showLabel?: boolean;
	slotName?: 'prefix' | 'suffix';
}) {
	const autolinkSettingsLink = createCommandLink('gitlens.showSettingsPage!autolinks', {
		showOptions: { preserveFocus: true },
	});

	const label = l10n.t(
		'Configure autolinks to linkify external references, like Jira or Zendesk tickets, in commit messages.',
	);
	const connectLink = html`<a
		href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>('gitlens.plus.cloudIntegrations.connect', { source: { source: 'inspect', detail: { action: 'connect' } } })}
		>${l10n.t('Connect an Integration')}</a
	>`;
	const popoverContent = html`${localizedContent(l10n.t('{configureLink} to linkify external references, like Jira or Zendesk tickets, in commit messages.'), { configureLink: html`<a href=${autolinkSettingsLink}>${l10n.t('Configure autolinks')}</a>` })}
		<hr />
		${localizedContent(opts.hasAccount ? l10n.t('{connectLink} — to get access to automatic rich autolinks for services like Jira, GitHub, and more.') : l10n.t('{connectLink} — sign up and to get access to automatic rich autolinks for services like Jira, GitHub, and more.'), { connectLink: connectLink })}`;

	return html`<gl-action-chip
		slot=${opts.slotName ?? nothing}
		href=${autolinkSettingsLink}
		data-action="autolink-settings"
		icon="info"
		.label=${label}
		.popoverContent=${popoverContent}
		truncate
		overlay=${opts.hasIntegrationsConnected ? 'tooltip' : 'popover'}
		>${opts.showLabel ? html`<span class="mq-hide-sm">${l10n.t(' No autolinks found')}</span>` : nothing}</gl-action-chip
	>`;
}
