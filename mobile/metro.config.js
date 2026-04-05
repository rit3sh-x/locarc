const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('path');

const projectRoot = __dirname;
const convexRoot = path.resolve(projectRoot, '../backend/convex');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.watchFolders = [convexRoot];

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    '@backend/api': path.resolve(convexRoot, '_generated/api'),
    '@backend/dataModel': path.resolve(convexRoot, '_generated/dataModel'),
    '@backend/types': path.resolve(convexRoot, 'types'),
    '~': './modules',
    '@': './src',
};

module.exports = withUniwindConfig(
    config,
    {
        cssEntryFile: './src/app/globals.css',
        dtsFile: './uniwind-types.d.ts'
    }
);