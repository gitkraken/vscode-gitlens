/**
 * One-time migration script for manifest contribution strings that are not generated from
 * contributions.json. Generated contribution strings are handled by generateContributions.mts.
 *
 * Usage: node --experimental-strip-types ./scripts/migrateContributesToNls.mts
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

type JsonObject = Record<string, unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');
const nlsPath = path.join(__dirname, 'package.nls.json');
const packageJsonPath = path.join(__dirname, 'package.json');

const nls: Record<string, string> = JSON.parse(readFileSync(nlsPath, 'utf8'));
const packageJson: JsonObject = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const contributes = asObject(packageJson.contributes);

let count = 0;

function asObject(value: unknown): JsonObject {
	return isObject(value) ? value : {};
}

function isObject(value: unknown): value is JsonObject {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asObjects(value: unknown): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function addNls(key: string, value: string): string {
	if (value.startsWith('%') && value.endsWith('%')) return value;

	nls[key] = value;
	count++;
	return `%${key}%`;
}

function stripGitlensPrefix(key: string): string {
	return key.startsWith('gitlens.') ? key.slice('gitlens.'.length) : key;
}

// Top-level manifest metadata shown in the Extensions view and Marketplace.
if (typeof packageJson.displayName === 'string') {
	packageJson.displayName = addNls('gitlens.displayName', packageJson.displayName);
}
if (typeof packageJson.description === 'string') {
	packageJson.description = addNls('gitlens.description', packageJson.description);
}
if (typeof packageJson.license === 'string') {
	packageJson.license = addNls('gitlens.license', packageJson.license);
}
for (const [i, badge] of asObjects(packageJson.badges).entries()) {
	if (typeof badge.description === 'string') {
		badge.description = addNls(`gitlens.badges.${i}.description`, badge.description);
	}
}

function localizeDescriptionFields(target: JsonObject, key: string): void {
	for (const field of ['description', 'markdownDescription', 'deprecationMessage', 'markdownDeprecationMessage']) {
		const value = target[field];
		if (typeof value === 'string') target[field] = addNls(`config.${key}.${field}`, value);
	}

	const enumDescriptions = target.enumDescriptions;
	if (Array.isArray(enumDescriptions)) {
		target.enumDescriptions = enumDescriptions.map((value, i) =>
			typeof value === 'string' ? addNls(`config.${key}.enumDescriptions.${i}`, value) : value,
		);
	}
}

// Configuration sections and property descriptions.
for (const section of asObjects(contributes.configuration)) {
	if (typeof section.title === 'string') {
		const sectionId = typeof section.id === 'string' ? section.id : section.title.replace(/\s+/g, '');
		section.title = addNls(`config.section.${sectionId}.title`, section.title);
	}

	for (const [propertyKey, propertyValue] of Object.entries(asObject(section.properties))) {
		const property = asObject(propertyValue);
		const shortKey = stripGitlensPrefix(propertyKey);
		localizeDescriptionFields(property, shortKey);

		const items = asObject(property.items);
		for (const [itemKey, itemValue] of Object.entries(asObject(items.properties))) {
			localizeDescriptionFields(asObject(itemValue), `${shortKey}.items.${itemKey}`);
		}
	}
}

// Color descriptions.
for (const color of asObjects(contributes.colors)) {
	if (typeof color.id === 'string' && typeof color.description === 'string') {
		color.description = addNls(`color.${color.id}.description`, color.description);
	}
}

// View container titles.
for (const containers of Object.values(asObject(contributes.viewsContainers))) {
	for (const container of asObjects(containers)) {
		if (typeof container.id === 'string' && typeof container.title === 'string') {
			container.title = addNls(`viewsContainer.${container.id}.title`, container.title);
		}
	}
}

// Walkthrough title, description, and step content.
for (const walkthrough of asObjects(contributes.walkthroughs)) {
	if (typeof walkthrough.id !== 'string') continue;
	if (typeof walkthrough.title === 'string') {
		walkthrough.title = addNls(`walkthrough.${walkthrough.id}.title`, walkthrough.title);
	}
	if (typeof walkthrough.description === 'string') {
		walkthrough.description = addNls(`walkthrough.${walkthrough.id}.description`, walkthrough.description);
	}
	for (const step of asObjects(walkthrough.steps)) {
		if (typeof step.id !== 'string') continue;
		if (typeof step.title === 'string') {
			step.title = addNls(`walkthrough.${walkthrough.id}.step.${step.id}.title`, step.title);
		}
		if (typeof step.description === 'string') {
			step.description = addNls(`walkthrough.${walkthrough.id}.step.${step.id}.description`, step.description);
		}
	}
}

// Custom editor and MCP provider labels.
for (const editor of asObjects(contributes.customEditors)) {
	if (typeof editor.viewType === 'string' && typeof editor.displayName === 'string') {
		editor.displayName = addNls(`customEditor.${editor.viewType}.displayName`, editor.displayName);
	}
}
for (const provider of asObjects(contributes.mcpServerDefinitionProviders)) {
	if (typeof provider.id === 'string' && typeof provider.label === 'string') {
		provider.label = addNls(`mcpServer.${provider.id}.label`, provider.label);
	}
}

const sorted: Record<string, string> = {};
for (const key of Object.keys(nls).sort()) {
	sorted[key] = nls[key];
}

writeFileSync(nlsPath, `${JSON.stringify(sorted, undefined, '\t')}\n`, 'utf8');
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, undefined, '\t')}\n`, 'utf8');

console.log(`Migration complete: ${count} strings extracted to package.nls.json`);
