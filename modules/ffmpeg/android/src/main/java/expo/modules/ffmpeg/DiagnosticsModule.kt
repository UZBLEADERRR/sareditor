package expo.modules.ffmpeg

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A flight recorder for the one class of bug that is otherwise invisible here:
 * the app disappearing without leaving anything on screen.
 *
 * Two things are captured. Breadcrumbs, written straight through to disk so the
 * trail survives even a native abort that no Java handler ever sees; and the
 * stack trace of an uncaught exception, appended to the same file before the
 * process is handed back to the default handler that kills it.
 *
 * The file is rotated on every launch, so what is left after a crash is exactly
 * the session that crashed. The next launch reads it back and shows it.
 */
class DiagnosticsModule : Module() {
  private var traceFile: File? = null
  private var previous: String = ""

  private val stamp = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

  override fun definition() = ModuleDefinition {
    Name("SarDiagnostics")

    OnCreate {
      val dir = File(appContext.reactContext!!.filesDir, "diagnostics").apply { mkdirs() }
      val current = File(dir, "trace.log")
      val prior = File(dir, "trace-prev.log")

      previous = if (current.exists()) current.readText() else ""
      if (current.exists()) {
        prior.delete()
        current.renameTo(prior)
      }
      traceFile = current
      append("boot ${describeDevice()}")

      val chain = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        val out = StringWriter()
        error.printStackTrace(PrintWriter(out))
        append("FATAL on '${thread.name}': $out")
        chain?.uncaughtException(thread, error)
      }
    }

    /** One breadcrumb. Flushed immediately — a lost tail defeats the purpose. */
    Function("trace") { message: String ->
      append(message)
    }

    /** The log of the session before this one, i.e. the one that died. */
    Function("previousTrace") { previous }

    Function("currentTrace") { traceFile?.takeIf { it.exists() }?.readText() ?: "" }

    Function("deviceInfo") { deviceInfo() }
  }

  private fun append(message: String) {
    val file = traceFile ?: return
    try {
      file.appendText("${stamp.format(Date())}  $message\n")
    } catch (_: Throwable) {
      // Diagnostics must never be the thing that brings the app down.
    }
  }

  /**
   * Page size matters: a device running 16 KB pages refuses to map a shared
   * library whose segments are 4 KB aligned, and the failure looks like a
   * crash with no Java stack behind it.
   */
  private fun deviceInfo(): Map<String, Any> {
    val context = appContext.reactContext
    val memory = ActivityManager.MemoryInfo()
    (context?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)
      ?.getMemoryInfo(memory)

    return mapOf(
      "manufacturer" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "androidRelease" to Build.VERSION.RELEASE,
      "sdkInt" to Build.VERSION.SDK_INT,
      "abis" to Build.SUPPORTED_ABIS.toList(),
      "pageSizeBytes" to Os.sysconf(OsConstants._SC_PAGESIZE),
      "totalMemMb" to (memory.totalMem / (1024 * 1024)),
      "availMemMb" to (memory.availMem / (1024 * 1024)),
      "lowMemory" to memory.lowMemory
    )
  }

  private fun describeDevice(): String {
    val info = deviceInfo()
    return info.entries.joinToString(" ") { "${it.key}=${it.value}" }
  }
}
