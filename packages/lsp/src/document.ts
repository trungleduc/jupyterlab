import { CodeEditor } from '@jupyterlab/codeeditor';
import { Signal } from '@lumino/signaling';
import { IDocumentInfo } from 'lsp-ws-connection';

import { DocumentConnectionManager } from './connection_manager';

import { LanguageIdentifier } from './lsp';
import {
  IEditorPosition,
  ISourcePosition,
  IVirtualPosition,
  PositionError
} from './positioning';

import { DefaultMap, untilReady } from './utils';

import IRange = CodeEditor.IRange;

type language = string;

interface IVirtualLine {
  /**
   * Inspections for which document should be skipped for this virtual line?
   */
  skip_inspect: Array<VirtualDocument.id_path>;
  /**
   * Where does the virtual line belongs to in the source document?
   */
  source_line: number | null;
  editor: CodeEditor.IEditor;
}

export interface ICodeBlockOptions {
  ce_editor: CodeEditor.IEditor;
  value: string;
}

export interface IVirtualDocumentBlock {
  /**
   * Line corresponding to the block in the entire foreign document
   */
  virtual_line: number;
  virtual_document: VirtualDocument;
  editor: CodeEditor.IEditor;
}

export type ForeignDocumentsMap = Map<IRange, IVirtualDocumentBlock>;

interface ISourceLine {
  virtual_line: number;
  editor: CodeEditor.IEditor;
  // shift
  editor_line: number;
  editor_shift: CodeEditor.IPosition;
  /**
   * Everything which is not in the range of foreign documents belongs to the host.
   */
  foreign_documents_map: ForeignDocumentsMap;
}

export interface IForeignContext {
  foreign_document: VirtualDocument;
  parent_host: VirtualDocument;
}

/**
 * Check if given position is within range.
 * Both start and end are inclusive.
 * @param position
 * @param range
 */
export function is_within_range(
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
      this._document.path,
      this._document.has_lsp_supported_file,
      this.languageId
    );
    return uris.document;
  }

  get languageId() {
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
    has_lsp_supported_file: boolean;
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
  public last_virtual_line: number;
  public readonly instance_id: number;

  standalone: boolean;
  isDisposed = false;
  /**
   * the remote document uri, version and other server-related info
   */
  public document_info: IDocumentInfo;
  /**
   * Virtual lines keep all the lines present in the document AND extracted to the foreign document.
   */
  public virtual_lines: Map<number, IVirtualLine>; // probably should go protected
  protected source_lines: Map<number, ISourceLine>;

  protected line_blocks: Array<string>;

  // TODO: merge into unused documents {standalone: Map, continuous: Map} ?
  protected unused_documents: Set<VirtualDocument>;
  protected unused_standalone_documents: DefaultMap<
    language,
    Array<VirtualDocument>
  >;

  private _remaining_lifetime: number;
  private static instances_count = 0;
  public foreign_documents: Map<VirtualDocument.virtual_id, VirtualDocument>;

  // TODO: make this configurable, depending on the language used
  blank_lines_between_cells: number = 2;
  last_source_line: number;
  private previous_value: string;
  public changed: Signal<VirtualDocument, VirtualDocument>;

  public path: string;
  public file_extension: string | undefined;
  public has_lsp_supported_file: boolean;
  public parent?: VirtualDocument | null;
  private readonly options: VirtualDocument.IOptions;
  public update_manager: UpdateManager;

  constructor(options: VirtualDocument.IOptions) {
    this.options = options;
    this.path = options.path;
    this.file_extension = options.file_extension;
    this.has_lsp_supported_file = options.has_lsp_supported_file;
    this.parent = options.parent;
    this.language = options.language;
    console.log(this.options);
    
    this.virtual_lines = new Map();
    this.source_lines = new Map();
    this.standalone = options.standalone || false;
    this.instance_id = VirtualDocument.instances_count;
    VirtualDocument.instances_count += 1;
    this.unused_standalone_documents = new DefaultMap(
      () => new Array<VirtualDocument>()
    );
    this._remaining_lifetime = 6;

    this.changed = new Signal(this);
    this.unused_documents = new Set();
    this.document_info = new VirtualDocumentInfo(this);
    this.update_manager = new UpdateManager(this);
    this.clear();
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.parent = null;

    for (const doc of this.foreign_documents.values()) {
      doc.dispose();
    }

    this.update_manager.dispose();

    // clear all the maps
    this.foreign_documents.clear();
    this.source_lines.clear();
    this.unused_documents.clear();
    this.unused_standalone_documents.clear();
    this.virtual_lines.clear();

    // just to be sure - if anything is accessed after disposal (it should not) we
    // will get alterted by errors in the console AND this will limit memory leaks

    this.document_info = null as any;
    this.line_blocks = null as any;
  }

  /**
   * When this counter goes down to 0, the document will be destroyed and the associated connection will be closed;
   * This is meant to reduce the number of open connections when a a foreign code snippet was removed from the document.
   *
   * Note: top level virtual documents are currently immortal (unless killed by other means); it might be worth
   * implementing culling of unused documents, but if and only if JupyterLab will also implement culling of
   * idle kernels - otherwise the user experience could be a bit inconsistent, and we would need to invent our own rules.
   */
  protected get remaining_lifetime() {
    if (!this.parent) {
      return Infinity;
    }
    return this._remaining_lifetime;
  }
  protected set remaining_lifetime(value: number) {
    if (this.parent) {
      this._remaining_lifetime = value;
    }
  }

  clear() {
    // TODO - deep clear (assure that there is no memory leak)
    this.unused_standalone_documents.clear();

    for (let document of this.foreign_documents.values()) {
      document.clear();
      if (document.standalone) {
        // once the standalone document was cleared, we may want to remove it and close connection;
        // but wait, this is a waste of resources (opening a connection takes 1-3 seconds) and,
        // since this is cleaned anyway, we could use it for another standalone document of the same language.
        let set = this.unused_standalone_documents.get(document.language);
        set.push(document);
      }
    }
    this.unused_documents = new Set(this.foreign_documents.values());
    this.virtual_lines.clear();
    this.source_lines.clear();
    this.last_virtual_line = 0;
    this.last_source_line = 0;
    this.line_blocks = [];
  }

  document_at_source_position(position: ISourcePosition): VirtualDocument {
    let source_line = this.source_lines.get(position.line);

    if (source_line == null) {
      return this;
    }

    let source_position_ce: CodeEditor.IPosition = {
      line: source_line.editor_line,
      column: position.ch
    };

    for (let [
      range,
      { virtual_document: document }
    ] of source_line.foreign_documents_map) {
      if (is_within_range(source_position_ce, range)) {
        let source_position_cm = {
          line: source_position_ce.line - range.start.line,
          ch: source_position_ce.column - range.start.column
        };

        return document.document_at_source_position(
          source_position_cm as ISourcePosition
        );
      }
    }

    return this;
  }

  is_within_foreign(source_position: ISourcePosition): boolean {
    let source_line = this.source_lines.get(source_position.line)!;

    let source_position_ce: CodeEditor.IPosition = {
      line: source_line.editor_line,
      column: source_position.ch
    };
    for (let [range] of source_line.foreign_documents_map) {
      if (is_within_range(source_position_ce, range)) {
        return true;
      }
    }
    return false;
  }

  virtual_position_at_document(
    source_position: ISourcePosition
  ): IVirtualPosition {
    let source_line = this.source_lines.get(source_position.line);
    if (source_line == null) {
      throw new PositionError('Source line not mapped to virtual position');
    }
    let virtual_line = source_line.virtual_line;

    // position inside the cell (block)
    let source_position_ce: CodeEditor.IPosition = {
      line: source_line.editor_line,
      column: source_position.ch
    };

    for (let [
      range,
      { virtual_line, virtual_document: document }
    ] of source_line.foreign_documents_map) {
      if (is_within_range(source_position_ce, range)) {
        // position inside the foreign document block
        let source_position_cm = {
          line: source_position_ce.line - range.start.line,
          ch: source_position_ce.column - range.start.column
        };
        if (document.is_within_foreign(source_position_cm as ISourcePosition)) {
          return this.virtual_position_at_document(
            source_position_cm as ISourcePosition
          );
        } else {
          // where in this block in the entire foreign document?
          source_position_cm.line += virtual_line;
          return source_position_cm as IVirtualPosition;
        }
      }
    }

    return {
      ch: source_position.ch,
      line: virtual_line
    } as IVirtualPosition;
  }

  extract_foreign_code(
    block: ICodeBlockOptions,
    editor_shift: CodeEditor.IPosition
  ) {
    let cell_code = block.value;

    return { cell_code_kept: cell_code };
  }

  prepare_code_block(
    block: ICodeBlockOptions,
    editor_shift: CodeEditor.IPosition = { line: 0, column: 0 }
  ) {
    let lines: Array<string>;
    let { cell_code_kept } = this.extract_foreign_code(block, editor_shift);
    let cell_code = cell_code_kept;

    lines = cell_code.split('\n');

    return { lines };
  }

  get foreign_document_maps(): ForeignDocumentsMap[] {
    let maps = new Set<ForeignDocumentsMap>();
    for (let line of this.source_lines.values()) {
      maps.add(line.foreign_documents_map);
    }
    return [...maps.values()];
  }

  append_code_block(
    block: ICodeBlockOptions,
    editor_shift: CodeEditor.IPosition = { line: 0, column: 0 },
    virtual_shift?: CodeEditor.IPosition
  ) {
    let cell_code = block.value;
    let ce_editor = block.ce_editor;

    if (this.isDisposed) {
      console.warn('Cannot append code block: document disposed');
      return;
    }

    let source_cell_lines = cell_code.split('\n');

    let { lines} = this.prepare_code_block(
      block,
      editor_shift
    );

    for (let i = 0; i < lines.length; i++) {
      this.virtual_lines.set(this.last_virtual_line + i, {
        skip_inspect: [],
        editor: ce_editor,
        // TODO this is incorrect, wont work if something was extracted
        source_line: this.last_source_line + i
      });
    }
    for (let i = 0; i < source_cell_lines.length; i++) {
      this.source_lines.set(this.last_source_line + i, {
        editor_line: i,
        editor_shift: {
          line: editor_shift.line - (virtual_shift?.line || 0),
          column:
            i === 0 ? editor_shift.column - (virtual_shift?.column || 0) : 0
        },
        // TODO: move those to a new abstraction layer (DocumentBlock class)
        editor: ce_editor,
        foreign_documents_map: new Map(),
        // TODO this is incorrect, wont work if something was extracted
        virtual_line: this.last_virtual_line + i
      });
    }

    this.last_virtual_line += lines.length;

    // one empty line is necessary to separate code blocks, next 'n' lines are to silence linters;
    // the final cell does not get the additional lines (thanks to the use of join, see below)
    this.line_blocks.push(lines.join('\n') + '\n');

    // adding the virtual lines for the blank lines
    for (let i = 0; i < this.blank_lines_between_cells; i++) {
      this.virtual_lines.set(this.last_virtual_line + i, {
        skip_inspect: [this.id_path],
        editor: ce_editor,
        source_line: null
      });
    }

    this.last_virtual_line += this.blank_lines_between_cells;
    this.last_source_line += source_cell_lines.length;
  }

  get value() {
    let lines_padding = '\n'.repeat(this.blank_lines_between_cells);
    return this.line_blocks.join(lines_padding);
  }

  get last_line() {
    const lines_in_last_block = this.line_blocks[
      this.line_blocks.length - 1
    ].split('\n');
    return lines_in_last_block[lines_in_last_block.length - 1];
  }

  close_expired_documents() {
    for (let document of this.unused_documents.values()) {
      document.remaining_lifetime -= 1;
      if (document.remaining_lifetime <= 0) {
        /** */
      }
    }
  }


  get virtual_id(): VirtualDocument.virtual_id {
    // for easier debugging, the language information is included in the ID:
    return this.standalone
      ? this.instance_id + '(' + this.language + ')'
      : this.language;
  }

  get ancestry(): Array<VirtualDocument> {
    if (!this.parent) {
      return [this];
    }
    return this.parent.ancestry.concat([this]);
  }

  get id_path(): VirtualDocument.id_path {
    if (!this.parent) {
      return this.virtual_id;
    }
    return this.parent.id_path + '-' + this.virtual_id;
  }

  get uri(): VirtualDocument.uri {
    const encodedPath = encodeURI(this.path);
    if (!this.parent) {
      return encodedPath;
    }
    return encodedPath + '.' + this.id_path + '.' + this.file_extension;
  }

  transform_source_to_editor(pos: ISourcePosition): IEditorPosition {
    let source_line = this.source_lines.get(pos.line)!;
    let editor_line = source_line.editor_line;
    let editor_shift = source_line.editor_shift;
    return {
      // only shift column in the line beginning the virtual document (first list of the editor in cell magics, but might be any line of editor in line magics!)
      ch: pos.ch + (editor_line === 0 ? editor_shift.column : 0),
      line: editor_line + editor_shift.line
      // TODO or:
      //  line: pos.line + editor_shift.line - this.first_line_of_the_block(editor)
    } as IEditorPosition;
  }

  /**
  Can be null because some lines are added as padding/anchors
  to the virtual document and those do not exist in the source document
  and thus they are absent in the editor.
  */
  transform_virtual_to_editor(
    virtual_position: IVirtualPosition
  ): IEditorPosition | null {
    let source_position = this.transform_virtual_to_source(virtual_position);
    if (source_position == null) {
      return null;
    }
    return this.transform_source_to_editor(source_position);
  }

  /**
  Can be null because some lines are added as padding/anchors
  to the virtual document and those do not exist in the source document.
  */
  transform_virtual_to_source(
    position: IVirtualPosition
  ): ISourcePosition | null {
    const line = this.virtual_lines.get(position.line)!.source_line;
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

  get_editor_at_virtual_line(pos: IVirtualPosition): CodeEditor.IEditor {
    let line = pos.line;
    // tolerate overshot by one (the hanging blank line at the end)
    if (!this.virtual_lines.has(line)) {
      line -= 1;
    }
    return this.virtual_lines.get(line)!.editor;
  }

  get_editor_at_source_line(pos: ISourcePosition): CodeEditor.IEditor {
    return this.source_lines.get(pos.line)!.editor;
  }

  /**
   * Recursively emits changed signal from the document or any descendant foreign document.
   */
  maybe_emit_changed() {
    if (this.value !== this.previous_value) {
      this.changed.emit(this);
    }
    this.previous_value = this.value;
    for (let document of this.foreign_documents.values()) {
      document.maybe_emit_changed();
    }
  }
}

export namespace VirtualDocument {
  /**
   * Identifier composed of `virtual_id`s of a nested structure of documents,
   * used to aide assignment of the connection to the virtual document
   * handling specific, nested language usage; it will be appended to the file name
   * when creating a connection.
   */
  export type id_path = string;
  /**
   * Instance identifier for standalone documents (snippets), or language identifier
   * for documents which should be interpreted as one when stretched across cells.
   */
  export type virtual_id = string;
  /**
   * Identifier composed of the file path and id_path.
   */
  export type uri = string;
}

export function collect_documents(
  virtual_document: VirtualDocument
): Set<VirtualDocument> {
  let collected = new Set<VirtualDocument>();
  collected.add(virtual_document);
  for (let foreign of virtual_document.foreign_documents.values()) {
    let foreign_languages = collect_documents(foreign);
    foreign_languages.forEach(collected.add, collected);
  }
  return collected;
}

export interface IBlockAddedInfo {
  virtual_document: VirtualDocument;
  block: ICodeBlockOptions;
}

export class UpdateManager {
  /**
   * Virtual documents update guard.
   */
  private is_update_in_progress: boolean = false;

  private update_lock: boolean = false;

  protected isDisposed = false;

  /**
   * Signal emitted by the editor that triggered the update, providing the root document of the updated documents.
   */
  private document_updated: Signal<UpdateManager, VirtualDocument>;
  public block_added: Signal<UpdateManager, IBlockAddedInfo>;
  update_done: Promise<void> = new Promise<void>(resolve => {
    resolve();
  });
  update_began: Signal<UpdateManager, ICodeBlockOptions[]>;
  update_finished: Signal<UpdateManager, ICodeBlockOptions[]>;

  constructor(private virtual_document: VirtualDocument) {
    this.document_updated = new Signal(this);
    this.block_added = new Signal(this);
    this.update_began = new Signal(this);
    this.update_finished = new Signal(this);
    this.document_updated.connect(this.on_updated, this);
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.document_updated.disconnect(this.on_updated, this);
  }

  /**
   * Once all the foreign documents were refreshed, the unused documents (and their connections)
   * should be terminated if their lifetime has expired.
   */
  private on_updated(manager: UpdateManager, root_document: VirtualDocument) {
    try {
      root_document.close_expired_documents();
    } catch (e) {
      console.warn('Failed to close expired documents');
    }
  }

  private can_update() {
    return !this.isDisposed && !this.is_update_in_progress && !this.update_lock;
  }

  /**
   * Execute provided callback within an update-locked context, which guarantees that:
   *  - the previous updates must have finished before the callback call, and
   *  - no update will happen when executing the callback
   * @param fn - the callback to execute in update lock
   */
  public async with_update_lock(fn: () => void): Promise<void> {
    await untilReady(() => this.can_update(), 12, 10).then(() => {
      try {
        this.update_lock = true;
        fn();
      } finally {
        this.update_lock = false;
      }
    });
  }

  /**
   * Update all the virtual documents, emit documents updated with root document if succeeded,
   * and resolve a void promise. The promise does not contain the text value of the root document,
   * as to avoid an easy trap of ignoring the changes in the virtual documents.
   */
  public async update_documents(blocks: ICodeBlockOptions[]): Promise<void> {
    let update = new Promise<void>(async (resolve, reject) => {
      // defer the update by up to 50 ms (10 retrials * 5 ms break),
      // awaiting for the previous update to complete.
      await untilReady(() => this.can_update(), 10, 5).then(() => {
        if (this.isDisposed || !this.virtual_document) {
          resolve();
        }
        try {
          this.is_update_in_progress = true;
          this.update_began.emit(blocks);

          this.virtual_document.clear();

          for (let code_block of blocks) {
            this.block_added.emit({
              block: code_block,
              virtual_document: this.virtual_document
            });
            this.virtual_document.append_code_block(code_block);
          }

          this.update_finished.emit(blocks);

          if (this.virtual_document) {
            this.document_updated.emit(this.virtual_document);
            this.virtual_document.maybe_emit_changed();
          }

          resolve();
        } catch (e) {
          console.warn('Documents update failed:', e);
          reject(e);
        } finally {
          this.is_update_in_progress = false;
        }
      });
    });
    this.update_done = update;
    return update;
  }
}
