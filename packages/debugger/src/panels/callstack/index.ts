// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { CommandToolbarButton } from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { CommandRegistry } from '@lumino/commands';

import { Panel, Widget } from '@lumino/widgets';

import { CallstackBody } from './body';

import { CallstackHeader } from './header';

import { IDebugger } from '../../tokens';

/**
 * A Panel to show a callstack.
 */
export class Callstack extends Panel {
  /**
   * Instantiate a new Callstack Panel.
   *
   * @param options The instantiation options for a Callstack Panel.
   */
  constructor(options: Callstack.IOptions) {
    super();
    const { commands, model } = options;
    const translator = options.translator || nullTranslator;
    const header = new CallstackHeader(translator);
    const body = new CallstackBody(model);
    this._updateWidgetPosition = options.updateWidgetPosition;

    header.toolbar.addItem(
      'continue',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.continue
      })
    );

    header.toolbar.addItem(
      'terminate',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.terminate
      })
    );

    header.toolbar.addItem(
      'step-over',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.next
      })
    );

    header.toolbar.addItem(
      'step-in',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.stepIn
      })
    );

    header.toolbar.addItem(
      'step-out',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.stepOut
      })
    );

    header.toolbar.addItem(
      'evaluate',
      new CommandToolbarButton({
        commands: commands.registry,
        id: commands.evaluate
      })
    );

    this.addWidget(header);
    this.addWidget(body);

    this.addClass('jp-DebuggerCallstack');
  }

  /**
   * A message handler invoked on a `'resize'` message.
   *
   * @param msg The Lumino message to process.
   */
  protected onResize(msg: Widget.ResizeMessage): void {
    super.onResize(msg);
    this._requestParentResize(msg);
  }

  /**
   * Invoke parent's handler to recompute height of all
   * widgets.
   *
   * @param msg The resize message.
   */
  private _requestParentResize(msg: Widget.ResizeMessage): void {
    if (msg.height < 24 && this._updateWidgetPosition) {
      this._updateWidgetPosition();
    }
  }

  private _updateWidgetPosition: (() => void) | undefined;
}

/**
 * A namespace for Callstack `statics`.
 */
export namespace Callstack {
  /**
   * The toolbar commands and registry for the callstack.
   */
  export interface ICommands {
    /**
     * The command registry.
     */
    registry: CommandRegistry;

    /**
     * The continue command ID.
     */
    continue: string;

    /**
     * The terminate command ID.
     */
    terminate: string;

    /**
     * The next / stepOver command ID.
     */
    next: string;

    /**
     * The stepIn command ID.
     */
    stepIn: string;

    /**
     * The stepOut command ID.
     */
    stepOut: string;

    /**
     * The evaluate command ID.
     */
    evaluate: string;
  }

  /**
   * Instantiation options for `Callstack`.
   */
  export interface IOptions extends Panel.IOptions {
    /**
     * The toolbar commands interface for the callstack.
     */
    commands: ICommands;

    /**
     * The model for the callstack.
     */
    model: IDebugger.Model.ICallstack;

    /**
     * The application language translator
     */
    translator?: ITranslator;

    updateWidgetPosition?: () => void; 
  }
}
