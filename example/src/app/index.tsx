import { observable } from "@legendapp/state";
import { Memo } from "@legendapp/state/react";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AudioManager, AudioRecorder } from "react-native-audio-api";
import {
  SpeechRecognition,
  type SupportedLocales,
} from "react-native-nitro-speech-recognition";

const locale = "en-US";

interface State {
  transcript: string;
  interimTranscript: string;
}

const state$ = observable<State>({
  transcript: "",
  interimTranscript: "",
});

export default function Page() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 8,
      }}
    >
      <SupportedLocalesSection />
      <Text>Transcript:</Text>
      <Memo>
        {() => (
          <Text>{`${state$.transcript.get()}${state$.interimTranscript.get()}`}</Text>
        )}
      </Memo>
      <Pressable
        style={{
          backgroundColor: "lightblue",
          padding: 16,
        }}
        onPress={async () => {
          try {
            await checkPermission();
            await startSpeechRecognition();
            state$.transcript.set("");
            state$.interimTranscript.set("");
            startRecording();
          } catch (error) {
            console.error(error);
          }
        }}
      >
        <Text>Start Recording</Text>
      </Pressable>
      <Pressable
        style={{
          backgroundColor: "lightblue",
          padding: 16,
        }}
        onPress={() => {
          try {
            stopRecording();
            stopSpeechRecognition();
          } catch (error) {
            Alert.alert(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <Text>Stop Recording</Text>
      </Pressable>
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
    <View style={{ paddingHorizontal: 16, alignItems: "center" }}>
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

function startRecording() {
  if (recorder) {
    recorder.disconnect();
    recorder = null;
  }

  recorder = new AudioRecorder({
    sampleRate: 16_000,
    bufferLengthInSamples: 4096,
  });
  recorder.onAudioReady((event) => {
    const pcm = floatTo16BitPCM(event.buffer.getChannelData(0));
    speechRecognition.streamInsert(pcm.buffer as ArrayBuffer);
  });
  recorder.start();
}

function stopRecording() {
  recorder?.stop();
  recorder?.disconnect();
  recorder = null;
}

const speechRecognition = new SpeechRecognition();

async function startSpeechRecognition() {
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

  const clearInterimTranscript = () => {
    state$.interimTranscript.set("");
  };

  speechRecognition.on("result", (event) => {
    console.log({
      event,
    });
    const transcript = event.results[0]?.transcript;
    if (!transcript) {
      return;
    }

    if (event.isFinal) {
      setTranscript(transcript);
    } else {
      clearInterimTranscript();
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
    requiresOnDeviceRecognition: false,
    addsPunctuation: true,
  });
}

function stopSpeechRecognition() {
  speechRecognition.stop();
  speechRecognition.unsubscribeAll();
}

function floatTo16BitPCM(float32Array: Float32Array): DataView {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]!));
    view.setInt16(offset, s < 0 ? s * 0x80_00 : s * 0x7f_ff, true);
  }
  return view;
}
