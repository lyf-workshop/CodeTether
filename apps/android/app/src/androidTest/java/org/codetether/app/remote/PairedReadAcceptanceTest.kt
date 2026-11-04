package org.codetether.app.remote

import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.TabletAccount
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectionMode

/** Explicitly enabled acceptance against the owner's already paired B1 synthetic workspace. */
@RunWith(AndroidJUnit4::class)
class PairedReadAcceptanceTest {
    @Test
    fun pairedFixturePagesWorkDirectlyAndThroughRelay() {
        assumeTrue(
            "Requires explicit paired read acceptance opt-in",
            InstrumentationRegistry.getArguments().getString("t1aPairedReadAcceptance") == "true",
        )
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val report = Bundle().apply {
            putBoolean("t1a_paired_read_passed", false)
            putInt("t1a_read_page_count", 0)
            putInt("t1a_write_operation_count", 0)
        }
        var stage = 0
        try {
            runBlocking {
                withTimeout(180_000L) {
                    val account = TabletAccount(instrumentation.targetContext)
                    stage = 1
                    assertTrue("Acceptance account configuration is required", account.isConfigured)
                    assertTrue("An existing signed-in account is required", account.restore() != null)
                    val computers = account.computers().filter { it.isAvailable }
                    report.putInt("t1a_available_computer_count", computers.size)
                    stage = 2
                    val fixtures = mutableListOf<Fixture>()
                    var unavailable = 0
                    for (computer in computers) {
                        val remote = RemoteSupervisor(account)
                        try {
                            remote.connect(computer, ConnectionMode.RELAY)
                            val (workspace, _) = remote.workspace()
                            countRead(report)
                            val projects = fixtureProjects(workspace)
                            for (project in projects) {
                                val conversations = remote.projectConversations(project).filter(::isFixtureConversation)
                                countRead(report)
                                if (conversations.any { it.provider == "codex" } &&
                                    conversations.any { it.provider == "claude-code" }
                                ) {
                                    val latest = conversations.groupBy { it.provider }.values.flatMap { rows ->
                                        rows.sortedByDescending { it.lastActivityAt }.take(2)
                                    }
                                    fixtures += Fixture(computer, project, latest)
                                }
                            }
                        } catch (cancel: CancellationException) {
                            throw cancel
                        } catch (_: Exception) {
                            unavailable += 1
                        } finally {
                            withContext(NonCancellable) { remote.disconnect() }
                        }
                    }
                    report.putInt("t1a_unavailable_computer_count", unavailable)
                    report.putInt("t1a_fixture_count", fixtures.size)
                    assertTrue("Exactly one paired B1 synthetic workspace is required", fixtures.size == 1)
                    val fixture = fixtures.single()
                    for (mode in listOf(ConnectionMode.DIRECT, ConnectionMode.RELAY)) {
                        stage = if (mode == ConnectionMode.DIRECT) 3 else 4
                        verifyPages(account, fixture, mode, report)
                        instrumentation.sendStatus(0, Bundle(report))
                    }
                }
            }
            report.putBoolean("t1a_paired_read_passed", true)
        } catch (failure: Throwable) {
            report.putString("t1a_failure_type", failure.javaClass.simpleName)
            report.putString("t1a_failure_frames", failure.stackTrace.take(8).joinToString("|") {
                "${it.className}.${it.methodName}:${it.lineNumber}"
            })
            // Third-party exceptions can include request material. Report only a fixed stage number.
            throw AssertionError("Paired read acceptance failed at stage $stage")
        } finally {
            report.putInt("t1a_stage", stage)
            instrumentation.sendStatus(0, report)
        }
    }

    private suspend fun verifyPages(
        account: TabletAccount,
        fixture: Fixture,
        mode: ConnectionMode,
        report: Bundle,
    ) {
        val prefix = if (mode == ConnectionMode.DIRECT) "t1a_direct" else "t1a_relay"
        val expectedTransport = if (mode == ConnectionMode.DIRECT) "direct" else "relay"
        val remote = RemoteSupervisor(account)
        try {
            val connection = remote.connect(fixture.computer, mode)
            assertTrue("The explicitly requested transport is required", connection.transport == expectedTransport)
            assertTrue("The connection expiry must be valid", Instant.parse(connection.expiresAt).isAfter(Instant.now()))
            val (workspace, currentConnection) = remote.workspace()
            countRead(report)
            assertTrue("Workspace transport must remain consistent", currentConnection.transport == expectedTransport)
            assertTrue("Workspace control capability must remain consistent", workspace.canControl == currentConnection.canControl)
            assertTrue("Fixture scope must remain available", fixtureProjects(workspace).any { it.id == fixture.project.id })
            val machine = workspace.machines.single { it.id == fixture.project.machineId }
            assertTrue("The fixture machine identifier must be valid", validId(machine.id, "machine"))
            assertTrue("The fixture project identifier must be valid", validId(fixture.project.id, "proj"))
            val codex = machine.providers.single { it.id == "codex" }
            val claude = machine.providers.single { it.id == "claude-code" }
            assertTrue("The supported fixture must expose approval and interrupt capability", codex.approvals && codex.interrupt)
            assertTrue("The unsupported fixture must hide approval and interrupt capability", !claude.approvals && !claude.interrupt)
            recordCapabilities(report, prefix + "_codex", codex)
            recordCapabilities(report, prefix + "_claude", claude)

            val project = remote.project(fixture.project)
            countRead(report)
            assertTrue("Project detail must preserve its scope", project.id == fixture.project.id && project.machineId == machine.id)
            val listed = remote.projectConversations(project).filter(::isFixtureConversation)
            countRead(report)
            assertTrue("Fixture conversations must remain listed", fixture.conversations.all { selected -> listed.any { it.target == selected.target } })
            var messageCount = 0
            var turnCount = 0
            var attentionCount = 0
            var changeCount = 0
            var changesRead = 0
            var olderPages = 0
            for (selected in fixture.conversations) {
                val target = selected.target
                assertTrue("Fixture conversation scope must be valid", validId(target.conversationId, "conv") &&
                    target.machineId == machine.id && target.projectId == project.id)
                val detail = remote.conversation(target)
                countRead(report)
                assertTrue("Conversation detail must preserve its scope", detail.conversation.target == target &&
                    detail.conversation.provider == selected.provider && isFixtureConversation(detail.conversation))
                val provider = detail.provider
                assertTrue("Conversation provider must preserve its identity", provider != null && provider.id == selected.provider)
                assertTrue("History must expose an opaque live cursor", detail.history.liveCursor.isNotBlank())
                assertTrue("Fixture history must contain valid turn identifiers", detail.history.turns.isNotEmpty() &&
                    detail.history.turns.all { validId(it.id, "turn") })
                assertTrue("History messages must reference scoped turns", detail.history.messages.all { message ->
                    message.id.isNotBlank() && (message.turnId == null || detail.history.turns.any { it.id == message.turnId })
                })
                assertTrue("Attention must preserve conversation scope", detail.attention.all {
                    validId(it.id, "attn") && it.target == target && (!it.canApprove || detail.canApprove)
                })
                messageCount += detail.history.messages.size
                turnCount += detail.history.turns.size
                attentionCount += detail.attention.size
                detail.history.beforeCursor?.let { cursor ->
                    val older = remote.olderHistory(target, cursor)
                    countRead(report)
                    assertTrue("Older history must contain valid turn identifiers", older.turns.all { validId(it.id, "turn") })
                    messageCount += older.messages.size
                    turnCount += older.turns.size
                    olderPages += 1
                }
                if (detail.canShowChanges) {
                    val changes = remote.changes(target)
                    countRead(report)
                    assertTrue("Changes must expose valid entries", changes.all {
                        it.path.isNotBlank() && (it.additions ?: 0) >= 0 && (it.deletions ?: 0) >= 0
                    })
                    changeCount += changes.size
                    changesRead += 1
                }
            }
            report.putString(prefix + "_transport", expectedTransport)
            report.putBoolean(prefix + "_can_control", currentConnection.canControl)
            report.putInt(prefix + "_machine_count", workspace.machines.size)
            report.putInt(prefix + "_project_count", workspace.projects.size)
            report.putInt(prefix + "_fixture_conversation_count", fixture.conversations.size)
            report.putInt(prefix + "_fixture_message_count", messageCount)
            report.putInt(prefix + "_fixture_turn_count", turnCount)
            report.putInt(prefix + "_fixture_attention_count", attentionCount)
            report.putInt(prefix + "_fixture_change_count", changeCount)
            report.putInt(prefix + "_changes_read_count", changesRead)
            report.putInt(prefix + "_older_page_count", olderPages)
            report.putBoolean(prefix + "_passed", true)
        } finally {
            withContext(NonCancellable) { remote.disconnect() }
        }
    }

    private fun fixtureProjects(workspace: RemoteWorkspace): List<RemoteProject> = workspace.projects.filter { project ->
        val providers = workspace.machines.firstOrNull { it.id == project.machineId }?.providers.orEmpty()
        project.name == "fixture-project" && project.available && providers.any {
            it.id == "codex" && it.displayName == "B1 R1 Synthetic Provider"
        } && providers.any {
            it.id == "claude-code" && it.displayName == "B1 Mac Synthetic Unsupported Provider"
        }
    }

    private fun isFixtureConversation(conversation: RemoteConversation): Boolean =
        conversation.title.startsWith("fixture-") && conversation.provider in setOf("codex", "claude-code")

    private fun validId(value: String, prefix: String): Boolean =
        value.matches(Regex("${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{5,95}"))

    private fun countRead(report: Bundle) {
        report.putInt("t1a_read_page_count", report.getInt("t1a_read_page_count") + 1)
    }

    private fun recordCapabilities(report: Bundle, prefix: String, provider: RemoteProvider) {
        report.putBoolean(prefix + "_can_start", provider.canStart)
        report.putBoolean(prefix + "_approvals", provider.approvals)
        report.putBoolean(prefix + "_interrupt", provider.interrupt)
        report.putBoolean(prefix + "_diff", provider.diff)
    }

    private class Fixture(
        val computer: PairedComputer,
        val project: RemoteProject,
        val conversations: List<RemoteConversation>,
    )
}
