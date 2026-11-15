package org.codetether.app.ui

import android.os.SystemClock
import android.view.ViewTreeObserver
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectionMode

/** Measures the normal foreground controller. The controlling PC revokes the scoped authorization. */
@RunWith(AndroidJUnit4::class)
class RevocationTimingAcceptanceTest {
    @Test
    fun controllerRemovalAndRenderedConfirmationUseTheAndroidMonotonicClock() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("t1aRevocationTiming") == "true")
        val report = LiveAcceptanceReport()
        report.flag("passed", false)
        var stage = 0L
        try {
            val scope = LiveAcceptanceScope(arguments)
            runBlocking {
                LiveAcceptanceActivity(scope).use { activity ->
                    stage = 1
                    activity.prepare()
                    val expectedName = requireNotNull(activity.controller.state.value.computer(scope.computerId)).computer.name
                    val removedState = AtomicLong()
                    val firstDrawAfterState = AtomicLong()
                    val visibleConfirmation = AtomicLong()
                    val firstVerifiedRedraw = AtomicLong()
                    val directoryAbsent = AtomicLong()
                    LiveAcceptanceControl(report).use { control ->
                        val observer = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                        val draw = ViewTreeObserver.OnDrawListener {
                            if (control.started.get() && isExpectedRemoved(activity, expectedName)) {
                                firstDrawAfterState.compareAndSet(0L, SystemClock.elapsedRealtimeNanos())
                                if (visibleConfirmation.get() != 0L) {
                                    firstVerifiedRedraw.compareAndSet(0L, SystemClock.elapsedRealtimeNanos())
                                }
                            }
                        }
                        activity.onMain { activity.decorView.viewTreeObserver.addOnDrawListener(draw) }
                        observer.launch {
                            activity.controller.state.collect { state ->
                                if (control.started.get()) {
                                    val page = state.page as? TabletPage.Removed
                                    if (page?.computerName == expectedName) {
                                        removedState.compareAndSet(0L, SystemClock.elapsedRealtimeNanos())
                                    }
                                    if (state.computer(scope.computerId) == null) {
                                        directoryAbsent.compareAndSet(0L, SystemClock.elapsedRealtimeNanos())
                                    }
                                }
                            }
                        }
                        try {
                            report.number("control_port", control.port.toLong())
                            report.flag("scope_ready", true)
                            report.flag("relay", scope.mode == ConnectionMode.RELAY)
                            report.flag("active_connection_before_removal", activity.controller.state.value.computer(scope.computerId)?.connection != null)
                            report.publish()
                            stage = 2
                            val deadline = SystemClock.elapsedRealtime() + scope.timeoutMs
                            while (!control.finished.get()) {
                                check(SystemClock.elapsedRealtime() < deadline) { "Revocation acceptance timed out" }
                                if (removedState.get() != 0L && visibleConfirmation.get() == 0L &&
                                    removedTitleIsVisible(expectedName) && isExpectedRemoved(activity, expectedName)
                                ) {
                                    visibleConfirmation.compareAndSet(0L, SystemClock.elapsedRealtimeNanos())
                                    // Confirm a new draw after the accessibility tree contains the Removed title.
                                    activity.onMain { activity.decorView.invalidate() }
                                }
                                report.number("armed_nanos", control.startedAtNanos.get())
                                report.number("controller_removed_nanos", removedState.get())
                                report.number("first_draw_after_removed_state_nanos", firstDrawAfterState.get())
                                report.number("visible_removed_confirmed_nanos", visibleConfirmation.get())
                                report.number("first_verified_removed_redraw_nanos", firstVerifiedRedraw.get())
                                report.number("controller_directory_absent_nanos", directoryAbsent.get())
                                report.flag("visible_removed_confirmed", visibleConfirmation.get() != 0L)
                                report.flag("verified_removed_redraw", firstVerifiedRedraw.get() != 0L)
                                delay(25)
                            }
                            stage = 3
                            assertTrue("The PC must arm the scoped measurement", control.started.get())
                            assertTrue("The actual controller must show the matching Removed page", removedState.get() != 0L)
                            assertTrue("The target computer must leave the controller directory", directoryAbsent.get() != 0L)
                            assertTrue("A draw following the Removed state must be observed", firstDrawAfterState.get() != 0L)
                            assertTrue("The Removed title must be visibly confirmed", visibleConfirmation.get() != 0L)
                            assertTrue("A fresh frame must follow visible Removed confirmation", firstVerifiedRedraw.get() >= visibleConfirmation.get())
                        } finally {
                            observer.cancel()
                            activity.onMain {
                                val tree = activity.decorView.viewTreeObserver
                                if (tree.isAlive) tree.removeOnDrawListener(draw)
                            }
                        }
                    }
                }
            }
            report.flag("passed", true)
        } catch (_: Throwable) {
            throw AssertionError("Scoped revocation timing acceptance failed at stage $stage")
        } finally {
            report.number("stage", stage)
            report.publish()
        }
    }

    private fun isExpectedRemoved(activity: LiveAcceptanceActivity, name: String): Boolean =
        (activity.controller.state.value.page as? TabletPage.Removed)?.computerName == name

    private fun removedTitleIsVisible(computerName: String): Boolean {
        val title = "$computerName 已把这台平板移除"
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return false
        try {
            if (root.packageName?.toString() != instrumentation.targetContext.packageName) return false
            val nodes = root.findAccessibilityNodeInfosByText(title)
            return try {
                nodes.any { it.isVisibleToUser && it.text?.toString() == title }
            } finally {
                nodes.forEach { it.recycle() }
            }
        } finally {
            root.recycle()
        }
    }
}
