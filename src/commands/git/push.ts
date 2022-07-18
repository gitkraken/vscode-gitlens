import * as nls from 'vscode-nls';
import { configuration } from '../../configuration';
import { CoreGitConfiguration, GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { getRemoteNameFromBranchName } from '../../git/models/branch';
import type { GitBranchReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { Directive, DirectiveQuickPickItem } from '../../quickpicks/items/directive';
import { FlagsQuickPickItem } from '../../quickpicks/items/flags';
import { isStringArray } from '../../system/array';
import { fromNow } from '../../system/date';
import { pad } from '../../system/string';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	AsyncStepResultGenerator,
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import {
	appendReposToTitle,
	pickRepositoriesStep,
	pickRepositoryStep,
	QuickCommand,
	QuickCommandButtons,
	StepResult,
} from '../quickCommand';

const localize = nls.loadMessageBundle();
interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	title: string;
}

type Flags = '--force' | '--set-upstream' | string;

interface State<Repos = string | string[] | Repository | Repository[]> {
	repos: Repos;
	reference?: GitReference;
	flags: Flags[];
}

export interface PushGitCommandArgs {
	readonly command: 'push';
	confirm?: boolean;
	state?: Partial<State>;
}

type PushStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export class PushGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: PushGitCommandArgs) {
		super(container, 'push', localize('label', 'push'), localize('title', 'Push'), {
			description: localize('description', 'pushes changes from the current branch to a remote'),
		});

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	execute(state: State<Repository[]>) {
		const index = state.flags.indexOf('--set-upstream');
		if (index !== -1) {
			if (!GitReference.isBranch(state.reference)) return Promise.resolve();

			return this.container.git.pushAll(state.repos, {
				force: false,
				publish: { remote: state.flags[index + 1] },
				reference: state.reference,
			});
		}

		return this.container.git.pushAll(state.repos, {
			force: state.flags.includes('--force'),
			reference: state.reference,
		});
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: this.container.git.openRepositories,
			associatedView: this.container.commitsView,
			title: this.title,
		};

		if (state.flags == null) {
			state.flags = [];
		}

		if (state.repos != null && !Array.isArray(state.repos)) {
			state.repos = [state.repos as string];
		}

		let skippedStepOne = false;

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (state.counter < 1 || state.repos == null || state.repos.length === 0 || isStringArray(state.repos)) {
				skippedStepOne = false;
				if (context.repos.length === 1) {
					skippedStepOne = true;
					state.counter++;

					state.repos = [context.repos[0]];
				} else if (state.reference != null) {
					const result = yield* pickRepositoryStep(
						{ ...state, repos: undefined, repo: state.reference.repoPath },
						context,
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = [result];
				} else {
					const result = yield* pickRepositoriesStep(
						state as ExcludeSome<typeof state, 'repos', string | Repository>,
						context,
						{ skipIfPossible: state.counter >= 1 },
					);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repos = result;
				}
			}

			if (this.confirm(state.confirm)) {
				const result = yield* this.confirmStep(state as PushStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (skippedStepOne) {
						state.counter--;
					}

					continue;
				}

				state.flags = result;
			}

			QuickCommand.endSteps(state);
			void this.execute(state as State<Repository[]>);
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private async *confirmStep(state: PushStepState, context: Context): AsyncStepResultGenerator<Flags[]> {
		const useForceWithLease = configuration.getAny<boolean>(CoreGitConfiguration.UseForcePushWithLease) ?? false;

		let step: QuickPickStep<FlagsQuickPickItem<Flags>>;

		if (state.repos.length > 1) {
			step = this.createConfirmStep(
				appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
				[
					FlagsQuickPickItem.create<Flags>(state.flags, [], {
						label: this.title,
						detail:
							state.repos.length === 1
								? localize('quickPick.push.detail.willPushOneRepository', 'Will push 1 repository')
								: localize(
										'quickPick.push.detail.willPushRepositories',
										'Will push {0} repositories',
										state.repos.length,
								  ),
					}),
					FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
						label: useForceWithLease
							? localize('quickPick.force.label.withLease', 'Force {0} (with lease)', this.title)
							: localize('quickPick.force.label', 'Force {0}', this.title),
						description: `--force${useForceWithLease ? '-with-lease' : ''}`,
						detail: useForceWithLease
							? state.repos.length === 1
								? localize(
										'quickPick.force.detail.WillForcePushWithLeaseOneRepository',
										'Will force push (with lease) 1 repository',
								  )
								: localize(
										'quickPick.force.detail.WillForcePushWithLeaseRepositories',
										'Will force push (with lease) {0} repositories',
										state.repos.length,
								  )
							: state.repos.length === 1
							? localize(
									'quickPick.force.detail.WillForcePushOneRepository',
									'Will force push 1 repository',
							  )
							: localize(
									'quickPick.force.detail.WillForcePushRepositories',
									'Will force push {0} repositories',
									state.repos.length,
							  ),
					}),
				],
			);
		} else {
			const [repo] = state.repos;

			const items: FlagsQuickPickItem<Flags>[] = [];

			if (GitReference.isBranch(state.reference)) {
				if (state.reference.remote) {
					step = this.createConfirmStep(
						appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
						[],
						DirectiveQuickPickItem.create(Directive.Cancel, true, {
							label: localize('cancel', 'Cancel {0}', this.title),
							detail: localize('quickPick.cannotPushRemote.detail', 'Cannot push remote branch'),
						}),
					);
				} else {
					const branch = await repo.getBranch(state.reference.name);

					if (branch != null && branch?.upstream == null) {
						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, branch.name],
									{
										label: localize(
											'quickPick.publish.label.publishBranchToRemote',
											'Publish {0} to {1}',
											branch.name,
											remote.name,
										),
										detail: localize(
											'quickPick.publish.detail',
											'Will publish {0} to {1}',
											GitReference.toString(branch),
											remote.name,
										),
									},
								),
							);
						}

						if (items.length) {
							step = this.createConfirmStep(
								appendReposToTitle(localize('confirmPublish', 'Confirm Publish'), state, context),
								items,
								undefined,
								{ placeholder: localize('confirmPublish', 'Confirm Publish') },
							);
						} else {
							step = this.createConfirmStep(
								appendReposToTitle(localize('confirmPublish', 'Confirm Publish'), state, context),
								[],
								DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: localize('cancelPublish', 'Cancel Publish'),
									detail: localize('cannotPublishNoRemotesFound', 'Cannot publish; No remotes found'),
								}),
								{ placeholder: localize('confirmPublish', 'Confirm Publish') },
							);
						}
					} else if (branch != null && branch?.state.behind > 0) {
						const currentBranch = await repo.getBranch();

						step = this.createConfirmStep(
							appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
							branch.id === currentBranch?.id
								? [
										FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
											label: useForceWithLease
												? localize(
														'quickPick.force.label.withLease',
														'Force {0} (with lease)',
														this.title,
												  )
												: localize('quickPick.force.label', 'Force {0}', this.title),
											description: `--force${useForceWithLease ? '-with-lease' : ''}`,
											detail: `${
												useForceWithLease
													? branch?.state.ahead === 1
														? branch?.getRemoteName()
															? localize(
																	'quickPick.force.detail.willForcePushWithLeaseOneCommitToRemote',
																	'Will force push (with lease) 1 commit to {0}',
																	branch?.getRemoteName(),
															  )
															: localize(
																	'quickPick.force.detail.willForcePushWithLeaseOneCommit',
																	'Will force push (with lease) 1 commit',
															  )
														: branch?.getRemoteName()
														? localize(
																'quickPick.force.detail.willForcePushWithLeaseCommitsToRemote',
																'Will force push (with lease) {0} commits to {1}',
																branch.state.ahead,
																branch.getRemoteName(),
														  )
														: localize(
																'quickPick.force.detail.willForcePushWithLeaseCommits',
																'Will force push (with lease) {0} commits',
																branch.state.ahead,
														  )
													: branch?.state.ahead === 1
													? branch?.getRemoteName()
														? localize(
																'quickPick.force.detail.willForcePushOneCommitToRemote',
																'Will force push 1 commit to {0}',
																branch.getRemoteName(),
														  )
														: localize(
																'quickPick.force.detail.willForcePushOneCommit',
																'Will force push 1 commit',
														  )
													: branch?.getRemoteName()
													? localize(
															'quickPick.force.detail.willForcePushCommitsToRemote',
															'Will force push {0} commits to {1}',
															branch.state.ahead,
															branch.getRemoteName(),
													  )
													: localize(
															'quickPick.force.detail.willForcePushCommits',
															'Will force push {0} commits',
															branch.state.ahead,
													  )
											}
												${
													branch != null && branch.state.behind > 0
														? `, ${
																branch?.state.behind === 1
																	? branch?.getRemoteName()
																		? localize(
																				'quickPick.force.detail.overwritingOneCommitOnRemote',
																				'overwiring 1 commit on {0}',
																				branch.getRemoteName(),
																		  )
																		: localize(
																				'quickPick.force.detail.overwritingOneCommit',
																				'overwiring 1 commit',
																		  )
																	: branch?.getRemoteName()
																	? localize(
																			'quickPick.force.detail.overwritingCommitsOnRemote',
																			'overwiring {0} commits on {1}',
																			branch.state.behind,
																			branch.getRemoteName(),
																	  )
																	: localize(
																			'quickPick.force.detail.overwritingCommits',
																			'overwiring {0} commits',
																			branch.state.behind,
																	  )
														  }`
														: ''
												}`,
										}),
								  ]
								: [],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: localize('cancel', 'Cancel {0}', this.title),
								detail:
									branch.state.behind === 1
										? localize(
												'cannotPushBranchIsBehindByOneCommit',
												'Cannot push; {0} is behind by 1 commit',
												GitReference.toString(branch),
										  )
										: localize(
												'cannotPushBranchIsBehindByCommits',
												'Cannot push; {0} is behind by {1} commits',
												GitReference.toString(branch),
												branch.state.behind,
										  ),
							}),
						);
					} else if (branch != null && branch?.state.ahead > 0) {
						step = this.createConfirmStep(appendReposToTitle(`Confirm ${context.title}`, state, context), [
							FlagsQuickPickItem.create<Flags>(state.flags, [branch.getRemoteName()!], {
								label: this.title,
								detail:
									branch.state.ahead === 1
										? localize(
												'quickPick.push.detail.willPushOneCommitFromBranchToRemote',
												'Will push 1 commit from {0} to {1}',
												GitReference.toString(branch),
												branch.getRemoteName(),
										  )
										: localize(
												'quickPick.push.detail.willPushCommitsFromBranchToRemote',
												'Will push {0} commits from {1} to {2}',
												branch.state.ahead,
												GitReference.toString(branch),
												branch.getRemoteName(),
										  ),
							}),
						]);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(localize('confirm', 'Confirm {0}', context.title), state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: localize('cancel', 'Cancel {0}', this.title),
								detail: localize('noCommitsFoundToPush', 'No commits found to push'),
							}),
						);
					}
				}
			} else {
				const status = await repo.getStatus();

				const branch: GitBranchReference = {
					refType: 'branch',
					name: status?.branch ?? 'HEAD',
					ref: status?.branch ?? 'HEAD',
					remote: false,
					repoPath: repo.path,
				};

				if (status?.state.ahead === 0) {
					if (state.reference == null && status.upstream == null) {
						state.reference = branch;

						for (const remote of await repo.getRemotes()) {
							items.push(
								FlagsQuickPickItem.create<Flags>(
									state.flags,
									['--set-upstream', remote.name, status.branch],
									{
										label: localize(
											'quickPick.publish.label',
											'Publish {0} to {1}',
											branch.name,
											remote.name,
										),
										detail: localize(
											'quickPick.publish.detail',
											'Will publish {0} to {1}',
											GitReference.toString(branch),
											remote.name,
										),
									},
								),
							);
						}
					}

					if (items.length) {
						step = this.createConfirmStep(
							appendReposToTitle(localize('confirmPublish', 'Confirm Publish'), state, context),
							items,
							undefined,
							{ placeholder: localize('confirmPublish', 'Confirm Publish') },
						);
					} else if (status.upstream == null) {
						step = this.createConfirmStep(
							appendReposToTitle(localize('confirmPublish', 'Confirm Publish'), state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: localize('cancelPublish', 'Cancel Publish'),
								detail: localize('cannotPublishNoRemotesFound', 'Cannot publish; No remotes found'),
							}),
							{ placeholder: localize('confirmPublish', 'Confirm Publish') },
						);
					} else {
						step = this.createConfirmStep(
							appendReposToTitle(localize('confirmPush', 'Confirm Push'), state, context),
							[],
							DirectiveQuickPickItem.create(Directive.Cancel, true, {
								label: localize('cancel', 'Cancel {0}', this.title),
								detail: localize(
									'cannotPushNoCommitsAheadOfRemote',
									'Cannot push; No commits ahead of {0}',
									getRemoteNameFromBranchName(status.upstream),
								),
							}),
						);
					}
				} else {
					let lastFetchedOn = '';

					const lastFetched = await repo.getLastFetched();
					if (lastFetched !== 0) {
						lastFetchedOn = `${pad(GlyphChars.Dot, 2, 2)}${localize(
							'lastFetchedTime',
							'Last fetched {0}',
							fromNow(new Date(lastFetched)),
						)}`;
					}

					let pushDetails;
					if (state.reference != null) {
						pushDetails = `${
							status?.state.ahead
								? ` ${localize(
										'pushDetails.commitsUpToAndIncludingRef',
										'commits up to and including {0}',
										GitReference.toString(state.reference, { label: false }),
								  )}`
								: ''
						}${
							status?.upstream
								? ` ${localize(
										'pushDetails.toRemote',
										'to {0}',
										getRemoteNameFromBranchName(status.upstream),
								  )}`
								: ''
						}`;
					} else {
						pushDetails = status?.state.ahead
							? status.state.ahead === 1
								? status?.upstream
									? localize(
											'pushDetails.oneCommitToRemote',
											'1 commit to {0}',
											getRemoteNameFromBranchName(status.upstream),
									  )
									: localize('pushDetails.oneCommitToRemote', '1 commit')
								: status?.upstream
								? localize(
										'pushDetails.commitsToRemote',
										'{0} commits to {1}',
										status.state.ahead,
										getRemoteNameFromBranchName(status.upstream),
								  )
								: localize('pushDetails.commitsToRemote', '{0} commits', status.state.ahead)
							: '';
					}

					step = this.createConfirmStep(
						appendReposToTitle(
							localize('confirm', 'Confirm {0}', context.title),
							state,
							context,
							lastFetchedOn,
						),
						[
							...(status?.state.behind
								? []
								: [
										FlagsQuickPickItem.create<Flags>(state.flags, [], {
											label: this.title,
											detail: `${localize(
												'quickpick.push.detail.willPush',
												'Will push',
											)}${pushDetails}`,
										}),
								  ]),
							FlagsQuickPickItem.create<Flags>(state.flags, ['--force'], {
								label: `Force ${this.title}${useForceWithLease ? ' (with lease)' : ''}`,
								description: `--force${useForceWithLease ? '-with-lease' : ''}`,
								detail: `${
									useForceWithLease
										? localize(
												'quickpick.push.detail.willForcePushWithLease',
												'Will force push (with lease)',
										  )
										: localize('quickpick.push.detail.willForcePush', 'Will force push')
								}${pushDetails}${
									status != null && status.state.behind > 0
										? `, ${
												status.state.behind === 1
													? status?.upstream
														? localize(
																'quickPick.force.detail.overwritingOneCommitOnRemote',
																'overwiring 1 commit on {0}',
																getRemoteNameFromBranchName(status.upstream),
														  )
														: localize(
																'quickPick.force.detail.overwritingOneCommit',
																'overwiring 1 commit',
														  )
													: status?.upstream
													? localize(
															'quickPick.force.detail.overwritingCommitsOnRemote',
															'overwiring {0} commits on {1}',
															status.state.behind,
															getRemoteNameFromBranchName(status.upstream),
													  )
													: localize(
															'quickPick.force.detail.overwritingCommits',
															'overwiring {0} commits',
															status.state.behind,
													  )
										  }`
										: ''
								}`,
							}),
						],
						status?.state.behind
							? DirectiveQuickPickItem.create(Directive.Cancel, true, {
									label: localize('cancel', 'Cancel {0}', this.title),
									detail: status?.upstream
										? status?.state.behind === 1
											? localize(
													'quickPick.cannotPushBranchIsBehindRemoteByOneCommit',
													'Cannot push; {0} is behind {1} by 1 commit',
													GitReference.toString(branch),
													getRemoteNameFromBranchName(status.upstream),
											  )
											: localize(
													'quickPick.cannotPushBranchIsBehindRemoteByCommits',
													'Cannot push; {0} is behind {1} by {2} commits',
													GitReference.toString(branch),
													getRemoteNameFromBranchName(status.upstream),
													status.state.behind,
											  )
										: status?.state.behind === 1
										? localize(
												'quickPick.cannotPushBranchIsBehindByOneCommit',
												'Cannot push; {0} is behind by 1 commit',
												GitReference.toString(branch),
										  )
										: localize(
												'quickPick.cannotPushBranchIsBehindByCommits',
												'Cannot push; {0} is behind by {1} commits',
												GitReference.toString(branch),
												status.state.behind,
										  ),
							  })
							: undefined,
					);

					step.additionalButtons = [QuickCommandButtons.Fetch];
					step.onDidClickButton = async (quickpick, button) => {
						if (button !== QuickCommandButtons.Fetch || quickpick.busy) return false;

						quickpick.title = `${localize('confirm', 'Confirm {0}', context.title)}${pad(
							GlyphChars.Dot,
							2,
							2,
						)}${localize('fetching', 'Fetching')}${GlyphChars.Ellipsis}`;

						quickpick.busy = true;
						quickpick.enabled = false;
						try {
							await repo.fetch({ progress: true });
							// Signal that the step should be retried
							return true;
						} finally {
							quickpick.busy = false;
							quickpick.enabled = true;
						}
					};
				}
			}
		}

		const selection: StepSelection<typeof step> = yield step;
		return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
	}
}
