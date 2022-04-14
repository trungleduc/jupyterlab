
import { CellType } from '@jupyterlab/nbformat';
import { LanguageIdentifier } from '../lsp';
import { positionAtOffset } from '../positioning';

import { IExtractedCode, IForeignCodeExtractor } from './types';

export class TextForeignCodeExtractor implements IForeignCodeExtractor {
  language: LanguageIdentifier;
  standalone: boolean;
  file_extension: string;
  cellType: CellType[]

  constructor(options: TextForeignCodeExtractor.IOptions) {
    this.language = options.language;
    this.standalone = options.is_standalone;
    this.file_extension = options.file_extension;
    this.cellType = options.cellType
  }

  has_foreign_code(code: string, cellType: CellType): boolean {
    return this.cellType.includes(cellType);
  }

  extract_foreign_code(code: string): IExtractedCode[] {
    let lines = code.split('\n');

    let extracts = new Array<IExtractedCode>();


    let foreignCodeFragment = code

    let start = positionAtOffset(0, lines);
    let end = positionAtOffset(
      foreignCodeFragment.length,
      lines
    );

    extracts.push({
      host_code: '',
      foreign_code: foreignCodeFragment,
      range: { start, end },
      virtual_shift: null
    });

    return extracts;
  }
}

namespace TextForeignCodeExtractor {
  export interface IOptions {
    /**
     * The foreign language.
     */
    language: string;

    /**
     * Should the foreign code be appended (False) to the previously established virtual document of the same language,
     * or is it standalone snippet which requires separate connection?
     */
    is_standalone: boolean;

    file_extension: string;

    cellType: CellType[]
  }

}
