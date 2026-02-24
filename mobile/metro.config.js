const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('path');

const projectRoot = __dirname;
const convexRoot = path.resolve(projectRoot, '../web/convex');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.watchFolders = [convexRoot];

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
];

module.exports = withUniwindConfig(config, {
    cssEntryFile: './src/app/globals.css',
    dtsFile: './uniwind-types.d.ts'
});