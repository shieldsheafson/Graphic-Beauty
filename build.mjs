// Bundles the site into one self-contained HTML file that works when opened
// straight from disk (browsers block ES module imports over file://).
//
//   node build.mjs   ->   dist/graphic-beauty.html
//
// Each module becomes a function whose exports land in a registry, and each
// `import { a, b } from './x.js'` becomes a lookup in that registry. This only
// handles the import/export forms this project uses.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)';?\s*$/gm;
const EXPORT = /^export\s+(?:function\s+(\w+)|(?:const|let)\s+(\w+))/gm;

const order = []; // dependencies before dependents
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  for (const [, , dep] of read(`src/${file}`).matchAll(IMPORT)) visit(dep);
  order.push(file);
}
visit('main.js');

const modules = order.map(file => {
  let src = read(`src/${file}`);
  const names = [...src.matchAll(EXPORT)].map(m => m[1] || m[2]);
  src = src
    .replace(IMPORT, (_, list, dep) =>
      `const {${list.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = __modules['${dep}'];`)
    .replace(/^export\s+/gm, '');
  return `__modules['${file}'] = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();`;
});

const bundle = `(() => {\n'use strict';\nconst __modules = {};\n${modules.join('\n\n')}\n})();`;

let html = read('index.html')
  .replace(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${read('style.css')}</style>`)
  .replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `<script>\n${bundle}\n</script>`);

if (html.includes('src/main.js') || html.includes('href="style.css"')) {
  throw new Error('index.html no longer matches the expected <link>/<script> tags');
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/graphic-beauty.html'), html);
console.log(`Wrote dist/graphic-beauty.html (${order.join(' → ')})`);
