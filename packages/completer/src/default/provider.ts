import { ICompletionProvider } from '../tokens';
import { CompletionHandler } from '../handler';
import { ICompletionContext } from '..';

export const DEFAULT_PROVIDER_ID = 'CompletionProvider:base';

export class DefaultCompletionProvider implements ICompletionProvider {
  async fetch(options: {
    request: CompletionHandler.IRequest;
    context: ICompletionContext;
  }): Promise<CompletionHandler.ICompletionItemsReply> {
    console.log('fetching with', options);

    return Promise.resolve(0) as any;
  }

  identifier = DEFAULT_PROVIDER_ID;
  renderer = null;
}
