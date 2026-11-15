package org.codetether.app.ui

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CopyOnWriteArrayList
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
import org.codetether.app.remote.RemoteFailure
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteProvider
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
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
        compose.onNodeWithText("开始").assertIsEnabled().performClick()
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

    @Test
    fun explicitSendRetryFailureRefreshesConversationAndKeepsTheDraftForANewAction() {
        val rejection = RemoteFailure("invalid_request", definitiveMutationFailure = true)
        withActivity(RotationSession(rejection)) { scenario, controller, session ->
            val page = TabletPage.Conversation(COMPUTER.id, TARGET)
            scenario.onActivity { controller.navigate(page) }
            compose.waitUntil(15_000L) { controller.state.value.detail?.conversation?.target == TARGET }
            val readsBeforeRetry = session.conversationReads.size
            val originalDraft = "Original send draft"
            compose.onNodeWithText("继续对话").performTextInput(originalDraft)
            compose.onNodeWithText("发送").performClick()
            compose.waitUntil(15_000L) { controller.state.value.sendMutation(page)?.status == MutationStatus.Unknown }
            compose.onNodeWithText("发送").assertIsNotEnabled()
            compose.onNodeWithText("重试").performClick()
            compose.waitUntil(15_000L) {
                controller.state.value.sendMutation(page)?.status == MutationStatus.Failed &&
                    session.conversationReads.size > readsBeforeRetry
            }
            compose.onNodeWithText(requireNotNull(rejection.message)).assertIsDisplayed()
            compose.onNodeWithText("重试").assertDoesNotExist()
            assertEquals(originalDraft, fieldText("继续对话"))
            assertEquals(listOf(TARGET), session.conversationReads.drop(readsBeforeRetry))
            assertEquals(listOf(session.sendAttempts.first(), session.sendAttempts.first()), session.sendAttempts.toList())

            val editedDraft = "Corrected send draft"
            compose.onNodeWithText("继续对话").performTextReplacement(editedDraft)
            compose.onNodeWithText("发送").assertIsEnabled().performClick()
            compose.waitUntil(15_000L) { session.sendAttempts.size == 3 }
            assertNotEquals(session.sendAttempts.first().actionId, session.sendAttempts.last().actionId)
            assertEquals(editedDraft, session.sendAttempts.last().text)
            session.sendResult.complete(Unit)
            compose.waitUntil(15_000L) { fieldText("继续对话").isEmpty() }
            assertEquals(page, controller.state.value.page)
            assertEquals(3, session.sends.get())
        }
    }

    @Test
    fun explicitCreateRetryNotFoundRefreshesProjectAndKeepsTheFormForANewAction() {
        val rejection = RemoteFailure("not_found", definitiveMutationFailure = true)
        withActivity(RotationSession(rejection)) { _, controller, session ->
            compose.onNodeWithText("＋ 新建会话").performClick()
            compose.onNode(hasText(PROJECT.name) and hasAnyAncestor(isDialog())).performClick()
            compose.onNode(hasText("Codex") and hasAnyAncestor(isDialog())).performClick()
            val originalText = "Original create message"
            compose.onNodeWithText("第一条消息").performScrollTo().performTextInput(originalText)
            compose.onNodeWithText("开始").performClick()
            compose.waitUntil(15_000L) {
                controller.state.value.createMutation(COMPUTER.id, PROJECT)?.status == MutationStatus.Unknown
            }
            compose.onNodeWithText("开始").assertIsNotEnabled()
            compose.onNodeWithText("重试").performScrollTo().performClick()
            compose.waitUntil(15_000L) {
                controller.state.value.createMutation(COMPUTER.id, PROJECT)?.status == MutationStatus.Failed &&
                    session.projectReads.isNotEmpty()
            }
            compose.onNodeWithText(requireNotNull(rejection.message)).performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("重试").assertDoesNotExist()
            assertEquals(originalText, fieldText("第一条消息"))
            assertEquals(listOf(PROJECT), session.projectReads.toList())
            assertEquals(listOf(session.createAttempts.first(), session.createAttempts.first()), session.createAttempts.toList())

            val editedText = "Corrected create message"
            compose.onNodeWithText("第一条消息").performScrollTo().performTextReplacement(editedText)
            compose.onNodeWithText("开始").assertIsEnabled().performClick()
            compose.waitUntil(15_000L) { session.createAttempts.size == 3 }
            assertNotEquals(session.createAttempts.first().actionId, session.createAttempts.last().actionId)
            assertEquals(editedText, session.createAttempts.last().text)
            session.createResult.complete(Unit)
            compose.waitUntil(15_000L) {
                controller.state.value.page == TabletPage.Conversation(COMPUTER.id, CREATED_TARGET)
            }
            compose.onNodeWithText("第一条消息").assertDoesNotExist()
            assertEquals(3, session.creates.get())
        }
    }

    @Test
    fun actualRotationRetainsOpenChangesSelectionAndBothScrollOffsets() = withActivity { scenario, controller, _ ->
        val offsets = openSecondChange(scenario, controller)
        assertPanelWidth(scenario, 420)

        rotateToPortrait(scenario, controller)
        assertPanelWidth(scenario, 520)
        compose.onNodeWithText("@@ second file @@").assertExists()
        assertEquals(offsets, compose.changesFixtureOffsets())

        scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        compose.waitUntil(15_000L) {
            var landscape = false
            scenario.onActivity { landscape = it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
            landscape
        }
        assertPanelWidth(scenario, 420)
        compose.onNodeWithText("@@ second file @@").assertExists()
        assertEquals(offsets, compose.changesFixtureOffsets())
    }

    @Test
    fun actualSplitScreenRetainsChangesAndRestoresFullscreen() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("t1aRealSplitScreen") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(
            instrumentation.uiAutomation.executeShellCommand(command),
        ).bufferedReader().use { it.readText() }
        val intent = Intent(instrumentation.targetContext, RotationRegressionActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
        RotationRegressionActivity.contentForTest = {}
        try {
            ActivityScenario.launch<RotationRegressionActivity>(intent).use { companion ->
                var otherTask = -1
                companion.onActivity { otherTask = it.taskId }
                withActivity { scenario, controller, _ ->
                    var ownTask = -1
                    scenario.onActivity { ownTask = it.taskId }
                    assertTrue("Expected separate tasks for split screen: $ownTask and $otherTask",
                        ownTask >= 0 && otherTask >= 0 && ownTask != otherTask)
                    val offsets = openSecondChange(scenario, controller)
                    try {
                        shell("wm shell splitscreen moveToSideStage $otherTask 1")
                        compose.waitUntil(20_000L) {
                            var narrow = false
                            scenario.onActivity { narrow = it.isInMultiWindowMode && it.resources.configuration.screenWidthDp < 900 }
                            narrow
                        }
                        assertPanelWidth(scenario, 520)
                        compose.onNodeWithText("@@ second file @@").assertExists()
                        assertEquals(offsets, compose.changesFixtureOffsets())
                    } finally {
                        shell("wm shell splitscreen exitSplitScreen $ownTask")
                        compose.waitUntil(20_000L) {
                            var fullscreen = false
                            scenario.onActivity { fullscreen = !it.isInMultiWindowMode && it.resources.configuration.screenWidthDp >= 900 }
                            fullscreen
                        }
                    }
                    assertPanelWidth(scenario, 420)
                    compose.onNodeWithText("@@ second file @@").assertExists()
                    assertEquals(offsets, compose.changesFixtureOffsets())
                }
            }
        } finally {
            RotationRegressionActivity.contentForTest = null
        }
    }

    private fun openSecondChange(
        scenario: ActivityScenario<MainActivityRegressionActivity>, controller: TabletController,
    ): Pair<Float, Float> {
        scenario.onActivity { controller.navigate(TabletPage.Conversation(COMPUTER.id, TARGET)) }
        compose.waitUntil(15_000L) { controller.state.value.detail?.conversation?.target == TARGET }
        compose.onNodeWithContentDescription("变更").performClick()
        compose.waitUntil(15_000L) { controller.state.value.changes.size == 2 }
        compose.onNodeWithTag("change-row-1").performClick()
        compose.scrollChangesFixture()
        return compose.changesFixtureOffsets().also { assertTrue(it.first > 0f && it.second > 0f) }
    }

    private fun assertPanelWidth(scenario: ActivityScenario<MainActivityRegressionActivity>, widthDp: Int) {
        var density = 0f
        scenario.onActivity { density = it.resources.displayMetrics.density }
        val panel = compose.onNodeWithTag("changes-panel").assertIsDisplayed().fetchSemanticsNode()
        assertEquals(widthDp * density, panel.boundsInRoot.width, 1f)
    }

    private fun withActivity(
        session: RotationSession = RotationSession(),
        test: (ActivityScenario<MainActivityRegressionActivity>, TabletController, RotationSession) -> Unit,
    ) {
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

    private data class Attempt(val actionId: String, val text: String)

    private class RotationSession(private val retryRejection: RemoteFailure? = null) : ControllerSession {
        val sendAttempts = CopyOnWriteArrayList<Attempt>()
        val createAttempts = CopyOnWriteArrayList<Attempt>()
        val conversationReads = CopyOnWriteArrayList<ConversationTarget>()
        val projectReads = CopyOnWriteArrayList<RemoteProject>()
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
        override suspend fun projectConversationDirectory(project: RemoteProject): List<RemoteConversation> =
            projectConversations(project, archived = false, status = null)

        override suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?): List<RemoteConversation> {
            projectReads += project
            return listOf(CONVERSATION)
        }
        override fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?): Flow<RemoteConversationDetail> = flow {
            conversationReads += target
            emit(RemoteConversationDetail(CONVERSATION.copy(target = target), HISTORY, PROVIDER, emptyList(), true))
            awaitCancellation()
        }
        override suspend fun send(target: ConversationTarget, text: String, actionId: String) {
            assertEquals(TARGET, target)
            if (retryRejection == null) assertEquals("旋转中的发送草稿", text)
            sendAttempts += Attempt(actionId, text)
            rejectRetry(sends.incrementAndGet(), actionId)
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
            if (retryRejection == null) assertEquals("旋转中的首条消息", text)
            createAttempts += Attempt(actionId, text)
            rejectRetry(creates.incrementAndGet(), actionId)
            try {
                createResult.await()
            } catch (cancel: CancellationException) {
                cancelledCreates.incrementAndGet()
                throw cancel
            }
            return CREATED_TARGET
        }
        private fun rejectRetry(attempt: Int, actionId: String) {
            val rejection = retryRejection ?: return
            when (attempt) {
                1 -> throw RemoteFailure("connection_closed", uncertainActionId = actionId)
                2 -> throw rejection
            }
        }

        override suspend fun action(actionId: String) = RemoteAction(actionId, "not_found", null, null)
        override suspend fun olderHistory(target: ConversationTarget, cursor: String) = HISTORY
        override suspend fun changes(target: ConversationTarget): List<RemoteChange> = changesPanelFixture
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
