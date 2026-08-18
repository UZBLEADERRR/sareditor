package expo.modules.ffmpeg

import android.os.Build
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_LOG_CHARS = 400_000

class FFmpegSessionNotFound(key: String) :
  CodedException("ERR_FFMPEG_SESSION", "No running FFmpeg session with key '$key'", null)

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

    Function("deviceInfo") {
      mapOf(
        "abis" to Build.SUPPORTED_ABIS.toList(),
        "sdkInt" to Build.VERSION.SDK_INT,
        "model" to Build.MODEL,
        "cores" to Runtime.getRuntime().availableProcessors()
      )
    }
  }
}
