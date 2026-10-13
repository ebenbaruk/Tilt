// Dev-only loader: lets cards and UI kits render straight from components/*.jsx
// when the compiled _ds_bundle.js is not present (e.g. a fresh GitHub clone opened via a static server).
(function () {
  var FILES = ['core/TerminalWindow','core/KeyButton','core/GameTabs','core/Stat','core/Notice','core/Spinner','core/PromptInput','core/TiltPanel',
    'games/PlayingCard','games/RouletteStrip','games/SlotReel','tilt/WinCard','tilt/SponsorBlock','tilt/Leaderboard','tilt/TranscriptLine'];
  function findBundle() {
    for (var k of Object.keys(window)) { try { var v = window[k]; if (v && typeof v === 'object' && v.KeyButton && v.TiltPanel) return v; } catch (e) {} }
    return null;
  }
  window.getTilt = function (root) {
    var b = findBundle(); if (b) return Promise.resolve(b);
    var NS = {};
    return Promise.all(FILES.map(function (f) { return fetch(root + 'components/' + f + '.jsx').then(function (r) { return r.text(); }); }))
      .then(function (srcs) {
        srcs.forEach(function (src) {
          src = src.replace(/^import .*$/gm, '').replace(/^export function (\w+)/gm, 'NS.$1 = function $1');
          var code = Babel.transform(src, { presets: ['react'] }).code;
          new Function('React', 'NS', 'with (NS) {' + code + '}')(React, NS);
        });
        return NS;
      });
  };
})();
