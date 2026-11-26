import type {
	AzureServerWorkItemWriteScope,
	AzureServicesWorkItemWriteScope,
	WorkItemAddress,
	WorkItemCreateOptions,
	WorkItemCreateOptionsResult,
	WorkItemDeleteCapability,
	WorkItemDeleteOptions,
	WorkItemDeleteResult,
	WorkItemReceipt,
	WorkItemState,
	WorkItemWriteContext,
	WorkItemWriteField,
	WorkItemWriteOptions,
	WorkItemWriteOptionsResult,
	WorkItemWriteResult,
	WorkItemWriteTargetOptions,
	WorkItemWriteTargetResult,
} from '../models/workItemWrites.js';
import { decodeAzurePathSegment } from './azure/azure.utils.js';
import { encodeAzurePathSegment } from './azure/models.js';
import type {
	AzureWorkItemFieldDefinition,
	AzureWorkItemTypeCategory,
	AzureWorkItemTypeField,
	AzureWorkItemTypeMetadata,
} from './azure/workItemWriteMetadata.js';
import {
	getAzureWorkItemBodyField,
	getAzureWorkItemTransitionTargets,
	isAzureProjectPathField,
	isAzureTestArtifact,
	toAzureWorkItemWriteFields,
} from './azure/workItemWriteMetadata.js';
import {
	getAzureWriteOrganizations,
	getAzureWriteProfile,
	isAzureGuid,
	isAzureIdentifier,
	isAzurePositiveInt,
	sameAzureIdentifier,
} from './azure/writeIdentity.js';
import { toWorkItemWriteFailure, WorkItemWriteError } from './azureWorkItemWriteErrors.js';
import type { ProviderRequestFunction } from './models.js';

type AzureWorkItem = { id: number; rev: number; fields: Readonly<Record<string, unknown>> };
type AzureDeletedWorkItem = {
	id?: unknown;
	project?: unknown;
	deletedDate?: unknown;
	code?: unknown;
	resource?: { id?: unknown; rev?: unknown };
};
type WorkItemMetadata = {
	type: AzureWorkItemTypeMetadata;
	states: readonly WorkItemState[];
	fields: readonly WorkItemWriteField[];
	catalog: readonly AzureWorkItemFieldDefinition[];
};
type Patch = { op: 'add' | 'test'; path: string; value: unknown } | { op: 'remove'; path: string };

type AzureServerConnectionData = {
	instanceId?: unknown;
	webApplicationRelativeDirectory?: unknown;
	authenticatedUser?: { id?: unknown };
};

const projectSecurityNamespaceId = '52d39943-cb85-4d7f-8fa8-c6baac873819';

function isSameId(actual: unknown, id: number): boolean {
	return actual === id || actual === String(id);
}

function isDeletedItem(
	item: AzureDeletedWorkItem | undefined,
	id: number,
): item is AzureDeletedWorkItem & { project: string } {
	if (item == null || !isSameId(item.id, id) || !isAzureIdentifier(item.project)) return false;

	return (
		item.code == null || item.code === 0 || (typeof item.code === 'number' && item.code >= 200 && item.code < 300)
	);
}

function getDeletedRevision(item: AzureDeletedWorkItem, id: number): number | undefined {
	const resource = item.resource;
	return resource != null && isSameId(resource.id, id) && isAzurePositiveInt(resource.rev) ? resource.rev : undefined;
}

// SEE: Azure reports `deletedDate` as a zone-less en-US UTC string ("11/25/2026 6:24:35 PM"), observed live.
const azureDeletedDate = /^(\d{1,2})\/(\d{1,2})\/([12]\d{3}) (\d{1,2}):([0-5]\d):([0-5]\d) (AM|PM)$/;

function toDeletedAt(value: unknown): string | undefined {
	const match = typeof value === 'string' ? azureDeletedDate.exec(value) : null;
	if (match == null) return undefined;

	const [month, day, year, hour, minute, second] = match.slice(1, 7).map(Number);
	if (hour < 1 || hour > 12) return undefined;

	const date = new Date(Date.UTC(year, month - 1, day, (hour % 12) + (match[7] === 'PM' ? 12 : 0), minute, second));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return undefined;
	}

	return date.toISOString();
}

function readValues<T>(body: { value?: T[] } | undefined): T[] {
	if (!Array.isArray(body?.value)) throw new WorkItemWriteError('unknown');

	return body.value;
}

function assertExistingAddress(address: WorkItemAddress): void {
	if (!isAzurePositiveInt(address.workItemId)) throw new WorkItemWriteError('invalid-input');
}

function assertMutationIdentity(expectedAccountId: string): void {
	if (!isAzureIdentifier(expectedAccountId)) throw new WorkItemWriteError('invalid-input');
}

function assertSameRevision(item: AzureWorkItem, expectedRevision: number): void {
	if (!isAzurePositiveInt(expectedRevision)) throw new WorkItemWriteError('invalid-input');
	if (item.rev !== expectedRevision) throw new WorkItemWriteError('conflict');
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
	if (value == null) return value === null;
	if (typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object' || ancestors.has(value)) return false;
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	) {
		return false;
	}

	ancestors.add(value);
	const valid = Object.values(value).every(entry => isJsonValue(entry, ancestors));
	ancestors.delete(value);
	return valid;
}

function isInProjectPath(value: unknown, projectName: string): boolean {
	if (typeof value !== 'string') return false;

	const root = value.split('\\', 1)[0];
	return root.toLowerCase() === projectName.toLowerCase();
}

function getFieldPatches(
	input: Readonly<Record<string, unknown>>,
	fieldMetadata: readonly WorkItemWriteField[],
	projectName: string,
	current?: Readonly<Record<string, unknown>>,
): Patch[] {
	if (input == null || typeof input !== 'object' || Array.isArray(input)) {
		throw new WorkItemWriteError('invalid-input');
	}

	const fields = new Map(fieldMetadata.map(field => [field.referenceName, field]));
	const errors = new Map<string, string>();
	const patch: Patch[] = [];
	for (const [name, value] of Object.entries(input)) {
		const field = fields.get(name);
		if (field == null || !isJsonValue(value)) {
			errors.set(name, field == null ? 'Field is unavailable for writing.' : 'Expected a JSON field value.');
			continue;
		}
		if (isAzureProjectPathField(name) && !isInProjectPath(value, projectName)) {
			errors.set(name, 'Expected a path in the selected project.');
			continue;
		}

		const path = `/fields/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
		if (current != null && value === null) {
			if (Object.hasOwn(current, name)) {
				patch.push({ op: 'remove', path: path });
			}
		} else {
			patch.push({ op: 'add', path: path, value: value });
		}
	}
	if (current == null) {
		for (const field of fieldMetadata) {
			const value = Object.hasOwn(input, field.referenceName) ? input[field.referenceName] : undefined;
			if (
				field.required &&
				(value === null || value === '' || (value === undefined && !Object.hasOwn(field, 'defaultValue')))
			) {
				errors.set(field.referenceName, 'This field is required.');
			}
		}
	}
	if (errors.size) throw new WorkItemWriteError('invalid-input', Object.fromEntries(errors));

	return patch;
}

async function readProject(
	request: ProviderRequestFunction,
	headers: { Authorization: string },
	collectionUrl: string,
	projectId: string,
	apiVersion: string,
): Promise<{ id: string; name: string }> {
	const { body: project } = await request<{ id?: unknown; name?: unknown }>({
		url: `${collectionUrl}/_apis/projects/${projectId}?api-version=${apiVersion}`,
		headers: headers,
		redirect: 'error',
	});
	if (!sameAzureIdentifier(project?.id, projectId) || !isAzureIdentifier(project?.name)) {
		throw new WorkItemWriteError('not-found');
	}

	return { id: project.id as string, name: project.name };
}

export class AzureWorkItemWriter {
	static async connect(
		request: ProviderRequestFunction,
		credential: { accessToken: string; authorization: string },
		options: AzureServicesWorkItemWriteScope,
		isSessionCurrent: () => Promise<boolean>,
	): Promise<AzureWorkItemWriter> {
		const { body: profile } = await getAzureWriteProfile(request, credential.accessToken);
		const accountId = profile?.id;
		if (
			!isAzureIdentifier(accountId) ||
			(options.expectedAccountId !== undefined && !sameAzureIdentifier(accountId, options.expectedAccountId))
		) {
			throw new WorkItemWriteError('no-connection');
		}

		const headers = { Authorization: credential.authorization };
		const { body: accounts } = await getAzureWriteOrganizations(request, credential.authorization, accountId);
		const organization = readValues(accounts).find(
			account =>
				sameAzureIdentifier(account.accountId, options.organizationId) &&
				sameAzureIdentifier(account.accountName, options.organizationName),
		);
		if (organization == null) throw new WorkItemWriteError('not-found');

		const organizationUrl = `https://dev.azure.com/${encodeAzurePathSegment(organization.accountName)}`;
		const project = await readProject(request, headers, organizationUrl, options.projectId, '7.1');
		return new AzureWorkItemWriter(
			request,
			headers,
			{
				providerId: options.providerId,
				connectionId: options.connectionId,
				accountId: accountId,
				organization: { id: organization.accountId, name: organization.accountName },
				project: project,
			},
			organizationUrl,
			'7.1',
			() => Promise.resolve('7.1'),
			isSessionCurrent,
		);
	}

	static async connectServer(
		request: ProviderRequestFunction,
		authorization: string,
		options: AzureServerWorkItemWriteScope,
		collectionUrl: string,
		resolveApiVersion: () => Promise<string | undefined>,
		resolveStatesApiVersion: (apiVersion: string) => Promise<string | undefined>,
		isSessionCurrent: () => Promise<boolean>,
	): Promise<AzureWorkItemWriter> {
		const headers = { Authorization: authorization };
		const { body: data } = await request<AzureServerConnectionData>({
			url: `${collectionUrl}/_apis/connectionData`,
			headers: headers,
			redirect: 'error',
		});
		const accountId = data?.authenticatedUser?.id;
		const segment =
			typeof data?.webApplicationRelativeDirectory === 'string'
				? data.webApplicationRelativeDirectory.split('/').findLast(Boolean)
				: undefined;
		const collectionName = segment != null ? decodeAzurePathSegment(segment) : undefined;
		if (
			!isAzureGuid(data?.instanceId) ||
			!sameAzureIdentifier(data.instanceId, options.organizationId) ||
			collectionName == null ||
			!sameAzureIdentifier(collectionName, options.organizationName)
		) {
			throw new WorkItemWriteError('not-found');
		}
		if (
			!isAzureIdentifier(accountId) ||
			(options.expectedAccountId !== undefined && !sameAzureIdentifier(accountId, options.expectedAccountId))
		) {
			throw new WorkItemWriteError('no-connection');
		}

		const apiVersion = await resolveApiVersion();
		if (apiVersion == null) throw new WorkItemWriteError('unsupported');

		const project = await readProject(request, headers, collectionUrl, options.projectId, apiVersion);
		let statesApiVersion: Promise<string> | undefined;
		return new AzureWorkItemWriter(
			request,
			headers,
			{
				providerId: options.providerId,
				connectionId: options.connectionId,
				baseUrl: options.baseUrl,
				accountId: accountId,
				organization: { id: data.instanceId, name: collectionName, url: collectionUrl },
				project: project,
			},
			collectionUrl,
			apiVersion,
			() =>
				(statesApiVersion ??= resolveStatesApiVersion(apiVersion).then(version => {
					if (version == null) throw new WorkItemWriteError('unsupported');

					return version;
				})),
			isSessionCurrent,
		);
	}

	private readonly projectUrl: string;

	private constructor(
		private readonly request: ProviderRequestFunction,
		private readonly headers: { Authorization: string },
		private readonly context: WorkItemWriteContext,
		private readonly organizationUrl: string,
		private readonly apiVersion: string,
		private readonly getStatesApiVersion: () => Promise<string>,
		private readonly isSessionCurrent: () => Promise<boolean>,
	) {
		this.projectUrl = `${organizationUrl}/${context.project.id}`;
	}

	async getCreateOptions(options: WorkItemCreateOptions): Promise<WorkItemCreateOptionsResult> {
		if (options.workItemType === undefined) {
			const types = await this.read<{ value?: AzureWorkItemTypeMetadata[] }>('/workitemtypes');
			const enabled = readValues(types).filter(type => isAzureIdentifier(type.name) && !type.isDisabled);
			return { ok: true, ...this.context, workItemTypes: enabled.map(type => ({ name: type.name })) };
		}

		const { type, fields, states, catalog } = await this.getMetadata(options.workItemType);
		if (type.isDisabled) throw new WorkItemWriteError('invalid-input');

		return {
			ok: true,
			...this.context,
			workItemType: type.name,
			fields: fields,
			states: states,
			initialStates: getAzureWorkItemTransitionTargets(type, states, ''),
			bodyField: getAzureWorkItemBodyField(fields, catalog),
		};
	}

	async getWriteOptions(options: WorkItemAddress): Promise<WorkItemWriteOptionsResult> {
		const item = await this.getItem(options);
		const metadata = await this.getMetadata(this.itemType(item));
		const issue = this.getReceipt(item, metadata);
		return {
			ok: true,
			...this.context,
			issue: issue,
			fields: metadata.fields,
			availableStates: getAzureWorkItemTransitionTargets(metadata.type, metadata.states, issue.state.name),
			deleteCapability: await this.getDeleteCapability(metadata.type).catch((): WorkItemDeleteCapability => ({
				allowed: 'unknown',
			})),
			bodyField: issue.bodyField,
		};
	}

	async resolveTarget(options: WorkItemWriteTargetOptions): Promise<WorkItemWriteTargetResult> {
		if (options.intent !== undefined && options.intent !== 'delete') throw new WorkItemWriteError('invalid-input');

		const item = await this.getItem(options);
		const metadata = await this.getMetadata(this.itemType(item));
		const issue = this.getReceipt(item, metadata);
		const deleteCapability =
			options.intent === 'delete' ? await this.getDeleteCapability(metadata.type) : undefined;
		if (deleteCapability?.allowed === false) throw new WorkItemWriteError(deleteCapability.reason);

		return {
			ok: true,
			...this.context,
			issue: issue,
			...(deleteCapability && { deleteCapability: deleteCapability }),
		};
	}

	async write(options: WorkItemWriteOptions): Promise<WorkItemWriteResult> {
		assertMutationIdentity(options.expectedAccountId);
		if (options.action === 'create') return this.create(options);

		if (options.action !== 'edit' && options.action !== 'set-state') throw new WorkItemWriteError('invalid-input');

		const item = await this.getItem(options);
		assertSameRevision(item, options.expectedRevision);
		const metadata = await this.getMetadata(this.itemType(item));
		const patch = getFieldPatches(options.fields ?? {}, metadata.fields, this.context.project.name, item.fields);
		if (options.action === 'set-state') {
			const state = this.getReceipt(item, metadata).state.name;
			if (
				!getAzureWorkItemTransitionTargets(metadata.type, metadata.states, state).some(
					s => s.name === options.state,
				)
			) {
				throw new WorkItemWriteError('transition-unavailable');
			}

			patch.push({ op: 'add', path: '/fields/System.State', value: options.state });
		}
		if (!patch.length) throw new WorkItemWriteError('invalid-input');

		patch.unshift({ op: 'test', path: '/rev', value: options.expectedRevision });
		return this.save('PATCH', `/workitems/${item.id}`, patch, metadata, {
			id: item.id,
			state: options.action === 'set-state' ? options.state : undefined,
		});
	}

	async delete(options: WorkItemDeleteOptions): Promise<WorkItemDeleteResult> {
		assertMutationIdentity(options.expectedAccountId);
		const item = await this.getItem(options);
		assertSameRevision(item, options.expectedRevision);
		const metadata = await this.getMetadata(this.itemType(item));
		const capability = await this.getDeleteCapability(metadata.type);
		if (capability.allowed === false) throw new WorkItemWriteError(capability.reason);

		await this.assertSessionCurrent();
		const current = await this.getItem(options);
		assertSameRevision(current, options.expectedRevision);
		if (this.itemType(current) !== metadata.type.name) throw new WorkItemWriteError('conflict');

		const issue = this.getReceipt(current, metadata);
		await this.assertSessionCurrent();
		try {
			const { body, status } = await this.request<AzureDeletedWorkItem>({
				method: 'DELETE',
				url: this.url(`/workitems/${issue.id}`),
				headers: this.headers,
				redirect: 'error',
			});
			let deleted =
				status === 200 && isDeletedItem(body, issue.id) && body.deletedDate != null ? body : undefined;
			if (deleted == null || getDeletedRevision(deleted, issue.id) === undefined) {
				const recycled = await this.read<AzureDeletedWorkItem>(`/recyclebin/${issue.id}`).catch(
					() => undefined,
				);
				if (isDeletedItem(recycled, issue.id)) {
					deleted = recycled;
				}
			}
			if (deleted == null) return { ok: false, reason: 'unknown', applied: 'maybe' };

			return await this.toDeleteOutcome(deleted, issue, options.expectedRevision);
		} catch (ex) {
			return toWorkItemWriteFailure(ex, { fields: metadata.fields });
		}
	}

	private async toDeleteOutcome(
		deleted: AzureDeletedWorkItem & { project: string },
		issue: WorkItemReceipt,
		expectedRevision: number,
	): Promise<WorkItemDeleteResult> {
		const revision = getDeletedRevision(deleted, issue.id);
		const deletedAt = toDeletedAt(deleted.deletedDate);
		const deletion = {
			disposition: 'recycle-bin',
			restorable: true,
			...(revision !== undefined && { revision: revision }),
			...(deletedAt !== undefined && { deletedAt: deletedAt }),
		} as const;
		const project = sameAzureIdentifier(
			deleted.project,
			isAzureGuid(deleted.project) ? this.context.project.id : this.context.project.name,
		)
			? this.context.project
			: await this.findProject(deleted.project);
		if (sameAzureIdentifier(project.id, this.context.project.id) && revision === expectedRevision + 1) {
			return { ok: true, ...this.context, issue: issue, deletion: { ...deletion, revision: revision } };
		}

		return {
			ok: false,
			reason: 'target-changed',
			applied: true,
			...this.context,
			deleted: { id: issue.id, ...(revision !== undefined && { revision: revision }), project: project },
			deletion: deletion,
		};
	}

	private async findProject(nameOrId: string): Promise<{ id?: string; name: string }> {
		try {
			const project = await this.readOrganization<{ id?: unknown; name?: unknown }>(
				`/projects/${encodeAzurePathSegment(nameOrId)}`,
			);
			if (
				isAzureGuid(project?.id) &&
				isAzureIdentifier(project.name) &&
				(sameAzureIdentifier(project.name, nameOrId) || sameAzureIdentifier(project.id, nameOrId))
			) {
				return { id: project.id, name: project.name };
			}
		} catch {}

		return { name: nameOrId };
	}

	private async create(options: Extract<WorkItemWriteOptions, { action: 'create' }>): Promise<WorkItemWriteResult> {
		const metadata = await this.getMetadata(options.workItemType);
		if (metadata.type.isDisabled) throw new WorkItemWriteError('invalid-input');

		const patch = getFieldPatches(options.fields, metadata.fields, this.context.project.name);
		return this.save('POST', `/workitems/$${encodeAzurePathSegment(metadata.type.name)}`, patch, metadata);
	}

	private async getDeleteCapability(type: AzureWorkItemTypeMetadata): Promise<WorkItemDeleteCapability> {
		if (isAzureTestArtifact(type)) return { allowed: false, reason: 'unsupported' };

		const categories = await this.read<{ value?: AzureWorkItemTypeCategory[] }>('/workitemtypecategories');
		if (isAzureTestArtifact(type, readValues(categories))) return { allowed: false, reason: 'unsupported' };

		try {
			const namespaces = await this.readOrganization<{
				value?: { namespaceId?: unknown; actions?: { bit?: unknown; name?: unknown }[] }[];
			}>(`/securitynamespaces/${projectSecurityNamespaceId}`);
			const bit = readValues(namespaces)
				.find(namespace => sameAzureIdentifier(namespace?.namespaceId, projectSecurityNamespaceId))
				?.actions?.find(action => action?.name === 'WORK_ITEM_DELETE')?.bit;
			if (!isAzurePositiveInt(bit)) return { allowed: 'unknown' };

			const permissions = await this.readOrganization<{ value?: unknown[] }>(
				`/permissions/${projectSecurityNamespaceId}/${bit}`,
				{
					tokens: `$PROJECT:vstfs:///Classification/TeamProject/${this.context.project.id}`,
					alwaysAllowAdministrators: 'false',
				},
			);
			const [allowed, ...rest] = readValues(permissions);
			if (typeof allowed !== 'boolean' || rest.length) return { allowed: 'unknown' };

			return allowed ? { allowed: true } : { allowed: false, reason: 'forbidden' };
		} catch {
			return { allowed: 'unknown' };
		}
	}

	private async getMetadata(name: string): Promise<WorkItemMetadata> {
		if (!isAzureIdentifier(name) || name === '.' || name === '..' || /[/\\]/.test(name)) {
			throw new WorkItemWriteError('invalid-input');
		}

		const path = `/workitemtypes/${encodeAzurePathSegment(name)}`;
		const [type, typeFields, definitions] = await Promise.all([
			this.read<AzureWorkItemTypeMetadata>(path),
			this.read<{ value?: AzureWorkItemTypeField[] }>(`${path}/fields`, { $expand: 'All' }),
			this.read<{ value?: AzureWorkItemFieldDefinition[] }>('/fields'),
		]);
		if (!sameAzureIdentifier(type?.name, name) || !isAzureIdentifier(type?.referenceName)) {
			throw new WorkItemWriteError('unknown');
		}
		if (type.transitions == null || typeof type.transitions !== 'object' || Array.isArray(type.transitions)) {
			throw new WorkItemWriteError('unknown');
		}

		const states =
			Array.isArray(type.states) && type.states.length !== 0
				? type.states
				: readValues(
						await this.read<{ value?: WorkItemState[] }>(`${path}/states`, {
							'api-version': await this.getStatesApiVersion(),
						}),
					);
		if (states.some(state => !isAzureIdentifier(state?.name) || !isAzureIdentifier(state.category))) {
			throw new WorkItemWriteError('unknown');
		}

		const catalog = readValues(definitions);
		return {
			type: type,
			states: states.map(({ name, category, color }) => ({
				name: name,
				category: category,
				...(typeof color === 'string' && { color: color }),
			})),
			fields: toAzureWorkItemWriteFields(readValues(typeFields), catalog),
			catalog: catalog,
		};
	}

	private async getItem(options: WorkItemAddress): Promise<AzureWorkItem> {
		assertExistingAddress(options);
		const data = await this.read<AzureWorkItem>(`/workitems/${options.workItemId}`);
		if (!this.isInProject(data) || data.id !== options.workItemId) throw new WorkItemWriteError('not-found');

		return data;
	}

	private isInProject(item: AzureWorkItem | undefined): item is AzureWorkItem {
		return sameAzureIdentifier(item?.fields?.['System.TeamProject'], this.context.project.name);
	}

	private itemType(item: AzureWorkItem): string {
		const type = item.fields['System.WorkItemType'];
		if (!isAzureIdentifier(type)) throw new WorkItemWriteError('unknown');

		return type;
	}

	private getReceipt(item: AzureWorkItem, metadata: WorkItemMetadata): WorkItemReceipt {
		const title = item.fields['System.Title'];
		const state = metadata.states.find(candidate => candidate.name === item.fields['System.State']);
		if (
			!isAzurePositiveInt(item.id) ||
			!isAzurePositiveInt(item.rev) ||
			typeof title !== 'string' ||
			state == null ||
			this.itemType(item) !== metadata.type.name
		) {
			throw new WorkItemWriteError('unknown');
		}

		return {
			id: item.id,
			revision: item.rev,
			url: `${this.projectUrl}/_workitems/edit/${item.id}`,
			type: metadata.type.name,
			title: title,
			state: { name: state.name, category: state.category },
			bodyField: getAzureWorkItemBodyField(metadata.fields, metadata.catalog, item.fields),
		};
	}

	private async assertSessionCurrent(): Promise<void> {
		if (!(await this.isSessionCurrent())) throw new WorkItemWriteError('no-connection');
	}

	private url(path: string, params?: Record<string, string>, base = `${this.projectUrl}/_apis/wit`): string {
		return `${base}${path}?${new URLSearchParams({ 'api-version': this.apiVersion, ...params }).toString()}`;
	}

	private read<T>(path: string, params?: Record<string, string>): Promise<T> {
		return this.get<T>(this.url(path, params));
	}

	private readOrganization<T>(path: string, params?: Record<string, string>): Promise<T> {
		return this.get<T>(this.url(path, params, `${this.organizationUrl}/_apis`));
	}

	private async get<T>(url: string): Promise<T> {
		const { body } = await this.request<T>({ url: url, headers: this.headers, redirect: 'error' });
		return body;
	}

	private async save(
		method: 'POST' | 'PATCH',
		path: string,
		patch: Patch[],
		metadata: WorkItemMetadata,
		expected?: { id: number; state?: string },
	): Promise<WorkItemWriteResult> {
		const body = JSON.stringify(patch);
		await this.assertSessionCurrent();
		try {
			const { body: item } = await this.request<AzureWorkItem>({
				method: method,
				url: this.url(path),
				headers: { ...this.headers, 'Content-Type': 'application/json-patch+json' },
				body: body,
				redirect: 'error',
			});
			if (
				!this.isInProject(item) ||
				(expected != null && item.id !== expected.id) ||
				(expected?.state !== undefined && item.fields['System.State'] !== expected.state)
			) {
				return { ok: false, reason: 'unknown', applied: 'maybe' };
			}

			return { ok: true, ...this.context, issue: this.getReceipt(item, metadata) };
		} catch (ex) {
			return toWorkItemWriteFailure(ex, { fields: metadata.fields });
		}
	}
}
