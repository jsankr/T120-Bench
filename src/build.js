const fs = require('fs'), path = require('path'), p = __dirname + '/';
let html = fs.readFileSync(p + 'template.html', 'utf8');
html = html.replace('/*CORE*/', () => fs.readFileSync(p + 'core.js', 'utf8')).replace('/*DIAG*/', () => fs.readFileSync(p + 'diag.js', 'utf8')).replace('/*APP*/', () => fs.readFileSync(p + 'app.js', 'utf8'));

fs.writeFileSync(path.join(p, '..', 'index.html'), html);
console.log('built', html.length, 'bytes');
