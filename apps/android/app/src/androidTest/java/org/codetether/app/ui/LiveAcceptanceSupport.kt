package org.codetether.app.ui

import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import kotlinx.coroutines.delay
import org.codetether.app.MainActivity
import org.codetether.app.remote.ConversationTarget
import org.json.JSONObject
import uniffi.supervisor_mobile.ConnectionMode

internal class LiveAcceptanceScope(arguments: Bundle) {
    val computerId = arguments.requiredId("t1aComputerId", "host")
    val target = ConversationTarget(
        arguments.requiredId("t1aMachineId", "machine"),
        arguments.requiredId("t1aProjectId", "proj"),
        arguments.requiredId("t1aConversationId", "conv"),
    )
    val turnId = arguments.getString("t1aTurnId")?.takeIf { it.isNotBlank() }?.also {
        check(it.matches(Regex("turn_[A-Za-z0-9_-]{6,96}"))) { "Invalid acceptance turn scope" }
    }
    val mode = when (arguments.getString("t1aMode")) {
        "DIRECT" -> ConnectionMode.DIRECT
        "RELAY" -> ConnectionMode.RELAY
        else -> throw AssertionError("An explicit DIRECT or RELAY acceptance mode is required")
    }
    val timeoutMs = (arguments.getString("t1aTimeoutSeconds")?.toLongOrNull() ?: 300L).also {
        check(it in 30L..900L) { "Acceptance timeout is outside the supported range" }
    } * 1_000L

    private fun Bundle.requiredId(name: String, prefix: String): String {
        val value = getString(name)
        check(value != null && value.matches(Regex("${prefix}_[A-Za-z0-9_-]{6,96}"))) {
            "An explicit valid acceptance scope is required"
        }
        return value
    }
}

internal class LiveAcceptanceActivity(private val scope: LiveAcceptanceScope) : Closeable {
    private val scenario = ActivityScenario.launch(MainActivity::class.java)
    lateinit var controller: TabletController
        private set
    lateinit var decorView: View
        private set

    init {
        scenario.onActivity { activity ->
            controller = ViewModelProvider(activity)[TabletController::class.java]
            decorView = activity.window.decorView
        }
    }

    suspend fun prepare() {
        val expectedTransport = if (scope.mode == ConnectionMode.DIRECT) "direct" else "relay"
        awaitAcceptance(90_000L) {
            val state = controller.state.value
            !state.busy && state.profile != null && state.computer(scope.computerId)?.workspace?.projects?.any {
                it.id == scope.target.projectId && it.machineId == scope.target.machineId
            } == true
        }
        onMain { controller.setMode(scope.mode) }
        awaitAcceptance(90_000L) {
            val state = controller.state.value
            !state.busy && state.mode == scope.mode && state.computer(scope.computerId)?.connection?.transport ==
                expectedTransport
        }
        onMain { controller.navigate(TabletPage.Conversation(scope.computerId, scope.target)) }
        awaitAcceptance(60_000L) {
            controller.state.value.detail?.conversation?.target == scope.target
        }
    }

    fun onMain(action: () -> Unit) {
        scenario.onActivity { action() }
    }

    override fun close() {
        scenario.close()
    }
}

internal suspend fun awaitAcceptance(timeoutMs: Long, condition: () -> Boolean) {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (!condition()) {
        check(SystemClock.elapsedRealtime() < deadline) { "Acceptance state did not become ready" }
        delay(25)
    }
}

/** Only numeric and boolean evidence can enter the instrumentation/logcat report. */
internal class LiveAcceptanceReport {
    private val values = linkedMapOf<String, Any>()

    @Synchronized fun number(name: String, value: Long) { values[name] = value }
    @Synchronized fun flag(name: String, value: Boolean) { values[name] = value }
    @Synchronized fun snapshot(): JSONObject = JSONObject(values.toMap())

    fun publish() {
        val snapshot = snapshot()
        val bundle = Bundle()
        for (name in snapshot.keys()) {
            when (val value = snapshot.get(name)) {
                is Boolean -> bundle.putBoolean(name, value)
                is Number -> bundle.putLong(name, value.toLong())
            }
        }
        InstrumentationRegistry.getInstrumentation().sendStatus(0, bundle)
        Log.i("T1aAcceptance", snapshot.toString())
    }
}

/** One line per connection, forwarded with adb. No application request or credential is accepted. */
internal class LiveAcceptanceControl(private val report: LiveAcceptanceReport) : Closeable {
    val started = AtomicBoolean()
    val startedAtNanos = AtomicLong()
    val finished = AtomicBoolean()
    val readDiff = AtomicBoolean()
    private val closed = AtomicBoolean()
    private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 500 }
    val port: Int get() = server.localPort
    private val worker = thread(name = "t1a-acceptance-control", isDaemon = true) {
        while (!closed.get()) {
            try {
                server.accept().use { socket ->
                    socket.soTimeout = 2_000
                    val command = socket.getInputStream().bufferedReader(Charsets.US_ASCII).readLine()
                    val received = SystemClock.elapsedRealtimeNanos()
                    val response = when (command) {
                        "CLOCK" -> JSONObject().put("ok", true).put("received_nanos", received)
                            .put("sent_nanos", SystemClock.elapsedRealtimeNanos())
                        "START" -> {
                            startedAtNanos.compareAndSet(0L, received)
                            started.set(true)
                            JSONObject().put("ok", true).put("armed_nanos", startedAtNanos.get())
                        }
                        "DIFF" -> JSONObject().put("ok", true).also { readDiff.set(true) }
                        "FINISH" -> JSONObject().put("ok", true).also { finished.set(true) }
                        "STATUS" -> report.snapshot().put("ok", true)
                        else -> JSONObject().put("ok", false)
                    }
                    socket.getOutputStream().write((response.toString() + "\n").toByteArray(Charsets.US_ASCII))
                }
            } catch (_: SocketTimeoutException) {
                // Bound a disconnected controller's lifetime without affecting the app's refresh loop.
            } catch (_: IOException) {
                if (!closed.get()) report.flag("control_io_error", true)
            }
        }
    }

    override fun close() {
        closed.set(true)
        server.close()
        worker.join(2_500L)
    }
}
