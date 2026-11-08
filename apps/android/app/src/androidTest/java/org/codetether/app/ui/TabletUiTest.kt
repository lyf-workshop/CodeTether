package org.codetether.app.ui

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
import org.junit.Assert.assertTrue
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

    private fun connectionPreview(): TabletState {
        val remote = local.copy(id = "fixture-build-server", name = "build-server", isLocal = false,
            platform = "Linux · x64", status = "online", providers = emptyList())
        val offline = PairedComputer("fixture-offline", "MacBook Pro", "macOS-arm64", true, "2030-01-01T00:00:00Z",
            "fixture-pairing", "", 1uL, "{}", "{}", "{}")
        val offlineMachine = local.copy(id = "fixture-offline-machine", name = offline.name,
            lastSeenAt = Instant.now().minusSeconds(9_000).toString())
        return initial.copy(page = TabletPage.Settings(SettingSection.Connection), computers = listOf(
            ComputerView(computer, workspace.copy(machines = listOf(local, remote)), connection),
            ComputerView(offline, workspace.copy(machines = listOf(offlineMachine))),
        ))
    }

    @Test
    fun connectionCheckIsStandaloneWithUserFacingDescriptionsAndDebugControls() {
        state = initial.copy(page = TabletPage.Settings())
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("连接检查").performClick()
        compose.onNodeWithText("账号").assertDoesNotExist()
        display(connectionPreview())
        compose.onNodeWithText("同一网络，直接连接").assertIsDisplayed()
        compose.onNodeWithText("经由 Windows 台式机", substring = false).assertIsDisplayed()
        compose.onNodeWithText("连不上 · 2 小时前在线").assertIsDisplayed()
        compose.onAllNodesWithText("已连接").assertCountEquals(2)
        compose.onNodeWithText("设备密钥保护").assertIsDisplayed()
        compose.onNodeWithText("TEE").assertIsDisplayed()
        compose.onNodeWithText("只经互联网连接").performClick()
        assertEquals(ConnectionMode.RELAY, state.mode)

        val first = state.computers.first()
        display(state.copy(computers = listOf(first.copy(connection = connection.copy(transport = "relay")),
            state.computers.last().copy(workspace = null))))
        compose.onNodeWithText("经互联网连接").assertIsDisplayed()
        compose.onNodeWithText("连不上").assertIsDisplayed()
        compose.onNodeWithText("同一网络，直接连接").assertDoesNotExist()
        compose.onNodeWithText("重新检查").performClick()
        assertEquals(listOf("refresh"), acted)
        compose.onNodeWithTag("connection-settings-back").performClick()
        assertEquals(TabletPage.Settings(), state.page)
        compose.onNodeWithText("退出登录").assertIsDisplayed()
        compose.onNodeWithText("连接检查").performClick()
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        assertEquals(TabletPage.Settings(), state.page)
    }

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
    fun resizedWindowAndSavedStateKeepTheOpenChangesSelectionAndOffsets() {
        val viewportWidth = mutableStateOf(1100.dp)
        val restoration = StateRestorationTester(compose)
        val panelActions = object : TabletActions by actions {
            override fun loadChanges() = Unit
        }
        state = detail().copy(changes = changesPanelFixture)
        restoration.setContent {
            Box(Modifier.size(viewportWidth.value, 620.dp)) { TabletApp(state, panelActions) }
        }
        compose.onNodeWithContentDescription("变更").performClick()
        compose.onNodeWithTag("change-row-1").performClick()
        compose.scrollChangesFixture()
        val offsets = compose.changesFixtureOffsets()
        assertTrue(offsets.first > 0f && offsets.second > 0f)
        val density = compose.activity.resources.displayMetrics.density
        fun assertPanelWidth(width: Int) {
            val panel = compose.onNodeWithTag("changes-panel").assertIsDisplayed().fetchSemanticsNode()
            assertEquals(width * density, panel.boundsInRoot.width, 1f)
        }
        assertPanelWidth(420)
        compose.runOnIdle { viewportWidth.value = 700.dp }
        assertPanelWidth(520)
        compose.onNodeWithText("@@ second file @@").assertExists()
        assertEquals(offsets, compose.changesFixtureOffsets())

        display(state.copy(changes = emptyList(), changesLoading = true))
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("正在读取变更…").assertIsDisplayed()
        display(state.copy(changes = changesPanelFixture, changesLoading = false))
        assertPanelWidth(520)
        compose.onNodeWithText("@@ second file @@").assertExists()
        assertEquals(offsets, compose.changesFixtureOffsets())

        compose.runOnIdle { viewportWidth.value = 1100.dp }
        assertPanelWidth(420)
        assertEquals(offsets, compose.changesFixtureOffsets())
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
    fun removedHomeKeepsSidebarAndOffersBothRecoveryActions() {
        val removed = initial.copy(page = TabletPage.Removed(computer.name), computers = emptyList())
        state = removed
        compose.setContent { TabletApp(state, actions) }
        val title = "${computer.name} 已把这台平板移除"
        compose.onNodeWithText(title).assertIsDisplayed()
        val configuration = compose.activity.resources.configuration
        val wide = configuration.screenWidthDp >= 900 && configuration.screenWidthDp > configuration.screenHeightDp
        if (!wide) compose.onNodeWithContentDescription("侧栏").performClick()
        compose.onNodeWithText("设置").assertIsDisplayed()
        if (!wide) compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }

        compose.onNodeWithText("输入配对码").performClick()
        compose.onNodeWithText("添加电脑").assertIsDisplayed()
        compose.onNodeWithText("取消").performClick()
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("输入配对码").performClick()
        compose.onNodeWithTag("removed-pair-code").performTextInput("123456")
        compose.onNodeWithText("连接").performClick()
        compose.onNodeWithText("已连接").assertIsDisplayed()
        compose.onNodeWithText("完成").performClick()
        assertEquals(TabletPage.Home, state.page)
        compose.onNodeWithText(title).assertDoesNotExist()

        display(removed)
        compose.onNodeWithText("看其他电脑").performClick()
        assertEquals(TabletPage.Devices, state.page)
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
        display(connectionPreview())
        compose.onNodeWithText("连接检查").assertIsDisplayed()
        capture("04-04-connection")
        display(initial.copy(page = TabletPage.Settings(SettingSection.Plans)))
        capture("04-05-roadmap")
        display(initial.copy(page = TabletPage.Removed(computer.name), computers = emptyList()))
        capture("04-06-removed")
        compose.onNodeWithText("输入配对码").performClick()
        capture("04-06-removed-pair")
        compose.onNodeWithText("取消").performClick()
        display(initial.copy(appearance = Appearance.Dark))
        capture("05-04-dark-home")
        display(detail().copy(appearance = Appearance.Dark))
        capture("05-05-dark-conv")
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        val frame = CountDownLatch(1)
        compose.runOnUiThread {
            val decor = compose.activity.window.decorView
            decor.viewTreeObserver.registerFrameCommitCallback { frame.countDown() }
            decor.postInvalidateOnAnimation()
        }
        assertTrue("Emulator did not commit the frame for $name", frame.await(5, TimeUnit.SECONDS))
        // A committed frame may still be waiting for the display compositor.
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
