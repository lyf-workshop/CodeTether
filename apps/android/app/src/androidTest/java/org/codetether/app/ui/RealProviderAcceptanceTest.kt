package org.codetether.app.ui

import android.os.SystemClock
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.codetether.app.account.TabletAccount
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.change
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.connectSupervisor

/** Observes the normal Activity/controller. The controlling PC starts the scoped real Provider Turn. */
@RunWith(AndroidJUnit4::class)
class RealProviderAcceptanceTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test
    fun scopedCodexStreamsIntoTheControllerAndProvidesCompleteDiffs() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("t1aRealProviderAcceptance") == "true")
        val report = LiveAcceptanceReport()
        report.flag("passed", false)
        var stage = 0L
        try {
            val scope = LiveAcceptanceScope(arguments)
            runBlocking {
                LiveAcceptanceActivity(scope).use { activity ->
                    stage = 1
                    activity.prepare()
                    val detail = requireNotNull(activity.controller.state.value.detail)
                    assertTrue("The scoped real Codex must expose diff capability", detail.conversation.provider == "codex" &&
                        detail.provider?.id == "codex" && detail.canShowChanges)
                    LiveAcceptanceControl(report).use { control ->
                        report.number("control_port", control.port.toLong())
                        report.flag("scope_ready", true)
                        report.flag("relay", scope.mode == ConnectionMode.RELAY)
                        report.publish()
                        stage = 2
                        val deadline = SystemClock.elapsedRealtime() + scope.timeoutMs
                        var turnId = scope.turnId
                        val messages = linkedMapOf<String, MessageGrowth>()
                        var completed = false
                        var finalDiffRead = false
                        while (!control.finished.get()) {
                            check(SystemClock.elapsedRealtime() < deadline) { "Real Provider acceptance timed out" }
                            if (control.started.get()) {
                                val current = activity.controller.state.value.detail
                                if (current?.conversation?.target == scope.target) {
                                    if (turnId == null) turnId = current.history.turns.lastOrNull { it.status == "running" }?.id
                                    val turn = current.history.turns.firstOrNull { it.id == turnId }
                                    if (turn?.status == "running" && current.conversation.status == "running") {
                                        for (message in current.history.messages.filter {
                                            it.role == "assistant" && it.status == "running" && it.turnId == turnId && it.text.isNotEmpty()
                                        }) {
                                            messages.getOrPut(message.id) { MessageGrowth(message.text) }.observe(message.text)
                                        }
                                    }
                                    completed = turn?.status == "completed"
                                    report.flag("turn_failed", turn?.status in setOf("failed", "interrupted"))
                                }
                                report.flag("turn_observed", turnId != null)
                                report.flag("turn_completed", completed)
                                val growing = messages.values.maxByOrNull { it.appendEvents }
                                report.number("running_message_count", messages.size.toLong())
                                report.number("same_message_append_events", growing?.appendEvents ?: 0L)
                                report.number("same_message_first_length", growing?.firstLength?.toLong() ?: 0L)
                                report.number("same_message_last_length", growing?.lastLength?.toLong() ?: 0L)
                                report.flag("running_text_append_only", messages.values.all { it.appendOnly })
                                if (control.readDiff.getAndSet(false) || (completed && !finalDiffRead)) {
                                    stage = 3
                                    readControllerChanges(activity, scope, report)
                                    if (completed) finalDiffRead = true
                                    report.flag("diff_ready", true)
                                    report.flag("turn_completed_on_diff", completed)
                                    report.flag("final_diff_read", finalDiffRead)
                                    report.publish()
                                    stage = 2
                                }
                            }
                            delay(25)
                        }
                        stage = 4
                        assertTrue("The PC must start the scoped acceptance window", control.started.get())
                        assertTrue("The same running assistant message must append text", messages.values.any { it.appendEvents > 0 })
                        assertTrue("Running text must remain append-only", messages.values.all { it.appendOnly })
                        assertTrue("The observed Turn must complete", completed)
                        assertTrue("The scoped completed Turn's final diff must be checked", finalDiffRead)
                    }
                }
            }
            report.flag("passed", true)
        } catch (_: Throwable) {
            throw AssertionError("Scoped real Provider acceptance failed at stage $stage")
        } finally {
            report.number("stage", stage)
            report.publish()
        }
    }

    private suspend fun readControllerChanges(
        activity: LiveAcceptanceActivity,
        scope: LiveAcceptanceScope,
        report: LiveAcceptanceReport,
    ) {
        assertTrue("Diff reads must stay on the scoped conversation", activity.controller.state.value.detail?.conversation?.target == scope.target)
        activity.onMain {
            activity.controller.dismissError()
            activity.controller.loadChanges()
        }
        awaitAcceptance(30_000L) { !activity.controller.state.value.changesLoading }
        val state = activity.controller.state.value
        assertTrue("The normal controller must finish its diff request", state.error == null &&
            state.detail?.conversation?.target == scope.target && state.changes.isNotEmpty())
        val changes = state.changes
        val lines = changes.flatMap { it.diff?.lineSequence()?.toList().orEmpty() }
        val hunks = lines.count { it.startsWith("@@ ") }
        val additions = lines.count { it.startsWith("+") && !it.startsWith("+++") }
        val deletions = lines.count { it.startsWith("-") && !it.startsWith("---") }
        report.number("controller_changed_file_count", changes.size.toLong())
        report.number("controller_diff_hunk_count", hunks.toLong())
        report.number("controller_diff_added_lines", additions.toLong())
        report.number("controller_diff_deleted_lines", deletions.toLong())
        report.number("controller_reported_additions", changes.sumOf { (it.additions ?: 0).toLong() })
        report.number("controller_reported_deletions", changes.sumOf { (it.deletions ?: 0).toLong() })
        assertTrue("A real changed line must have a unified diff hunk and both line markers", hunks > 0 && additions > 0 && deletions > 0)
        verifyRenderedChanges(changes, report)
        readOmissionMetadata(scope, changes, report)
    }

    private fun verifyRenderedChanges(changes: List<RemoteChange>, report: LiveAcceptanceReport) {
        if (compose.onAllNodes(androidx.compose.ui.test.hasTestTag("changes-panel")).fetchSemanticsNodes().isEmpty()) {
            compose.onNodeWithContentDescription("变更").performClick()
        }
        compose.onNodeWithTag("changes-panel").assertIsDisplayed()
        var displayed = 0L
        for ((index, change) in changes.withIndex()) {
            val diff = change.diff ?: continue
            compose.onNodeWithTag("change-row-$index").performScrollTo().performClick()
            val lines = diff.lineSequence().map { it.ifEmpty { " " } }.toList()
            val node = compose.onNodeWithTag("change-diff-lines", useUnmergedTree = true).fetchSemanticsNode()
            assertTrue("The visible panel must render the selected record's actual diff", renderedText(node) == lines)
            val hunk = lines.indexOfFirst { it.startsWith("@@ ") }
            val addition = lines.indexOfFirst { it.startsWith("+") && !it.startsWith("+++") }
            val deletion = lines.indexOfFirst { it.startsWith("-") && !it.startsWith("---") }
            for (line in listOf(hunk, addition, deletion).filter { it >= 0 }) {
                compose.onNodeWithTag("change-line-$line").performScrollTo().assertIsDisplayed()
            }
            displayed += 1
        }
        report.number("rendered_diff_record_count", displayed)
        report.flag("rendered_diffs_match_controller", displayed > 0L)
    }

    private fun renderedText(node: SemanticsNode): List<String> {
        val own = if (node.config.contains(SemanticsProperties.Text)) node.config[SemanticsProperties.Text].map { it.text } else emptyList()
        return own + node.children.flatMap(::renderedText)
    }

    /** Keep response metadata discarded by the existing List-returning UI API out of production state. */
    private suspend fun readOmissionMetadata(scope: LiveAcceptanceScope, changes: List<RemoteChange>, report: LiveAcceptanceReport) {
        val account = TabletAccount(InstrumentationRegistry.getInstrumentation().targetContext)
        val computer = account.computers().single { it.id == scope.computerId }
        val credentials = account.connection(computer, scope.mode)
        withContext(Dispatchers.IO) {
            val session = connectSupervisor(credentials.options, credentials.signer)
            try {
                assertTrue("The omission probe must use the chosen transport", session.transport() ==
                    if (scope.mode == ConnectionMode.DIRECT) "direct" else "relay")
                var offset = 0
                var pages = 0L
                val records = mutableListOf<RemoteChange>()
                var omittedDiffs = 0L
                var omittedChanges = 0L
                while (true) {
                    val request = JSONObject().put("operation", "conversation.changes")
                        .put("machineId", scope.target.machineId).put("projectId", scope.target.projectId)
                        .put("conversationId", scope.target.conversationId).put("offset", offset)
                    val page = JSONObject(session.request(request.toString()))
                    assertTrue("Diff metadata must preserve the requested conversation", page.getString("conversationId") == scope.target.conversationId)
                    pages += 1
                    val rows = page.getJSONArray("changes")
                    for (index in 0 until rows.length()) records += rows.getJSONObject(index).change()
                    omittedDiffs += page.getLong("omittedDiffs")
                    omittedChanges += page.getLong("omittedChanges")
                    if (!page.has("nextOffset")) break
                    val next = page.getInt("nextOffset")
                    assertTrue("Diff pagination must advance within its bound", next > offset && next <= 2048)
                    offset = next
                }
                report.number("diff_metadata_page_count", pages)
                report.number("omitted_diffs", omittedDiffs)
                report.number("omitted_changes", omittedChanges)
                report.flag("native_items_match_controller", records == changes)
                assertTrue("The small acceptance diff must match every controller record", omittedDiffs == 0L &&
                    omittedChanges == 0L && records == changes)
            } finally {
                try { session.disconnect() } finally { session.close() }
            }
        }
    }

    private class MessageGrowth(firstText: String) {
        val firstLength = firstText.length
        var lastLength = firstLength
        var appendEvents = 0L
        var appendOnly = true
        private var previousText = firstText

        fun observe(text: String) {
            val preservesPrefix = text.startsWith(previousText)
            if (preservesPrefix && text.length > previousText.length) appendEvents += 1
            if (!preservesPrefix) appendOnly = false
            previousText = text
            lastLength = text.length
        }
    }
}
