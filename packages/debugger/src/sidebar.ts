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
    const updateWidgetPosition = this._updateWidgetPosition();
    this.variables = new VariablesPanel({
      model: model.variables,
      commands: callstackCommands.registry,
      service,
      themeManager,
      translator,
      updateWidgetPosition
    });

    this.callstack = new CallstackPanel({
      commands: callstackCommands,
      model: model.callstack,
      translator,
      updateWidgetPosition
    });

    this.breakpoints = new BreakpointsPanel({
      service,
      model: model.breakpoints,
      translator,
      updateWidgetPosition
    });

    this.sources = new SourcesPanel({
      model: model.sources,
      service,
      editorServices,
      translator,
      updateWidgetPosition
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

   * 
   * #### Notes
   * `correctWidgetHeight` function is called on every `resize` event of 
   * children widgets so 'debouncing' is needed to prevent
   * multiple function calls.  
   */
  private _updateWidgetPosition = () => {
    let timeOut: number;
    const MIN_HEIGHT = 25
    const savedHeight = new WeakMap<Widget, number>(); 

    const getWidgetHeight = (widget: Widget) => parseInt(widget.node.style.height.replace('px', ''))
    
    /**
     * Update height of all children widgets to keep the 
     * minimum height of each is at least MIN_HEIGHT.
     */
    const correctWidgetHeight = () => {        
      let totalHeight = 0;
      if (this._body.layout) {
        const layout = this._body.layout as SplitLayout;
        const widgetHeights = layout.relativeSizes();
        layout.handles.forEach((_, idx) => {
          const widget = layout.widgets[idx];
          const currentHeight = getWidgetHeight(widget);
          widgetHeights[idx] = currentHeight;
          totalHeight += currentHeight;
        });
        const totalElements = widgetHeights.length;
        for (let index = 0; index < totalElements - 1; index++) {
          const element = widgetHeights[index];
          if (element < MIN_HEIGHT) {
            widgetHeights[index + 1] =
              widgetHeights[index + 1] - MIN_HEIGHT + widgetHeights[index];
            widgetHeights[index] = MIN_HEIGHT;
          }
        }
        if (widgetHeights[totalElements - 1] < MIN_HEIGHT) {
          for (let index = totalElements - 2; index >= 0; index--) {
            if (widgetHeights[index] > 2*MIN_HEIGHT) {
              widgetHeights[index] =
                widgetHeights[index] - MIN_HEIGHT + widgetHeights[totalElements - 1];
              widgetHeights[totalElements - 1] = MIN_HEIGHT;
              break;
            }
          }
        }
        const neWSize = widgetHeights.map(ele => ele / totalHeight);
        layout.setRelativeSizes(neWSize);
      }
    }

    const toggleWidget = (widget: Panel) => {

      const layout = this._body.layout as SplitLayout;
      const widgetHeights = this._body.widgets.map(w => getWidgetHeight(w));
      const totalHeight = widgetHeights.reduce((pv, cv) => pv + cv, 0)
      
      const widgetId =  this._body.widgets.indexOf(widget);
      if(widgetId === -1) return; //Bail early
      
      const currentHeight = widgetHeights[widgetId];
      if(widgetId > 0){
        if(currentHeight > 25 ){
          savedHeight.set(widget, currentHeight)
          widgetHeights[widgetId - 1] = widgetHeights[widgetId - 1] + currentHeight - 25;
          widgetHeights[widgetId] = 25;
        } else {
          const lastHeight = savedHeight.get(widget)
          if(lastHeight && widgetHeights[widgetId - 1] > lastHeight ){
            widgetHeights[widgetId - 1] = widgetHeights[widgetId - 1] + widgetHeights[widgetId] - lastHeight;
            widgetHeights[widgetId] = lastHeight;
          } else {
            widgetHeights[widgetId] = widgetHeights[widgetId - 1] + widgetHeights[widgetId] - 25;              
            widgetHeights[widgetId - 1] = 25;
          }
        }
      } else {
        if(currentHeight > 25 ){
          savedHeight.set(widget, currentHeight)
          widgetHeights[widgetId + 1] = widgetHeights[widgetId + 1] + currentHeight - 25;
          widgetHeights[widgetId] = 25;
        } else {
          const lastHeight = savedHeight.get(widget)
          if(lastHeight && widgetHeights[widgetId + 1] > lastHeight ){
            widgetHeights[widgetId + 1] = widgetHeights[widgetId + 1] + widgetHeights[widgetId] - lastHeight;
            widgetHeights[widgetId] = lastHeight;
          } else {
            widgetHeights[widgetId] = widgetHeights[widgetId + 1] + widgetHeights[widgetId] - 25;              
            widgetHeights[widgetId + 1] = 25;
          }
        }        
      }
      const neWSize = widgetHeights.map(ele => ele / totalHeight);
      layout.setRelativeSizes(neWSize);
      
    }
    return (widget?: Panel) => {
      if(widget){
        toggleWidget(widget);
      } else {
        clearTimeout(timeOut);
        timeOut = setTimeout(correctWidgetHeight, 500);
      }
    }
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
