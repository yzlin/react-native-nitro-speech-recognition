// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const {
  wrapWithAudioAPIMetroConfig,
} = require("react-native-audio-api/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = wrapWithAudioAPIMetroConfig(
  withUniwindConfig(config, {
    cssEntryFile: "./src/global.css",
    dtsFile: "./src/types/uniwind-types.d.ts",
  }),
);
