/* eslint-disable */
// bytenode-compile.js — Compile en bytecode V8 (.jsc) tous les .js des dossiers
// passés en argument, PUIS supprime les .js source. Utilisé UNIQUEMENT par
// scripts/build-protected-bundle.sh, à l'intérieur de l'image runtime (pour que
// le bytecode soit compatible V8 avec le Node qui l'exécutera).
//
// Usage : node bytenode-compile.js <dir1> [dir2 ...]
'use strict';
const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

function walkJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('bytenode-compile: aucun dossier fourni');
  process.exit(1);
}

let count = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    console.error(`bytenode-compile: dossier introuvable: ${dir}`);
    process.exit(1);
  }
  for (const file of walkJs(dir, [])) {
    bytenode.compileFile({ filename: file, output: file + 'c' }); // x.js -> x.jsc
    fs.unlinkSync(file); // le .js source ne part JAMAIS dans le bundle
    count++;
  }
}
console.log(`bytenode-compile: ${count} fichier(s) compilé(s) en .jsc (node ${process.version})`);
