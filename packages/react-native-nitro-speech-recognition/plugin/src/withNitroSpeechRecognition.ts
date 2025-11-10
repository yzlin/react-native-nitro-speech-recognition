import {
  type ConfigPlugin,
  createRunOncePlugin,
  IOSConfig,
} from "expo/config-plugins";

let pkg: { name: string; version?: string } = {
  name: "react-native-nitro-speech-recognition",
};

try {
  pkg = require("react-native-nitro-speech-recognition/package.json");
} catch {
  // empty catch block
}

const SPEECH_RECOGNITION_USAGE =
  "Allow $(PRODUCT_NAME) to to use speech recognition";

const withNitroSpeechRecognition: ConfigPlugin<{
  speechRecognitionPermission?: string | false;
}> = (config, { speechRecognitionPermission } = {}) => {
  IOSConfig.Permissions.createPermissionsPlugin({
    // biome-ignore lint/style/useNamingConvention: iOS plist key naming convention
    NSSpeechRecognitionUsageDescription: SPEECH_RECOGNITION_USAGE,
  })(config, {
    // biome-ignore lint/style/useNamingConvention: iOS plist key naming convention
    NSSpeechRecognitionUsageDescription: speechRecognitionPermission,
  });

  return config;
};

export default createRunOncePlugin(
  withNitroSpeechRecognition,
  pkg.name,
  pkg.version
);
