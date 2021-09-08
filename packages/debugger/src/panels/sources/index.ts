/*-----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { IEditorServices } from '@jupyterlab/codeeditor';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ToolbarButton } from '@jupyterlab/ui-components';
import { Panel } from '@lumino/widgets';
import { viewBreakpointIcon } from '../../icons';
import { IDebugger } from '../../tokens';
import { PanelHeader } from '../header';
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

    this._header = new SourcesHeader(model, translator);
    const body = new SourcesBody({
      service,
      model,
      editorServices
    });
    this._header.toolbar.addItem(
      'open',
      new ToolbarButton({
        icon: viewBreakpointIcon,
        onClick: (): void => model.open(),
        tooltip: trans.__('Open in the Main Area')
      })
    );

    this.addWidget(body);
    this.addClass('jp-DebuggerSources');
  }

  get header(): PanelHeader {
    return this._header;
  }

  private _header: PanelHeader;
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
  }
}
