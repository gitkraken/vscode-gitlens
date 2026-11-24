import type {
	IssueTrackerCreateOptions,
	IssueTrackerCreateOptionsResult,
	IssueTrackerDeleteOptions,
	IssueTrackerField,
	IssueTrackerIssueReceipt,
	IssueTrackerIssueWriteOptions,
	IssueTrackerIssueWriteOptionsResult,
	IssueTrackerStatus,
	IssueTrackerTransition,
	IssueTrackerWriteConnection,
	IssueTrackerWriteOptions,
	IssueTrackerWriteResult,
	IssueTrackerWriteTargetOptions,
	IssueTrackerWriteTargetResult,
} from '../models/issueTrackerWrites.js';
import { toIssueWebUrl, toStatusCategory } from './jiraIssueByKey.js';
import { JiraIssueWriteError, toJiraIssueWriteFailure } from './jiraIssueWriteErrors.js';
import type { ProviderRequestFunction } from './models.js';

type Project = IssueTrackerIssueReceipt['project'];
type IssueType = IssueTrackerIssueReceipt['issueType'];
type JiraStatus = { id: string; name: string; statusCategory: { key: string } };
type JiraIssue = {
	id: string;
	key: string;
	fields: { project: Project; issuetype: IssueType; summary: string; status: JiraStatus; subtasks?: unknown[] };
};
type JiraField = Omit<IssueTrackerField, 'fieldId' | 'hasDefaultValue'> & {
	fieldId?: string;
	key?: string;
	hasDefaultValue?: boolean;
};
type JiraTransition = Omit<IssueTrackerTransition, 'to' | 'fields' | 'isAvailable' | 'isConditional' | 'hasScreen'> & {
	to: JiraStatus;
	fields?: Record<string, JiraField>;
	isAvailable?: boolean;
	isConditional?: boolean;
	hasScreen?: boolean;
};
type JiraPage = {
	startAt: number;
	total: number;
	fields?: JiraField[];
	results?: JiraField[];
	issueTypes?: IssueType[];
};
type JiraSite = { id: string; url: string; scopes: string[] };
type JiraPermissions = Record<string, { havePermission?: boolean }>;

const pageSize = 50;
const maxPages = 20;
const createPermission = 'CREATE_ISSUES';
const permissionKeys = { edit: 'EDIT_ISSUES', transition: 'TRANSITION_ISSUES', delete: 'DELETE_ISSUES' };
const reservedFields = new Set(['summary', 'description', 'project', 'issuetype']);
const numericId = /^\d+$/;

function isNumericId(value: unknown): value is string {
	return typeof value === 'string' && numericId.test(value);
}

export function isJiraWriteIdentifier(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.trim() === value &&
		value !== '.' &&
		value !== '..' &&
		!/[\\/?#]/.test(value)
	);
}

function toStatus(status: JiraStatus): IssueTrackerStatus {
	if (
		typeof status?.id !== 'string' ||
		typeof status.name !== 'string' ||
		typeof status.statusCategory?.key !== 'string'
	) {
		throw new Error('Jira returned incomplete status metadata');
	}

	return { id: status.id, name: status.name, category: toStatusCategory(status.statusCategory.key) };
}

function toField(fieldId: string, field: JiraField): IssueTrackerField {
	return {
		fieldId: fieldId,
		name: field.name,
		required: field.required,
		schema: structuredClone(field.schema),
		allowedValues: structuredClone(field.allowedValues),
		hasDefaultValue: field.hasDefaultValue ?? false,
		operations: field.operations,
	};
}

function toFields(fields: Record<string, JiraField>): IssueTrackerField[] {
	return Object.entries(fields).map(([id, field]) => toField(id, field));
}

function validateFields(
	fields: Readonly<Record<string, unknown>> | undefined,
	topLevel: { summary?: string; description?: string },
	screen: readonly IssueTrackerField[],
): Record<string, unknown> {
	if (fields !== undefined && (fields == null || typeof fields !== 'object' || Array.isArray(fields))) {
		throw new JiraIssueWriteError('invalid-input');
	}

	const values = { ...fields, ...topLevel };
	const settable = new Set(screen.filter(field => field.operations.includes('set')).map(field => field.fieldId));
	const invalid = Object.keys(values).filter(
		key => !settable.has(key) || (reservedFields.has(key) && Object.hasOwn(fields ?? {}, key)),
	);
	if (invalid.length !== 0) {
		throw new JiraIssueWriteError(
			'invalid-input',
			Object.fromEntries(invalid.map(key => [key, 'field-not-settable'])),
		);
	}

	return values;
}

export class JiraIssueWriter {
	static async connect(
		request: ProviderRequestFunction,
		accessToken: string,
		options: IssueTrackerWriteConnection,
		isSessionCurrent: () => Promise<boolean>,
	): Promise<JiraIssueWriter> {
		const { body: sites } = await request<JiraSite[]>({
			url: 'https://api.atlassian.com/oauth/token/accessible-resources',
			redirect: 'error',
			headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
		});
		const site = sites.find(
			resource =>
				resource.id === options.resourceId && resource.scopes?.some(scope => /:jira(?:-|$)/.test(scope)),
		);
		if (site == null) throw new JiraIssueWriteError('not-found');

		const resourceUrl = new URL(site.url);
		if (resourceUrl.protocol !== 'https:' || resourceUrl.username || resourceUrl.password) {
			throw new JiraIssueWriteError('unknown');
		}

		const writer = new JiraIssueWriter(request, accessToken, site, isSessionCurrent);
		const { accountId } = await writer.read<{ accountId: string }>('/myself');
		if (typeof accountId !== 'string' || !accountId) throw new JiraIssueWriteError('unknown');

		if (options.expectedAccountId !== undefined && options.expectedAccountId !== accountId) {
			throw new JiraIssueWriteError('forbidden');
		}

		writer.accountId = accountId;
		return writer;
	}

	private accountId = '';

	private constructor(
		private readonly request: ProviderRequestFunction,
		private readonly accessToken: string,
		private readonly site: JiraSite,
		private readonly isSessionCurrent: () => Promise<boolean>,
	) {}

	async getCreateOptions(options: IssueTrackerCreateOptions): Promise<IssueTrackerCreateOptionsResult> {
		const project = await this.readCreateProject(options.project);
		const result = {
			ok: true as const,
			resourceId: this.site.id,
			siteUrl: this.site.url,
			accountId: this.accountId,
			project: project,
		};
		if (options.issueTypeId === undefined) {
			const { values, truncated } = await this.readPages(
				this.createMetadataPath(project.id),
				page => page.issueTypes,
			);
			return {
				...result,
				issueTypes: values.map(({ id, name }) => ({ id: id, name: name })),
				truncated: truncated,
			};
		}

		const { values, truncated } = await this.readCreateFields(project.id, options.issueTypeId);
		return { ...result, issueTypeId: options.issueTypeId, fields: values, truncated: truncated };
	}

	async getIssueOptions(options: IssueTrackerIssueWriteOptions): Promise<IssueTrackerIssueWriteOptionsResult> {
		const issue = await this.resolveIssue(options);
		const permissions = await this.readPermissions(issue.id);
		const [fields, transitions] = await Promise.all([
			permissions.edit ? this.readEditFields(issue.id) : [],
			permissions.transition ? this.readTransitions(issue.id) : [],
		]);
		const reason = this.getDeleteRefusal(permissions.delete, issue);
		return {
			ok: true,
			issue: this.toReceipt(issue),
			accountId: this.accountId,
			fields: fields,
			transitions: transitions,
			permissions: permissions,
			deleteCapability: reason === undefined ? { allowed: true } : { allowed: false, reason: reason },
		};
	}

	async resolveTarget(options: IssueTrackerWriteTargetOptions): Promise<IssueTrackerWriteTargetResult> {
		if (options.intent !== undefined && options.intent !== 'delete') throw new JiraIssueWriteError('invalid-input');

		const issue = await this.resolveIssue(options);
		if (options.intent === 'delete') {
			await this.ensureDeletable(issue);
		}

		return { ok: true, issue: this.toReceipt(issue), accountId: this.accountId };
	}

	async write(options: IssueTrackerWriteOptions): Promise<IssueTrackerWriteResult> {
		switch (options.action) {
			case 'create':
				return this.createIssue(options);
			case 'edit':
			case 'transition':
				return this.updateIssue(options);
			default:
				throw new JiraIssueWriteError('invalid-input');
		}
	}

	async delete(options: IssueTrackerDeleteOptions): Promise<IssueTrackerWriteResult> {
		if (!isJiraWriteIdentifier(options.expectedAccountId) || !isNumericId(options.expectedIssueId)) {
			throw new JiraIssueWriteError('invalid-input');
		}

		const issue = await this.resolveIssue(options);
		await this.ensureDeletable(issue);
		const receipt = this.toReceipt(issue);
		return this.dispatch('DELETE', `/issue/${issue.id}?deleteSubtasks=false`, 204, () => receipt);
	}

	private async createIssue(
		options: Extract<IssueTrackerWriteOptions, { action: 'create' }>,
	): Promise<IssueTrackerWriteResult> {
		if (typeof options.summary !== 'string' || !options.summary.trim()) {
			throw new JiraIssueWriteError('invalid-input');
		}

		const topLevel = this.editableFields(options);
		const project = await this.readCreateProject(options.project);
		const screen = await this.readCreateFields(project.id, options.issueTypeId);
		const fields = validateFields(options.fields, topLevel, screen.values);
		return this.dispatch(
			'POST',
			'/issue',
			201,
			async response => {
				const created = response as { id: string };
				if (!isNumericId(created.id)) throw new Error('Jira returned no issue ID');

				return this.toReceipt(await this.readIssue(created.id));
			},
			{ fields: { ...fields, project: { id: project.id }, issuetype: { id: options.issueTypeId } } },
		);
	}

	private async updateIssue(
		options: Extract<IssueTrackerWriteOptions, { action: 'edit' | 'transition' }>,
	): Promise<IssueTrackerWriteResult> {
		if (!isNumericId(options.expectedIssueId)) throw new JiraIssueWriteError('invalid-input');

		const issue = await this.resolveIssue(options);
		const path = `/issue/${issue.id}`;
		const readReceipt = async () => this.toReceipt(await this.readIssue(issue.id));
		const permissions = await this.readPermissions(issue.id);
		if (options.action === 'edit') {
			if (!permissions.edit) throw new JiraIssueWriteError('forbidden');

			const fields = validateFields(
				options.fields,
				this.editableFields(options),
				await this.readEditFields(issue.id),
			);
			if (Object.keys(fields).length === 0) throw new JiraIssueWriteError('invalid-input');

			return this.dispatch('PUT', path, 204, readReceipt, { fields: fields });
		}

		if (!isNumericId(options.transitionId)) throw new JiraIssueWriteError('invalid-input');
		if (!permissions.transition) throw new JiraIssueWriteError('forbidden');

		const transition = (await this.readTransitions(issue.id)).find(item => item.id === options.transitionId);
		if (transition?.isAvailable !== true) throw new JiraIssueWriteError('transition-unavailable');

		const fields = validateFields(
			options.fields,
			this.editableFields(options),
			transition.hasScreen ? transition.fields : [],
		);
		return this.dispatch('POST', `${path}/transitions`, 204, readReceipt, {
			transition: { id: transition.id },
			fields: fields,
		});
	}

	private editableFields(options: { summary?: string; description?: string }): {
		summary?: string;
		description?: string;
	} {
		const { summary, description } = options;
		if (
			(summary !== undefined && (typeof summary !== 'string' || !summary.trim())) ||
			(description !== undefined && typeof description !== 'string')
		) {
			throw new JiraIssueWriteError('invalid-input');
		}

		return {
			...(summary !== undefined && { summary: summary }),
			...(description !== undefined && { description: description }),
		};
	}

	private async resolveIssue(options: IssueTrackerIssueWriteOptions): Promise<JiraIssue> {
		if (
			!isJiraWriteIdentifier(options.issue) ||
			(options.expectedIssueId !== undefined && !isNumericId(options.expectedIssueId))
		) {
			throw new JiraIssueWriteError('invalid-input');
		}

		const issue = await this.readIssue(options.issue);
		if (
			(options.expectedIssueId !== undefined && options.expectedIssueId !== issue.id) ||
			(!numericId.test(options.issue) && options.issue.toUpperCase() !== issue.key.toUpperCase())
		) {
			throw new JiraIssueWriteError('conflict');
		}

		return issue;
	}

	private async readIssue(idOrKey: string): Promise<JiraIssue> {
		const issue = await this.read<JiraIssue>(
			`/issue/${encodeURIComponent(idOrKey)}?fields=project,issuetype,summary,status,subtasks`,
		);
		if (
			!isNumericId(issue.id) ||
			(numericId.test(idOrKey) && issue.id !== idOrKey) ||
			!isJiraWriteIdentifier(issue.key) ||
			!isJiraWriteIdentifier(issue.fields?.project?.key) ||
			!issue.key.startsWith(`${issue.fields.project.key}-`) ||
			!isNumericId(issue.fields.project.id)
		) {
			throw new Error('Jira returned inconsistent issue identity');
		}

		return issue;
	}

	private async readCreateProject(idOrKey: string): Promise<Project> {
		if (!isJiraWriteIdentifier(idOrKey)) throw new JiraIssueWriteError('invalid-input');

		const { id, key } = await this.read<Project>(`/project/${encodeURIComponent(idOrKey)}`);
		if (
			!isNumericId(id) ||
			!isJiraWriteIdentifier(key) ||
			(numericId.test(idOrKey) ? id !== idOrKey : key.toUpperCase() !== idOrKey.toUpperCase())
		) {
			throw new JiraIssueWriteError('conflict');
		}

		const permissions = await this.readPermissionsFor({ projectId: id, permissions: createPermission });
		if (permissions[createPermission]?.havePermission !== true) throw new JiraIssueWriteError('forbidden');

		return { id: id, key: key };
	}

	private async readPermissions(issueId: string): Promise<IssueTrackerIssueWriteOptionsSuccess['permissions']> {
		const permissions = await this.readPermissionsFor({
			issueId: issueId,
			permissions: Object.values(permissionKeys).join(','),
		});
		return {
			edit: permissions[permissionKeys.edit]?.havePermission === true,
			transition: permissions[permissionKeys.transition]?.havePermission === true,
			delete: permissions[permissionKeys.delete]?.havePermission === true,
		};
	}

	private async readPermissionsFor(params: Record<string, string>): Promise<JiraPermissions> {
		const query = new URLSearchParams(params);
		const { permissions } = await this.read<{ permissions: JiraPermissions }>(`/mypermissions?${query.toString()}`);
		return permissions;
	}

	private async readTransitions(issueId: string): Promise<IssueTrackerTransition[]> {
		const { transitions } = await this.read<{ transitions: JiraTransition[] }>(
			`/issue/${issueId}/transitions?expand=transitions.fields`,
		);
		return transitions.map(transition => ({
			id: transition.id,
			name: transition.name,
			to: toStatus(transition.to),
			hasScreen: transition.hasScreen === true,
			isAvailable: transition.isAvailable !== false,
			isConditional: transition.isConditional === true,
			fields: toFields(transition.fields ?? {}),
		}));
	}

	private async readEditFields(issueId: string): Promise<IssueTrackerField[]> {
		const { fields } = await this.read<{ fields: Record<string, JiraField> }>(`/issue/${issueId}/editmeta`);
		return toFields(fields);
	}

	private async readCreateFields(
		projectId: string,
		issueTypeId: string,
	): Promise<{ values: IssueTrackerField[]; truncated: boolean }> {
		if (!isNumericId(issueTypeId)) throw new JiraIssueWriteError('invalid-input');

		const { values, truncated } = await this.readPages(
			`${this.createMetadataPath(projectId)}/${issueTypeId}`,
			page => page.fields ?? page.results,
		);
		return {
			values: values.map(field => {
				const id = field.fieldId ?? field.key;
				if (!id) throw new Error('Jira returned metadata with no field ID');

				return toField(id, field);
			}),
			truncated: truncated,
		};
	}

	private createMetadataPath(projectId: string): string {
		return `/issue/createmeta/${projectId}/issuetypes`;
	}

	private async readPages<T>(
		path: string,
		items: (page: JiraPage) => T[] | undefined,
	): Promise<{ values: T[]; truncated: boolean }> {
		const values: T[] = [];
		for (let index = 0; index < maxPages; index++) {
			const startAt = values.length;
			const page = await this.read<JiraPage>(`${path}?startAt=${startAt}&maxResults=${pageSize}`);
			const rows = items(page);
			if (
				!Array.isArray(rows) ||
				!Number.isSafeInteger(page.total) ||
				page.total < 0 ||
				page.startAt !== startAt
			) {
				throw new Error('Jira returned invalid create metadata pagination');
			}

			values.push(...rows);
			if (values.length >= page.total) return { values: values, truncated: false };
			if (rows.length === 0) break;
		}

		return { values: values, truncated: true };
	}

	private getDeleteRefusal(
		allowed: boolean,
		issue: JiraIssue,
	): 'forbidden' | 'insufficient-scope' | 'invalid-input' | undefined {
		if (!allowed) return 'forbidden';
		if (!this.site.scopes?.some(scope => scope === 'delete:issue:jira' || scope === 'write:jira-work')) {
			return 'insufficient-scope';
		}
		if (!Array.isArray(issue.fields.subtasks) || issue.fields.subtasks.length !== 0) return 'invalid-input';

		return undefined;
	}

	private async ensureDeletable(issue: JiraIssue): Promise<void> {
		const reason = this.getDeleteRefusal((await this.readPermissions(issue.id)).delete, issue);
		if (reason !== undefined) throw new JiraIssueWriteError(reason);
	}

	private toReceipt(issue: JiraIssue): IssueTrackerIssueReceipt {
		const { project, issuetype, summary, status } = issue.fields;
		if (!isNumericId(issuetype?.id) || typeof issuetype.name !== 'string' || typeof summary !== 'string') {
			throw new Error('Jira returned incomplete issue metadata');
		}

		return {
			resourceId: this.site.id,
			siteUrl: this.site.url,
			id: issue.id,
			key: issue.key,
			url: toIssueWebUrl(this.site.url, issue.key),
			project: { id: project.id, key: project.key },
			issueType: { id: issuetype.id, name: issuetype.name },
			summary: summary,
			status: toStatus(status),
		};
	}

	private async read<T>(path: string): Promise<T> {
		return (await this.request<T>({ url: this.url(path), headers: this.headers(), redirect: 'error' })).body;
	}

	private async dispatch(
		method: 'POST' | 'PUT' | 'DELETE',
		path: string,
		expectedStatus: number,
		receipt: (response: unknown) => IssueTrackerIssueReceipt | Promise<IssueTrackerIssueReceipt>,
		payload?: object,
	): Promise<IssueTrackerWriteResult> {
		let body: string | undefined;
		try {
			body = payload === undefined ? undefined : JSON.stringify(payload);
		} catch {
			return { ok: false, reason: 'invalid-input', mutationDispatched: false };
		}

		if (!(await this.isSessionCurrent())) return { ok: false, reason: 'no-connection', mutationDispatched: false };

		let response;
		try {
			response = await this.request<unknown>({
				url: this.url(path),
				method: method,
				headers: { ...this.headers(), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
				body: body,
				redirect: 'error',
			});
		} catch (ex) {
			return toJiraIssueWriteFailure(ex, true);
		}

		if (response.status !== expectedStatus) return { ok: false, reason: 'unknown', applied: 'maybe' };

		try {
			return { ok: true, issue: await receipt(response.body), accountId: this.accountId };
		} catch {
			return { ok: false, reason: 'unknown', applied: 'maybe' };
		}
	}

	private url(path: string): string {
		return `https://api.atlassian.com/ex/jira/${encodeURIComponent(this.site.id)}/rest/api/2${path}`;
	}

	private headers(): Record<string, string> {
		return { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' };
	}
}

type IssueTrackerIssueWriteOptionsSuccess = Extract<IssueTrackerIssueWriteOptionsResult, { ok: true }>;
