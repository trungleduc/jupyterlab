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

    this._expandIcon = new Widget({ node: document.createElement('div') });

    this._iconAngle = 0;
    this._iconElement = caretDownEmptyIcon.element({
      container: this._expandIcon.node
    });
    this._iconElement.classList.add(PanelHeader.ICON_EXPANDING_CLASS);

    this._paddingDiv = new Widget({ node: document.createElement('div') });
    this._paddingDiv.node.style.flexGrow = '1';
    this._paddingDiv.node.style.height = '100%';

    this.layout = new PanelLayout();
    this.layout.addWidget(this._expandIcon);
    this.layout.addWidget(this.titleWidget);
    this.layout.addWidget(this.toolbar);
    this.layout.addWidget(this._paddingDiv);
  }

  public attachOnClickListener = (f: ()=>void): void => {
    this._expandIcon.node.onclick = f;
    this.titleWidget.node.onclick = f;
    this._paddingDiv.node.onclick = f;
  };

  public toggleIcon = (angle: 0 | -90): void => {
    if (angle !== this._iconAngle) {
      this._iconElement.classList.remove(
        PanelHeader.ICON_EXPANDING_CLASS,
        PanelHeader.ICON_CONTRACTING_CLASS
      );
      if (angle === -90) {
        this._iconElement.classList.add(PanelHeader.ICON_CONTRACTING_CLASS);
      } else {
        this._iconElement.classList.add(PanelHeader.ICON_EXPANDING_CLASS);
      }
      this._iconAngle = angle;
    }
  };

  private _iconAngle: number;

  private _iconElement: HTMLElement;

  private _expandIcon: Widget;
  
  private _paddingDiv: Widget;
  
  protected _trans: TranslationBundle;
  
  static readonly ICON_EXPANDING_CLASS =
  'jp-DebuggerSidebar-panel-header-IconExpanding';
  static readonly ICON_CONTRACTING_CLASS =
  'jp-DebuggerSidebar-panel-header-IconContracting';
  
  readonly titleWidget: Widget;

  readonly layout: PanelLayout;

  /**
   * The toolbar for the breakpoints header.
   */
  readonly toolbar = new Toolbar();
}
