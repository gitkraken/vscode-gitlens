'use strict';
import { QuickInputButtons, QuickPickItem, Uri, window } from 'vscode';
import { Container } from '../../container';
import { GitStashCommit, GitUri, Repository } from '../../git/gitService';
import { BreakQuickCommand, QuickCommandBase, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import {
    CommitQuickPickItem,
    Directive,
    DirectiveQuickPickItem,
    GitFlagsQuickPickItem,
    QuickPickItemOfT,
    RepositoryQuickPickItem
} from '../../quickpicks';
import { Iterables, Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';
import { Messages } from '../../messages';

interface ApplyState {
    subcommand: 'apply';
    repo: Repository;
    stash: { stashName: string; message: string; repoPath: string };
    flags: string[];
}

interface DropState {
    subcommand: 'drop';
    repo: Repository;
    stash: { stashName: string; message: string; repoPath: string };
    flags: string[];
}

interface PopState {
    subcommand: 'pop';
    repo: Repository;
    stash: { stashName: string; message: string; repoPath: string };
    flags: string[];
}

interface PushState {
    subcommand: 'push';
    repo: Repository;
    message?: string;
    uris?: Uri[];
    flags: string[];
}

type State = ApplyState | DropState | PopState | PushState;
type StashStepState<T> = StepState<T> & { repo: Repository };

export interface StashGitCommandArgs {
    readonly command: 'stash';
    state?: Partial<State>;

    confirm?: boolean;
}

export class StashGitCommand extends QuickCommandBase<State> {
    private _subcommand: string | undefined;

    constructor(args?: StashGitCommandArgs) {
        super('stash', 'stash', 'Stash');

        if (args === undefined || args.state === undefined) return;

        let counter = 0;
        if (args.state.subcommand !== undefined) {
            counter++;
        }

        if (args.state.repo !== undefined) {
            counter++;
        }

        switch (args.state.subcommand) {
            case 'apply':
            case 'drop':
            case 'pop':
                if (args.state.stash !== undefined) {
                    counter++;
                }
                break;

            case 'push':
                if (args.state.message !== undefined) {
                    counter++;
                }

                break;
        }

        this._initialState = {
            counter: counter,
            confirm: args.confirm,
            ...args.state
        };
    }

    get canSkipConfirm(): boolean {
        return this._subcommand === 'drop' ? false : super.canSkipConfirm;
    }

    get confirmationKey() {
        return this._subcommand === undefined ? undefined : `${super.confirmationKey}-${this._subcommand}`;
    }

    protected async *steps(): StepAsyncGenerator {
        const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
        let oneRepo = false;

        while (true) {
            try {
                if (state.subcommand === undefined || state.counter < 1) {
                    this._subcommand = undefined;

                    const step = this.createPickStep<QuickPickItemOfT<State['subcommand']>>({
                        title: this.title,
                        placeholder: `Choose a ${this.label} command`,
                        items: [
                            {
                                label: 'apply',
                                picked: state.subcommand === 'apply',
                                item: 'apply'
                            },
                            {
                                label: 'drop',
                                picked: state.subcommand === 'drop',
                                item: 'drop'
                            },
                            {
                                label: 'pop',
                                picked: state.subcommand === 'pop',
                                item: 'pop'
                            },
                            {
                                label: 'push',
                                picked: state.subcommand === 'push',
                                item: 'push'
                            }
                        ],
                        buttons: [QuickInputButtons.Back]
                    });
                    const selection: StepSelection<typeof step> = yield step;

                    if (!this.canPickStepMoveNext(step, state, selection)) {
                        break;
                    }

                    state.subcommand = selection[0].item;
                }

                this._subcommand = state.subcommand;

                if (state.repo === undefined || state.counter < 2) {
                    const repos = [...(await Container.git.getOrderedRepositories())];

                    if (repos.length === 1) {
                        oneRepo = true;
                        state.counter++;
                        state.repo = repos[0];
                    }
                    else {
                        const step = this.createPickStep<RepositoryQuickPickItem>({
                            title: `${this.title} ${state.subcommand}`,
                            placeholder: 'Choose a repository',
                            items: await Promise.all(
                                repos.map(r =>
                                    RepositoryQuickPickItem.create(r, r.id === (state.repo && state.repo.id), {
                                        branch: true,
                                        fetched: true,
                                        status: true
                                    })
                                )
                            )
                        });
                        const selection: StepSelection<typeof step> = yield step;

                        if (!this.canPickStepMoveNext(step, state, selection)) {
                            continue;
                        }

                        state.repo = selection[0].item;
                    }
                }

                switch (state.subcommand) {
                    case 'apply':
                    case 'pop':
                        yield* this.applyOrPop(state as StashStepState<ApplyState | PopState>);
                        break;
                    case 'drop':
                        yield* this.drop(state as StashStepState<DropState>);
                        break;
                    case 'push':
                        yield* this.push(state as StashStepState<PushState>);
                        break;
                    default:
                        return undefined;
                }

                if (oneRepo) {
                    state.counter--;
                }
                continue;
            }
            catch (ex) {
                if (ex instanceof BreakQuickCommand) break;

                Logger.error(ex, `${this.title}.${state.subcommand}`);

                switch (state.subcommand) {
                    case 'apply':
                    case 'pop':
                        if (
                            ex.message.includes(
                                'Your local changes to the following files would be overwritten by merge'
                            )
                        ) {
                            void window.showWarningMessage(
                                'Unable to apply stash. Your working tree changes would be overwritten'
                            );

                            return undefined;
                        }
                        else if (ex.message.includes('Auto-merging') && ex.message.includes('CONFLICT')) {
                            void window.showInformationMessage('Stash applied with conflicts');

                            return undefined;
                        }

                        void Messages.showGenericErrorMessage(
                            `Unable to apply stash \u2014 ${ex.message.trim().replace(/\n+?/g, '; ')}`
                        );

                        return undefined;

                    case 'drop':
                        void Messages.showGenericErrorMessage('Unable to delete stash');

                        return undefined;

                    case 'push':
                        if (ex.message.includes('newer version of Git')) {
                            void window.showErrorMessage(`Unable to stash changes. ${ex.message}`);

                            return undefined;
                        }

                        void Messages.showGenericErrorMessage('Unable to stash changes');

                        return undefined;
                }

                throw ex;
            }
        }

        return undefined;
    }

    private async *applyOrPop(state: StashStepState<ApplyState> | StashStepState<PopState>): StepAsyncGenerator {
        while (true) {
            if (state.stash === undefined || state.counter < 3) {
                const stash = await Container.git.getStashList(state.repo.path);

                const step = this.createPickStep<CommitQuickPickItem<GitStashCommit>>({
                    title: `${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repo.formattedName
                    }`,
                    placeholder:
                        stash === undefined
                            ? `${state.repo.formattedName} has no stashed changes`
                            : 'Choose a stash to apply to your working tree',
                    matchOnDetail: true,
                    items:
                        stash === undefined
                            ? [
                                  DirectiveQuickPickItem.create(Directive.Back, true),
                                  DirectiveQuickPickItem.create(Directive.Cancel)
                              ]
                            : [
                                  ...Iterables.map(stash.commits.values(), c =>
                                      CommitQuickPickItem.create(
                                          c,
                                          c.stashName === (state.stash && state.stash.stashName),
                                          {
                                              compact: true
                                          }
                                      )
                                  )
                              ]
                });
                const selection: StepSelection<typeof step> = yield step;

                if (!this.canPickStepMoveNext(step, state, selection)) {
                    break;
                }

                state.stash = selection[0].item;
            }

            if (this.confirm(state.confirm)) {
                const message =
                    state.stash.message.length > 80
                        ? `${state.stash.message.substring(0, 80)}${GlyphChars.Ellipsis}`
                        : state.stash.message;

                const step = this.createConfirmStep<GitFlagsQuickPickItem & { command: 'apply' | 'pop' }>(
                    `Confirm ${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repo.formattedName
                    }`,
                    [
                        {
                            label: `${this.title} ${state.subcommand}`,
                            description: `${state.stash.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
                            detail:
                                state.subcommand === 'pop'
                                    ? `Will delete ${
                                          state.stash!.stashName
                                      } and apply the changes to the working tree of ${state.repo.formattedName}`
                                    : `Will apply the changes from ${state.stash!.stashName} to the working tree of ${
                                          state.repo.formattedName
                                      }`,
                            command: state.subcommand!,
                            item: []
                        },
                        // Alternate confirmation (if pop then apply, and vice versa)
                        {
                            label: `${this.title} ${state.subcommand === 'pop' ? 'apply' : 'pop'}`,
                            description: `${state.stash!.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
                            detail:
                                state.subcommand === 'pop'
                                    ? `Will apply the changes from ${state.stash!.stashName} to the working tree of ${
                                          state.repo.formattedName
                                      }`
                                    : `Will delete ${
                                          state.stash!.stashName
                                      } and apply the changes to the working tree of ${state.repo.formattedName}`,
                            command: state.subcommand === 'pop' ? 'apply' : 'pop',
                            item: []
                        }
                    ],
                    { placeholder: `Confirm ${this.title} ${state.subcommand}` }
                );
                const selection: StepSelection<typeof step> = yield step;

                if (!this.canPickStepMoveNext(step, state, selection)) {
                    break;
                }

                state.subcommand = selection[0].command;
                state.flags = selection[0].item;
            }
            else {
                state.flags = [];
            }

            void Container.git.stashApply(state.repo.path, state.stash!.stashName, state.subcommand === 'pop');

            throw new BreakQuickCommand();
        }

        return undefined;
    }

    private async *drop(state: StashStepState<DropState>): StepAsyncGenerator {
        while (true) {
            if (state.stash === undefined || state.counter < 3) {
                const stash = await Container.git.getStashList(state.repo.path);

                const step = this.createPickStep<CommitQuickPickItem<GitStashCommit>>({
                    title: `${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repo.formattedName
                    }`,
                    placeholder:
                        stash === undefined
                            ? `${state.repo.formattedName} has no stashed changes`
                            : 'Choose a stash to delete',
                    matchOnDetail: true,
                    items:
                        stash === undefined
                            ? [
                                  DirectiveQuickPickItem.create(Directive.Back, true),
                                  DirectiveQuickPickItem.create(Directive.Cancel)
                              ]
                            : [
                                  ...Iterables.map(stash.commits.values(), c =>
                                      CommitQuickPickItem.create(
                                          c,
                                          c.stashName === (state.stash && state.stash.stashName),
                                          {
                                              compact: true
                                          }
                                      )
                                  )
                              ]
                });
                const selection: StepSelection<typeof step> = yield step;

                if (!this.canPickStepMoveNext(step, state, selection)) {
                    break;
                }

                state.stash = selection[0].item;
            }

            // if (this.confirm(state.confirm)) {
            const message =
                state.stash.message.length > 80
                    ? `${state.stash.message.substring(0, 80)}${GlyphChars.Ellipsis}`
                    : state.stash.message;

            const step = this.createConfirmStep<QuickPickItem>(
                `Confirm ${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                    state.repo.formattedName
                }`,
                [
                    {
                        label: `${this.title} ${state.subcommand}`,
                        description: `${state.stash.stashName}${Strings.pad(GlyphChars.Dash, 2, 2)}${message}`,
                        detail: `Will delete ${state.stash.stashName}`
                    }
                ],
                { placeholder: `Confirm ${this.title} ${state.subcommand}` }
            );
            const selection: StepSelection<typeof step> = yield step;

            if (!this.canPickStepMoveNext(step, state, selection)) {
                break;
            }

            void Container.git.stashDelete(state.repo.path, state.stash.stashName);

            throw new BreakQuickCommand();
        }

        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async *push(state: StashStepState<PushState>): StepAsyncGenerator {
        while (true) {
            if (state.message === undefined || state.counter < 3) {
                const step = this.createInputStep({
                    title: `${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repo.formattedName
                    }`,
                    placeholder: 'Please provide a stash message',
                    value: state.message
                    // validate: (value: string | undefined): [boolean, string | undefined] => [value != null, undefined]
                });

                const value: StepSelection<typeof step> = yield step;

                if (!(await this.canInputStepMoveNext(step, state, value))) {
                    break;
                }

                state.message = value;
            }

            if (this.confirm(state.confirm)) {
                const step = this.createConfirmStep<GitFlagsQuickPickItem>(
                    `Confirm ${this.title} ${state.subcommand}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repo.formattedName
                    }`,
                    state.uris === undefined || state.uris.length === 0
                        ? [
                              {
                                  label: `${this.title} ${state.subcommand}`,
                                  description: state.message,
                                  detail: 'Will stash uncommitted changes',
                                  item: []
                              },
                              {
                                  label: `${this.title} ${state.subcommand}`,
                                  description: state.message,
                                  detail: 'Will stash uncommitted changes, including untracked files',
                                  item: ['--include-untracked']
                              },
                              {
                                  label: `${this.title} ${state.subcommand}`,
                                  description: state.message,
                                  detail: 'Will stash uncommitted changes, but will keep staged files intact',
                                  item: ['--keep-index']
                              }
                          ]
                        : [
                              {
                                  label: `${this.title} ${state.subcommand}`,
                                  description: state.message,
                                  detail: `Will stash changes in ${
                                      state.uris.length === 1
                                          ? GitUri.getFormattedPath(state.uris[0], { relativeTo: state.repo.path })
                                          : `${state.uris.length} files`
                                  }`,
                                  item: []
                              }
                          ],
                    { placeholder: `Confirm ${this.title} ${state.subcommand}` }
                );
                const selection: StepSelection<typeof step> = yield step;

                if (!this.canPickStepMoveNext(step, state, selection)) {
                    break;
                }

                state.flags = selection[0].item;
            }
            else {
                state.flags = [];
            }

            void Container.git.stashSave(state.repo.path, state.message, state.uris, {
                includeUntracked: state.flags.includes('--include-untracked'),
                keepIndex: state.flags.includes('--keep-index')
            });

            throw new BreakQuickCommand();
        }

        return undefined;
    }
}
