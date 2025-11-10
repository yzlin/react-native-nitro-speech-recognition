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
    NSSpeechRecognitionUsageDescription: SPEECH_RECOGNITION_USAGE,
  })(config, {
    NSSpeechRecognitionUsageDescription: speechRecognitionPermission,
  });

  return config;
};

export default createRunOncePlugin(
  withNitroSpeechRecognition,
  pkg.name,
  pkg.version
);
