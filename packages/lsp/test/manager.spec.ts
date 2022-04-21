import { LanguageServerManager } from '@jupyterlab/lsp';
import { ServerConnection } from '@jupyterlab/services';

const spy = jest.spyOn(ServerConnection, 'makeRequest');
const specs = {
  pyls: {
    argv: [''],
    display_name: 'pyls',
    env: {},
    languages: ['python'],
    mime_types: ['text/python', 'text/x-ipython'],
    version: 2
  }
};
const sessions = {
  pyls: {
    handler_count: 0,
    last_handler_message_at: null,
    last_server_message_at: null,
    spec: specs.pyls,
    status: 'not_started'
  }
};
spy.mockImplementation((status, method, setting) => {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => ({
      sessions,
      specs,
      version: 2
    })
  }) as any;
});
describe('@jupyterlab/lsp', () => {
  describe('LanguageServerManager', () => {
    let manager: LanguageServerManager;
    beforeEach(() => {
      manager = new LanguageServerManager({});
    });
    describe('#fetchSessions', () => {
      it('should fetch session from server', async () => {
        await manager.fetchSessions();
        expect(manager.sessions.has('pyls' as any)).toEqual(true);
        expect(manager.specs.has('pyls' as any)).toEqual(true);
      });
    });

    describe('#_comparePriorities', () => {
      it('should raise warning if two server have the same priority', async () => {
        console.warn = jest.fn();
        const value = manager['_comparePriorities'](
          'pylsp',
          'unified-language-server'
        );
        expect((console.warn as jest.Mock).mock.calls[0][0]).toEqual(
          'Two matching servers: pylsp and unified-language-server have the same priority; choose which one to use by changing the priority in Advanced Settings Editor'
        );
        expect(value).toEqual(-1);
      });
    });
    describe('#getMatchingServers', () => {
      it('should get the matching server', async () => {
        const match = manager.getMatchingServers({
          language: 'python',
          mimeType: 'text/python'
        });
        expect(match).toEqual(['pyls']);
      });
    });
    describe('#getMatchingSpecs', () => {
      it('should get the matching spec', async () => {
        const match = manager.getMatchingSpecs({
          language: 'python',
          mimeType: 'text/python'
        });
        expect(match.has('pyls')).toEqual(true);
      });
    });
  });
});
