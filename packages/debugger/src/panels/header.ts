// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Toolbar } from '@jupyterlab/apputils';

import { ITranslator, nullTranslator, TranslationBundle } from '@jupyterlab/translation';

import { PanelLayout, Widget } from '@lumino/widgets';

import { caretDownEmptyIcon } from '@jupyterlab/ui-components';


/**
 * The base header for a debugger panels.
 */
export class PanelHeader extends Widget {
  /**
   * Instantiate a new PanelHeader.
   */
  constructor(translator?: ITranslator) {
    super({ node: document.createElement('div') });
    this.node.classList.add('jp-stack-panel-header');

    translator = translator || nullTranslator;
    this._trans = translator.load('jupyterlab');
    this.titleWidget = new Widget({ node: document.createElement('h2') });

    this.expandIcon = new Widget({ node: document.createElement('div') });

    this._iconAngle = 0;
    this._iconElement = caretDownEmptyIcon.element({container: this.expandIcon.node})
    this._iconElement.classList.add(PanelHeader.ICON_EXPANDING_CLASS)

    this.layout = new PanelLayout();
    this.layout.addWidget(this.expandIcon);
    this.layout.addWidget(this.titleWidget);
    this.layout.addWidget(this.toolbar);

  }

  public toggleIcon = (angle : 0 | -90):void => {
    if(angle !== this._iconAngle){
      this._iconElement.classList.remove(PanelHeader.ICON_EXPANDING_CLASS, PanelHeader.ICON_CONTRACTING_CLASS)
      if(angle === -90){
        this._iconElement.classList.add(PanelHeader.ICON_CONTRACTING_CLASS)
      } else {
        this._iconElement.classList.add(PanelHeader.ICON_EXPANDING_CLASS)
      }
      this._iconAngle = angle;
    }
  } 

  private _iconAngle : number;

  private _iconElement : HTMLElement;

  protected _trans: TranslationBundle;

  static readonly ICON_EXPANDING_CLASS = 'jp-DebuggerSidebar-panel-header-IconExpanding';
  static readonly ICON_CONTRACTING_CLASS = 'jp-DebuggerSidebar-panel-header-IconContracting';

  readonly layout: PanelLayout;

  readonly titleWidget: Widget;

  readonly expandIcon: Widget;
  /**
   * The toolbar for the breakpoints header.
   */
  readonly toolbar = new Toolbar();
}
