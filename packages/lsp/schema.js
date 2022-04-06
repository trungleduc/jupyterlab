const childProcess = require('child_process');
const json2ts = require('json-schema-to-typescript');
const fs = require('fs');

const package = 'jupyterlab_server';
const schemaLocalPath = 'lsp_handler/schema/schema.json';
const cmd = `python -c 'import pkg_resources;print(pkg_resources.resource_filename("${package}", "${schemaLocalPath}"))'`;
const value = childProcess.execSync(cmd, {});
if (value === null) {
  throw Error();
}
const schemaPath = value
  .toString()
  .replace(/(\r\n|\n)$/, '')
  .trim();

json2ts
  .compileFromFile(schemaPath, { unreachableDefinitions: true })
  .then(ts => {
    fs.writeFileSync('src/_schema.ts', ts);
  });

const pluginSchema = '../lsp-extension/schema/plugin.json';
json2ts.compileFromFile(pluginSchema).then(ts => {
  fs.writeFileSync('src/_plugin.ts', ts);
});
