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
            '@backend/api': '../backend/convex/_generated/api',
            '@backend/dataModel': '../backend/convex/_generated/dataModel',
            '@backend/types': '../backend/convex/types',
            '~': './modules',
            '@': './src',
          },
        },
      ],
    ],
  };
};
