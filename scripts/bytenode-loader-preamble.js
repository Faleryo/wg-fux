/* eslint-disable */
// bytenode-loader-preamble.js — PRÉAMBULE injecté en tête de server.js dans le
// BUNDLE DURCI (par scripts/build-protected-bundle.sh). N'est PAS utilisé en dev.
//
// Rôle : après compilation de api-service/{src,db}/**.js en bytecode V8 (.jsc),
// Node ne sait pas résoudre `require('./x')` vers `x.jsc` (il n'essaie que
// .js/.json/.node). On enregistre donc le handler .jsc (bytenode) PUIS on patche
// la résolution pour retomber sur `<req>.jsc` et `<req>/index.jsc`. server.js
// reste un .js normal (obfusqué) : il garde `require.main === module` intact,
// donc `node server.js` démarre bien le serveur.
'use strict';
require('bytenode'); // enregistre Module._extensions['.jsc']

(function patchJscResolution() {
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    try {
      return origResolve.call(this, request, parent, isMain, options);
    } catch (err) {
      // Uniquement pour les requires RELATIFS/absolus de notre code (jamais les
      // paquets node_modules, qui restent en .js et résolvent normalement).
      if (typeof request === 'string' && /^\.{0,2}\//.test(request)) {
        for (const alt of [request + '.jsc', request + '/index.jsc']) {
          try {
            return origResolve.call(this, alt, parent, isMain, options);
          } catch (_) {
            /* essai suivant */
          }
        }
      }
      throw err;
    }
  };
})();

// --- server.js obfusqué original à partir d'ici (concaténé par le build) ---
