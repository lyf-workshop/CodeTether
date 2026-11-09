package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.remote.ConversationTarget
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
    CenterSheet("新建会话", onDismiss, header = { title ->
        CreateSheetHeader(title, enabled, onDismiss, ::send)
    }) {
        Column(
            Modifier.heightIn(max = 530.dp).verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
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
            if (machine != null && machine.providers.isNotEmpty()) {
                SectionTitle("AI 工具")
                val tools = machine.providers
                TabletListSegments(
                    options = tools.map { tool ->
                        val reason = when {
                            tool.status == "not_installed" -> "没有安装"
                            tool.requiresSignIn || tool.status == "unauthenticated" -> "要在电脑上登录"
                            tool.status == "unsupported_version" -> "版本不支持"
                            else -> "暂时不可用"
                        }
                        val label = if (tool.canStart) tool.displayName else "${tool.displayName}（$reason）"
                        label to (tool.id == providerSelection)
                    },
                    optionEnabled = { tools[it].canStart && !state.busy },
                ) { index ->
                    val tool = tools[index]
                    if (providerSelection != tool.id) {
                        providerSelection = tool.id
                        reasoning = null
                    }
                }
            }
            if (provider?.id == "claude-code" && provider.reasoning.isNotEmpty()) {
                SectionTitle("推理强度")
                val options = listOf(null to "默认") + provider.reasoning.map { it.id to it.label }
                TabletListSegments(options.map { it.second to (reasoning == it.first) }, optionEnabled = { !state.busy }) {
                    reasoning = options[it].first
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
        }
    }
}

@Composable
private fun CreateSheetHeader(title: String, enabled: Boolean, onDismiss: () -> Unit, onStart: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).background(ink.bar),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.width(72.dp).heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onDismiss)
                .semantics { contentDescription = "关闭窗口" },
            contentAlignment = Alignment.Center,
        ) { Text("取消", color = ink.text, fontSize = 15.sp) }
        Text(title, Modifier.weight(1f), color = ink.text, fontWeight = FontWeight.Bold,
            fontSize = 17.sp, textAlign = TextAlign.Center)
        Box(
            Modifier.width(72.dp).heightIn(min = 48.dp).clickable(enabled = enabled, role = Role.Button, onClick = onStart),
            contentAlignment = Alignment.Center,
        ) {
            Text("开始", color = if (enabled) ink.text else ink.secondary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
    Rule()
}

private fun newSubmissionActionId(): String = "act_${UUID.randomUUID().toString().replace("-", "")}"
