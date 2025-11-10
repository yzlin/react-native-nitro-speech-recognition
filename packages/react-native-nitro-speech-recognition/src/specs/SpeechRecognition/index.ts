import EventEmitter from "eventemitter3";
import { NitroModules } from "react-native-nitro-modules";

import type {
  NitroSpeechRecognition as NitroSpeechRecognitionModule,
  OnDeviceModelDownloadResult,
  PermissionResponse,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionOptions,
  SpeechRecognitionResultEvent,
  SupportedLocales,
} from "./NitroSpeechRecognition.nitro";

export type {
  AudioFormat,
  SupportedLocales,
} from "./NitroSpeechRecognition.nitro";

const HybridNitroSpeechRecognition =
  NitroModules.createHybridObject<NitroSpeechRecognitionModule>(
    "NitroSpeechRecognition"
  );

interface Events {
  start: [];
  end: [];
  speechstart: [];
  speechend: [];
  nomatch: [];
  soundstart: [];
  soundend: [];
  result: [result: SpeechRecognitionResultEvent];
  error: [error: SpeechRecognitionErrorEvent];
}

interface Subscription {
  remove(): void;
}

export class SpeechRecognition {
  private readonly eventEmitter = new EventEmitter<Events>();

  start({
    locale = "en-US",
    interimResults = false,
    maxAlternatives = 5,
    requiresOnDeviceRecognition = false,
    addsPunctuation = false,
    audioFormat = "pcmFloat32",
    sampleRate = 16_000,
  }: Partial<SpeechRecognitionOptions>) {
    const emitter = this.eventEmitter;
    HybridNitroSpeechRecognition.start(
      {
        locale,
        interimResults,
        maxAlternatives,
        requiresOnDeviceRecognition,
        addsPunctuation,
        audioFormat,
        sampleRate,
      },
      (result) => {
        emitter.emit("result", result);
      },
      (error) => {
        emitter.emit("error", error);
      },
      (eventType) => {
        emitter.emit(eventType);
      }
    );
  }

  stop() {
    HybridNitroSpeechRecognition.stop();
  }

  streamInsert(buffer: ArrayBuffer) {
    HybridNitroSpeechRecognition.streamInsert(buffer);
  }

  static isRecognitionAvailable(): boolean {
    return HybridNitroSpeechRecognition.isRecognitionAvailable();
  }

  static isOnDeviceRecognitionAvailable(): boolean {
    return HybridNitroSpeechRecognition.isOnDeviceRecognitionAvailable();
  }

  static getSupportedLocales(): Promise<SupportedLocales> {
    return HybridNitroSpeechRecognition.getSupportedLocales();
  }

  static downloadOnDeviceModel(
    locale: string,
    onDownloadProgress: (progress: number) => void
  ): Promise<OnDeviceModelDownloadResult> {
    return HybridNitroSpeechRecognition.downloadOnDeviceModel(
      locale,
      onDownloadProgress
    );
  }

  static getPermissionsAsync(): Promise<PermissionResponse> {
    return HybridNitroSpeechRecognition.getPermissionsAsync();
  }

  static requestPermissionsAsync(): Promise<PermissionResponse> {
    return HybridNitroSpeechRecognition.requestPermissionsAsync();
  }

  on<EventType extends keyof Events>(
    event: EventType,
    fn: (
      ...args: EventEmitter.ArgumentMap<Events>[Extract<
        EventType,
        keyof Events
      >]
    ) => void
  ) {
    this.eventEmitter.on(event, fn);
  }

  off<EventType extends keyof Events>(
    event: EventType,
    fn: (
      ...args: EventEmitter.ArgumentMap<Events>[Extract<
        EventType,
        keyof Events
      >]
    ) => void
  ) {
    this.eventEmitter.off(event, fn);
  }

  subscribe<EventType extends keyof Events>(
    event: EventType,
    fn: (
      ...args: EventEmitter.ArgumentMap<Events>[Extract<
        EventType,
        keyof Events
      >]
    ) => void
  ): Subscription {
    const emitter = this.eventEmitter;
    emitter.addListener(event, fn);

    return {
      remove: () => {
        emitter.removeListener(event, fn);
      },
    };
  }

  unsubscribeAll() {
    this.eventEmitter.removeAllListeners();
  }
}
