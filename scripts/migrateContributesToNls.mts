/**
 * One-time migration script: extracts localizable strings from non-generated
 * contributes sections in package.json into package.nls.json, replacing them
 * with %key% references.
 *
 * Sections handled: configuration, colors, viewsContainers, walkthroughs,
 * customEditors, mcpServerDefinitionProviders.
 *
 * Usage: node --experimental-strip-types ./scripts/migrateContributesToNls.mts
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const nlsPath = path.join(__dirname, 'package.nls.json');
const packageJsonPath = path.join(__dirname, 'package.json');

const nls: Record<string, string> = JSON.parse(readFileSync(nlsPath, 'utf8'));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const contributes = packageJson.contributes;

let count = 0;

function addNls(key: string, value: string): string {
	if (value.startsWith('%') && value.endsWith('%')) {
		// Already a %key% reference, skip
		return value;
	}
	nls[key] = value;
	count++;
	return `%${key}%`;
}

// Strip "gitlens." prefix from property keys for shorter NLS keys
function stripGitlensPrefix(key: string): string {
	return key.startsWith('gitlens.') ? key.slice('gitlens.'.length) : key;
}

// --- Configuration ---
for (const section of contributes.configuration) {
	// Section title
	if (section.title) {
		const sectionId = section.id ?? section.title.replace(/\s+/g, '');
		section.title = addNls(`config.section.${sectionId}.title`, section.title);
	}

	// Properties
	for (const [propKey, prop] of Object.entries(section.properties ?? {}) as [string, any][]) {
		const shortKey = stripGitlensPrefix(propKey);

		for (const field of [
			'description',
			'markdownDescription',
			'deprecationMessage',
			'markdownDeprecationMessage',
		]) {
			if (prop[field]) {
				prop[field] = addNls(`config.${shortKey}.${field}`, prop[field]);
			}
		}
		if (prop.enumDescriptions) {
			prop.enumDescriptions = prop.enumDescriptions.map((desc: string, i: number) =>
				addNls(`config.${shortKey}.enumDescriptions.${i}`, desc),
			);
		}

		// Nested items descriptions (array-type settings like gitlens.autolinks, gitlens.remotes)
		if (prop.items?.properties) {
			for (const [subKey, subProp] of Object.entries(prop.items.properties) as [string, any][]) {
				for (const field of ['description', 'markdownDescription']) {
					if (subProp[field]) {
						subProp[field] = addNls(`config.${shortKey}.items.${subKey}.${field}`, subProp[field]);
					}
				}
				if (subProp.enumDescriptions) {
					subProp.enumDescriptions = subProp.enumDescriptions.map((desc: string, i: number) =>
						addNls(`config.${shortKey}.items.${subKey}.enumDescriptions.${i}`, desc),
					);
				}
			}
		}
	}
}

// --- Colors ---
for (const color of contributes.colors) {
	if (color.description) {
		color.description = addNls(`color.${color.id}.description`, color.description);
	}
}

// --- ViewsContainers ---
for (const [location, containers] of Object.entries(contributes.viewsContainers) as [string, any[]][]) {
	for (const container of containers) {
		if (container.title) {
			container.title = addNls(`viewsContainer.${container.id}.title`, container.title);
		}
	}
}

// --- Walkthroughs ---
for (const walkthrough of contributes.walkthroughs ?? []) {
	if (walkthrough.title) {
		walkthrough.title = addNls(`walkthrough.${walkthrough.id}.title`, walkthrough.title);
	}
	if (walkthrough.description) {
		walkthrough.description = addNls(`walkthrough.${walkthrough.id}.description`, walkthrough.description);
	}
	for (const step of walkthrough.steps ?? []) {
		if (step.title) {
			step.title = addNls(`walkthrough.${walkthrough.id}.step.${step.id}.title`, step.title);
		}
		if (step.description) {
			step.description = addNls(`walkthrough.${walkthrough.id}.step.${step.id}.description`, step.description);
		}
	}
}

// --- CustomEditors ---
for (const editor of contributes.customEditors ?? []) {
	if (editor.displayName) {
		editor.displayName = addNls(`customEditor.${editor.viewType}.displayName`, editor.displayName);
	}
}

// --- McpServerDefinitionProviders ---
for (const provider of contributes.mcpServerDefinitionProviders ?? []) {
	if (provider.label) {
		provider.label = addNls(`mcpServer.${provider.id}.label`, provider.label);
	}
}

// Sort NLS keys alphabetically
const sorted: Record<string, string> = {};
for (const key of Object.keys(nls).sort()) {
	sorted[key] = nls[key];
}

// Write files
writeFileSync(nlsPath, `${JSON.stringify(sorted, undefined, '\t')}\n`, 'utf8');
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, undefined, '\t')}\n`, 'utf8');

console.log(`Migration complete: ${count} strings extracted to package.nls.json`);
