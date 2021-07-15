/*-----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { ToolbarButton } from '@jupyterlab/apputils';

import { IEditorServices } from '@jupyterlab/codeeditor';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Panel, Widget } from '@lumino/widgets';

import { viewBreakpointIcon } from '../../icons';

import { IDebugger } from '../../tokens';

import { SourcesBody } from './body';

import { SourcesHeader } from './header';

/**
 * A Panel that shows a preview of the source code while debugging.
 */
export class Sources extends Panel {
  /**
   * Instantiate a new Sources preview Panel.
   *
   * @param options The Sources instantiation options.
   */
  constructor(options: Sources.IOptions) {
    super();
    const { model, service, editorServices } = options;
    const translator = options.translator || nullTranslator;
    const trans = translator.load('jupyterlab');
    this._updateWidgetPosition = options.updateWidgetPosition;

    const header = new SourcesHeader(model, translator);
    const body = new SourcesBody({
      service,
      model,
      editorServices
    });
    header.toolbar.addItem(
      'open',
      new ToolbarButton({
        icon: viewBreakpointIcon,
        onClick: (): void => model.open(),
        tooltip: trans.__('Open in the Main Area')
      })
    );

    // header.node.onclick = (evt) =>{
    //   console.log('this._height', this._height, this.onUpdateRequest, this.onResize, this.onFitRequest);
    //   if(!this._height){
    //     this._height = this.node.style.height
    //     this.node.style.top = parseInt(this.node.style.top.replace('px', '')) + parseInt(this._height.replace('px', '')) - 25  + 'px'
    //     this.node.style.height = '25px'
    //     console.log('changed up', this._height , this.node.style.height, this.node.style.top );

    //   } else {
    //     this.node.style.height = this._height
    //     this.node.style.top = parseInt(this.node.style.top.replace('px', ''))  - parseInt(this._height.replace('px', '')) + 25 + 'px'
    //     this._height = undefined
    //     console.log('changed down', this._height , this.node.style.height, this.node.style.top );
    //   }

    // }
    this.addWidget(header);
    this.addWidget(body);
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
 * A namespace for `Sources` statics.
 */
export namespace Sources {
  /**
   * The options used to create a Sources.
   */
  export interface IOptions {
    /**
     * The debugger service.
     */
    service: IDebugger;

    /**
     * The model for the sources.
     */
    model: IDebugger.Model.ISources;

    /**
     * The editor services used to create new read-only editors.
     */
    editorServices: IEditorServices;

    /**
     * The application language translator
     */
    translator?: ITranslator;


    updateWidgetPosition?: () => void; 
  }
}
