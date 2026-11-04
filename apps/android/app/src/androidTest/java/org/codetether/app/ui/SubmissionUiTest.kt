package org.codetether.app.ui

import androidx.activity.ComponentActivity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import org.codetether.app.account.AccountProfile
import org.codetether.app.account.PairedComputer
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteProvider
import org.codetether.app.remote.RemoteReasoning
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import uniffi.supervisor_mobile.ConnectionMode

@OptIn(ExperimentalTestApi::class)
class SubmissionUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val target = ConversationTarget("machine_demo", "proj_demo", "conv_demo")
    private val computer = PairedComputer("host_demo", "演示电脑", "win32", true, "2030-01-01T00:00:00Z",
        "hauth_demo", "", 1uL, "{}", "{}", "{}")
    private val project = RemoteProject(target.projectId, target.machineId, "演示项目", true)
    private val codex = RemoteProvider("codex", "Codex", "available", emptyList(), true, true, true, true)
    private val claude = RemoteProvider("claude-code", "Claude Code", "available",
        listOf(RemoteReasoning("high", "高")), true, false, false, false)
    private val machine = RemoteMachine(target.machineId, "演示电脑", "Windows", true, "local", listOf(codex, claude))
    private val alternateMachine = machine.copy(id = "machine_other", name = "第二台演示设备")
    private val alternateProject = project.copy(machineId = alternateMachine.id, name = "另一位置项目")
    private val conversation = RemoteConversation(target, "演示会话", "codex", "idle", "created", false, "2026-11-04T00:00:00Z")
    private val base = TabletState(
        page = TabletPage.Conversation(computer.id, target), profile = AccountProfile("fixture-account", ""),
        computers = listOf(ComputerView(computer,
            RemoteWorkspace(listOf(machine, alternateMachine), listOf(project, alternateProject), listOf(conversation), emptyList(), true),
            RemoteConnection("direct", true, "2030-01-01T00:00:00Z"))),
        loaded = listOf(computer.id to conversation),
        detail = RemoteConversationDetail(conversation, RemoteHistory(emptyList(), emptyList(), null, "cursor-demo", true, false),
            codex, emptyList(), true),
    )
    private var state by mutableStateOf(base)
    private val sends = mutableListOf<String>()
    private val creates = mutableListOf<CreateRequest>()
    private var cancelCount = 0
    private val actions = object : TabletActions {
        override fun navigate(page: TabletPage) { state = state.copy(page = page) }
        override fun requestCode(email: String) {}
        override fun verifyCode(email: String, code: String) {}
        override fun editEmail() {}
        override fun pair(code: String) {}
        override fun cancelPairing() { cancelCount += 1; state = state.copy(busy = false, pairingInProgress = false) }
        override fun removeComputer(computer: PairedComputer) {}
        override fun signOut() {}
        override fun setAppearance(value: Appearance) { state = state.copy(appearance = value) }
        override fun setMode(value: ConnectionMode) { state = state.copy(mode = value) }
        override fun refresh() {}
        override fun setProjectFilter(archived: Boolean, status: String?) {}
        override fun older() {}
        override fun loadChanges() {}
        override fun create(computerId: String, project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String) {
            creates += CreateRequest(project.id, project.machineId, provider, text, reasoning, actionId)
            state = state.copy(busy = true, createOutcome = MutationOutcome(actionId, MutationStatus.Pending))
        }
        override fun send(target: TabletPage.Conversation, text: String, actionId: String) {
            sends += actionId
            state = state.copy(busy = true, sendOutcome = MutationOutcome(actionId, MutationStatus.Pending))
        }
        override fun approve(computerId: String, item: RemoteAttention, accept: Boolean) {}
        override fun resolveAttention(computerId: String, item: RemoteAttention) {}
        override fun interrupt(target: TabletPage.Conversation, turnId: String) {}
        override fun archive(target: TabletPage.Conversation) {}
        override fun dismissError() { state = state.copy(error = null) }
    }

    @Test
    fun savedDraftAndUnknownSendSurviveRestorationUntilExplicitSuccess() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("继续对话").performTextInput("需要保留的草稿")
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("需要保留的草稿", fieldText("继续对话"))
        compose.onNodeWithText("发送").performClick()
        update { it.copy(busy = false, error = null,
            sendOutcome = MutationOutcome(sends.single(), MutationStatus.Unknown, "正在确认发送结果")) }
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("需要保留的草稿", fieldText("继续对话"))
        compose.onNodeWithText("发送").assertIsNotEnabled()
        assertEquals(1, sends.size)
        update { it.copy(sendOutcome = MutationOutcome(sends.single(), MutationStatus.Success)) }
        assertEquals("", fieldText("继续对话"))
    }

    @Test
    fun actualActivityRotationsPreserveDraftAndUnknownSubmissionIdentity() {
        RotationRegressionActivity.contentForTest = { TabletApp(state, actions) }
        try {
            ActivityScenario.launch(RotationRegressionActivity::class.java).use { scenario ->
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                compose.waitUntil(15_000L) {
                    var landscape = false
                    scenario.onActivity { landscape = it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
                    landscape
                }
                compose.onNodeWithText("继续对话").performTextInput("跨横竖屏保留的草稿")
                rotate(scenario, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, Configuration.ORIENTATION_PORTRAIT)
                assertEquals("跨横竖屏保留的草稿", fieldText("继续对话"))
                compose.onNodeWithText("发送").performClick()
                update { it.copy(busy = false, error = null,
                    sendOutcome = MutationOutcome(sends.single(), MutationStatus.Unknown, "正在确认发送结果")) }
                rotate(scenario, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, Configuration.ORIENTATION_LANDSCAPE)
                assertEquals("跨横竖屏保留的草稿", fieldText("继续对话"))
                compose.onNodeWithText("发送").assertIsNotEnabled()
                assertEquals(1, sends.size)
                update { it.copy(sendOutcome = MutationOutcome(sends.single(), MutationStatus.Success)) }
                assertEquals("", fieldText("继续对话"))
                assertEquals(1, sends.size)
            }
        } finally {
            RotationRegressionActivity.contentForTest = null
        }
    }

    @Test
    fun aSuccessReceiptDoesNotClearTextEditedWhileThePriorSendWasUnknown() {
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("继续对话").performTextInput("第一条草稿")
        compose.onNodeWithText("发送").performClick()
        update { it.copy(busy = false,
            sendOutcome = MutationOutcome(sends.single(), MutationStatus.Unknown, "正在确认发送结果")) }
        compose.onNodeWithText("继续对话").performTextReplacement("稍后要发送的新草稿")
        update { it.copy(sendOutcome = MutationOutcome(sends.single(), MutationStatus.Success)) }
        assertEquals("稍后要发送的新草稿", fieldText("继续对话"))
        compose.onNodeWithText("发送").assertIsEnabled()
        assertEquals(1, sends.size)
    }

    @Test
    fun creationFailureKeepsTheModalInputAndSelectionsAcrossRestoration() {
        state = base.copy(page = TabletPage.Home)
        val restoration = StateRestorationTester(compose)
        restoration.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("＋ 新建会话").performClick()
        compose.onNode(hasText("另一位置项目") and hasAnyAncestor(isDialog())).performClick()
        compose.onNodeWithText("Claude Code").performClick()
        compose.onNodeWithText("高").performClick()
        compose.onNodeWithText("第一条消息").performScrollTo().performTextInput("保留第一条消息")
        compose.onNodeWithText("创建会话").performScrollTo().performClick()
        compose.onNodeWithText("第一条消息").assertIsDisplayed()
        update { it.copy(busy = false,
            createOutcome = MutationOutcome(creates.single().actionId, MutationStatus.Failed, "合成创建失败")) }
        compose.onNodeWithText("合成创建失败").performScrollTo().assertIsDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("保留第一条消息", fieldText("第一条消息"))
        compose.onNodeWithText("合成创建失败").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("创建会话").performScrollTo().assertIsEnabled().performClick()
        val retried = creates.last()
        assertEquals(project.id, retried.projectId)
        assertEquals(alternateMachine.id, retried.machineId)
        assertEquals("claude-code", retried.provider)
        assertEquals("high", retried.reasoning)
        assertEquals("保留第一条消息", retried.text)
        update { it.copy(busy = false,
            createOutcome = MutationOutcome(retried.actionId, MutationStatus.Unknown, "正在确认创建结果")) }
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("创建会话").assertIsNotEnabled()
        assertEquals(2, creates.size)
        update { it.copy(createOutcome = MutationOutcome(retried.actionId, MutationStatus.Success)) }
        compose.onNodeWithText("第一条消息").assertDoesNotExist()
    }

    @Test
    fun projectLoadingDoesNotPresentAnEmptyResult() {
        state = base.copy(page = TabletPage.Project(computer.id, project), projectLoading = true)
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("正在读取会话…").assertIsDisplayed()
        compose.onNodeWithText("没有符合条件的会话").assertDoesNotExist()
        update { it.copy(projectLoading = false) }
        compose.onNodeWithText("没有符合条件的会话").assertIsDisplayed()
    }

    @Test
    fun pairingWaitCanBeCancelledWhileOtherActionsAreBusy() {
        state = base.copy(page = TabletPage.Pair, busy = true, pairingInProgress = true, pairingClaimed = true)
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("取消等待").assertIsEnabled().performClick()
        assertEquals(1, cancelCount)
        compose.onNodeWithText("退出登录").assertIsEnabled()
        compose.onNodeWithText("取消等待").assertDoesNotExist()
    }

    private fun update(change: (TabletState) -> TabletState) {
        compose.runOnIdle { state = change(state) }
        compose.waitForIdle()
    }

    private fun fieldText(label: String): String =
        compose.onNodeWithText(label).fetchSemanticsNode().config[SemanticsProperties.EditableText].text

    private fun rotate(scenario: ActivityScenario<RotationRegressionActivity>, requested: Int, expected: Int) {
        var previous: RotationRegressionActivity? = null
        scenario.onActivity {
            previous = it
            it.requestedOrientation = requested
        }
        compose.waitUntil(15_000L) {
            var recreated = false
            scenario.onActivity { recreated = it !== previous && it.resources.configuration.orientation == expected }
            recreated
        }
        compose.waitForIdle()
    }

    private data class CreateRequest(val projectId: String, val machineId: String, val provider: String, val text: String,
        val reasoning: String?, val actionId: String)
}
