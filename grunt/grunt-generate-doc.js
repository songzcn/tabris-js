const {join, parse, relative, sep} = require('path');

const SNIPPETS_LOCATION = 'snippets';

const MSG_DEPRECATED = '**Deprecated**';
const MSG_PROVISIONAL = '**Note:** this API is provisional and may change in a future release.';
const MSG_STATIC_PROP = 'This property can only be set on widget creation. Once set, it cannot be changed anymore.';

module.exports = function(grunt) {

  grunt.registerTask('generate-doc', () => {
    let targetPath = grunt.config('doc').target;
    let apiPath = join(targetPath, 'api');
    let typesFile = join(targetPath, 'types.md');
    let tocFile = join(targetPath, 'toc.yml');
    let api = readAPI();
    let types = readTypes();

    renderAPI();
    renderIndex();

    function readAPI() {
      let api = {};
      grunt.file.expand(grunt.config('doc').api).forEach(file => {
        let isWidget = file.indexOf('/widgets/') !== -1;
        let def = Object.assign(grunt.file.readJSON(file), {file, isWidget});
        let key = def.type; // TODO:Use a different field as key to avoid needing pseudo-types.
        if (api[key]) {
          throw new Error('Duplicate key ' + key);
        }
        api[key] = def;
      });
      return api;
    }

    function readTypes() {
      return {
        list: grunt.file.read(typesFile).match(/^##\ *(.*)$/gm).map(heading => heading.slice(3).toLowerCase()),
        path: relative(apiPath, typesFile).replace(sep, '/')
      };
    }

    function renderAPI() {
      Object.keys(api).forEach(definition => {
        let targetFile = join(apiPath, parse(api[definition].file).name + '.md');
        grunt.file.write(targetFile, renderDocument(definition));
      });
    }

    function renderIndex() {
      grunt.log.verbose.writeln('Generating index');
      let types = Object.keys(api).map(type => api[type]).sort(compareTypes);
      let render = def => `    - title: ${title(def)}\n      url: api/${parse(def.file).name}.html`;
      let data = {
        api: types.filter(type => !type.isWidget).map(render).join('\n'),
        widgets: types.filter(type => type.isWidget).map(render).join('\n')
      };
      grunt.file.write(tocFile, grunt.template.process(grunt.file.read(tocFile), {data}));
    }

    function renderDocument(key) {
      grunt.log.verbose.writeln('Generating DOC for ' + key);
      let def = api[key];
      return [
        '---\n---',
        '# ' + title(def) + '\n',
        renderExtends(def),
        renderDescription(def),
        renderImages(def),
        renderExample(def),
        renderMembers(def),
        renderSnippet(def),
        renderLinks(def)
      ].filter(value => !!value).join('\n');
    }

    function renderMembers(def) {
      return [
        renderMethods(def),
        renderProperties(def),
        renderEvents(def)
      ].filter(value => !!value).join('\n');
    }

    function renderExample(def) {
      let exampleFile = join(apiPath, parse(def.file).name + '.md');
      if (grunt.file.isFile(exampleFile)) {
        return grunt.file.read(exampleFile);
      }
    }

    function renderSnippet(def) {
      let snippetPath = join(SNIPPETS_LOCATION, `${def.type.toLowerCase()}.js`);
      if (grunt.file.isFile(snippetPath)) {
        return [
          '## Example',
          '```js',
          grunt.file.read(snippetPath).trim(),
          '```'
        ].join('\n');
      }
    }

    function renderImages(def) {
      let androidImage = join('img/android', parse(def.file).name + '.png');
      let iosImage = join('img/ios', parse(def.file).name + '.png');
      let exists = image => grunt.file.isFile(join('doc/api', image));
      if (exists(androidImage) && exists(iosImage)) {
        return [
          'Android | iOS',
          '--- | ---',
          `![${def.type} on Android](${androidImage}) | ![${def.type} on iOS](${iosImage})`,
        ].join('\n') + '\n';
      }
      if (exists(androidImage)) {
        return `![${def.type} on Android](${androidImage})\n`;
      }
      if (exists(iosImage)) {
        return `![${def.type} on iOS](${iosImage})\n`;
      }
      return '';
    }

    function renderDescription(def) {
      let result = def.description ? def.description + '\n\n' : '';
      if (def.namespace === 'global') {
        result += `This ${def.object ? 'object' : 'API'} is available in the global namespace. `;
        result += 'You do not need to import it explicitly.\n';
      } else {
        result += `Import this ${def.object ? 'object' : 'type'} with `;
        result += `"\`const {${def.object || def.type}} = require('tabris');\`"\n`;
      }
      return result;
    }

    function renderExtends(def) {
      if (def.extends) {
        if (!(def.extends in api)) {
          throw new Error('Could not find super type for ' + def.type);
        }
        let sup = api[def.extends];
        return `Extends [${sup.type}](${sup.type}.md)\n`;
      }
      return '';
    }

    function renderMethods(def) {
      if (!def.methods || !Object.keys(def.methods).length) {
        return '';
      }
      let result = ['## Methods\n\n'];
      Object.keys(def.methods).sort().forEach(name => {
        if (Array.isArray(def.methods[name])) {
          def.methods[name].filter(desc => !desc.ts_only).forEach(desc => {
            result.push(renderMethod(name, desc));
          });
        } else {
          result.push(renderMethod(name, def.methods[name]));
        }
      });
      return result.join('');
    }

    function renderMethod(name, desc) {
      let result = [];
      result.push('### ' + name + renderSignature(desc.parameters) + '\n');
      if (desc.parameters && desc.parameters.length) {
        result.push('**Parameters:** ' + renderMethodParamList(desc.parameters) + '\n');
      }
      if (desc.returns) {
        result.push('**Returns:** *' + renderTypeLink(desc.returns) + '*\n');
      }
      if (desc.provisional) {
        result.push(MSG_PROVISIONAL + '\n');
      }
      if (desc.description) {
        result.push(desc.description + '\n');
      }
      return result.join('\n') + '\n';
    }

    function renderProperties(def) {
      if (!def.properties || !Object.keys(def.properties).length) {
        return '';
      }
      let result = ['## Properties\n\n'];
      Object.keys(def.properties).filter(name => !def.properties[name].ts_only).sort().forEach(name => {
        let property = def.properties[name];
        result.push('### ', name, '\n\n');
        if (property.readonly) {
          result.push('**read-only**<br/>\n');
        }
        result.push('Type: ', renderPropertyType(property), '\n');
        if (property.deprecated) {
          let message = typeof property.deprecated === 'string' ? property.deprecated : '';
          result.push('\n' + MSG_DEPRECATED + (message ? ': ' + message : '') + '\n');
        }
        if (property.provisional) {
          result.push('\n' + MSG_PROVISIONAL + '\n');
        }
        if (property.description) {
          result.push('\n' + property.description);
        }
        if (property.static) {
          result.push('<br/>' + MSG_STATIC_PROP);
        }
        result.push('\n\n');
      });
      return result.join('');
    }

    function renderPropertyType(property) {
      let name = property.type;
      let result = ['*', renderTypeLink(name), '*'];
      if (property.values) {
        result.push(', supported values: `' + property.values.join('`, `') + '`');
      }
      if (property.default) {
        result.push(', default: `' + property.default + '`');
      }
      return result.join('');
    }

    function renderEvents(def) {
      if (!def.events || !Object.keys(def.events).length) {
        return '';
      }
      let widgetEvents = Object.keys(def.events).map(name => Object.assign({name}, def.events[name]));
      let changeEvents = createChangeEvents(def.properties);
      for (let changeEvent of changeEvents) {
        if (!(widgetEvents.some(widgetEvent => widgetEvent.name === changeEvent.name))) {
          widgetEvents.push(changeEvent);
        }
      }
      let events = widgetEvents.sort((a, b) => a.name.localeCompare(b.name));
      return [
        '## Events\n\n',
        ...events.map(({name, description, provisional, parameters}) => ([
          '### ', name, '\n',
          description ? description + '\n' : '',
          provisional ? MSG_PROVISIONAL : '',
          parameters ? '\n#### Event Parameters ' + renderEventParamList(parameters) + '\n' : ''
        ]).join('')),
        '\n\n'
      ].join('');
    }

    function createChangeEvents(properties) {
      if (!properties || !Object.keys(properties).length) {
        return [];
      }
      return Object.keys(properties)
        .filter(name => !properties[name].static)
        .map(name => ({
          name: `${name}Changed`,
          description: `Fired when the [*${name}*](#${name}) property has changed.`,
          parameters: [{
            name: 'value',
            type: properties[name].type,
            description: `The new value of [*${name}*](#${name}).`
          }]
        }));
    }

    function renderSignature(parameters) {
      return '(' + parameters.map(param => typeof param === 'object' ? param.name : param).join(', ') + ')';
    }

    function renderEventParamList(parameters) {
      let result = '\n';
      result += renderEventParameter({name: 'target', type: 'this', description: 'The widget the event was fired on.'});
      Object.keys(parameters).sort().forEach((name) => {
        result += renderEventParameter(Object.assign({name}, parameters[name]));
      });
      return result;
    }

    function renderMethodParamList(parameters) {
      return '\n\n' + parameters.map(param => {
        let type = '';
        if (param.type) {
          type = '*' + renderTypeLink(param.type) + '*';
        } else if (param.value) {
          type = '`' + param.value + '`';
        }
        let optional = param.optional ? ' [**Optional**]' : '';
        let result = [`- ${param.name}: ${type}${optional}`];
        if (param.description) {
          result.push(`  - ${firstCharLower(param.description)}`);
        }
        return result.join('\n');
      }).join('\n');
    }

    function renderEventParameter({name, type, description}) {
      return `- **${name}**: *${renderTypeLink(type)}*\n    ${description}\n\n`;
    }

    function renderLinks(def) {
      if (!def.links || !def.links.length) {
        return '';
      }
      return ['## See also\n'].concat(def.links.map(link => {
        let path = link.path.replace('${GITHUB_BRANCH}',
          'https://github.com/eclipsesource/tabris-js/tree/v' + grunt.config('version'));
        return `- [${link.title}](${path})`;
      })).join('\n') + '\n';
    }

    function renderTypeLink(name) {
      if (types.list.indexOf(name.toLowerCase()) !== -1) {
        return `[${name}](${types.path}#${name.toLowerCase()})`;
      }
      if (api[firstCharUp(name)]) {
        return `[${name}](${name}.md)`;
      }
      return name;
    }

  });

  function firstCharUp(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function firstCharLower(str) {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  function title(def) {
    return def.object || def.type;
  }

  function isLowerCase(str) {
    return str.charAt(0).toLowerCase() === str.charAt(0);
  }

  function compareTypes(a, b) {
    let ta = title(a);
    let tb = title(b);
    if (isLowerCase(ta) !== isLowerCase(tb)) {
      return isLowerCase(ta) ? -1 : 1;
    }
    return ta.localeCompare(tb, 'en');
  }

};
