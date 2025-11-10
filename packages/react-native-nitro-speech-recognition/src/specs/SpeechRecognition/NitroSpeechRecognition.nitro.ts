import type { HybridObject } from "react-native-nitro-modules";

export interface NitroSpeechRecognition
  extends HybridObject<{ ios: "swift"; android: "kotlin" }> {
  start(
    options: SpeechRecognitionOptions,
    onResult: (result: SpeechRecognitionResultEvent) => void,
    onError: (error: SpeechRecognitionErrorEvent) => void,
    onEvent: (eventType: EventType) => void
  ): void;
  stop(): void;

  streamInsert(buffer: ArrayBuffer): void;

  isRecognitionAvailable(): boolean;
  isOnDeviceRecognitionAvailable(): boolean;
  downloadOnDeviceModel(
    locale: string,
    onDownloadProgress: (progress: number) => void
  ): Promise<OnDeviceModelDownloadResult>;

  getSupportedLocales(): Promise<SupportedLocales>;

  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
}

export interface SpeechRecognitionOptions {
  locale: string;
  interimResults: boolean;
  maxAlternatives: number;
  requiresOnDeviceRecognition?: boolean;
  addsPunctuation: boolean;
  audioFormat: AudioFormat;
  sampleRate: number;
}

export interface SpeechRecognitionResultEvent {
  isFinal: boolean;
  results: SpeechRecognitionResult[];
}

export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionErrorEvent {
  name: string;
  message: string;
  code?: number;
}

type EventType = "start" | "end" | "speechstart" | "speechend" | "nomatch";

type OnDeviceModelDownloadStatus =
  | "download_success"
  | "opened_dialog"
  | "download_canceled";

export interface OnDeviceModelDownloadResult {
  /**
   * On Android 13, the status will be "opened_dialog" indicating that the model download dialog was opened.
   * On Android 14+, the status will be "download_success" indicating that the model download was successful.
   * On Android 14+, "download_canceled" will be returned if the download was canceled by a user interaction.
   */
  status: OnDeviceModelDownloadStatus;
  message: string;
}

export interface SupportedLocales {
  locales: string[];
  installedLocales: string[];
}

export interface PermissionResponse {
  canAskAgain: boolean;
  granted: boolean;
  status: PermissionStatus;
}

export type PermissionStatus = "undetermined" | "denied" | "granted";

export type AudioFormat = "pcmInt16" | "pcmFloat32";
