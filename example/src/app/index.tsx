import { observable } from "@legendapp/state";
import { Memo, useValue } from "@legendapp/state/react";
import { Button } from "heroui-native";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import {
  type AudioFormat,
  SpeechRecognition,
  type SupportedLocales,
} from "react-native-nitro-speech-recognition";

import { convertPcmFloat32To16BitPcm } from "@/lib/utils";

const locale = "en-US";

interface State {
  sampleRate: number;
  isRecording: boolean;
  transcript: string;
  interimTranscript: string;
  audioFormat: AudioFormat;
}

const state$ = observable<State>({
  sampleRate: 16_000,
  isRecording: false,
  transcript: "",
  interimTranscript: "",
  audioFormat: "pcmFloat32", // default PCM format in react-native-audio-api
});

export default function Page() {
  const isRecording = useValue(state$.isRecording);

  return (
    <View className="flex-1 items-center justify-center gap-2">
      <SupportedLocalesSection />
      <Text>Transcript:</Text>
      <Memo>
        {() => (
          <Text>{`${state$.transcript.get()}${state$.interimTranscript.get()}`}</Text>
        )}
      </Memo>
      {isRecording ? (
        <Button
          isDisabled={!isRecording}
          onPress={() => {
            try {
              stopRecording();
              stopSpeechRecognition();
              state$.isRecording.set(false);
            } catch (error) {
              Alert.alert(
                error instanceof Error ? error.message : String(error)
              );
            }
          }}
        >
          Stop Recording
        </Button>
      ) : (
        <Button
          isDisabled={isRecording}
          onPress={async () => {
            try {
              await checkPermission();

              const sampleRate = state$.sampleRate.get();
              const audioFormat = state$.audioFormat.get();

              state$.transcript.set("");
              state$.interimTranscript.set("");

              await startSpeechRecognition({
                sampleRate,
                audioFormat,
              });
              startRecording({
                sampleRate,
                audioFormat,
              });
              state$.isRecording.set(true);
            } catch (error) {
              console.error(error);
              state$.isRecording.set(false);
            }
          }}
        >
          Start Recording
        </Button>
      )}
    </View>
  );
}

function SupportedLocalesSection() {
  const [locales, setLocales] = useState<SupportedLocales>({
    locales: [],
    installedLocales: [],
  });

  useEffect(() => {
    SpeechRecognition.getSupportedLocales().then(setLocales);
  }, []);

  return (
    <View className="items-center px-4">
      <Text>Supported Locales:</Text>
      <Text>{locales.locales.join(", ")}</Text>
      <Text>Installed Locales:</Text>
      <Text>{locales.installedLocales.join(", ")}</Text>
    </View>
  );
}

async function checkPermission() {
  let recordingStatus = await AudioManager.checkRecordingPermissions();
  if (recordingStatus === "Undetermined") {
    recordingStatus = await AudioManager.requestRecordingPermissions();
  }

  if (recordingStatus !== "Granted") {
    throw new Error("Recording permission not granted");
  }

  let speechStatus = await SpeechRecognition.getPermissionsAsync();
  if (speechStatus.canAskAgain) {
    speechStatus = await SpeechRecognition.requestPermissionsAsync();
  }

  if (!speechStatus.granted) {
    throw new Error("Speech recognition permission not granted");
  }
}

let recorder: AudioRecorder | null = null;

function cleanup() {
  if (recorder) {
    recorder.stop();
    recorder.disconnect();
    recorder = null;
  }
}

function startRecording({
  sampleRate,
  audioFormat,
}: {
  sampleRate: number;
  audioFormat: AudioFormat;
}) {
  cleanup();

  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "spokenAudio",
    iosOptions: ["defaultToSpeaker", "allowBluetoothA2DP"],
  });

  recorder = new AudioRecorder({
    sampleRate,
    bufferLengthInSamples: 4096,
  });
  recorder.onAudioReady((event) => {
    const bufferData = event.buffer.getChannelData(0);
    let chunk: ArrayBufferLike = bufferData.buffer;
    if (audioFormat === "pcmInt16") {
      const pcm = convertPcmFloat32To16BitPcm(bufferData);
      chunk = pcm.buffer;
    }
    speechRecognition.streamInsert(chunk as ArrayBuffer);
  });
  recorder.start();
}

function stopRecording() {
  cleanup();

  AudioManager.setAudioSessionOptions({
    iosCategory: "playback",
    iosMode: "default",
  });
}

const speechRecognition = new SpeechRecognition();

async function startSpeechRecognition({
  sampleRate,
  audioFormat,
}: {
  sampleRate: number;
  audioFormat: AudioFormat;
}) {
  if (!SpeechRecognition.isRecognitionAvailable()) {
    throw new Error("Speech recognition is not available");
  }

  if (!SpeechRecognition.isOnDeviceRecognitionAvailable()) {
    throw new Error("On-device speech recognition is not available");
  }

  const installedLocales = (await SpeechRecognition.getSupportedLocales())
    .installedLocales;
  if (!installedLocales.includes(locale)) {
    console.log("onDeviceModel not available");
    const result = await SpeechRecognition.downloadOnDeviceModel(
      locale,
      (progress) => {
        console.log(`On-device model download progress: ${progress * 100}%`);
      }
    );
    console.log(result);

    if (result.status !== "download_success") {
      throw new Error("On-device model download was canceled");
    }
  }

  if (speechRecognition) {
    speechRecognition.stop();
  }

  const setTranscript = (transcript: string) => {
    state$.transcript.set((v) => v + transcript);
    state$.interimTranscript.set("");
  };

  const setInterimTranscript = (transcript: string) => {
    state$.interimTranscript.set(transcript);
  };

  speechRecognition.on("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (!transcript) {
      return;
    }

    if (event.isFinal) {
      setTranscript(transcript);
    } else {
      setInterimTranscript(transcript);
    }
  });
  speechRecognition.on("start", () => {
    console.log("Speech recognition started");
  });
  speechRecognition.on("end", () => {
    console.log("Speech recognition ended");
  });
  speechRecognition.on("error", (error) => {
    console.error("Speech recognition error:", error);
  });
  speechRecognition.on("nomatch", () => {
    console.log("No match found");
  });
  speechRecognition.on("speechstart", () => {
    console.log("Speech started");
  });
  speechRecognition.on("speechend", () => {
    console.log("Speech ended");
  });

  speechRecognition.start({
    locale,
    interimResults: true,
    requiresOnDeviceRecognition: true,
    addsPunctuation: true,
    sampleRate,
    audioFormat,
  });
}

function stopSpeechRecognition() {
  speechRecognition.stop();
  speechRecognition.unsubscribeAll();
}
