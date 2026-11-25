import { getAzureWorkItemDescription, toAzureWorkItemHtmlFields } from '@gitkraken/provider-apis';
import type { WorkItemState, WorkItemWriteField } from '../../models/workItemWrites.js';

export type AzureWorkItemTypeMetadata = {
	name: string;
	referenceName: string;
	isDisabled?: boolean;
	states?: WorkItemState[];
	transitions?: Record<string, { to: string }[]>;
};

export type AzureWorkItemTypeCategory = { referenceName: string; workItemTypes?: { name: string }[] };
export type AzureWorkItemFieldDefinition = { referenceName: string; name: string; type: string; readOnly: boolean };
export type AzureWorkItemTypeField = {
	referenceName: string;
	name: string;
	alwaysRequired?: boolean;
	allowedValues?: unknown[];
	defaultValue?: unknown;
	helpText?: string;
};

const writableSystemFields = new Set([
	'system.title',
	'system.description',
	'system.assignedto',
	'system.tags',
	'system.reason',
	'system.history',
	'system.areapath',
	'system.iterationpath',
]);

function isCallerWritable(referenceName: string): boolean {
	const name = referenceName.toLowerCase();
	return !name.startsWith('system.') || writableSystemFields.has(name);
}

const projectPathFields = new Set(['system.areapath', 'system.iterationpath']);

export function isAzureProjectPathField(referenceName: string): boolean {
	return projectPathFields.has(referenceName.toLowerCase());
}

export function toAzureWorkItemWriteFields(
	typeFields: readonly AzureWorkItemTypeField[],
	catalog: readonly AzureWorkItemFieldDefinition[],
): WorkItemWriteField[] {
	const definitions = new Map(catalog.map(field => [field.referenceName, field]));
	const editable: WorkItemWriteField[] = [];
	for (const field of typeFields) {
		const definition = definitions.get(field.referenceName);
		if (definition?.readOnly !== false || !isCallerWritable(field.referenceName)) continue;

		editable.push({
			referenceName: field.referenceName,
			name: field.name,
			type: definition.type,
			required: field.alwaysRequired === true && !isAzureProjectPathField(field.referenceName),
			...(Array.isArray(field.allowedValues) &&
				field.allowedValues.length !== 0 && { allowedValues: structuredClone(field.allowedValues) }),
			...(field.defaultValue != null && { defaultValue: structuredClone(field.defaultValue) }),
			...(typeof field.helpText === 'string' && { helpText: field.helpText }),
		});
	}
	return editable;
}

export function getAzureWorkItemBodyField(
	fields: readonly WorkItemWriteField[],
	catalog: readonly AzureWorkItemFieldDefinition[],
	values?: Readonly<Record<string, unknown>>,
): string | undefined {
	const html = toAzureWorkItemHtmlFields(catalog);
	const current = getAzureWorkItemDescription(values, html)?.field.referenceName;
	if (current != null && fields.some(field => field.referenceName === current)) return current;

	const available = Object.fromEntries(
		fields
			.filter(field => field.type.toLowerCase() === 'html')
			.map(field => [field.referenceName, field.referenceName]),
	);
	return getAzureWorkItemDescription(available, html)?.field.referenceName;
}

export function getAzureWorkItemTransitionTargets(
	type: AzureWorkItemTypeMetadata,
	states: readonly WorkItemState[],
	from: string,
): WorkItemState[] {
	const transitions = type.transitions != null && Object.hasOwn(type.transitions, from) ? type.transitions[from] : [];
	const targets = new Set(Array.isArray(transitions) ? transitions.map(transition => transition?.to) : []);
	return states.filter(state => state.name !== from && targets.has(state.name));
}

const testArtifactTypes = new Set([
	'microsoft.vsts.workitemtypes.testplan',
	'microsoft.vsts.workitemtypes.testsuite',
	'microsoft.vsts.workitemtypes.testcase',
	'microsoft.vsts.workitemtypes.sharedstep',
	'microsoft.vsts.workitemtypes.sharedparameter',
]);
const testArtifactCategories = new Set([
	'microsoft.testplancategory',
	'microsoft.testsuitecategory',
	'microsoft.testcasecategory',
	'microsoft.sharedstepcategory',
	'microsoft.sharedparametercategory',
]);

export function isAzureTestArtifact(
	type: AzureWorkItemTypeMetadata,
	categories: readonly AzureWorkItemTypeCategory[] = [],
): boolean {
	if (testArtifactTypes.has(type.referenceName.toLowerCase())) return true;

	const name = type.name.toLowerCase();
	return categories.some(
		category =>
			typeof category?.referenceName === 'string' &&
			testArtifactCategories.has(category.referenceName.toLowerCase()) &&
			Array.isArray(category.workItemTypes) &&
			category.workItemTypes.some(
				member => typeof member?.name === 'string' && member.name.toLowerCase() === name,
			),
	);
}
