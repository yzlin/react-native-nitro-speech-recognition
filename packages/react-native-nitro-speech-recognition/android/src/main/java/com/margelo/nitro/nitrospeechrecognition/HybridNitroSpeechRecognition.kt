package com.margelo.nitro.nitrospeechrecognition

import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.ModelDownloadListener
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.annotation.RequiresApi
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.nitrospeechrecognition.AudioFormat as AudioBufferFormat
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.Executors

typealias ResultCallback = (SpeechRecognitionResultEvent) -> Unit
typealias ErrorCallback = (SpeechRecognitionErrorEvent) -> Unit
typealias EventCallback = (EventType) -> Unit

enum class RecognitionState {
  INACTIVE, // Represents the inactive state
  STARTING,
  ACTIVE, // Represents the active state
  STOPPING,
  ERROR, // Inactive, but error occurred. Prevent dispatching any additional events until start() is called
  // Add more states as needed
}

@DoNotStrip
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class HybridNitroSpeechRecognition : HybridNitroSpeechRecognitionSpec(), RecognitionListener {
  private var speech: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private var recordingParcel: ParcelFileDescriptor? = null
  private var outputStream: ParcelFileDescriptor.AutoCloseOutputStream? = null
  private var options: SpeechRecognitionOptions? = null
  private var onResult: ResultCallback? = null
  private var onError: ErrorCallback? = null
  private var onEvent: EventCallback? = null

  var recognitionState = RecognitionState.INACTIVE


  companion object {
    private fun log(message: String) {
      Log.d("HybridNitroSpeechService", message)
    }

    private fun createSpeechRecognizer(
      options: SpeechRecognitionOptions
    ): SpeechRecognizer? {
      val context = NitroModules.applicationContext ?: throw Error("No context!")

      val value =
        when {
          options.requiresOnDeviceRecognition == true -> {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
          }

          else -> {
            SpeechRecognizer.createSpeechRecognizer(context)
          }
        }

      return value
    }

    private fun createSpeechIntent(
      options: SpeechRecognitionOptions,
      parcel: ParcelFileDescriptor
    ): Intent {
      val sampleRateInHz = options.sampleRate

      val action = RecognizerIntent.ACTION_RECOGNIZE_SPEECH
      val intent = Intent(action)

      // Optional boolean to indicate whether partial results should be returned by
      // the recognizer as the user speaks (default is false).
      // The server may ignore a request for partial results in some or all cases.
      intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, options.interimResults)

      intent.putExtra(
        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
      )

      // Feature: Confidence levels on transcript words (i.e. `results[x].segments` on the "result" event)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
      ) {
        intent.putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_CONFIDENCE, true)
        intent.putExtra(RecognizerIntent.EXTRA_REQUEST_WORD_TIMING, true)
      }

      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, parcel)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      // NOTE: SpeechRecognizer doesn't seem to be happy with AudioFormat.ENCODING_PCM_FLOAT, so here forces using PCM 16bit
      // and later convert the incoming stream
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, sampleRateInHz)
      intent.putExtra(
        RecognizerIntent.EXTRA_SEGMENTED_SESSION,
        RecognizerIntent.EXTRA_AUDIO_SOURCE,
      )

      if (options.addsPunctuation) {
        intent.putExtra(
          RecognizerIntent.EXTRA_ENABLE_FORMATTING,
          RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY
        )
      }

      // Offline recognition
      // to be used with ACTION_RECOGNIZE_SPEECH, ACTION_VOICE_SEARCH_HANDS_FREE, ACTION_WEB_SEARCH
      if (options.requiresOnDeviceRecognition == true) {
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }

      // Optional limit on the maximum number of results to return.
      // If omitted the recognizer will choose how many results to return. Must be an integer.
      intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, options.maxAlternatives)

      val locale =
        options.locale.takeIf { it.isNotEmpty() } ?: Locale.getDefault().toString()
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)

      return intent
    }
  }

  private fun stopStream() {
    try {
      recordingParcel?.close()
      recordingParcel = null
    } catch (e: IOException) {
      e.printStackTrace()
    }

    try {
      outputStream?.close()
      outputStream = null
    } catch (e: IOException) {
      e.printStackTrace()
    }
  }

  private fun teardownAndEnd(state: RecognitionState = RecognitionState.INACTIVE) {
    recognitionState = RecognitionState.STOPPING
    mainHandler.post {
      try {
        speech?.cancel()
        stopStream()
      } catch (e: Exception) {
        // do nothing
      }
      speech?.destroy()
      onEvent?.invoke(EventType.END)
      recognitionState = state
    }
  }

  private fun getErrorInfo(errorCode: Int): SpeechRecognitionErrorEvent {
    // Mapped to error
    // https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
    val name: String =
      when (errorCode) {
        // Audio recording error.
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_CLIENT -> "client"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "service-not-allowed"
        SpeechRecognizer.ERROR_NETWORK -> "network"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
        SpeechRecognizer.ERROR_NO_MATCH -> "no-speech"
        SpeechRecognizer.ERROR_SERVER -> "network"
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language-not-supported"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "language-not-supported"
        // Extra codes
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech-timeout"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "too-many-requests"
        else -> "unknown"
      }

    val message: String =
      when (errorCode) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
        SpeechRecognizer.ERROR_CLIENT -> "Other client side errors."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
        SpeechRecognizer.ERROR_NETWORK -> "Other network related errors."
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network operation timed out."
        SpeechRecognizer.ERROR_NO_MATCH -> "No speech was detected."
        SpeechRecognizer.ERROR_SERVER -> "Server sent error status."
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "Server disconnected."
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Requested language is supported, but not yet downloaded."
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
          "Requested language is not available to be used with the current recognizer."
        // Extra codes/messages
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "RecognitionService busy."
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Too many requests from the same client."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input."
        else -> "Unknown error"
      }

    return SpeechRecognitionErrorEvent(name, message, errorCode.toDouble())
  }

  private fun getResults(results: Bundle?): List<SpeechRecognitionResult> {
    val resultList = mutableListOf<SpeechRecognitionResult>()
    val confidences = results?.getDoubleArray(SpeechRecognizer.CONFIDENCE_SCORES)

    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.let { matches ->
      resultList.addAll(
        matches.mapIndexed { index, transcript ->
          val confidence = confidences?.getOrNull(index) ?: 0f
          SpeechRecognitionResult(transcript, confidence.toDouble())
        },
      )
    }

    return resultList
  }

  override fun start(
    options: SpeechRecognitionOptions,
    onResult: ResultCallback,
    onError: ErrorCallback,
    onEvent: EventCallback
  ) {
    this.options = options
    this.onResult = onResult
    this.onError = onError
    this.onEvent = onEvent

    mainHandler.post {
      speech?.destroy()
      stopStream()
      recognitionState = RecognitionState.STARTING

      try {
        val pipe = ParcelFileDescriptor.createPipe()
        val parcel = pipe[0]
        recordingParcel = parcel
        outputStream = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
        val intent = createSpeechIntent(options, parcel)
        speech = createSpeechRecognizer(options)

        speech?.setRecognitionListener(this)
        speech?.startListening(intent)

        onEvent(EventType.START)
      } catch (e: Exception) {
        val errorMessage = e.localizedMessage ?: e.message ?: "Unknown error"
        e.printStackTrace()
        log("Failed to create Speech Recognizer with error: $errorMessage")
        onError(
          SpeechRecognitionErrorEvent(
            "audio-capture",
            errorMessage,
            (-1).toDouble()
          )
        )
        teardownAndEnd()
        throw e
      }
    }
  }

  override fun stop() {
    mainHandler.post {
      recognitionState = RecognitionState.STOPPING
      try {
        speech?.stopListening()
      } catch (e: Exception) {
        // do nothing
      }
    }
  }

  override fun streamInsert(buffer: ArrayBuffer) {
    val options = this.options ?: return
    val outputStream = this.outputStream ?: return

    var bytes = buffer.toByteArray()
    if (options.audioFormat == AudioBufferFormat.PCMFLOAT32) {
      bytes = convertFloat32ToPCM16(bytes)
    }

    outputStream.write(bytes)
    outputStream.flush()
  }

  override fun isRecognitionAvailable(): Boolean {
    val context = NitroModules.applicationContext ?: throw Error("No context!")

    return SpeechRecognizer.isRecognitionAvailable(context)
  }

  override fun isOnDeviceRecognitionAvailable(): Boolean {
    val context = NitroModules.applicationContext ?: throw Error("No context!")

    return SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
  }

  var isDownloadingModel = false

  override fun downloadOnDeviceModel(
    locale: String,
    onDownloadProgress: (Double) -> Unit
  ): Promise<OnDeviceModelDownloadResult> {
    return Promise.async {
      if (isDownloadingModel) {
        throw Error("An offline model download is already in progress.")
      }

      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)

      val context = NitroModules.applicationContext ?: throw Error("No context!")

      // API 33 (Android 13) -- Trigger the model download but resolve immediately
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        mainHandler.post {
          val recognizer =
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
          recognizer.triggerModelDownload(intent)
        }

        return@async OnDeviceModelDownloadResult(
          OnDeviceModelDownloadStatus.OPENED_DIALOG,
          "Opened the model download dialog."
        )
      }

      val promise = Promise<OnDeviceModelDownloadResult>()

      // API 34+ (Android 14+) -- Trigger the model download and listen to the progress
      isDownloadingModel = true
      mainHandler.post {
        val recognizer =
          SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer.triggerModelDownload(
          intent,
          Executors.newSingleThreadExecutor(),
          object : ModelDownloadListener {
            override fun onProgress(progress: Int) {
              onDownloadProgress(progress.toDouble() / 100.0)
            }

            override fun onSuccess() {
              isDownloadingModel = false
              recognizer.destroy()
              promise.resolve(
                OnDeviceModelDownloadResult(
                  OnDeviceModelDownloadStatus.DOWNLOAD_SUCCESS,
                  "On device model download completed successfully."
                )
              )
            }

            override fun onScheduled() {
              promise.resolve(
                OnDeviceModelDownloadResult(
                  OnDeviceModelDownloadStatus.DOWNLOAD_CANCELED,
                  "On device model download was canceled"
                )
              )
            }

            override fun onError(error: Int) {
              isDownloadingModel = false
              recognizer.destroy()
              promise.reject(Error("Failed to download offline model download with error: $error"))
            }
          },
        )
      }

      return@async promise.await()
    }
  }

  override fun getSupportedLocales(): Promise<SupportedLocales> {
    val context = NitroModules.applicationContext ?: throw Error("No context!")
    if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
      return Promise.async {
        SupportedLocales(arrayOf(), arrayOf())
      }
    }

    val promise = Promise<SupportedLocales>()
    var didResolve = false

    mainHandler.post {
      val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)

      recognizer.checkRecognitionSupport(intent, Executors.newSingleThreadExecutor(), object :
        RecognitionSupportCallback {
        override fun onSupportResult(recognitionSupport: RecognitionSupport) {
          log("onSupportResult() called with recognitionSupport: $recognitionSupport")
          // Seems to get called twice when using `createSpeechRecognizer()`
          if (didResolve) {
            return
          }
          didResolve = true
          // These languages are supported but need to be downloaded before use.
          val installedLocales = recognitionSupport.installedOnDeviceLanguages

          val locales =
            recognitionSupport.supportedOnDeviceLanguages
              .union(installedLocales)
              .union(recognitionSupport.onlineLanguages)
              .sorted()
          promise.resolve(SupportedLocales(locales.toTypedArray(), installedLocales.toTypedArray()))
          recognizer.destroy()
        }

        override fun onError(error: Int) {
          log("getSupportedLocales.onError() called with error code: $error")
          // This is a workaround for when both the onSupportResult and onError callbacks are called
          // This occurs when providing some packages such as com.google.android.tts
          // com.samsung.android.bixby.agent usually errors though
          mainHandler.postDelayed({
            if (didResolve) {
              return@postDelayed
            }
            promise.reject(Error("Failed to retrieve supported locales with error: $error"))
          }, 50)

          recognizer.destroy()
        }
      })
    }

    return promise
  }

  override fun getPermissionsAsync(): Promise<PermissionResponse> {
    return Promise.resolved(PermissionResponse(false, true, PermissionStatus.GRANTED))
  }

  override fun requestPermissionsAsync(): Promise<PermissionResponse> {
    return Promise.resolved(PermissionResponse(false, true, PermissionStatus.GRANTED))
  }

  override fun dispose() {
    super.dispose()

    // prevent from sending any events
    this.onResult = null
    this.onError = null
    this.onEvent = null
    teardownAndEnd()
  }

  override fun onBeginningOfSpeech() {
    onEvent?.invoke(EventType.SPEECHSTART)
  }

  override fun onBufferReceived(p0: ByteArray?) {
  }

  override fun onEndOfSpeech() {
    onEvent?.invoke(EventType.SPEECHEND)
    log("onEndOfSpeech()")
  }

  override fun onError(errorCode: Int) {
    // Web Speech API:
    // https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/nomatch_event
    if (errorCode == SpeechRecognizer.ERROR_NO_MATCH) {
      onEvent?.invoke(EventType.NOMATCH)
    }

    val error = getErrorInfo(errorCode)
    onError?.invoke(error)
    teardownAndEnd(RecognitionState.ERROR)
    log("onError() - ${error.name}: ${error.message} - code: $errorCode")
  }

  override fun onEvent(eventType: Int, params: Bundle?) {
    // reserved for future events
  }

  override fun onPartialResults(partialResults: Bundle?) {
    val partialResultsList = getResults(partialResults)
    // Avoid sending result event if there was an empty result, or the first result is an empty string
    val resultsList = partialResultsList.filter { it.transcript.isNotEmpty() }

    log("onPartialResults(), results: $resultsList")
    if (resultsList.isNotEmpty()) {
      onResult?.invoke(SpeechRecognitionResultEvent(false, resultsList.toTypedArray()))
    }
  }

  override fun onReadyForSpeech(params: Bundle?) {
    // Avoid sending this event if there was an error
    // An error may preempt this event in the case of a permission error or a language not supported error
    if (recognitionState != RecognitionState.ERROR) {
      onEvent?.invoke(EventType.START)
      recognitionState = RecognitionState.ACTIVE
    }
  }

  override fun onResults(results: Bundle?) {
    val resultsList = getResults(results)

    if (resultsList.isEmpty()) {
      // https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/nomatch_event
      // The nomatch event of the Web Speech API is fired
      // when the speech recognition service returns a final result with no significant recognition.
      onEvent?.invoke(EventType.NOMATCH)
    } else {
      onResult?.invoke(SpeechRecognitionResultEvent(true, resultsList.toTypedArray()))
    }
    log("onResults(), results: $resultsList")

    teardownAndEnd()
  }

  /**
   * For API 33: Basically same as onResults but doesn't stop
   */
  override fun onSegmentResults(segmentResults: Bundle) {
    val resultsList = getResults(segmentResults)
    if (resultsList.isEmpty()) {
      onEvent?.invoke(EventType.NOMATCH)
    } else {
      onResult?.invoke(SpeechRecognitionResultEvent(true, resultsList.toTypedArray()))
    }
    log("onSegmentResults(), transcriptions: $resultsList")

    // If the user opted to stop
    if (recognitionState == RecognitionState.STOPPING) {
      teardownAndEnd()
    }
  }

  override fun onEndOfSegmentedSession() {
    log("onEndOfSegmentedSession()")
    teardownAndEnd()
  }

  override fun onRmsChanged(p0: Float) {
    // for future implementation on volume change
  }
}

fun convertFloat32ToPCM16(float32Data: ByteArray): ByteArray {
  val floatBuffer = ByteBuffer.wrap(float32Data)
    .order(ByteOrder.LITTLE_ENDIAN)
    .asFloatBuffer()

  val output = ByteArray(float32Data.size / 2)  // Int16 is half the size
  val outputBuffer = ByteBuffer.wrap(output)
    .order(ByteOrder.LITTLE_ENDIAN)

  while (floatBuffer.hasRemaining()) {
    val sample = floatBuffer.get()
    val clamped = sample.coerceIn(-1.0f, 1.0f)
    val int16Sample = if (clamped < 0) {
      (clamped * 0x8000).toInt().toShort()
    } else {
      (clamped * 0x7FFF).toInt().toShort()
    }
    outputBuffer.putShort(int16Sample)
  }

  return output
}