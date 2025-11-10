import Foundation
import NitroModules
import Speech

typealias ResultCallback = (_ result: SpeechRecognitionResultEvent) -> Void
typealias ErrorCallback = (_ error: SpeechRecognitionErrorEvent) -> Void
typealias EventCallback = (_ eventType: EventType) -> Void

class HybridNitroSpeechRecognition: HybridNitroSpeechRecognitionSpec {
  private var options: SpeechRecognitionOptions?
  private var onResult: ResultCallback?
  private var onError: ErrorCallback?
  private var onEvent: EventCallback?

  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  // Whether the recognizer has been stopped by the user or the timer has timed out
  private var stoppedListening = false

  // Hack for iOS 18 to detect final results
  // See: https://forums.developer.apple.com/forums/thread/762952 for more info
  // This is a temporary workaround until the issue is fixed in a future iOS release
  var hasSeenFinalResult: Bool = false

  // Hack for iOS 18 to avoid sending a "nomatch" event after the final-final result
  // Example event order emitted in iOS 18:
  // [
  //   { isFinal: false, transcripts: ["actually", "final", "results"], metadata: { duration: 1500 } },
  //   { isFinal: true, transcripts: [] }
  // ]
  var previousResult: SFSpeechRecognitionResult?

  override init() {
    recognizer = SFSpeechRecognizer()
  }

  func start(options: SpeechRecognitionOptions, onResult: @escaping ResultCallback, onError: @escaping ErrorCallback, onEvent: @escaping EventCallback) throws {
    Task { @MainActor in
      do {
        reset()

        self.options = options
        self.onResult = onResult
        self.onError = onError
        self.onEvent = onEvent

        let currentLocale = recognizer?.locale.identifier

        if recognizer == nil || currentLocale != options.locale {
          guard let locale = resolveLocale(options.locale) else {
            throw SpeechRecognitionError.invalidLocale
          }

          recognizer = SFSpeechRecognizer(locale: locale)
        }

        guard let recognizer else {
          throw SpeechRecognitionError.nilRecognizer
        }

        guard recognizer.isAvailable else {
          throw SpeechRecognitionError.recognizerIsUnavailable
        }

        if !(options.requiresOnDeviceRecognition ?? false) {
          guard SFSpeechRecognizer.hasAuthorizationToRecognize() else {
            throw SpeechRecognitionError.invalidLocale
          }
        }

        let request = Self.prepareRequest(
          options: options,
          recognizer: recognizer
        )
        self.request = request

        task = recognizer.recognitionTask(with: request, resultHandler: { [weak self] result, error in
          self?.recognitionHandler(options: options, result: result, error: error)
        })

        onEvent(.start)
      } catch {
        handleError(error)
        reset(andEmitEnd: true)
      }
    }
  }

  func stop() throws {
    Task {
      let taskState = task?.state
      // Check if the recognizer is running
      // If it is, then just run the stopListening function
      if taskState == .running || taskState == .starting {
        stopListening()
      } else {
        // Task isn't likely running, just reset and emit an end event
        reset(andEmitEnd: true)
      }
    }
  }

  func streamInsert(buffer: NitroModules.ArrayBuffer) throws {
    guard let request = request as? SFSpeechAudioBufferRecognitionRequest else {
      return
    }

    guard let options else {
      return
    }

    guard let audioFormat = AVAudioFormat(
      commonFormat: options.audioFormat.avAudioFormat,
      sampleRate: options.sampleRate,
      channels: 1,
      interleaved: false
    ) else {
      throw SpeechRecognitionError.audioCapture
    }

    let bufData = buffer.data
    let length = buffer.size
    let frameCount = AVAudioFrameCount(length / Int(audioFormat.streamDescription.pointee.mBytesPerFrame))

    guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: frameCount) else {
      throw SpeechRecognitionError.audioCapture
    }
    pcmBuffer.frameLength = frameCount
    let audioBuffer = pcmBuffer.audioBufferList.pointee.mBuffers
    memcpy(audioBuffer.mData, bufData, length)

    request.append(pcmBuffer)
  }

  func isRecognitionAvailable() throws -> Bool {
    let recognizer = SFSpeechRecognizer()
    return recognizer?.isAvailable ?? false
  }

  func isOnDeviceRecognitionAvailable() throws -> Bool {
    let recognizer = SFSpeechRecognizer()
    return recognizer?.supportsOnDeviceRecognition ?? false
  }

  func downloadOnDeviceModel(locale: String, onDownloadProgress: @escaping (Double) -> Void) throws -> NitroModules.Promise<OnDeviceModelDownloadResult> {
    return Promise.rejected(withError: SpeechRecognitionError.unsupported)
  }

  func getSupportedLocales() throws -> NitroModules.Promise<SupportedLocales> {
    let supportedLocales = SFSpeechRecognizer.supportedLocales().map { $0.identifier }.sorted()

    // On iOS, the installed locales are the same as the supported locales
    let installedLocales = supportedLocales

    return Promise.resolved(withResult: .init(locales: supportedLocales, installedLocales: installedLocales))
  }

  func getPermissionsAsync() throws -> NitroModules.Promise<PermissionResponse> {
    let status = SFSpeechRecognizer.authorizationStatus()
    return Promise.resolved(withResult: status.permissionResponse)
  }

  func requestPermissionsAsync() throws -> NitroModules.Promise<PermissionResponse> {
    return Promise.async {
      await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
          continuation.resume(returning: status.permissionResponse)
        }
      }
    }
  }

  private func resolveLocale(_ localeIdentifier: String) -> Locale? {
    // The supportedLocales() method returns the locales in the format with dashes, e.g. "en-US"
    // However, we shouldn't mind if the user passes in the locale with underscores, e.g. "en_US"
    let normalizedIdentifier = localeIdentifier.replacingOccurrences(of: "_", with: "-")
    let localesToCheck = [localeIdentifier, normalizedIdentifier]
    let supportedLocales = SFSpeechRecognizer.supportedLocales()

    for identifier in localesToCheck {
      if supportedLocales.contains(where: { $0.identifier == identifier }) {
        return Locale(identifier: identifier)
      }
    }

    return nil
  }

  private func stopListening() {
    // Prevent double entry
    // e.g. when the user presses the stop button twice
    // or timer timeout + user interaction
    if stoppedListening {
      return
    }
    stoppedListening = true
    if let request = request as? SFSpeechAudioBufferRecognitionRequest {
      request.endAudio()
    }

    task?.finish()
  }

  private func reset(andEmitEnd: Bool = false) {
    let taskWasRunning = task != nil
    let shouldEmitEndEvent = andEmitEnd || taskWasRunning || stoppedListening

    stoppedListening = false
    task?.cancel()
    request = nil
    task = nil

    previousResult = nil
    hasSeenFinalResult = false

    if shouldEmitEndEvent {
      onEvent?(.end)
    }

    onResult = nil
    onError = nil
    onEvent = nil
  }

  private func handleError(_ error: Error) {
    if let speechRecognitionError = error as? SpeechRecognitionError {
      onError?(SpeechRecognitionErrorEvent(name: speechRecognitionError.name, message: speechRecognitionError.message, code: nil))
      return
    }

    // Other errors thrown by SFSpeechRecognizer / SFSpeechRecognitionTask

    /*
     Error Code | Error Domain | Description
     102 | kLSRErrorDomain | Assets are not installed.
     201 | kLSRErrorDomain | Siri or Dictation is disabled.
     300 | kLSRErrorDomain | Failed to initialize recognizer.
     301 | kLSRErrorDomain | Request was canceled.
     203 | kAFAssistantErrorDomain | Failure occurred during speech recognition.
     1100 | kAFAssistantErrorDomain | Trying to start recognition while an earlier instance is still active.
     1101 | kAFAssistantErrorDomain | Connection to speech process was invalidated.
     1107 | kAFAssistantErrorDomain | Connection to speech process was interrupted.
     1110 | kAFAssistantErrorDomain | Failed to recognize any speech.
     1700 | kAFAssistantErrorDomain | Request is not authorized.
     */
    let nsError = error as NSError
    let errorCode = nsError.code

    let errorTypes: [(codes: [Int], code: String, message: String)] = [
      (
        [102, 201], "service-not-allowed",
        "Assets are not installed, Siri or Dictation is disabled."
      ),
      ([203], "audio-capture", "Failure occurred during speech recognition."),
      ([1100], "busy", "Trying to start recognition while an earlier instance is still active."),
      ([1101, 1107], "network", "Connection to speech process was invalidated or interrupted."),
      ([1110], "no-speech", "No speech was detected."),
      ([1700], "not-allowed", "Request is not authorized."),
    ]

    for (codes, code, message) in errorTypes {
      if codes.contains(errorCode) {
        // Handle nomatch error for the underlying error:
        // +[AFAggregator logDictationFailedWithErrr:] Error Domain=kAFAssistantErrorDomain Code=203 "Retry" UserInfo={NSLocalizedDescription=Retry, NSUnderlyingError=0x600000d0ca50 {Error Domain=SiriSpeechErrorDomain Code=1 "(null)"}}
        if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
          if errorCode == 203, underlyingError.domain == "SiriSpeechErrorDomain",
             underlyingError.code == 1
          {
            onEvent?(.nomatch)
          } else {
            onError?(SpeechRecognitionErrorEvent(name: code, message: message, code: Double(errorCode)))
          }
        } else {
          onError?(SpeechRecognitionErrorEvent(name: code, message: message, code: Double(errorCode)))
        }
        return
      }
    }

    // Unknown error (but not a canceled request)
    if errorCode != 301 {
      onError?(SpeechRecognitionErrorEvent(name: "audio-capture", message: error.localizedDescription, code: Double(errorCode)))
    }
  }

  private static func prepareRequest(
    options: SpeechRecognitionOptions,
    recognizer: SFSpeechRecognizer
  ) -> SFSpeechRecognitionRequest {
    let request = SFSpeechAudioBufferRecognitionRequest()

    request.shouldReportPartialResults = options.interimResults

    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = options.requiresOnDeviceRecognition ?? false
    }

    if #available(iOS 16, *) {
      request.addsPunctuation = options.addsPunctuation
    }

    return request
  }

  private nonisolated func recognitionHandler(
    options: SpeechRecognitionOptions,
    result: SFSpeechRecognitionResult?,
    error: Error?
  ) {
    // When a final result is returned, we should expect the task to be idle or stopping
    let receivedFinalResult = result?.isFinal ?? false
    let receivedError = error != nil

    // Hack for iOS 18 to detect final results
    // See: https://forums.developer.apple.com/forums/thread/762952 for more info
    // This can be emitted multiple times during a continuous session, unlike `result.isFinal` which is only emitted once
    var receivedFinalLikeResult: Bool = receivedFinalResult
    if #available(iOS 18.0, *), !receivedFinalLikeResult {
      receivedFinalLikeResult = result?.speechRecognitionMetadata?.speechDuration ?? 0 > 0
    }

    let shouldEmitResult = receivedFinalResult || options.interimResults || receivedFinalLikeResult

    if let result: SFSpeechRecognitionResult, shouldEmitResult {
      let taskState = task?.state
      if taskState != .none {
        handleRecognitionResult(result, maxAlternatives: Int(options.maxAlternatives))
      }
    }

    if let error: Error {
      // TODO: don't emit no-speech if there were already interim results
      // Don't emit any errors after the task has finished
      if task != nil {
        handleError(error)
      }
    }

    if receivedError || receivedFinalResult {
      reset()
      return
    }
  }

  private func handleRecognitionResult(_ result: SFSpeechRecognitionResult, maxAlternatives: Int) {
    var results: [SpeechRecognitionResult] = []

    // Limit the number of transcriptions to the maxAlternatives
    let transcriptionSubsequence = result.transcriptions.prefix(maxAlternatives)

    var isFinal = result.isFinal

    // Hack for iOS 18 to detect final results
    // See: https://forums.developer.apple.com/forums/thread/762952 for more info
    // This is a temporary workaround until the issue is fixed in a future iOS release
    if #available(iOS 18.0, *), !isFinal {
      isFinal = result.speechRecognitionMetadata?.speechDuration ?? 0 > 0
    }

    for transcription in transcriptionSubsequence {
      var transcript = transcription.formattedString

      // Prepend an empty space if the hacky workaround is applied
      // So that the user can append the transcript to the previous result,
      // matching the behavior of Android & Web Speech API
      if hasSeenFinalResult {
        transcript = " " + transcription.formattedString
      }

      let confidence =
        transcription.segments.map { $0.confidence }.reduce(0, +)
          / Float(transcription.segments.count)

      let item = SpeechRecognitionResult(
        transcript: transcript,
        confidence: Double(confidence)
      )

      if !transcription.formattedString.isEmpty {
        results.append(item)
      }
    }

    // Apply the "workaround"
    if #available(iOS 18.0, *), !result.isFinal, isFinal {
      hasSeenFinalResult = true
    }

    if isFinal, results.isEmpty {
      // Hack for iOS 18 to avoid sending a "nomatch" event after the final-final result
      var previousResultWasFinal = false
      var previousResultHadTranscriptions = false
      if #available(iOS 18.0, *), let previousResult {
        previousResultWasFinal = previousResult.speechRecognitionMetadata?.speechDuration ?? 0 > 0
        previousResultHadTranscriptions = !previousResult.transcriptions.isEmpty
      }

      if !previousResultWasFinal || !previousResultHadTranscriptions {
        // https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/nomatch_event
        // The nomatch event of the Web Speech API is fired
        // when the speech recognition service returns a final result with no significant recognition.
        onEvent?(.nomatch)
        return
      }
    }

    onResult?(SpeechRecognitionResultEvent(isFinal: isFinal, results: results))
    previousResult = result
  }
}

extension SFSpeechRecognizer {
  static func hasAuthorizationToRecognize() -> Bool {
    let status = authorizationStatus()
    return status == .authorized
  }

  static func requestPermissions() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
  }
}

extension SFSpeechRecognizerAuthorizationStatus {
  var permissionResponse: PermissionResponse {
    let status = SFSpeechRecognizer.authorizationStatus()
    let canAskAgain = (status == .notDetermined)
    let granted = (status == .authorized)
    var permissionStatus = PermissionStatus.undetermined
    switch status {
      case .authorized:
        permissionStatus = PermissionStatus.granted

      case .denied, .restricted:
        permissionStatus = PermissionStatus.denied

      case .notDetermined:
        permissionStatus = PermissionStatus.undetermined

      default:
        permissionStatus = PermissionStatus.undetermined
    }

    return .init(canAskAgain: canAskAgain, granted: granted, status: permissionStatus)
  }
}

extension AudioFormat {
  var avAudioFormat: AVAudioCommonFormat {
    switch self {
      case .pcmint16:
        return .pcmFormatInt16

      case .pcmfloat32:
        return .pcmFormatFloat32

      @unknown default:
        fatalError("Unsupported audio format")
    }
  }
}
