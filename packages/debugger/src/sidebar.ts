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
   * Panel resize and toggle handler creator, this function returns a
   * handler which is called by child panel to inform parent to 
   * re-compute the height of all its children.
   * 
   * #### Notes
   * `correctWidgetHeight` function is called on every `resize` event of 
   * children widgets so 'debouncing' is needed to prevent
   * multiple function calls.  
   */
  private _updateWidgetPosition = (): ((widget?: Panel) => void) => {
    let timeOut: number;
    const MIN_HEIGHT = 25;
    const savedHeight = new WeakMap<Widget, number>();

    const getWidgetHeight = (widget: Widget) =>
      parseInt(widget.node.style.height.replace('px', ''));

    /**
     * Update height of all children panels to keep the
     * minimum height of each is at least MIN_HEIGHT.
     */
    const correctWidgetHeight = (): void => {
      const layout = this._body.layout as SplitLayout;
      const widgetHeights = this._body.widgets.map(w => getWidgetHeight(w));
      const heightRatio = Private.computePanelHeightOnResize(
        widgetHeights,
        MIN_HEIGHT
      );
      layout.setRelativeSizes(heightRatio);
    };

    /**
     * Update height of all children panels to expand of 
     * contract the selected panel.
     * 
     * @param widget - the panel to be expanded of contracted
     */
    const toggleWidgetHeight = (widget: Panel): void => {
      const layout = this._body.layout as SplitLayout;
      const widgetHeights = this._body.widgets.map(w => getWidgetHeight(w));
      const lastHeight = savedHeight.get(widget);
      const widgetId = this._body.widgets.indexOf(widget);
      if (widgetId === -1) return; //Bail early

      const { heightRatio, heightToSave } = Private.computePanelHeightOnToggle(
        widgetHeights,
        widgetId,
        lastHeight,
        MIN_HEIGHT
      );
      if (heightToSave) {
        savedHeight.set(widget, heightToSave);
      }
      layout.setRelativeSizes(heightRatio);
    };
    return (widget?: Panel) => {
      if (widget) {
        toggleWidgetHeight(widget);
      } else {
        clearTimeout(timeOut);
        timeOut = setTimeout(correctWidgetHeight, 500);
      }
    };
  };

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

  /**
   * Compute the height ratio of all panels in order to expand
   * for contract a selected panel.
   *
   * @param widgetHeights - array of all widgets height.
   * @param  widgetId - index of selected widget.
   * @param  lastHeight - height of widget before contracted
   * @param  minHeight - minimum height of a panel.
   * @return The new height ration of panels and last height of
   * selected widget.
   */
  export function computePanelHeightOnToggle(
    widgetHeights: Array<number>,
    widgetId: number,
    lastHeight: number | undefined,
    minHeight: number
  ): {heightRatio: Array<number>, heightToSave: number| undefined } {
    const totalHeight = widgetHeights.reduce((pv, cv) => pv + cv, 0);
    let heightToSave = undefined;
    
    const currentHeight = widgetHeights[widgetId];
    let offsetId: number;
    if (widgetId < widgetHeights.length - 1) {
      offsetId = 1
    } else {
      offsetId = -1      
    }

    let nextId = widgetId + offsetId;
    
    if(currentHeight > minHeight ){
      heightToSave = currentHeight
      while (widgetHeights[nextId]) {
        if (widgetHeights[nextId] <= minHeight && nextId > 0 && nextId < widgetHeights.length - 1 ) {
            widgetHeights[nextId] = minHeight;
            nextId += offsetId;
        } else {
          widgetHeights[nextId] = widgetHeights[nextId] + currentHeight - minHeight
          break;
        }
      }
      widgetHeights[widgetId] = minHeight;
    } else {
      while (widgetHeights[nextId]) {
        if (widgetHeights[nextId] <= minHeight) {
          widgetHeights[nextId] = minHeight;
          nextId += offsetId;
        } else {
          const heightOfTwoWidget = widgetHeights[nextId] + widgetHeights[widgetId]
          if (lastHeight && widgetHeights[nextId] > lastHeight) {
            widgetHeights[nextId] = heightOfTwoWidget - lastHeight;
            widgetHeights[widgetId] = lastHeight;
          } else {
            widgetHeights[widgetId] = heightOfTwoWidget - minHeight;              
            widgetHeights[nextId] = minHeight;
          }
          break;
        }
      }          
    }
    return {heightRatio: widgetHeights.map(ele => ele / totalHeight), heightToSave};
  }

  /**
   * Compute the height ratio of all panels in order to keep
   * the height of each is at least `minHeight`.
   *
   * @param widgetHeights - array of all widgets height.
   * @param  minHeight - minimum height of a panel.
   * @return The new height ration of panels
   */
  export function computePanelHeightOnResize(
    widgetHeights: Array<number>,
    minHeight: number
  ): Array<number> {
    const totalHeight = widgetHeights.reduce((pv, cv) => pv + cv, 0);
    const totalElements = widgetHeights.length;

    for (let index = 0; index < totalElements - 1; index++) {
      const element = widgetHeights[index];
      if (element < minHeight) {
        widgetHeights[index + 1] =
          widgetHeights[index + 1] - minHeight + widgetHeights[index];
        widgetHeights[index] = minHeight;
      }
    }
    if (widgetHeights[totalElements - 1] < minHeight) {
      for (let index = totalElements - 2; index >= 0; index--) {
        if (widgetHeights[index] > 2 * minHeight) {
          widgetHeights[index] =
            widgetHeights[index] - minHeight + widgetHeights[totalElements - 1];
          widgetHeights[totalElements - 1] = minHeight;
          break;
        }
      }
    }
    return widgetHeights.map(ele => ele / totalHeight);
  }
}
