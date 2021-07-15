// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { IThemeManager } from '@jupyterlab/apputils';

import { IEditorServices } from '@jupyterlab/codeeditor';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { bugIcon } from '@jupyterlab/ui-components';

import { Panel, SplitLayout, SplitPanel , Widget  } from '@lumino/widgets';

import { Breakpoints as BreakpointsPanel } from './panels/breakpoints';

import { Callstack as CallstackPanel } from './panels/callstack';

import { Sources as SourcesPanel } from './panels/sources';

import { Variables as VariablesPanel } from './panels/variables';

import { IDebugger } from './tokens';

/**
 * A debugger sidebar.
 */
export class DebuggerSidebar extends Panel implements IDebugger.ISidebar {
  /**
   * Instantiate a new Debugger.Sidebar
   *
   * @param options The instantiation options for a Debugger.Sidebar
   */
  constructor(options: DebuggerSidebar.IOptions) {
    super();
    this.id = 'jp-debugger-sidebar';
    this.title.icon = bugIcon;
    this.addClass('jp-DebuggerSidebar');

    const {
      callstackCommands,
      editorServices,
      service,
      themeManager
    } = options;
    const translator = options.translator || nullTranslator;
    const model = service.model;

    this.variables = new VariablesPanel({
      model: model.variables,
      commands: callstackCommands.registry,
      service,
      themeManager,
      translator,
      updateWidgetPosition: this._updateWidgetPosition
    });

    this.callstack = new CallstackPanel({
      commands: callstackCommands,
      model: model.callstack,
      translator,
      updateWidgetPosition: this._updateWidgetPosition
    });

    this.breakpoints = new BreakpointsPanel({
      service,
      model: model.breakpoints,
      translator,
      updateWidgetPosition: this._updateWidgetPosition
    });

    this.sources = new SourcesPanel({
      model: model.sources,
      service,
      editorServices,
      translator,
      updateWidgetPosition: this._updateWidgetPosition
    });

    const header = new DebuggerSidebar.Header();

    this.addWidget(header);
    model.titleChanged.connect((_, title) => {
      header.title.label = title;
    });

    this._body = new SplitPanel();
    this._body.orientation = 'vertical';
    this._body.addClass('jp-DebuggerSidebar-body');
    this.addWidget(this._body);

    this.addItem(this.variables);
    this.addItem(this.callstack);
    this.addItem(this.breakpoints);
    this.addItem(this.sources);
  }

  /**
   * Update height of all children widgets to keep the 
   * minimum height of each is at least 25px.
   * 
   * #### Notes
   * This method is called on every `resize` event of 
   * children widgets so 'debouncing' is needed to prevent
   * multiple function calls.  
   */
  private _updateWidgetPosition(): void {
    clearTimeout(this._timeOut);
    this._timeOut = setTimeout(() => {
      let totalHeight = 0;
      if (this._body.layout) {
        const layout = this._body.layout as SplitLayout;
        const widgetHeights = layout.relativeSizes();
        layout.handles.forEach((element, idx) => {
          const widget = layout.widgets[idx];
          const currentHeight = parseInt(
            widget.node.style.height.replace('px', '')
          );
          widgetHeights[idx] = currentHeight;
          totalHeight += currentHeight;
        });
        const totalElements = widgetHeights.length;
        for (let index = 0; index < totalElements - 1; index++) {
          const element = widgetHeights[index];
          if (element < 25) {
            widgetHeights[index + 1] =
              widgetHeights[index + 1] - 25 + widgetHeights[index];
            widgetHeights[index] = 25;
          }
        }
        if (widgetHeights[totalElements - 1] < 25) {
          for (let index = totalElements - 2; index >= 0; index--) {
            if (widgetHeights[index] > 50) {
              widgetHeights[index] =
                widgetHeights[index] - 25 + widgetHeights[totalElements - 1];
              widgetHeights[totalElements - 1] = 25;
              break;
            }
          }
        }
        const neWSize = widgetHeights.map(ele => ele / totalHeight);
        layout.setRelativeSizes(neWSize);
      }
    }, 500);
  }

  /**
   * Add an item at the end of the sidebar.
   *
   * @param widget - The widget to add to the sidebar.
   *
   * #### Notes
   * If the widget is already contained in the sidebar, it will be moved.
   * The item can be removed from the sidebar by setting its parent to `null`.
   */
  addItem(widget: Widget): void {
    this._body.addWidget(widget);
  }

  /**
   * Insert an item at the specified index.
   *
   * @param index - The index at which to insert the widget.
   *
   * @param widget - The widget to insert into to the sidebar.
   *
   * #### Notes
   * If the widget is already contained in the sidebar, it will be moved.
   * The item can be removed from the sidebar by setting its parent to `null`.
   */
  insertItem(index: number, widget: Widget): void {
    this._body.insertWidget(index, widget);
  }

  /**
   * A read-only array of the sidebar items.
   */
  get items(): readonly Widget[] {
    return this._body.widgets;
  }

  /**
   * Whether the sidebar is disposed.
   */
  isDisposed: boolean;

  /**
   * Dispose the sidebar.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    super.dispose();
  }

  /**
   * The variables widget.
   */
  readonly variables: VariablesPanel;

  /**
   * The callstack widget.
   */
  readonly callstack: CallstackPanel;

  /**
   * The breakpoints widget.
   */
  readonly breakpoints: BreakpointsPanel;

  /**
   * The sources widget.
   */
  readonly sources: SourcesPanel;

  /**
   * Container for debugger panels.
   */
  private _body: SplitPanel;

  private _timeOut: number;
}

/**
 * A namespace for DebuggerSidebar statics
 */
export namespace DebuggerSidebar {
  /**
   * Instantiation options for `DebuggerSidebar`.
   */
  export interface IOptions {
    /**
     * The debug service.
     */
    service: IDebugger;

    /**
     * The callstack toolbar commands.
     */
    callstackCommands: CallstackPanel.ICommands;
    /**
     * The editor services.
     */
    editorServices: IEditorServices;

    /**
     * An optional application theme manager to detect theme changes.
     */
    themeManager?: IThemeManager | null;

    /**
     * An optional application language translator.
     */
    translator?: ITranslator;
  }

  /**
   * The header for a debugger sidebar.
   */
  export class Header extends Widget {
    /**
     * Instantiate a new sidebar header.
     */
    constructor() {
      super({ node: Private.createHeader() });
      this.title.changed.connect(_ => {
        this.node!.querySelector('h2')!.textContent = this.title.label;
      });
    }
  }
}

/**
 * A namespace for private module data.
 */
namespace Private {
  /**
   * Create a sidebar header node.
   */
  export function createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.classList.add('jp-stack-panel-header');

    const title = document.createElement('h2');

    title.textContent = '-';
    title.classList.add('jp-left-truncated');
    header.appendChild(title);

    return header;
  }
}
