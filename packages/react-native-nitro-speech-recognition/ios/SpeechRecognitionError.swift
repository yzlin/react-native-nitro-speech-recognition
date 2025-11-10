
enum SpeechRecognitionError: Error {
  case unsupported
  case invalidLocale
  case nilRecognizer
  case recognizerIsUnavailable
  case audioCapture

  var name: String {
    switch self {
      case .unsupported: return "unsupported"
      case .invalidLocale: return "language-not-supported"
      case .nilRecognizer: return "init"
      case .recognizerIsUnavailable: return "service-not-allowed"
      case .audioCapture: return "audio-capture"
    }
  }

  var message: String {
    switch self {
      case .unsupported: return "Unsupported"
      case .invalidLocale: return "Invalid locale"
      case .nilRecognizer:
        return "Can't initialize speech recognizer. Ensure the locale is supported by the device."
      case .recognizerIsUnavailable: return "Recognizer is unavailable"
      case .audioCapture: return "Audio capture failed"
    }
  }
}
