module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@backend/api': '../web/convex/_generated/api',
            '@backend/dataModel': '../web/convex/_generated/dataModel',
            '@backend/types': '../web/convex/types',
            '~': './modules',
            '@': './src',
          },
        },
      ],
    ],
  };
};
