'use strict';
// Community Mac builds use a verified ad-hoc signature, without Developer ID.
module.exports = {
  extends: null,
  ...require('./package.json').build,
  afterPack: async context => {
    if (context.electronPlatformName !== 'darwin') return;
    const path = require('node:path');
    const {execFileSync} = require('node:child_process');
    execFileSync('python3', [
      path.resolve(__dirname, '../scripts/sign_macos_app.py'),
      path.join(context.appOutDir, 'LifeOS.app'),
    ], {stdio: 'inherit'});
  },
};
