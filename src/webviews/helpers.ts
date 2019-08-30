'use strict';
import { ConfigurationTarget } from 'vscode';
import { configuration, ViewLocation } from '../configuration';

export function applyViewLayoutPreset(preset: 'contextual' | 'default' | 'scm') {
	let repositories;
	let histories;
	let compareAndSearch;
	switch (preset) {
		case 'contextual':
			repositories = ViewLocation.SourceControl;
			histories = ViewLocation.Explorer;
			compareAndSearch = ViewLocation.GitLens;
			break;
		case 'default':
			repositories = ViewLocation.GitLens;
			histories = ViewLocation.GitLens;
			compareAndSearch = ViewLocation.GitLens;
			break;
		case 'scm':
			repositories = ViewLocation.SourceControl;
			histories = ViewLocation.SourceControl;
			compareAndSearch = ViewLocation.SourceControl;
			break;
		default:
			return;
	}

	configuration.update(
		configuration.name('views')('repositories')('location').value,
		repositories,
		ConfigurationTarget.Global
	);
	configuration.update(
		configuration.name('views')('fileHistory')('location').value,
		histories,
		ConfigurationTarget.Global
	);
	configuration.update(
		configuration.name('views')('lineHistory')('location').value,
		histories,
		ConfigurationTarget.Global
	);
	configuration.update(
		configuration.name('views')('compare')('location').value,
		compareAndSearch,
		ConfigurationTarget.Global
	);
	configuration.update(
		configuration.name('views')('search')('location').value,
		compareAndSearch,
		ConfigurationTarget.Global
	);
}
