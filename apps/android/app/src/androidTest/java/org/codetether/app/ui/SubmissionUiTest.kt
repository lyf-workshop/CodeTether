package org.codetether.app.ui

import androidx.activity.ComponentActivity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.os.Parcel
import androidx.lifecycle.SavedStateHandle
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
import androidx.compose.ui.test.onNodeWithContentDescription
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
import org.junit.Assert.assertTrue
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
    private var savedState = SavedStateHandle()
    private var mutations = PendingMutationStore(savedState).apply { bindOwner("fixture-account") }
    private val sends = mutableListOf<String>()
    private val creates = mutableListOf<CreateRequest>()
    private val attempts = mutableListOf<MutationRequest>()
    private var cancelCount = 0
    private val actions = object : TabletActions {
        override fun navigate(page: TabletPage) {
            val detail = if (page is TabletPage.Conversation) base.detail?.copy(
                conversation = conversation.copy(target = page.target),
            ) else state.detail
            state = state.copy(page = page, detail = detail)
        }
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
            submit(MutationRequest.Create(actionId, computerId, project, provider, text, reasoning))
        }
        override fun send(target: TabletPage.Conversation, text: String, actionId: String) {
            submit(MutationRequest.Send(actionId, target.computerId, target.target, text))
        }
        override fun retryMutation(actionId: String) {
            submit(requireNotNull(mutations.find(actionId)).request)
        }
        override fun acknowledgeMutation(actionId: String) {
            mutations.remove(actionId)
            state = state.copy(mutations = mutations.all())
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
        completeMutation(sends.single(), MutationStatus.Unknown, "正在确认发送结果")
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("需要保留的草稿", fieldText("继续对话"))
        compose.onNodeWithText("发送").assertIsNotEnabled()
        assertEquals(1, sends.size)
        completeMutation(sends.single(), MutationStatus.Success)
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
                completeMutation(sends.single(), MutationStatus.Unknown, "正在确认发送结果")
                rotate(scenario, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, Configuration.ORIENTATION_LANDSCAPE)
                assertEquals("跨横竖屏保留的草稿", fieldText("继续对话"))
                compose.onNodeWithText("发送").assertIsNotEnabled()
                assertEquals(1, sends.size)
                completeMutation(sends.single(), MutationStatus.Success)
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
        completeMutation(sends.single(), MutationStatus.Unknown, "正在确认发送结果")
        compose.onNodeWithText("继续对话").performTextReplacement("稍后要发送的新草稿")
        completeMutation(sends.single(), MutationStatus.Success)
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
        completeMutation(creates.single().actionId, MutationStatus.Failed, "合成创建失败")
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
        completeMutation(retried.actionId, MutationStatus.Unknown, "正在确认创建结果")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("创建会话").assertIsNotEnabled()
        assertEquals(2, creates.size)
        completeMutation(retried.actionId, MutationStatus.Success)
        compose.onNodeWithText("第一条消息").assertDoesNotExist()
    }

    @Test
    fun unknownSendRetriesTheOriginalRequestAfterTheUserEditsTheDraft() {
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("继续对话").performTextInput("  原始发送内容  ")
        compose.onNodeWithText("发送").performClick()
        val original = attempts.single() as MutationRequest.Send
        assertEquals("  原始发送内容  ", original.text)
        completeMutation(original.actionId, MutationStatus.Unknown, "暂时无法确认发送结果")
        compose.onNodeWithText("继续对话").assertIsEnabled().performTextReplacement("后来编辑的新草稿")
        compose.onNodeWithText("重试").assertIsEnabled().performClick()
        assertEquals(listOf(original, original), attempts)
        completeMutation(original.actionId, MutationStatus.Success)
        assertEquals("后来编辑的新草稿", fieldText("继续对话"))
        compose.onNodeWithText("发送").assertIsEnabled()
        assertTrue(mutations.find(original.actionId) == null)
    }

    @Test
    fun serializedPendingSendRestoresAsRetryableWithoutALocalPendingIdentity() {
        val original = MutationRequest.Send("act_restored_send_demo", computer.id, target, "  已保存的原稿  ")
        mutations.put(PendingMutation(original, MutationStatus.Pending))
        restoreMutationStoreFromSerializedState()
        val restoration = StateRestorationTester(compose)
        restoration.setContent { TabletApp(state, actions) }
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("  已保存的原稿  ", fieldText("继续对话"))
        compose.onNodeWithText("继续对话").assertIsEnabled()
        compose.onNodeWithText("重试").assertIsEnabled().performClick()
        assertEquals(listOf(original), attempts)
        completeMutation(original.actionId, MutationStatus.Success)
        assertEquals("", fieldText("继续对话"))
    }

    @Test
    fun anotherComputerCanSendAndTheFirstConversationsEditedDraftIsRetained() {
        val otherTarget = ConversationTarget("machine_remote", "proj_remote", "conv_remote")
        val otherComputer = PairedComputer("host_remote", "另一电脑", "win32", true, "2030-01-01T00:00:00Z",
            "hauth_remote", "", 1uL, "{}", "{}", "{}")
        val otherProject = RemoteProject(otherTarget.projectId, otherTarget.machineId, "另一电脑项目", true)
        val otherMachine = machine.copy(id = otherTarget.machineId)
        state = base.copy(computers = base.computers + ComputerView(otherComputer,
            RemoteWorkspace(listOf(otherMachine), listOf(otherProject), emptyList(), emptyList(), true),
            RemoteConnection("relay", true, "2030-01-01T00:00:00Z")))
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("继续对话").performTextInput("第一台电脑的原稿")
        compose.onNodeWithText("发送").performClick()
        val original = attempts.single()
        completeMutation(original.actionId, MutationStatus.Unknown, "等待确认")
        compose.onNodeWithText("继续对话").performTextReplacement("第一台电脑的新草稿")
        compose.runOnIdle { actions.navigate(TabletPage.Conversation(otherComputer.id, otherTarget)) }
        compose.onNodeWithText("继续对话").performTextInput("第二台电脑的消息")
        compose.onNodeWithText("发送").assertIsEnabled().performClick()
        val second = attempts.last() as MutationRequest.Send
        assertEquals(otherComputer.id, second.computerId)
        assertEquals(otherTarget, second.target)
        completeMutation(second.actionId, MutationStatus.Success)
        compose.runOnIdle { actions.navigate(TabletPage.Conversation(computer.id, target)) }
        assertEquals("第一台电脑的新草稿", fieldText("继续对话"))
        compose.onNodeWithText("重试").assertIsEnabled()
        assertEquals(original, mutations.find(original.actionId)?.request)
        assertEquals(2, attempts.size)
    }

    @Test
    fun reopeningAnUnknownCreateRestoresItsPayloadAndRetryKeepsNewEdits() {
        state = base.copy(page = TabletPage.Home)
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("＋ 新建会话").performClick()
        dialogText("另一位置项目").performClick()
        dialogText("Claude Code").performClick()
        dialogText("高").performClick()
        compose.onNodeWithText("第一条消息").performScrollTo().performTextInput("  原始首条消息  ")
        compose.onNodeWithText("创建会话").performScrollTo().performClick()
        val original = attempts.single() as MutationRequest.Create
        completeMutation(original.actionId, MutationStatus.Unknown, "暂时无法确认创建结果")
        compose.onNodeWithContentDescription("关闭窗口").performClick()
        compose.onNodeWithText("＋ 新建会话").performClick()
        assertEquals("  原始首条消息  ", fieldText("第一条消息"))
        compose.onNodeWithText("第一条消息").assertIsEnabled().performTextReplacement("后来编辑的首条消息")
        compose.onNodeWithText("重试").performScrollTo().assertIsEnabled().performClick()
        assertEquals(listOf(original, original), attempts)
        completeMutation(original.actionId, MutationStatus.Success)
        assertEquals("后来编辑的首条消息", fieldText("第一条消息"))
        compose.onNodeWithText("创建会话").performScrollTo().assertIsEnabled()
        assertEquals(TabletPage.Home, state.page)
        assertTrue(mutations.find(original.actionId) == null)
    }

    @Test
    fun unknownCreationOnlyBlocksItsOriginalProjectLocation() {
        state = base.copy(page = TabletPage.Home)
        compose.setContent { TabletApp(state, actions) }
        compose.onNodeWithText("＋ 新建会话").performClick()
        dialogText("另一位置项目").performClick()
        dialogText("Codex").performClick()
        compose.onNodeWithText("第一条消息").performScrollTo().performTextInput("原位置的请求")
        compose.onNodeWithText("创建会话").performScrollTo().performClick()
        val original = attempts.single()
        completeMutation(original.actionId, MutationStatus.Unknown, "等待确认")
        dialogText("演示项目").performScrollTo().performClick()
        dialogText("Codex").performClick()
        compose.onNodeWithText("第一条消息").performScrollTo().performTextReplacement("另一个位置的请求")
        compose.onNodeWithText("创建会话").performScrollTo().assertIsEnabled().performClick()
        val other = attempts.last()
        assertTrue(original.scope != other.scope)
        assertTrue(original.actionId != other.actionId)
        assertEquals(2, mutations.all().size)
        assertEquals(original, mutations.find(original.actionId)?.request)
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

    private fun dialogText(label: String) = compose.onNode(hasText(label) and hasAnyAncestor(isDialog()))

    private fun submit(request: MutationRequest) {
        attempts += request
        when (request) {
            is MutationRequest.Send -> sends += request.actionId
            is MutationRequest.Create -> creates += CreateRequest(request.project.id, request.project.machineId,
                request.provider, request.text, request.reasoning, request.actionId)
        }
        mutations.put(PendingMutation(request, MutationStatus.Pending))
        state = state.copy(busy = true, mutations = mutations.all())
    }

    private fun completeMutation(actionId: String, status: MutationStatus, message: String? = null) {
        compose.runOnIdle {
            val previous = requireNotNull(mutations.find(actionId))
            val request = previous.request
            val result = if (status == MutationStatus.Success && request is MutationRequest.Create) {
                ConversationTarget(request.project.machineId, request.project.id, "conv_created")
            } else previous.result
            mutations.put(previous.copy(status = status, message = message, result = result))
            state = state.copy(busy = false, error = null, mutations = mutations.all())
        }
        compose.waitForIdle()
    }

    @Suppress("DEPRECATION")
    private fun restoreMutationStoreFromSerializedState() {
        val bundle = Bundle()
        for (key in savedState.keys()) {
            when (val value = savedState.get<Any?>(key)) {
                is String -> bundle.putString(key, value)
                is ArrayList<*> -> bundle.putParcelableArrayList(key, ArrayList(value.map { it as Bundle }))
                null -> bundle.putString(key, null)
                else -> error("Unexpected synthetic saved-state type")
            }
        }
        val parcel = Parcel.obtain()
        try {
            parcel.writeBundle(bundle)
            parcel.setDataPosition(0)
            val restored = requireNotNull(parcel.readBundle(javaClass.classLoader))
            savedState = SavedStateHandle(restored.keySet().associateWith { restored.get(it) })
            mutations = PendingMutationStore(savedState)
            state = state.copy(busy = false, mutations = mutations.all())
        } finally {
            parcel.recycle()
        }
    }

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
