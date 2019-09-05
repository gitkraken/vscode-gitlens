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

	configuration.update('views', 'repositories', 'location', repositories, ConfigurationTarget.Global);
	configuration.update('views', 'fileHistory', 'location', histories, ConfigurationTarget.Global);
	configuration.update('views', 'lineHistory', 'location', histories, ConfigurationTarget.Global);
	configuration.update('views', 'compare', 'location', compareAndSearch, ConfigurationTarget.Global);
	configuration.update('views', 'search', 'location', compareAndSearch, ConfigurationTarget.Global);
}
