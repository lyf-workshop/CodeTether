package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.account.PairedComputer
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteMessage
import org.codetether.app.remote.RemoteProject
import java.util.UUID

@Composable
private fun ListPage(
    title: String,
    summary: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 820.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PageTitle(title, summary)
            content()
        }
    }
}

@Composable
private fun Empty(text: String) {
    Group { RowItem(text) }
}

@Composable
internal fun DevicesPage(state: TabletState, go: (TabletPage) -> Unit) {
    ListPage("设备", "查看每台电脑和它可以访问的设备。") {
        QuietButton("输入配对码") { go(TabletPage.Pair) }
        state.computers.forEach { entry ->
            SectionTitle(entry.computer.name)
            val machines = entry.workspace?.machines.orEmpty()
            if (machines.isEmpty()) Empty(entry.problem ?: "正在连接…") else Group {
                machines.forEachIndexed { index, machine ->
                    if (index > 0) Rule()
                    RowItem(machine.name, machineSubtitle(entry, machine), trailing = machine.platform) {
                        go(TabletPage.Device(entry.computer.id, machine.id))
                    }
                }
            }
        }
    }
}

@Composable
internal fun DevicePage(state: TabletState, page: TabletPage.Device, go: (TabletPage) -> Unit) {
    val entry = state.computer(page.computerId)
    val machine = state.machine(page.computerId, page.machineId)
    ListPage(machine?.name ?: "设备", machine?.let { entry?.let { owner -> machineSubtitle(owner, it) } }) {
        QuietButton("所有设备") { go(TabletPage.Devices) }
        if (entry?.connection == null || machine?.available != true) {
            Empty(entry?.problem ?: "这台电脑现在连不上，请确认它开着并且联网")
        }
        val workspace = entry?.workspace
        if (workspace != null) {
            SectionTitle("项目")
            val projects = workspace.projects.filter { it.machineId == page.machineId }
            if (projects.isEmpty()) Empty("没有项目") else Group {
                projects.forEachIndexed { index, project ->
                    if (index > 0) Rule()
                    RowItem(project.name, if (project.available) null else "暂时无法访问") {
                        go(TabletPage.Project(page.computerId, project))
                    }
                }
            }
            SectionTitle("最近的会话")
            val recent = workspace.recent.filter { it.target.machineId == page.machineId && !it.archived }
            if (recent.isEmpty()) Empty("没有会话") else Group {
                recent.take(5).forEachIndexed { index, row ->
                    if (index > 0) Rule()
                    ConversationRow(page.computerId, row, state, go)
                }
            }
        }
        if (!machine?.providers.isNullOrEmpty()) {
            SectionTitle("AI 工具")
            Group {
                machine?.providers?.forEachIndexed { index, provider ->
                    if (index > 0) Rule()
                    RowItem(provider.displayName, providerStatus(provider.status))
                }
            }
        }
    }
}

private fun machineSubtitle(entry: ComputerView, machine: RemoteMachine): String {
    val online = entry.connection != null && machine.available && machine.status in setOf("online", "local")
    return listOfNotNull(
        if (online) "在线" else "离线",
        if (!machine.isLocal) "经由 ${entry.computer.name}" else null,
    ).joinToString(" · ")
}

private fun providerStatus(status: String): String = when (status) {
    "available" -> "可用"
    "not_installed" -> "尚未安装，请在电脑上处理"
    "misconfigured", "unauthenticated" -> "请先在电脑上登录"
    "unsupported_version" -> "版本不支持，请在电脑上检查"
    else -> "暂时不可用"
}

@Composable
private fun ConversationRow(computer: String, row: RemoteConversation, state: TabletState, go: (TabletPage) -> Unit) {
    ConversationListRow(computer, row, state) { go(TabletPage.Conversation(computer, row.target)) }
}

@Composable
internal fun ConversationPage(state: TabletState, target: TabletPage.Conversation, actions: TabletActions) {
    val detail = state.detail
    if (detail == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(if (state.error == null) "正在读取会话…" else "暂时无法读取会话", color = ink.secondary)
        }
        return
    }
    val computer = state.computer(target.computerId)
    val connected = computer?.connection != null
    val machine = state.machine(target.computerId, target.target.machineId)
    val project = computer?.workspace?.projects?.firstOrNull {
        it.id == target.target.projectId && it.machineId == target.target.machineId
    }
    val messages = (state.olderMessages + detail.history.messages).distinctBy { it.id }
    val activeTurnId = detail.activeTurnId
    val activeTurn = detail.history.turns.lastOrNull { it.id == activeTurnId }
    val running = connected && detail.conversation.status == "running"
    val activeTool = if (running && activeTurn != null) detail.history.messages.lastOrNull {
        it.turnId == activeTurn.id && it.role == "tool" && it.status == "running" && it.text.isNotBlank()
    } else null
    val runningAction = activeTool?.let { "正在执行 · ${it.text}" } ?: "正在运行"
    val provider = providerLabel(detail.conversation.provider)
    val stop = activeTurn?.takeIf { connected && detail.canInterrupt }?.let { turn ->
        { actions.interrupt(target, turn.id) }
    }
    val list = rememberLazyListState()
    val mutation = state.sendMutation(target)
    var draft by rememberSaveable(target.computerId, target.target) { mutableStateOf(mutation?.request?.text.orEmpty()) }
    val awaitingResult = mutation?.unresolved == true
    val canSend = connected && detail.canSend && !state.busy && !awaitingResult
    fun send() {
        if (draft.isNotBlank() && canSend) {
            actions.send(target, draft, newSubmissionActionId())
        }
    }
    LaunchedEffect(mutation?.actionId, mutation?.status) {
        if (mutation?.status == MutationStatus.Success) {
            if (draft == mutation.request.text) draft = ""
            actions.acknowledgeMutation(mutation.actionId)
        }
    }
    val last = messages.lastOrNull()
    LaunchedEffect(last?.id, last?.text, detail.attention.size, running, runningAction) {
        val count = list.layoutInfo.totalItemsCount
        val visible = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        if (count > 0 && (list.firstVisibleItemIndex == 0 || visible >= count - 2)) {
            list.scrollToItem(count - 1)
        }
    }
    Column(Modifier.fillMaxSize().background(ink.card)) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                Modifier.widthIn(max = 760.dp).fillMaxWidth().fillMaxHeight().padding(horizontal = 28.dp),
                state = list,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item("status") {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Badge(if (detail.conversation.archived) "archived" else detail.conversation.status)
                        tabletRelativeTime(detail.conversation.lastActivityAt)?.let {
                            Text(it, color = ink.secondary, fontSize = 13.sp)
                        }
                    }
                }
                if (state.olderCursor != null) item("older") {
                    QuietButton("加载更早的会话", Modifier.fillMaxWidth(), !state.busy, actions::older)
                }
                if (detail.conversation.origin == "adopted_native") item("imported") {
                    Text("从 ${providerLabel(detail.conversation.provider)} 导入", color = ink.secondary, fontSize = 13.sp)
                }
                items(messages, key = { "message-${it.id}" }) { message ->
                    TimelineMessage(message, provider)
                }
                items(detail.attention.filter { it.type == "approval" }, key = { "approval-${it.id}" }) { item ->
                    ConversationApprovalCard(
                        item = item,
                        location = listOfNotNull(machine?.name, project?.name).joinToString(" · "),
                        actionable = detail.canApprove && item.canApprove && connected,
                        enabled = !state.busy,
                        approve = { actions.approve(target.computerId, item, true) },
                        decline = { actions.approve(target.computerId, item, false) },
                    )
                }
                val failed = detail.history.turns.lastOrNull()?.takeIf { it.status == "failed" }
                if (failed != null) item("failure") {
                    Column(Modifier.fillMaxWidth().clip(cardShape).background(ink.failedCard).padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("这轮没有完成", color = ink.failed, fontWeight = FontWeight.Bold)
                        failed.error?.let { Text(it, color = ink.secondary) }
                        val priorInput = failed.input
                        if (failed.canRetry && canSend && !priorInput.isNullOrBlank()) {
                            QuietButton("重试") { actions.send(target, priorInput, newSubmissionActionId()) }
                        }
                    }
                }
                if (running) item("running") { RunningTimelineStatus(provider, runningAction) }
                item("end") { Spacer(Modifier.height(10.dp)) }
            }
        }
        Rule()
        Box(Modifier.fillMaxWidth().background(ink.bar).padding(start = 24.dp, top = 10.dp, end = 24.dp, bottom = 14.dp),
            contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth()) {
                when {
                    !connected -> Text("这台电脑现在连不上，请确认它开着并且联网", Modifier.padding(10.dp), color = ink.secondary)
                    detail.conversation.status == "waiting" -> WaitingComposerStatus(!state.busy, stop)
                    running -> RunningComposerStatus(runningAction, activeTurn?.startedAt, !state.busy, stop)
                    detail.conversation.archived -> Text("这条会话已归档", Modifier.padding(10.dp), color = ink.secondary)
                    !detail.canSend -> Text("暂时不能发送消息", Modifier.padding(10.dp), color = ink.secondary)
                    else -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        InkField(draft, { draft = it.take(64 * 1024) }, "继续对话",
                            Modifier.weight(1f).onPreviewKeyEvent { event ->
                                if (event.type == KeyEventType.KeyDown && event.isCtrlPressed && event.key == Key.Enter) {
                                    send()
                                    true
                                } else false
                            }, singleLine = false, enabled = !state.busy)
                        InkButton("发送", enabled = canSend && draft.isNotBlank(), onClick = ::send)
                    }
                }
                mutation?.message?.let { Text(it, color = ink.failed, fontSize = 13.sp) }
                if (mutation?.status == MutationStatus.Unknown) {
                    Text("重试会使用上次提交的内容。", color = ink.secondary, fontSize = 13.sp)
                    QuietButton("重试", enabled = connected && detail.canControl && !state.busy) { actions.retryMutation(mutation.actionId) }
                }
            }
        }
    }
}

@Composable
private fun TimelineMessage(message: RemoteMessage, provider: String) {
    val fromUser = message.role == "user"
    val tool = message.role == "tool" || message.role == "system"
    Box(Modifier.fillMaxWidth(), contentAlignment = if (fromUser) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(
            Modifier.widthIn(max = if (fromUser) 555.dp else 760.dp)
                .clip(cardShape).background(if (fromUser || tool) ink.bar else ink.card).padding(12.dp),
        ) {
            if (!fromUser && !tool) Text(provider, fontWeight = FontWeight.Bold, color = ink.text)
            Text(message.text, color = if (tool) ink.secondary else ink.text,
                fontFamily = if (tool) FontFamily.Monospace else FontFamily.Default,
                fontSize = if (tool) 13.sp else 15.sp, lineHeight = 21.sp)
        }
    }
}

@Composable
private fun ApprovalButtons(enabled: Boolean, approve: () -> Unit, decline: () -> Unit) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        InkButton("允许一次", enabled = enabled, onClick = approve)
        QuietButton("拒绝", enabled = enabled, onClick = decline)
    }
}

@Composable
internal fun SettingsPage(state: TabletState, page: TabletPage.Settings, actions: TabletActions, go: (TabletPage) -> Unit) {
    if (page.section == SettingSection.Connection) {
        ConnectionCheckPage(state, actions)
        return
    }
    var removing by remember { mutableStateOf<PairedComputer?>(null) }
    var signOut by remember { mutableStateOf(false) }
    ListPage("设置") {
        Group {
            SettingSection.entries.forEachIndexed { index, section ->
                if (index > 0) Rule()
                RowItem(section.label, active = section == page.section) { go(TabletPage.Settings(section)) }
            }
        }
        SectionTitle(page.section.label)
        when (page.section) {
            SettingSection.Account -> Group {
                RowItem("已登录", state.profile?.email)
                QuietButton("退出登录", enabled = !state.busy) { signOut = true }
            }
            SettingSection.Computers -> {
                Group {
                    state.computers.forEachIndexed { index, entry ->
                        if (index > 0) Rule()
                        RowItem(entry.computer.name, if (entry.connection != null) "在线" else "暂时连不上")
                        QuietButton("移除 ${entry.computer.name}", enabled = !state.busy) { removing = entry.computer }
                    }
                    QuietButton("输入配对码") { go(TabletPage.Pair) }
                }
            }
            SettingSection.Appearance -> Segments(Appearance.entries.map { it.label to (state.appearance == it) }) {
                actions.setAppearance(Appearance.entries[it])
            }
            SettingSection.Connection -> Unit
            SettingSection.Plans -> Group {
                listOf(
                    "添加项目、浏览文件夹和导入以前的会话",
                    "移除项目、项目内搜索、置顶、重命名和恢复",
                    "通知、后台保持连接和解锁确认",
                    "手机布局和切换 AI 工具使用的服务",
                ).forEachIndexed { index, plan ->
                    if (index > 0) Rule()
                    RowItem(plan)
                }
            }
        }
    }
    removing?.let { computer ->
        CenterSheet("移除电脑", { removing = null }) {
            Text("移除后将与 ${computer.name} 断开。电脑上正在运行的工作会继续。", color = ink.secondary)
            InkButton("移除", Modifier.fillMaxWidth(), !state.busy) {
                removing = null
                actions.removeComputer(computer)
            }
        }
    }
    if (signOut) CenterSheet("退出登录", { signOut = false }) {
        Text("退出后，这台设备会断开连接。电脑上正在运行的工作会继续。", color = ink.secondary)
        InkButton("退出登录", Modifier.fillMaxWidth(), !state.busy) {
            signOut = false
            actions.signOut()
        }
    }
}

@Composable
internal fun CreateSheet(
    state: TabletState,
    actions: TabletActions,
    onDismiss: () -> Unit,
    onCreated: (String, ConversationTarget) -> Unit,
) {
    val available = state.computers.flatMap { entry ->
        entry.workspace?.projects.orEmpty().map { entry to it }
    }
    val outstanding = state.mutations.filter { it.request is MutationRequest.Create && it.unresolved }
    val initial = outstanding.firstOrNull()?.request as? MutationRequest.Create
    var selectedComputerId by rememberSaveable { mutableStateOf(initial?.computerId) }
    var selectedMachineId by rememberSaveable { mutableStateOf(initial?.project?.machineId) }
    var selectedProjectId by rememberSaveable { mutableStateOf(initial?.project?.id) }
    var providerSelection by rememberSaveable { mutableStateOf(initial?.provider) }
    var reasoning by rememberSaveable { mutableStateOf(initial?.reasoning) }
    var text by rememberSaveable { mutableStateOf(initial?.text.orEmpty()) }
    val selected = available.firstOrNull { (entry, row) ->
        entry.computer.id == selectedComputerId && row.machineId == selectedMachineId && row.id == selectedProjectId
    }
    val stored = state.mutations.mapNotNull { it.request as? MutationRequest.Create }.firstOrNull {
        it.computerId == selectedComputerId && it.project.machineId == selectedMachineId && it.project.id == selectedProjectId
    }
    val project = selected?.let { it.first.computer.id to it.second } ?: stored?.let { it.computerId to it.project }
    val machine = project?.let { state.machine(it.first, it.second.machineId) }
    val provider = machine?.providers?.firstOrNull { it.id == providerSelection }
    val owner = project?.let { state.computer(it.first) }
    val mutation = project?.let { state.createMutation(it.first, it.second) }
    val awaitingResult = mutation?.unresolved == true
    val stillAvailable = owner?.workspace?.projects?.any { it.id == project?.second?.id &&
        it.machineId == project?.second?.machineId && it.available } == true
    val enabled = stillAvailable && owner?.connection != null && owner.workspace?.canControl == true &&
        machine?.available == true && provider?.canStart == true && text.isNotBlank() && !state.busy && !awaitingResult
    LaunchedEffect(mutation?.actionId, mutation?.status) {
        val request = mutation?.request as? MutationRequest.Create
        if (mutation?.status == MutationStatus.Success && request != null) {
            if (text == request.text && providerSelection == request.provider && reasoning == request.reasoning) {
                mutation.result?.let { onCreated(request.computerId, it) }
                onDismiss()
            }
            actions.acknowledgeMutation(mutation.actionId)
        }
    }
    fun send() {
        val selection = project ?: return
        val tool = provider ?: return
        if (enabled) {
            actions.create(selection.first, selection.second, tool.id, text, reasoning, newSubmissionActionId())
        }
    }
    CenterSheet("新建会话", onDismiss) {
        Column(Modifier.heightIn(max = 530.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (outstanding.isNotEmpty()) {
                SectionTitle("待确认的创建")
                Group {
                    outstanding.forEachIndexed { index, entry ->
                        val request = entry.request as MutationRequest.Create
                        if (index > 0) Rule()
                        RowItem(request.project.name, if (entry.status == MutationStatus.Pending) "正在创建" else "结果待确认",
                            modifier = Modifier.testTag("pending-create-$index"),
                            onClick = if (!state.busy) ({
                                selectedComputerId = request.computerId
                                selectedMachineId = request.project.machineId
                                selectedProjectId = request.project.id
                                providerSelection = request.provider
                                reasoning = request.reasoning
                                text = request.text
                            }) else null)
                    }
                }
            }
            SectionTitle("项目")
            if (available.isEmpty()) Empty("没有可以使用的项目") else Group {
                available.forEachIndexed { index, (entry, row) ->
                    if (index > 0) Rule()
                    val canUse = row.available && entry.connection != null && entry.workspace?.canControl == true
                    RowItem(row.name, if (canUse) entry.computer.name else "${entry.computer.name} · 暂时不能使用",
                        active = project == (entry.computer.id to row),
                        modifier = Modifier.testTag("new-project-${row.id}"),
                        onClick = if (canUse && !state.busy) ({
                            if (project != (entry.computer.id to row)) {
                                providerSelection = null
                                reasoning = null
                            }
                            selectedComputerId = entry.computer.id
                            selectedMachineId = row.machineId
                            selectedProjectId = row.id
                        }) else null)
                }
            }
            if (machine != null) {
                SectionTitle("AI 工具")
                Group {
                    machine.providers.forEachIndexed { index, tool ->
                        if (index > 0) Rule()
                        RowItem(tool.displayName, providerStatus(tool.status), active = tool.id == providerSelection,
                            onClick = if (tool.canStart && !state.busy) ({
                                if (providerSelection != tool.id) {
                                    providerSelection = tool.id
                                    reasoning = null
                                }
                            }) else null)
                    }
                }
            }
            if (provider?.id == "claude-code" && provider.reasoning.isNotEmpty()) {
                SectionTitle("推理强度")
                val options = listOf(null to "默认") + provider.reasoning.map { it.id to it.label }
                Segments(options.map { it.second to (reasoning == it.first) }) {
                    if (!state.busy) reasoning = options[it].first
                }
            }
            InkField(text, { text = it.take(64 * 1024) }, "第一条消息", Modifier.onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.isCtrlPressed && event.key == Key.Enter) {
                    send()
                    true
                } else false
            }, singleLine = false, enabled = !state.busy)
            mutation?.message?.let { Text(it, color = ink.failed, fontSize = 13.sp) }
            if (mutation?.status == MutationStatus.Unknown) {
                Text("重试会使用上次提交的内容和选择。", color = ink.secondary, fontSize = 13.sp)
                QuietButton("重试", enabled = !state.busy && owner?.connection != null && owner.workspace?.canControl == true) {
                    actions.retryMutation(mutation.actionId)
                }
            }
            InkButton("创建会话", Modifier.fillMaxWidth(), enabled, ::send)
        }
    }
}

private fun newSubmissionActionId(): String = "act_${UUID.randomUUID().toString().replace("-", "")}"
