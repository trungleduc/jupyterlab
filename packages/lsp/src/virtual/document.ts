import { CodeEditor } from '@jupyterlab/codeeditor';
import { Signal } from '@lumino/signaling';
import { IDocumentInfo } from 'lsp-ws-connection';

import { DocumentConnectionManager } from '../connection_manager';
import { LanguageIdentifier } from '../lsp';
import {
  IEditorPosition,
  IRootPosition,
  ISourcePosition,
  IVirtualPosition,
  PositionError
} from '../positioning';
import { DefaultMap, untilReady } from '../utils';

import type * as CodeMirror from 'codemirror';
type IRange = CodeEditor.IRange;

type language = string;

interface IVirtualLine {
  /**
   * Inspections for which document should be skipped for this virtual line?
   */
  skipInspect: Array<VirtualDocument.idPath>;
  /**
   * Where does the virtual line belongs to in the source document?
   */
  sourceLine: number | null;
  editor: CodeEditor.IEditor;
}

export interface ICodeBlockOptions {
  ceEditor: CodeEditor.IEditor;
  value: string;
}

export interface IVirtualDocumentBlock {
  /**
   * Line corresponding to the block in the entire foreign document
   */
  virtualLine: number;
  virtualDocument: VirtualDocument;
  editor: CodeEditor.IEditor;
}

export type ForeignDocumentsMap = Map<IRange, IVirtualDocumentBlock>;

interface ISourceLine {
  virtualLine: number;
  editor: CodeEditor.IEditor;
  // shift
  editorLine: number;
  editorShift: CodeEditor.IPosition;
  /**
   * Everything which is not in the range of foreign documents belongs to the host.
   */
  foreignDocumentsMap: ForeignDocumentsMap;
}

export interface IForeignContext {
  foreignDocument: VirtualDocument;
  parentHost: VirtualDocument;
}

/**
 * Check if given position is within range.
 * Both start and end are inclusive.
 * @param position
 * @param range
 */
export function isWithinRange(
  position: CodeEditor.IPosition,
  range: CodeEditor.IRange
): boolean {
  if (range.start.line === range.end.line) {
    return (
      position.line === range.start.line &&
      position.column >= range.start.column &&
      position.column <= range.end.column
    );
  }

  return (
    (position.line === range.start.line &&
      position.column >= range.start.column &&
      position.line < range.end.line) ||
    (position.line > range.start.line &&
      position.column <= range.end.column &&
      position.line === range.end.line) ||
    (position.line > range.start.line && position.line < range.end.line)
  );
}

/**
 * a virtual implementation of IDocumentInfo
 */
export class VirtualDocumentInfo implements IDocumentInfo {
  private _document: VirtualDocument;
  version = 0;

  constructor(document: VirtualDocument) {
    this._document = document;
  }

  get text(): string {
    return this._document.value;
  }

  get uri(): string {
    const uris = DocumentConnectionManager.solveUris(
      this._document,
      this.languageId
    );
    return uris.document;
  }

  get languageId(): string {
    return this._document.language;
  }
}

export namespace VirtualDocument {
  export interface IOptions {
    language: LanguageIdentifier;
    path: string;
    file_extension: string | undefined;
    /**
     * Notebooks or any other aggregates of documents are not supported
     * by the LSP specification, and we need to make appropriate
     * adjustments for them, pretending they are simple files
     * so that the LSP servers do not refuse to cooperate.
     */
    hasLspSupportedFile: boolean;
    /**
     * Being standalone is relevant to foreign documents
     * and defines whether following chunks of code in the same
     * language should be appended to this document (false, not standalone)
     * or should be considered separate documents (true, standalone)
     *
     */
    standalone?: boolean;
    parent?: VirtualDocument;
  }
}

/**
 * A notebook can hold one or more virtual documents; there is always one,
 * "root" document, corresponding to the language of the kernel. All other
 * virtual documents are extracted out of the notebook, based on magics,
 * or other syntax constructs, depending on the kernel language.
 *
 * Virtual documents represent the underlying code in a single language,
 * which has been parsed excluding interactive kernel commands (magics)
 * which could be misunderstood by the specific LSP server.
 *
 * VirtualDocument has no awareness of the notebook or editor it lives in,
 * however it is able to transform its content back to the notebook space,
 * as it keeps editor coordinates for each virtual line.
 *
 * The notebook/editor aware transformations are preferred to be placed in
 * VirtualEditor descendants rather than here.
 *
 * No dependency on editor implementation (such as CodeMirrorEditor)
 * is allowed for VirtualEditor.
 */
export class VirtualDocument {
  language: string;
  standalone: boolean;
  isDisposed = false;
  blankLinesBetweenCells: number = 2;
  lastSourceLine: number;

  public lastVirtualLine: number;
  /**
   * the remote document uri, version and other server-related info
   */
  public documentInfo: IDocumentInfo;
  /**
   * Virtual lines keep all the lines present in the document AND extracted to the foreign document.
   */
  public virtualLines: Map<number, IVirtualLine>; // probably should go protected
  public changed: Signal<VirtualDocument, VirtualDocument>;
  public path: string;
  public file_extension: string | undefined;
  public hasLspSupportedFile: boolean;
  public parent?: VirtualDocument | null;
  public updateManager: UpdateManager;
  public readonly instanceId: number;

  protected sourceLines: Map<number, ISourceLine>;
  protected lineBlocks: Array<string>;

  // TODO: merge into unused documents {standalone: Map, continuous: Map} ?
  protected unusedDocuments: Set<VirtualDocument>;
  protected unusedStandaloneDocuments: DefaultMap<
    language,
    Array<VirtualDocument>
  >;

  private _remainingLifetime: number;
  private _editorToSourceLine: Map<CodeEditor.IEditor, number>;
  private _editorToSourceLineNew: Map<CodeEditor.IEditor, number>;

  private previousValue: string;
  private static instancesCount = 0;
  private readonly options: VirtualDocument.IOptions;

  constructor(options: VirtualDocument.IOptions) {
    this.options = options;
    this.path = this.options.path;
    this.file_extension = options.file_extension;
    this.hasLspSupportedFile = options.hasLspSupportedFile;
    this.parent = options.parent;
    this.language = options.language;

    this.virtualLines = new Map();
    this.sourceLines = new Map();
    this._editorToSourceLine = new Map();
    this.standalone = options.standalone || false;
    this.instanceId = VirtualDocument.instancesCount;
    VirtualDocument.instancesCount += 1;
    this.unusedStandaloneDocuments = new DefaultMap(
      () => new Array<VirtualDocument>()
    );
    this._remainingLifetime = 6;

    this.changed = new Signal(this);
    this.unusedDocuments = new Set();
    this.documentInfo = new VirtualDocumentInfo(this);
    this.updateManager = new UpdateManager(this);
    this.updateManager.updateBegan.connect(() => {
      this._editorToSourceLineNew = new Map();
    }, this);
    this.updateManager.blockAdded.connect(
      (_: UpdateManager, blockData: IBlockAddedInfo) => {
        this._editorToSourceLineNew.set(
          blockData.block.ceEditor,
          blockData.virtualDocument.lastSourceLine
        );
      },
      this
    );
    this.updateManager.updateFinished.connect(() => {
      this._editorToSourceLine = this._editorToSourceLineNew;
    }, this);
    this.clear();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.parent = null;

    this.updateManager.dispose();

    // clear all the maps

    this.sourceLines.clear();
    this.unusedDocuments.clear();
    this.unusedStandaloneDocuments.clear();
    this.virtualLines.clear();

    // just to be sure - if anything is accessed after disposal (it should not) we
    // will get alterted by errors in the console AND this will limit memory leaks

    this.documentInfo = null as any;
    this.lineBlocks = null as any;
  }

  /**
   * When this counter goes down to 0, the document will be destroyed and the associated connection will be closed;
   * This is meant to reduce the number of open connections when a a foreign code snippet was removed from the document.
   *
   * Note: top level virtual documents are currently immortal (unless killed by other means); it might be worth
   * implementing culling of unused documents, but if and only if JupyterLab will also implement culling of
   * idle kernels - otherwise the user experience could be a bit inconsistent, and we would need to invent our own rules.
   */
  protected get remainingLifetime(): number {
    if (!this.parent) {
      return Infinity;
    }
    return this._remainingLifetime;
  }
  protected set remainingLifetime(value: number) {
    if (this.parent) {
      this._remainingLifetime = value;
    }
  }

  clear(): void {
    // TODO - deep clear (assure that there is no memory leak)
    this.unusedStandaloneDocuments.clear();

    this.unusedDocuments = new Set();
    this.virtualLines.clear();
    this.sourceLines.clear();
    this.lastVirtualLine = 0;
    this.lastSourceLine = 0;
    this.lineBlocks = [];
  }

  documentAtSourcePosition(position: ISourcePosition): VirtualDocument {
    let sourceLine = this.sourceLines.get(position.line);

    if (sourceLine == null) {
      return this;
    }

    let sourcePositionCe: CodeEditor.IPosition = {
      line: sourceLine.editorLine,
      column: position.ch
    };

    for (let [
      range,
      { virtualDocument: document }
    ] of sourceLine.foreignDocumentsMap) {
      if (isWithinRange(sourcePositionCe, range)) {
        let sourcePositionCm = {
          line: sourcePositionCe.line - range.start.line,
          ch: sourcePositionCe.column - range.start.column
        };

        return document.documentAtSourcePosition(
          sourcePositionCm as ISourcePosition
        );
      }
    }

    return this;
  }

  isWithinForeign(sourcePosition: ISourcePosition): boolean {
    let sourceLine = this.sourceLines.get(sourcePosition.line)!;

    let sourcePositionCe: CodeEditor.IPosition = {
      line: sourceLine.editorLine,
      column: sourcePosition.ch
    };
    for (let [range] of sourceLine.foreignDocumentsMap) {
      if (isWithinRange(sourcePositionCe, range)) {
        return true;
      }
    }
    return false;
  }

  transformFromEditorToRoot(
    editor: CodeEditor.IEditor,
    position: IEditorPosition
  ): IRootPosition | null {
    if (!this._editorToSourceLine.has(editor)) {
      console.log('Editor not found in _editorToSourceLine map');
      return null;
    }
    let shift = this._editorToSourceLine.get(editor)!;
    return {
      ...(position as CodeMirror.Position),
      line: position.line + shift
    } as IRootPosition;
  }

  virtualPositionAtDocument(sourcePosition: ISourcePosition): IVirtualPosition {
    let sourceLine = this.sourceLines.get(sourcePosition.line);
    if (sourceLine == null) {
      throw new PositionError('Source line not mapped to virtual position');
    }
    let virtualLine = sourceLine.virtualLine;

    // position inside the cell (block)
    let sourcePositionCe: CodeEditor.IPosition = {
      line: sourceLine.editorLine,
      column: sourcePosition.ch
    };

    for (let [range, content] of sourceLine.foreignDocumentsMap) {
      const { virtualLine, virtualDocument: document } = content;
      if (isWithinRange(sourcePositionCe, range)) {
        // position inside the foreign document block
        let sourcePositionCm = {
          line: sourcePositionCe.line - range.start.line,
          ch: sourcePositionCe.column - range.start.column
        };
        if (document.isWithinForeign(sourcePositionCm as ISourcePosition)) {
          return this.virtualPositionAtDocument(
            sourcePositionCm as ISourcePosition
          );
        } else {
          // where in this block in the entire foreign document?
          sourcePositionCm.line += virtualLine;
          return sourcePositionCm as IVirtualPosition;
        }
      }
    }

    return {
      ch: sourcePosition.ch,
      line: virtualLine
    } as IVirtualPosition;
  }

  appendCodeBlock(
    block: ICodeBlockOptions,
    editorShift: CodeEditor.IPosition = { line: 0, column: 0 },
    virtualShift?: CodeEditor.IPosition
  ): void {
    let cellCode = block.value;
    let ceEditor = block.ceEditor;

    if (this.isDisposed) {
      console.warn('Cannot append code block: document disposed');
      return;
    }

    let sourceCellLines = cellCode.split('\n');

    let lines = block.value.split('\n');

    for (let i = 0; i < lines.length; i++) {
      this.virtualLines.set(this.lastVirtualLine + i, {
        skipInspect: [],
        editor: ceEditor,
        // TODO this is incorrect, wont work if something was extracted
        sourceLine: this.lastSourceLine + i
      });
    }
    for (let i = 0; i < sourceCellLines.length; i++) {
      this.sourceLines.set(this.lastSourceLine + i, {
        editorLine: i,
        editorShift: {
          line: editorShift.line - (virtualShift?.line || 0),
          column: i === 0 ? editorShift.column - (virtualShift?.column || 0) : 0
        },
        // TODO: move those to a new abstraction layer (DocumentBlock class)
        editor: ceEditor,
        foreignDocumentsMap: new Map(),
        // TODO this is incorrect, wont work if something was extracted
        virtualLine: this.lastVirtualLine + i
      });
    }

    this.lastVirtualLine += lines.length;

    // one empty line is necessary to separate code blocks, next 'n' lines are to silence linters;
    // the final cell does not get the additional lines (thanks to the use of join, see below)
    this.lineBlocks.push(lines.join('\n') + '\n');

    // adding the virtual lines for the blank lines
    for (let i = 0; i < this.blankLinesBetweenCells; i++) {
      this.virtualLines.set(this.lastVirtualLine + i, {
        skipInspect: [this.idPath],
        editor: ceEditor,
        sourceLine: null
      });
    }

    this.lastVirtualLine += this.blankLinesBetweenCells;
    this.lastSourceLine += sourceCellLines.length;
  }

  get value(): string {
    let linesPadding = '\n'.repeat(this.blankLinesBetweenCells);
    return this.lineBlocks.join(linesPadding);
  }

  get lastLine(): string {
    const linesInLastBlock = this.lineBlocks[this.lineBlocks.length - 1].split(
      '\n'
    );
    return linesInLastBlock[linesInLastBlock.length - 1];
  }

  closeExpiredDocuments(): void {
    for (let document of this.unusedDocuments.values()) {
      document.remainingLifetime -= 1;
      if (document.remainingLifetime <= 0) {
        /** TODO */
      }
    }
  }

  get virtualId(): VirtualDocument.virtualId {
    // for easier debugging, the language information is included in the ID:
    return this.standalone
      ? this.instanceId + '(' + this.language + ')'
      : this.language;
  }

  get ancestry(): Array<VirtualDocument> {
    if (!this.parent) {
      return [this];
    }
    return this.parent.ancestry.concat([this]);
  }

  get idPath(): VirtualDocument.idPath {
    if (!this.parent) {
      return this.virtualId;
    }
    return this.parent.idPath + '-' + this.virtualId;
  }

  get uri(): VirtualDocument.uri {
    const encodedPath = encodeURI(this.path);
    if (!this.parent) {
      return encodedPath;
    }
    return encodedPath + '.' + this.idPath + '.' + this.file_extension;
  }

  transformSourceToEditor(pos: ISourcePosition): IEditorPosition {
    let sourceLine = this.sourceLines.get(pos.line)!;
    let editorLine = sourceLine.editorLine;
    let editorShift = sourceLine.editorShift;
    return {
      // only shift column in the line beginning the virtual document (first list of the editor in cell magics, but might be any line of editor in line magics!)
      ch: pos.ch + (editorLine === 0 ? editorShift.column : 0),
      line: editorLine + editorShift.line
      // TODO or:
      //  line: pos.line + editor_shift.line - this.first_line_of_the_block(editor)
    } as IEditorPosition;
  }

  /**
  Can be null because some lines are added as padding/anchors
  to the virtual document and those do not exist in the source document
  and thus they are absent in the editor.
  */
  transformVirtualToEditor(
    virtualPosition: IVirtualPosition
  ): IEditorPosition | null {
    let sourcePosition = this.transformVirtualToSource(virtualPosition);
    if (sourcePosition == null) {
      return null;
    }
    return this.transformSourceToEditor(sourcePosition);
  }

  /**
  Can be null because some lines are added as padding/anchors
  to the virtual document and those do not exist in the source document.
  */
  transformVirtualToSource(position: IVirtualPosition): ISourcePosition | null {
    const line = this.virtualLines.get(position.line)!.sourceLine;
    if (line == null) {
      return null;
    }
    return {
      ch: position.ch,
      line: line
    } as ISourcePosition;
  }

  get root(): VirtualDocument {
    if (this.parent == null) {
      return this;
    }
    return this.parent.root;
  }

  getEditorAtVirtualLine(pos: IVirtualPosition): CodeEditor.IEditor {
    let line = pos.line;
    // tolerate overshot by one (the hanging blank line at the end)
    if (!this.virtualLines.has(line)) {
      line -= 1;
    }
    return this.virtualLines.get(line)!.editor;
  }

  getEditorAtSourceLine(pos: ISourcePosition): CodeEditor.IEditor {
    return this.sourceLines.get(pos.line)!.editor;
  }

  /**
   * Recursively emits changed signal from the document or any descendant foreign document.
   */
  maybeEmitChanged(): void {
    if (this.value !== this.previousValue) {
      this.changed.emit(this);
    }
    this.previousValue = this.value;
  }

  static ceToCm(position: CodeEditor.IPosition): CodeMirror.Position {
    return { line: position.line, ch: position.column };
  }
}

export namespace VirtualDocument {
  /**
   * Identifier composed of `virtual_id`s of a nested structure of documents,
   * used to aide assignment of the connection to the virtual document
   * handling specific, nested language usage; it will be appended to the file name
   * when creating a connection.
   */
  export type idPath = string;
  /**
   * Instance identifier for standalone documents (snippets), or language identifier
   * for documents which should be interpreted as one when stretched across cells.
   */
  export type virtualId = string;
  /**
   * Identifier composed of the file path and id_path.
   */
  export type uri = string;
}

export function collectDocuments(
  virtualDocument: VirtualDocument
): Set<VirtualDocument> {
  let collected = new Set<VirtualDocument>();
  collected.add(virtualDocument);
  return collected;
}

export interface IBlockAddedInfo {
  virtualDocument: VirtualDocument;
  block: ICodeBlockOptions;
}

export class UpdateManager {
  /**
   * Virtual documents update guard.
   */
  private isUpdateInProgress: boolean = false;

  private updateLock: boolean = false;

  protected isDisposed = false;

  /**
   * Signal emitted by the editor that triggered the update, providing the root document of the updated documents.
   */
  private documentUpdated: Signal<UpdateManager, VirtualDocument>;
  public blockAdded: Signal<UpdateManager, IBlockAddedInfo>;
  updateDone: Promise<void> = new Promise<void>(resolve => {
    resolve();
  });
  updateBegan: Signal<UpdateManager, ICodeBlockOptions[]>;
  updateFinished: Signal<UpdateManager, ICodeBlockOptions[]>;

  constructor(private virtualDocument: VirtualDocument) {
    this.documentUpdated = new Signal(this);
    this.blockAdded = new Signal(this);
    this.updateBegan = new Signal(this);
    this.updateFinished = new Signal(this);
    this.documentUpdated.connect(this.onUpdated, this);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.documentUpdated.disconnect(this.onUpdated, this);
  }

  /**
   * Once all the foreign documents were refreshed, the unused documents (and their connections)
   * should be terminated if their lifetime has expired.
   */
  private onUpdated(manager: UpdateManager, rootDocument: VirtualDocument) {
    try {
      rootDocument.closeExpiredDocuments();
    } catch (e) {
      console.warn('Failed to close expired documents');
    }
  }

  private canUpdate() {
    return !this.isDisposed && !this.isUpdateInProgress && !this.updateLock;
  }

  /**
   * Execute provided callback within an update-locked context, which guarantees that:
   *  - the previous updates must have finished before the callback call, and
   *  - no update will happen when executing the callback
   * @param fn - the callback to execute in update lock
   */
  public async withUpdateLock(fn: () => void): Promise<void> {
    await untilReady(() => this.canUpdate(), 12, 10).then(() => {
      try {
        this.updateLock = true;
        fn();
      } finally {
        this.updateLock = false;
      }
    });
  }

  /**
   * Update all the virtual documents, emit documents updated with root document if succeeded,
   * and resolve a void promise. The promise does not contain the text value of the root document,
   * as to avoid an easy trap of ignoring the changes in the virtual documents.
   */
  public async updateDocuments(blocks: ICodeBlockOptions[]): Promise<void> {
    let update = new Promise<void>((resolve, reject) => {
      // defer the update by up to 50 ms (10 retrials * 5 ms break),
      // awaiting for the previous update to complete.
      untilReady(() => this.canUpdate(), 10, 5).then(() => {
        if (this.isDisposed || !this.virtualDocument) {
          resolve();
        }
        try {
          this.isUpdateInProgress = true;
          this.updateBegan.emit(blocks);

          this.virtualDocument.clear();

          for (let codeBlock of blocks) {
            this.blockAdded.emit({
              block: codeBlock,
              virtualDocument: this.virtualDocument
            });
            this.virtualDocument.appendCodeBlock(codeBlock);
          }

          this.updateFinished.emit(blocks);

          if (this.virtualDocument) {
            this.documentUpdated.emit(this.virtualDocument);
            this.virtualDocument.maybeEmitChanged();
          }

          resolve();
        } catch (e) {
          console.warn('Documents update failed:', e);
          reject(e);
        } finally {
          this.isUpdateInProgress = false;
        }
      });
    });
    this.updateDone = update;
    return update;
  }
}
