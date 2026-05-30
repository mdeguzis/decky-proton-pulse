// Barrel for lib/scoring -- single entry point both the webui and the
// decky-proton-pulse plugin import from. When we add more modules here
// (per-report scoring, version helpers, etc) they get re-exported through
// this file so consumers never have to know individual file paths.
//
// Why a barrel: lets us split files internally without breaking imports
// in the plugin's synced copy. Phase 2 of the scoring share work depends
// on a single stable entry point

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(
    {},
    require('./gameStats.js'),
  );
}
