package org.codetether.app.ui

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.codetether.app.account.AccountProfile
import org.codetether.app.account.PairedComputer
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteMessage
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteProvider
import org.codetether.app.remote.RemoteReasoning
import org.codetether.app.remote.RemoteTurn
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import uniffi.supervisor_mobile.ConnectionMode

@OptIn(ExperimentalTestApi::class)
class TabletUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val target = ConversationTarget("fixture-machine", "fixture-project", "fixture-conversation")
    private val computer = PairedComputer(
        "fixture-computer", "Windows 台式机", "Windows-x64", true, "2030-01-01T00:00:00Z",
        "fixture-pairing", "", 1uL, "{}", "{}", "{}",
    )
    private val local = RemoteMachine("fixture-machine", computer.name, "Windows · x64", true, "local",
        listOf(
            RemoteProvider("codex", "Codex", "available", emptyList(), true, true, true, true),
            RemoteProvider("claude-code", "Claude Code", "available",
                listOf(RemoteReasoning("high", "高")), true, false, false, false),
        ),
    )
    private val project = RemoteProject("fixture-project", local.id, "CodeTether", true, 1)
    private val summary = RemoteConversation(target, "修复窄窗口的会话标题", "codex", "waiting", "created", false,
        "2026-11-03T12:00:00Z")
    private val pending = RemoteAttention("fixture-attention", target, "approval", "运行命令", "fixture-approval",
        "fixture-turn", "2026-11-03T12:00:00Z", "pnpm --filter @codetether/web test", true)
    private val completed = pending.copy(id = "fixture-completed", type = "completed_review", title = "整理备份脚本的参数说明",
        approvalId = null, detail = null, canApprove = false)
    private val history = RemoteHistory(
        listOf(
            RemoteMessage("first", "user", "会话列表在窄窗口下截断太早。帮我修一下。", "", "completed"),
            RemoteMessage("second", "assistant", "我先检查会话列表和窄窗口下的样式。", "", "completed"),
            RemoteMessage("third", "tool", "读取  conversation-row.tsx", "", "completed"),
            RemoteMessage("fourth", "assistant", "原因是时间列占用了固定宽度。我调整了标题列。", "", "completed"),
        ),
        listOf(RemoteTurn("fixture-turn", "running", "修复标题", "", null, null, false)),
        null, "fixture:0", true, false,
    )
    private val connection = RemoteConnection("direct", true, "2030-01-01T00:00:00Z")
    private val workspace = RemoteWorkspace(listOf(local), listOf(project), listOf(summary), listOf(pending, completed), true)
    private val initial = TabletState(
        page = TabletPage.Home,
        profile = AccountProfile("test-account", ""),
        computers = listOf(ComputerView(computer, workspace, connection)),
        loaded = listOf(computer.id to summary),
        appearance = Appearance.Light,
        keyProtection = "TEE",
    )
    private val convoPage = TabletPage.Conversation(computer.id, target)
    private var state by mutableStateOf(initial)
    private val acted = mutableListOf<String>()

    private val actions = object : TabletActions {
        override fun navigate(page: TabletPage) { state = state.copy(page = page) }
        override fun requestCode(email: String) { state = state.copy(otpEmail = email) }
        override fun verifyCode(email: String, code: String) { state = state.copy(page = TabletPage.Pair) }
        override fun editEmail() { state = state.copy(otpEmail = null) }
        override fun pair(code: String) { state = state.copy(lastPairedName = computer.name) }
        override fun cancelPairing() { state = state.copy(busy = false, pairingInProgress = false) }
        override fun removeComputer(computer: PairedComputer) { acted.add("remove") }
        override fun signOut() { state = TabletState() }
        override fun setAppearance(value: Appearance) { state = state.copy(appearance = value) }
        override fun setMode(value: ConnectionMode) { state = state.copy(mode = value) }
        override fun refresh() { acted.add("refresh") }
        override fun setProjectFilter(archived: Boolean, status: String?) {
            state = state.copy(projectArchived = archived, projectStatus = status)
        }
        override fun older() { acted.add("older") }
        override fun loadChanges() {
            state = state.copy(changes = listOf(RemoteChange("src/conversation-row.tsx", "modified",
                "@@ -1,1 +1,2 @@\n-<span>{title}</span>\n+<span className=\"truncate\">{title}</span>\n+<time>{updated}</time>", 2, 1)))
        }
        override fun create(computerId: String, project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String) {
            acted.add("create")
            val result = ConversationTarget(project.machineId, project.id, target.conversationId)
            state = state.copy(mutations = listOf(PendingMutation(
                MutationRequest.Create(actionId, computerId, project, provider, text, reasoning), MutationStatus.Success, result = result,
            )))
        }
        override fun send(target: TabletPage.Conversation, text: String, actionId: String) {
            acted.add("send")
            state = state.copy(mutations = listOf(PendingMutation(
                MutationRequest.Send(actionId, target.computerId, target.target, text), MutationStatus.Success, result = target.target,
            )))
        }
        override fun retryMutation(actionId: String) { acted.add("retry") }
        override fun acknowledgeMutation(actionId: String) { state = state.copy(mutations = state.mutations.filterNot { it.actionId == actionId }) }
        override fun approve(computerId: String, item: RemoteAttention, accept: Boolean) {
            acted.add(if (accept) "accept" else "decline")
        }
        override fun resolveAttention(computerId: String, item: RemoteAttention) { acted.add("resolve") }
        override fun interrupt(target: TabletPage.Conversation, turnId: String) { acted.add("stop") }
        override fun archive(target: TabletPage.Conversation) { acted.add("archive") }
        override fun dismissError() { state = state.copy(error = null) }
    }

    private fun display(next: TabletState) {
        compose.runOnIdle { state = next }
        compose.waitForIdle()
    }

    private fun detail(
        conversation: RemoteConversation = summary,
        provider: RemoteProvider = local.providers.first(),
        history: RemoteHistory = this.history,
        attention: List<RemoteAttention> = listOf(pending),
    ) = initial.copy(page = convoPage, detail = RemoteConversationDetail(conversation, history, provider, attention, true))

    @Test
    fun approvalAndStopRespectProviderCapabilities() {
        state = detail()
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("允许一次").assertIsDisplayed().performClick()
        compose.onNodeWithText("拒绝").assertIsDisplayed().performClick()
        compose.onNodeWithText("停止").assertIsDisplayed().performClick()
        assertEquals(listOf("accept", "decline", "stop"), acted)

        display(detail(summary.copy(status = "running"), local.providers[1], attention = listOf(pending.copy(canApprove = false))))
        compose.onNodeWithText("允许一次").assertDoesNotExist()
        compose.onNodeWithText("停止").assertDoesNotExist()
        compose.onNodeWithContentDescription("变更").assertDoesNotExist()

        display(initial.copy(page = TabletPage.Inbox))
        compose.onNodeWithText("处理完成").performClick()
        assertEquals("resolve", acted.last())
    }

    @Test
    fun keyboardSearchCreateAndSendAreScopedToTheVisibleUi() {
        state = initial
        compose.setContent { TabletApp(state, actions) }
        ctrl(Key.K)
        compose.onNodeWithText("按标题搜索").assertIsDisplayed()
        compose.onNodeWithText("按标题搜索").performTextInput("窄窗口")
        compose.onNode(hasText("修复窄窗口的会话标题") and hasAnyAncestor(isDialog()))
            .assertIsDisplayed().performClick()
        display(detail(summary.copy(status = "idle"), history = history.copy(turns = emptyList()), attention = emptyList()))
        compose.onNodeWithText("继续对话").performTextInput("再检查一次")
        ctrl(Key.Enter)
        assertEquals("send", acted.last())
        ctrl(Key.N)
        compose.onNodeWithText("第一条消息").assertIsDisplayed()
        compose.onNodeWithText("第一条消息").performKeyInput { pressKey(Key.Escape) }
        compose.onNodeWithText("第一条消息").assertDoesNotExist()
    }

    private fun ctrl(key: Key) {
        compose.onRoot().performKeyInput {
            keyDown(Key.CtrlLeft)
            pressKey(key)
            keyUp(Key.CtrlLeft)
        }
    }

    @Test
    fun changesWithTheSamePathKeepTheirOwnDiffWhenSelectedAndRefreshed() {
        val first = RemoteChange(
            "demo.txt", "modified", "@@ -1 +1 @@\n-old-original\n+old-replacement", 1, 1,
            turnId = "turn_fixture_first", itemId = "item_fixture_first", order = 1,
        )
        val second = RemoteChange(
            "demo.txt", "modified", "@@ -1 +1 @@\n-new-original\n+new-replacement", 1, 1,
            turnId = "turn_fixture_second", itemId = "item_fixture_second", order = 2,
        )
        state = detail().copy(changes = listOf(first, second))
        compose.setContent {
            TabletInk(state.appearance) { ChangesPanel(androidx.compose.ui.Modifier, state, {}, {}) }
        }
        compose.onNodeWithText("+old-replacement").assertIsDisplayed()
        compose.onNodeWithTag("change-row-1").performClick()
        compose.onNodeWithText("+new-replacement").assertIsDisplayed()
        compose.onNodeWithText("+old-replacement").assertDoesNotExist()
        display(state.copy(changes = listOf(second.copy(diff = "@@ -1 +1 @@\n-new-original\n+new-refreshed"), first)))
        compose.onNodeWithText("+new-refreshed").assertIsDisplayed()
        compose.onNodeWithTag("change-row-1").performClick()
        compose.onNodeWithText("+old-replacement").assertIsDisplayed()
        compose.onNodeWithText("+new-refreshed").assertDoesNotExist()
    }

    @Test
    fun capturePortraitPrototypeScreens() {
        if (compose.activity.resources.configuration.orientation != Configuration.ORIENTATION_PORTRAIT) return
        state = detail()
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithContentDescription("变更").assertIsDisplayed()
        capture("05-01-port-conv")
        compose.onNodeWithContentDescription("侧栏").performClick()
        capture("05-02-port-side")
        compose.onNodeWithContentDescription("侧栏").performClick()
        compose.onNodeWithContentDescription("变更").performClick()
        capture("05-03-port-changes")
    }

    @Test
    fun captureLandscapePrototypeScreens() {
        if (compose.activity.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE) return
        state = TabletState(appearance = Appearance.Light)
        compose.setContent { TabletApp(state, actions) }
        capture("01-01-signin")
        display(state.copy(otpEmail = "fixture@example.invalid"))
        capture("01-02-otp")
        display(initial.copy(page = TabletPage.Pair, computers = emptyList()))
        capture("01-03-pair")
        display(state.copy(error = "配对码不对，还可以试 3 次"))
        capture("01-04-pair-error")
        display(state.copy(error = null, lastPairedName = computer.name))
        capture("01-05-paired")

        display(initial)
        capture("02-01-home")
        display(initial.copy(page = TabletPage.Inbox))
        capture("02-02-inbox")
        display(detail())
        capture("02-03-conversation")
        compose.onNodeWithContentDescription("变更").performClick()
        capture("02-04-changes")
        compose.onNodeWithContentDescription("关闭变更").performClick()
        display(detail(summary.copy(status = "running"), attention = emptyList()))
        capture("02-05-running")
        display(detail(summary.copy(status = "running", provider = "claude-code"), local.providers[1], attention = emptyList()))
        capture("02-06-running-restricted")
        display(detail(summary.copy(status = "failed"),
            history = history.copy(turns = listOf(history.turns.first().copy(status = "failed", error = "请检查电脑上的登录状态", canRetry = true))),
            attention = emptyList()))
        capture("02-07-failed")
        display(detail(summary.copy(status = "completed"), attention = emptyList()))
        compose.onNodeWithContentDescription("更多").performClick()
        capture("02-08-more")
        compose.onNodeWithText("归档").performClick()
        compose.onNodeWithContentDescription("关闭窗口").performClick()
        display(detail(summary.copy(status = "completed", origin = "adopted_native"), attention = emptyList()))
        capture("02-09-imported")

        display(initial)
        compose.onNodeWithText("＋ 新建会话").performClick()
        compose.onNodeWithTag("new-project-${project.id}").performClick()
        compose.onNodeWithText("Codex").performClick()
        capture("02-10-new-codex")
        compose.onNodeWithText("Claude Code").performClick()
        capture("02-11-new-claude")
        compose.onNodeWithContentDescription("关闭窗口").performClick()
        ctrl(Key.K)
        capture("02-12-search")
        compose.onNodeWithContentDescription("关闭窗口").performClick()

        display(initial.copy(page = TabletPage.Devices))
        capture("03-01-devices")
        display(initial.copy(page = TabletPage.Device(computer.id, local.id)))
        capture("03-02-device")
        display(state.copy(computers = listOf(ComputerView(computer, workspace, problem = "这台电脑现在连不上"))))
        capture("03-03-device-offline")
        display(initial.copy(page = TabletPage.Project(computer.id, project), projectRows = listOf(summary)))
        capture("03-04-project")
        display(state.copy(projectArchived = true, projectRows = listOf(summary.copy(archived = true))))
        capture("03-05-project-archived")

        display(initial.copy(page = TabletPage.Settings()))
        capture("04-01-settings")
        display(initial.copy(page = TabletPage.Settings(SettingSection.Computers)))
        compose.onNodeWithText("移除 Windows 台式机").performClick()
        capture("04-02-unpair")
        compose.onNodeWithContentDescription("关闭窗口").performClick()
        display(initial.copy(page = TabletPage.Pair))
        capture("04-03-pair-more")
        display(initial.copy(page = TabletPage.Settings(SettingSection.Connection)))
        capture("04-04-connection")
        display(initial.copy(page = TabletPage.Settings(SettingSection.Plans)))
        capture("04-05-roadmap")
        display(initial.copy(page = TabletPage.Removed(computer.name), computers = emptyList()))
        capture("04-06-removed")
        display(initial.copy(appearance = Appearance.Dark))
        capture("05-04-dark-home")
        display(detail().copy(appearance = Appearance.Dark))
        capture("05-05-dark-conv")
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        // Compose can be idle before the emulator publishes the first composed surface.
        SystemClock.sleep(200)
        val directory = requireNotNull(instrumentation.targetContext.getExternalFilesDir("t1a-shots"))
        val image = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            File(directory, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } finally {
            image.recycle()
        }
    }
}
