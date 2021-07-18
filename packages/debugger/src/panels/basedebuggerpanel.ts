// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Panel, Widget } from '@lumino/widgets';

import {  PanelHeader } from './header';

/**
 * A base class for panels of debugger.
 */
export class BaseDebuggerPanel extends Panel {
  /**
   * Instantiate a new  BasePanel.
   *
   * @param options The instantiation options for a Breakpoints Panel.
   */
  constructor(options: BaseDebuggerPanel.IOptions) {
    super();
    this._updateWidgetPosition = options.updateWidgetPosition;
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
    const header = this.widgets[0] as PanelHeader
    if(msg.height > 26){
      header.toggleIcon(-90);
    } else {
      header.toggleIcon(0);
    }
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
  /**
   * Invoke parent's handler to expand or contract this widget.
   *
   * @param msg The resize message.
   */
   protected _toggleWidgetHeight = (): void => {
    if (this._updateWidgetPosition) {
      this._updateWidgetPosition(this);      
    }
  }

  private _updateWidgetPosition: ((widget?: Panel) => void) | undefined;

}

/**
 * A namespace for Breakpoints `statics`.
 */
export namespace BaseDebuggerPanel {
  /**
   * Instantiation options for `Breakpoints`.
   */
  export interface IOptions extends Panel.IOptions {

    updateWidgetPosition?: () => void; 

  }
}
