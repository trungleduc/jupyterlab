// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Dialog, showDialog, ToolbarButton } from '@jupyterlab/apputils';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Signal } from '@lumino/signaling';

import { Panel, Widget } from '@lumino/widgets';

import { closeAllIcon } from '../../icons';

import { IDebugger } from '../../tokens';

import { BreakpointsBody } from './body';

import { BreakpointsHeader } from './header';

/**
 * A Panel to show a list of breakpoints.
 */
export class Breakpoints extends Panel {
  /**
   * Instantiate a new Breakpoints Panel.
   *
   * @param options The instantiation options for a Breakpoints Panel.
   */
  constructor(options: Breakpoints.IOptions) {
    super();
    const { model, service } = options;
    const translator = options.translator || nullTranslator;
    const trans = translator.load('jupyterlab');
    this._updateWidgetPosition = options.updateWidgetPosition;

    const header = new BreakpointsHeader(translator);
    const body = new BreakpointsBody(model);

    header.toolbar.addItem(
      'closeAll',
      new ToolbarButton({
        icon: closeAllIcon,
        onClick: async (): Promise<void> => {
          if (model.breakpoints.size === 0) {
            return;
          }
          const result = await showDialog({
            title: trans.__('Remove All Breakpoints'),
            body: trans.__('Are you sure you want to remove all breakpoints?'),
            buttons: [
              Dialog.okButton({ label: trans.__('Remove breakpoints') }),
              Dialog.cancelButton({ label: trans.__('Cancel') })
            ],
            hasClose: true
          });
          if (result.button.accept) {
            return service.clearBreakpoints();
          }
        },
        tooltip: trans.__('Remove All Breakpoints')
      })
    );

    this.addWidget(header);
    this.addWidget(body);

    this.addClass('jp-DebuggerBreakpoints');
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

  readonly clicked = new Signal<this, IDebugger.IBreakpoint>(this);
}

/**
 * A namespace for Breakpoints `statics`.
 */
export namespace Breakpoints {
  /**
   * Instantiation options for `Breakpoints`.
   */
  export interface IOptions extends Panel.IOptions {
    /**
     * The breakpoints model.
     */
    model: IDebugger.Model.IBreakpoints;

    /**
     * The debugger service.
     */
    service: IDebugger;

    /**
     * The application language translator..
     */
    translator?: ITranslator;

    updateWidgetPosition?: () => void; 
  }
}
