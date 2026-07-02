const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// fuerza a conservar las extensiones de assets que Expo ya trae
//config.resolver.assetExts = [...config.resolver.assetExts, "ttf", "png"];

module.exports = withNativeWind(config, {
  input: "./app/global.css",
});