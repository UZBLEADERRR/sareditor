module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4 runs its animations on worklets; the plugin has to come
      // last so it sees the final output of every other transform.
      'react-native-worklets/plugin',
    ],
  };
};
