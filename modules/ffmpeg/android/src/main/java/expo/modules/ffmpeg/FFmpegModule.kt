package expo.modules.ffmpeg

import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.Level
import com.arthenica.ffmpegkit.ReturnCode
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_LOG_CHARS = 400_000

class FFmpegSessionNotFound(key: String) :
  CodedException("ERR_FFMPEG_SESSION", "No running FFmpeg session with key '$key'", null)

class SpeechFailed(message: String) : CodedException("ERR_TTS", message, null)

/**
 * Thin, progress-aware bridge over ffmpeg-kit.
 *
 * Everything above this layer (filter graphs, subtitle burn-in, audio ducking)
 * is plain TypeScript that builds argument arrays — this module only has to run
 * them, stream progress back, and hand the logs over for parsing.
 */
class FFmpegModule : Module() {
  private val sessions = ConcurrentHashMap<String, FFmpegSession>()
  private val cancelled = ConcurrentHashMap<String, AtomicBoolean>()
  private var tts: TextToSpeech? = null

  override fun definition() = ModuleDefinition {
    Name("SarFFmpeg")

    Events("onProgress")

    OnCreate {
      FFmpegKitConfig.setLogLevel(Level.AV_LOG_INFO)
      // ffmpeg-kit keeps every finished session in memory otherwise, which adds
      // up fast when a project is re-rendered a dozen times.
      FFmpegKitConfig.setSessionHistorySize(10)
    }

    OnDestroy {
      sessions.values.forEach { FFmpegKit.cancel(it.sessionId) }
      sessions.clear()
      cancelled.clear()
      tts?.shutdown()
      tts = null
    }

    /**
     * Runs one ffmpeg invocation.
     *
     * @param key          caller supplied id, used for progress events + cancel
     * @param args         argv for ffmpeg, already split (no shell quoting games)
     * @param totalMs      expected output duration, used to turn ffmpeg's
     *                     `out_time` into a 0..1 progress fraction
     */
    AsyncFunction("run") { key: String, args: List<String>, totalMs: Double, promise: Promise ->
      val flag = AtomicBoolean(false)
      cancelled[key] = flag
      val startedAt = System.currentTimeMillis()

      val session = FFmpegKit.executeWithArgumentsAsync(
        args.toTypedArray(),
        { completed ->
          sessions.remove(key)
          cancelled.remove(key)
          val rc: ReturnCode? = completed.returnCode
          val logs = completed.allLogsAsString ?: ""
          promise.resolve(
            mapOf(
              "returnCode" to (rc?.value ?: -1),
              "success" to ReturnCode.isSuccess(rc),
              "cancelled" to (ReturnCode.isCancel(rc) || flag.get()),
              "state" to completed.state.toString(),
              "durationMs" to (System.currentTimeMillis() - startedAt).toDouble(),
              "logs" to if (logs.length > MAX_LOG_CHARS) logs.takeLast(MAX_LOG_CHARS) else logs,
              "failStackTrace" to (completed.failStackTrace ?: "")
            )
          )
        },
        { /* log callback: logs are collected on the session itself */ },
        { statistics ->
          val timeMs = statistics.time.toDouble()
          sendEvent(
            "onProgress",
            mapOf(
              "key" to key,
              "timeMs" to timeMs,
              "progress" to if (totalMs > 0) (timeMs / totalMs).coerceIn(0.0, 1.0) else 0.0,
              "speed" to statistics.speed,
              "fps" to statistics.videoFps.toDouble(),
              "frame" to statistics.videoFrameNumber.toDouble(),
              "bitrate" to statistics.bitrate,
              "sizeBytes" to statistics.size.toDouble()
            )
          )
        }
      )
      sessions[key] = session
    }

    AsyncFunction("cancel") { key: String ->
      cancelled[key]?.set(true)
      val session = sessions[key] ?: throw FFmpegSessionNotFound(key)
      FFmpegKit.cancel(session.sessionId)
      true
    }

    AsyncFunction("cancelAll") {
      cancelled.values.forEach { it.set(true) }
      FFmpegKit.cancel()
      true
    }

    /** Full ffprobe payload for a file, returned as a JSON string for the JS side to parse. */
    AsyncFunction("probe") { path: String, promise: Promise ->
      FFprobeKit.getMediaInformationAsync(path) { session ->
        val info = session.mediaInformation
        if (info == null) {
          promise.resolve(mapOf("ok" to false, "json" to "", "logs" to (session.allLogsAsString ?: "")))
        } else {
          promise.resolve(
            mapOf(
              "ok" to true,
              "json" to info.allProperties.toString(),
              "logs" to ""
            )
          )
        }
      }
    }

    /**
     * Registers directories that libass/fontconfig should scan, plus an optional
     * "family name in the .ass file" -> "font file name" mapping. Called once on
     * boot with /system/fonts and the app's own imported-fonts directory.
     */
    AsyncFunction("registerFontDirectories") { dirs: List<String>, mapping: Map<String, String> ->
      val existing = dirs.filter { File(it).isDirectory }
      FFmpegKitConfig.setFontDirectoryList(appContext.reactContext!!, existing, mapping)
      existing
    }

    /**
     * Voices the device can speak with, offline and at no cost. The engine is
     * whatever the user has installed, so the list differs between phones.
     */
    AsyncFunction("listSpeechVoices") { promise: Promise ->
      withTts(promise) { engine ->
        val voices = engine.voices.orEmpty()
          .sortedBy { it.locale.toLanguageTag() }
          .map { voice ->
            mapOf(
              "id" to voice.name,
              "language" to voice.locale.toLanguageTag(),
              "quality" to voice.quality,
              "networkRequired" to voice.isNetworkConnectionRequired
            )
          }
        promise.resolve(voices)
      }
    }

    /**
     * Speaks text into a WAV file so it can be mixed into the render.
     *
     * `TextToSpeech.speak` would only play it aloud; synthesising to a file is
     * what makes an offline voiceover possible at all.
     */
    AsyncFunction("synthesizeSpeech") { text: String, voiceId: String?, language: String?, outputPath: String, promise: Promise ->
      withTts(promise) { engine ->
        language?.takeIf { it.isNotBlank() }?.let { engine.language = Locale.forLanguageTag(it) }
        voiceId?.takeIf { it.isNotBlank() }?.let { id ->
          engine.voices.orEmpty().firstOrNull { it.name == id }?.let { engine.voice = it }
        }

        val target = File(outputPath)
        target.parentFile?.mkdirs()
        if (target.exists()) target.delete()

        val utteranceId = "sar_${System.nanoTime()}"
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String?) = Unit

          override fun onDone(id: String?) {
            if (id != utteranceId) return
            if (target.exists() && target.length() > 44) {
              promise.resolve(mapOf("path" to target.absolutePath, "sizeBytes" to target.length().toDouble()))
            } else {
              promise.reject(SpeechFailed("Ovoz fayli yozilmadi"))
            }
          }

          @Deprecated("Kept for API levels below 21")
          override fun onError(id: String?) {
            if (id == utteranceId) promise.reject(SpeechFailed("Qurilma ovozi xato berdi"))
          }

          override fun onError(id: String?, errorCode: Int) {
            if (id == utteranceId) promise.reject(SpeechFailed("Qurilma ovozi xato berdi ($errorCode)"))
          }
        })

        val params = Bundle().apply { putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId) }
        val result = engine.synthesizeToFile(text, params, target, utteranceId)
        if (result != TextToSpeech.SUCCESS) {
          promise.reject(SpeechFailed("Qurilmada ovoz dvigateli topilmadi"))
        }
      }
    }

    Function("deviceInfo") {
      mapOf(
        "abis" to Build.SUPPORTED_ABIS.toList(),
        "sdkInt" to Build.VERSION.SDK_INT,
        "model" to Build.MODEL,
        "cores" to Runtime.getRuntime().availableProcessors()
      )
    }
  }

  /** Brings the speech engine up once, then hands it to the caller. */
  private fun withTts(promise: Promise, block: (TextToSpeech) -> Unit) {
    val existing = tts
    if (existing != null) {
      block(existing)
      return
    }

    val context = appContext.reactContext
    if (context == null) {
      promise.reject(SpeechFailed("Kontekst mavjud emas"))
      return
    }

    var engine: TextToSpeech? = null
    engine = TextToSpeech(context) { status ->
      if (status == TextToSpeech.SUCCESS) {
        tts = engine
        block(engine!!)
      } else {
        promise.reject(SpeechFailed("Qurilmada ovoz dvigateli yo‘q"))
      }
    }
  }
}
