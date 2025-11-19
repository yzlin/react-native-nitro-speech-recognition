# react-native-nitro-speech-recognition

[![npm version](https://badge.fury.io/js/react-native-nitro-speech-recognition.svg)](https://badge.fury.io/js/react-native-nitro-speech-recognition)

A powerful speech recognition library for React Native, built with [Nitro Modules](https://github.com/mrousavy/nitro).

## Features

- 🚀 **Fast & Efficient**: Built with Nitro Modules for high performance.
- 🎙️ **Real-time Recognition**: Supports real-time speech-to-text.
- 📱 **On-Device Support**: Supports on-device speech recognition (Android 13+).
- 🌍 **Multi-language**: Supports multiple locales.
- 🔄 **Flexible Audio Input**: Accepts raw audio buffers (PCM Int16 or Float32).

## Installation

```sh
npm install react-native-nitro-speech-recognition
# or
yarn add react-native-nitro-speech-recognition
# or
bun add react-native-nitro-speech-recognition
```

### Expo

You can use this library with [Expo](https://expo.dev). It includes a Config Plugin to automatically configure permissions.

First, install the package:

```sh
npx expo install react-native-nitro-speech-recognition
```

Then, add the config plugin to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-speech-recognition",
        {
          "microphonePermission": "Allow $(PRODUCT_NAME) to access your microphone.",
          "speechRecognitionPermission": "Allow $(PRODUCT_NAME) to access speech recognition."
        }
      ]
    ]
  }
}
```

### Manual Installation (Bare React Native)

If you are not using Expo, or if you are using a bare React Native project, you need to configure permissions manually.

#### iOS

Add the following key to your `Info.plist` to request speech recognition permission:

```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>Allow access to speech recognition for transcribing your voice.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Allow access to the microphone for recording audio.</string>
```

### Android

Add the following permission to your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

## Usage

### Basic Usage

```typescript
import { SpeechRecognition } from 'react-native-nitro-speech-recognition';

const speechRecognition = new SpeechRecognition();

// 1. Check availability
const isAvailable = SpeechRecognition.isRecognitionAvailable();

// 2. Request permissions
const permissions = await SpeechRecognition.requestPermissionsAsync();

// 3. Setup event listeners
speechRecognition.on('result', (event) => {
  console.log('Transcript:', event.results[0]?.transcript);
  console.log('Is Final:', event.isFinal);
});

speechRecognition.on('error', (error) => {
  console.error('Error:', error);
});

// 4. Start recognition
speechRecognition.start({
  locale: 'en-US',
  interimResults: true,
  audioFormat: 'pcmFloat32', // or 'pcmInt16'
  sampleRate: 16000,
});

// 5. Feed audio data (e.g., from a microphone stream)
// This library does NOT handle audio recording. You need to use an external library
// like `react-native-audio-api` to record audio and feed the raw PCM data (ArrayBuffer)
// to the recognizer.

// Example using `react-native-audio-api`:
// import { AudioRecorder } from 'react-native-audio-api';

// const recorder = new AudioRecorder({
//   sampleRate: 16000,
//   bufferLengthInSamples: 4096,
// });

// recorder.onAudioReady((event) => {
//   const bufferData = event.buffer.getChannelData(0);
//   // Ensure the data is in the correct format (e.g. pcmFloat32 or pcmInt16)
//   speechRecognition.streamInsert(bufferData.buffer);
// });

// recorder.start();

// 6. Stop recognition
speechRecognition.stop();
```

### On-Device Recognition (Android)

To use on-device recognition on Android, you might need to download the model first.

```typescript
const locale = 'en-US';
const supported = await SpeechRecognition.getSupportedLocales();

if (!supported.installedLocales.includes(locale)) {
  const result = await SpeechRecognition.downloadOnDeviceModel(locale, (progress) => {
    console.log(`Download progress: ${progress * 100}%`);
  });
  
  if (result.status === 'download_success') {
    console.log('Model downloaded successfully');
  }
}

speechRecognition.start({
  locale,
  requiresOnDeviceRecognition: true,
  // ... other options
});
```

## API Reference

### `SpeechRecognition`

The main class for managing speech recognition sessions.

#### Methods

- `start(options: SpeechRecognitionOptions): void`: Starts the speech recognition session.
- `stop(): void`: Stops the speech recognition session.
- `streamInsert(buffer: ArrayBuffer): void`: Feeds audio data into the recognizer.
- `on(event: EventType, listener: Function): void`: Registers an event listener.
- `unsubscribeAll(): void`: Unsubscribes all listeners.

#### Static Methods

- `isRecognitionAvailable(): boolean`: Checks if speech recognition is available on the device.
- `isOnDeviceRecognitionAvailable(): boolean`: Checks if on-device recognition is available.
- `downloadOnDeviceModel(locale: string, onProgress: (progress: number) => void): Promise<OnDeviceModelDownloadResult>`: Downloads the on-device model for the specified locale (Android).
- `getSupportedLocales(): Promise<SupportedLocales>`: Returns the list of supported and installed locales.
- `getPermissionsAsync(): Promise<PermissionResponse>`: Gets the current permission status.
- `requestPermissionsAsync(): Promise<PermissionResponse>`: Requests speech recognition permissions.

### `SpeechRecognitionOptions`

| Property | Type | Description |
| :--- | :--- | :--- |
| `locale` | `string` | The locale for recognition (e.g., "en-US"). |
| `interimResults` | `boolean` | Whether to return interim results. |
| `maxAlternatives` | `number` | Maximum number of alternative transcripts. |
| `requiresOnDeviceRecognition` | `boolean` | Whether to require on-device recognition. |
| `addsPunctuation` | `boolean` | Whether to add punctuation to the transcript. |
| `audioFormat` | `'pcmInt16' \| 'pcmFloat32'` | The format of the input audio buffer. |
| `sampleRate` | `number` | The sample rate of the input audio. |

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT
