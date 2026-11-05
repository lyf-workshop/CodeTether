package org.codetether.app.ui

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.codetether.app.account.AccountProfile
import org.codetether.app.account.KeyProtection
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.PairingResult
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAction
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteProvider
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import uniffi.supervisor_mobile.ConnectionMode

@OptIn(ExperimentalTestApi::class)
class MainActivityRotationTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test
    fun actualMainActivityRotationKeepsTheSendingJobAndClearsDraftAfterOneSuccess() = withActivity { scenario, controller, session ->
        scenario.onActivity { controller.navigate(TabletPage.Conversation(COMPUTER.id, TARGET)) }
        compose.waitUntil(15_000L) { controller.state.value.detail?.conversation?.target == TARGET }
        compose.onNodeWithText("继续对话").performTextInput("旋转中的发送草稿")
        compose.onNodeWithText("发送").performClick()
        compose.waitUntil(15_000L) { session.sends.get() == 1 }

        rotateToPortrait(scenario, controller)
        assertEquals(0, session.cancelledSends.get())
        assertEquals(1, session.sends.get())
        assertEquals(0, session.disconnects.get())
        assertEquals(1, session.connects.get())
        assertEquals("旋转中的发送草稿", fieldText("继续对话"))

        session.sendResult.complete(Unit)
        compose.waitUntil(15_000L) { fieldText("继续对话").isEmpty() }
        compose.waitForIdle()
        assertEquals("", fieldText("继续对话"))
        assertEquals(1, session.sends.get())
        assertEquals(0, session.cancelledSends.get())
    }

    @Test
    fun actualMainActivityRotationKeepsCreationAndClosesTheModalAfterOneSuccess() = withActivity { scenario, controller, session ->
        compose.onNodeWithText("＋ 新建会话").performClick()
        compose.onNode(hasText(PROJECT.name) and hasAnyAncestor(isDialog())).performClick()
        compose.onNode(hasText("Codex") and hasAnyAncestor(isDialog())).performClick()
        compose.onNodeWithText("第一条消息").performScrollTo().performTextInput("旋转中的首条消息")
        compose.onNodeWithText("创建会话").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(15_000L) { session.creates.get() == 1 }

        rotateToPortrait(scenario, controller)
        assertEquals(0, session.cancelledCreates.get())
        assertEquals(1, session.creates.get())
        assertEquals(0, session.disconnects.get())
        assertEquals(1, session.connects.get())
        assertEquals("旋转中的首条消息", fieldText("第一条消息"))

        session.createResult.complete(Unit)
        compose.waitUntil(15_000L) {
            controller.state.value.page == TabletPage.Conversation(COMPUTER.id, CREATED_TARGET)
        }
        compose.waitForIdle()
        compose.onNodeWithText("第一条消息").assertDoesNotExist()
        assertEquals(TabletPage.Conversation(COMPUTER.id, CREATED_TARGET), controller.state.value.page)
        assertEquals(1, session.creates.get())
        assertEquals(0, session.cancelledCreates.get())
    }

    private fun withActivity(test: (ActivityScenario<MainActivityRegressionActivity>, TabletController, RotationSession) -> Unit) {
        val session = RotationSession()
        MainActivityRegressionActivity.dependenciesForTest = ControllerDependencies(RotationAccount()) { session }
        try {
            ActivityScenario.launch(MainActivityRegressionActivity::class.java).use { scenario ->
                lateinit var controller: TabletController
                scenario.onActivity {
                    controller = ViewModelProvider(it)[TabletController::class.java]
                    it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                }
                compose.waitUntil(15_000L) {
                    var landscape = false
                    scenario.onActivity { landscape = it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
                    landscape && !controller.state.value.busy && controller.state.value.computer(COMPUTER.id)?.connection != null
                }
                assertEquals(TabletPage.Home, controller.state.value.page)
                test(scenario, controller, session)
            }
        } finally {
            MainActivityRegressionActivity.dependenciesForTest = null
        }
    }

    private fun rotateToPortrait(scenario: ActivityScenario<MainActivityRegressionActivity>, expectedController: TabletController) {
        var previous: MainActivityRegressionActivity? = null
        scenario.onActivity {
            previous = it
            it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        compose.waitUntil(15_000L) {
            var recreated = false
            scenario.onActivity {
                recreated = it !== previous && it.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
            }
            recreated
        }
        scenario.onActivity { assertSame(expectedController, ViewModelProvider(it)[TabletController::class.java]) }
        compose.waitForIdle()
        assertTrue(previous?.isDestroyed == true)
    }

    private fun fieldText(label: String): String =
        compose.onNodeWithText(label).fetchSemanticsNode().config[SemanticsProperties.EditableText].text

    private class RotationAccount : ControllerAccount {
        override suspend fun restore() = AccountProfile("synthetic-rotation-account", "rotation@example.invalid")
        override suspend fun computers() = listOf(COMPUTER)
        override suspend fun keyProtection() = KeyProtection.TEE
        override suspend fun signOut(onLocalCleared: suspend () -> Unit) = onLocalCleared()
        override suspend fun requestCode(email: String) = error("Unexpected synthetic login")
        override suspend fun verifyCode(email: String, code: String): AccountProfile = error("Unexpected synthetic login")
        override suspend fun pair(code: String, onClaimed: () -> Unit): PairingResult = error("Unexpected synthetic pairing")
        override suspend fun removeComputer(computer: PairedComputer) = error("Unexpected synthetic removal")
    }

    private class RotationSession : ControllerSession {
        val sends = AtomicInteger()
        val creates = AtomicInteger()
        val cancelledSends = AtomicInteger()
        val cancelledCreates = AtomicInteger()
        val disconnects = AtomicInteger()
        val connects = AtomicInteger()
        val sendResult = CompletableDeferred<Unit>()
        val createResult = CompletableDeferred<Unit>()

        override suspend fun connect(computer: PairedComputer, mode: ConnectionMode): RemoteConnection {
            connects.incrementAndGet()
            return CONNECTION
        }
        override suspend fun disconnect() { disconnects.incrementAndGet() }
        override suspend fun workspace() = WORKSPACE to CONNECTION
        override suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?) = listOf(CONVERSATION)
        override fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?): Flow<RemoteConversationDetail> = flow {
            emit(RemoteConversationDetail(CONVERSATION.copy(target = target), HISTORY, PROVIDER, emptyList(), true))
            awaitCancellation()
        }
        override suspend fun send(target: ConversationTarget, text: String, actionId: String) {
            assertEquals(TARGET, target)
            assertEquals("旋转中的发送草稿", text)
            sends.incrementAndGet()
            try {
                sendResult.await()
            } catch (cancel: CancellationException) {
                cancelledSends.incrementAndGet()
                throw cancel
            }
        }
        override suspend fun create(project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String): ConversationTarget {
            assertEquals(PROJECT, project)
            assertEquals("codex", provider)
            assertEquals("旋转中的首条消息", text)
            creates.incrementAndGet()
            try {
                createResult.await()
            } catch (cancel: CancellationException) {
                cancelledCreates.incrementAndGet()
                throw cancel
            }
            return CREATED_TARGET
        }
        override suspend fun action(actionId: String) = RemoteAction(actionId, "not_found", null, null)
        override suspend fun olderHistory(target: ConversationTarget, cursor: String) = HISTORY
        override suspend fun changes(target: ConversationTarget): List<RemoteChange> = emptyList()
        override suspend fun approve(item: RemoteAttention, accept: Boolean) = Unit
        override suspend fun resolveAttention(item: RemoteAttention) = Unit
        override suspend fun interrupt(target: ConversationTarget, turnId: String) = Unit
        override suspend fun archive(target: ConversationTarget) = Unit
    }

    private companion object {
        val TARGET = ConversationTarget("machine_rotation", "proj_rotation", "conv_rotation")
        val CREATED_TARGET = TARGET.copy(conversationId = "conv_rotation_created")
        val COMPUTER = PairedComputer("host_rotation", "旋转回归电脑", "win32", true, "2030-01-01T00:00:00Z",
            "hauth_rotation", "", 1uL, "{}", "{}", "{}")
        val PROJECT = RemoteProject(TARGET.projectId, TARGET.machineId, "旋转回归项目", true)
        val PROVIDER = RemoteProvider("codex", "Codex", "available", emptyList(), true, true, true, true)
        val MACHINE = RemoteMachine(TARGET.machineId, COMPUTER.name, "Windows", true, "local", listOf(PROVIDER))
        val CONVERSATION = RemoteConversation(TARGET, "旋转回归会话", "codex", "idle", "created", false, "2026-11-04T00:00:00Z")
        val WORKSPACE = RemoteWorkspace(listOf(MACHINE), listOf(PROJECT), listOf(CONVERSATION), emptyList(), true)
        val CONNECTION = RemoteConnection("direct", true, "2030-01-01T00:00:00Z")
        val HISTORY = RemoteHistory(emptyList(), emptyList(), null, "synthetic_rotation_cursor", true, false)
    }
}
