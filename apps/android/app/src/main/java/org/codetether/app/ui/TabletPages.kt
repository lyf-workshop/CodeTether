package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChangeKey
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteMessage
import org.codetether.app.remote.RemoteProject
import java.util.UUID
import uniffi.supervisor_mobile.ConnectionMode

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
internal fun HomePage(state: TabletState, go: (TabletPage) -> Unit) {
    ListPage("最近的会话", "所有电脑和设备上的会话，按设备分组。") {
        val attention = state.computers.flatMap { entry ->
            entry.workspace?.attention.orEmpty().map { entry.computer.id to it }
        }
        if (attention.isNotEmpty()) {
            SectionTitle("需要你处理  ${attention.size} 个")
            Group {
                attention.take(5).forEachIndexed { index, (computer, item) ->
                    if (index > 0) Rule()
                    val target = item.target
                    RowItem(item.title, attentionLabel(item.type), onClick = target?.let {
                        { go(TabletPage.Conversation(computer, it)) }
                    })
                }
            }
        }
        if (state.computers.isEmpty()) Empty("配对一台电脑后，会话会显示在这里。")
        state.computers.forEach { entry ->
            val workspace = entry.workspace
            if (workspace == null) {
                SectionTitle(entry.computer.name)
                Empty(entry.problem ?: "正在连接…")
            } else workspace.machines.forEach { machine ->
                val rows = workspace.recent.filter { it.target.machineId == machine.id && !it.archived }.take(5)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        SectionTitle(machine.name)
                        Text(machineSubtitle(entry, machine), Modifier.padding(start = 12.dp), color = ink.secondary, fontSize = 13.sp)
                    }
                    QuietButton("查看全部") { go(TabletPage.Device(entry.computer.id, machine.id)) }
                }
                if (rows.isEmpty()) Empty("这里还没有会话") else Group {
                    rows.forEachIndexed { index, row ->
                        if (index > 0) Rule()
                        ConversationRow(entry.computer.id, row, state, go)
                    }
                }
            }
        }
    }
}

@Composable
internal fun InboxPage(state: TabletState, actions: TabletActions, go: (TabletPage) -> Unit) {
    var filter by remember { mutableStateOf<String?>(null) }
    val sections = listOf(null to "全部", "approval" to "等待批准", "completed_review" to "已完成待查看", "failed" to "失败")
    val attention = state.computers.flatMap { entry ->
        entry.workspace?.attention.orEmpty().map { entry to it }
    }.filter { filter == null || it.second.type == filter }
    ListPage("待处理", "在这里处理需要批准、已完成和失败的工作。") {
        Segments(sections.map { it.second to (it.first == filter) }) { filter = sections[it].first }
        if (attention.isEmpty()) Empty("没有需要处理的事项")
        attention.forEach { (computer, item) ->
            Group {
                val target = item.target
                RowItem(item.title, "${computer.computer.name} · ${attentionLabel(item.type)}", onClick = target?.let {
                    { go(TabletPage.Conversation(computer.computer.id, it)) }
                })
                item.detail?.let { Text(it, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), color = ink.secondary) }
                if (computer.connection != null) {
                    when {
                        item.canApprove -> ApprovalButtons(
                            !state.busy,
                            { actions.approve(computer.computer.id, item, true) },
                            { actions.approve(computer.computer.id, item, false) },
                        )
                        item.type != "approval" && computer.workspace?.canControl == true ->
                            QuietButton(if (item.type == "failed") "知道了" else "处理完成", enabled = !state.busy) {
                                actions.resolveAttention(computer.computer.id, item)
                            }
                    }
                }
            }
        }
    }
}

private fun attentionLabel(type: String): String = when (type) {
    "approval" -> "等待批准"
    "completed_review" -> "已完成待查看"
    else -> "失败"
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
internal fun ProjectPage(
    state: TabletState,
    page: TabletPage.Project,
    actions: TabletActions,
    go: (TabletPage) -> Unit,
) {
    val statuses = listOf(null to "全部", "running" to "运行中", "waiting" to "等待批准", "completed" to "已完成", "failed" to "失败")
    val machine = state.machine(page.computerId, page.project.machineId)
    ListPage(page.project.name, machine?.name) {
        QuietButton("返回设备") { go(TabletPage.Device(page.computerId, page.project.machineId)) }
        Segments(listOf("会话" to !state.projectArchived, "已归档" to state.projectArchived)) {
            actions.setProjectFilter(it == 1, state.projectStatus)
        }
        Segments(statuses.map { it.second to (it.first == state.projectStatus) }) {
            actions.setProjectFilter(state.projectArchived, statuses[it].first)
        }
        if (state.projectLoading) Empty("正在读取会话…")
        else if (state.projectRows.isEmpty()) Empty("没有符合条件的会话") else Group {
            state.projectRows.forEachIndexed { index, row ->
                if (index > 0) Rule()
                ConversationRow(page.computerId, row, state, go)
            }
        }
    }
}

@Composable
private fun ConversationRow(computer: String, row: RemoteConversation, state: TabletState, go: (TabletPage) -> Unit) {
    val project = state.computer(computer)?.workspace?.projects?.firstOrNull { it.id == row.target.projectId }?.name
    RowItem(
        row.title,
        listOfNotNull(providerLabel(row.provider), project, statusLabel(if (row.archived) "archived" else row.status))
            .joinToString(" · "),
    ) { go(TabletPage.Conversation(computer, row.target)) }
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
    val connected = state.computer(target.computerId)?.connection != null
    val messages = (state.olderMessages + detail.history.messages).distinctBy { it.id }
    val list = rememberLazyListState()
    var draft by rememberSaveable(target.computerId, target.target) { mutableStateOf("") }
    var submittedDraft by rememberSaveable(target.computerId, target.target) { mutableStateOf<String?>(null) }
    var pendingActionId by rememberSaveable(target.computerId, target.target) { mutableStateOf<String?>(null) }
    var submissionMessage by rememberSaveable(target.computerId, target.target) { mutableStateOf<String?>(null) }
    val canSend = connected && detail.canSend && !state.busy && pendingActionId == null
    fun send() {
        val input = draft.trim()
        if (input.isNotEmpty() && canSend) {
            val actionId = newSubmissionActionId()
            pendingActionId = actionId
            submittedDraft = draft
            submissionMessage = null
            actions.send(target, input, actionId)
        }
    }
    LaunchedEffect(state.sendOutcome, pendingActionId) {
        val outcome = state.sendOutcome?.takeIf { it.actionId == pendingActionId }
        when (outcome?.status) {
            MutationStatus.Success -> {
                if (draft == submittedDraft) draft = ""
                pendingActionId = null
                submittedDraft = null
                submissionMessage = null
            }
            MutationStatus.Failed -> {
                pendingActionId = null
                submittedDraft = null
                submissionMessage = outcome.message
            }
            MutationStatus.Unknown -> submissionMessage = outcome.message ?: "暂时无法确认这次操作的结果。"
            MutationStatus.Pending, null -> Unit
        }
    }
    val last = messages.lastOrNull()
    LaunchedEffect(last?.id, last?.text, detail.attention.size) {
        val count = list.layoutInfo.totalItemsCount
        val visible = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        if (count > 0 && (list.firstVisibleItemIndex == 0 || visible >= count - 2)) {
            list.scrollToItem(count - 1)
        }
    }
    Column(Modifier.fillMaxSize().background(ink.card)) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                Modifier.widthIn(max = 760.dp).fillMaxWidth().fillMaxHeight().padding(horizontal = 16.dp),
                state = list,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item("status") {
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.Center) {
                        Badge(if (detail.conversation.archived) "archived" else detail.conversation.status)
                    }
                }
                if (state.olderCursor != null) item("older") {
                    QuietButton("加载更早的会话", Modifier.fillMaxWidth(), !state.busy, actions::older)
                }
                if (detail.conversation.origin == "adopted_native") item("imported") {
                    Text("从 ${providerLabel(detail.conversation.provider)} 导入", color = ink.secondary, fontSize = 13.sp)
                }
                items(messages, key = { "message-${it.id}" }) { message ->
                    TimelineMessage(message, providerLabel(detail.conversation.provider))
                }
                items(detail.attention.filter { it.type == "approval" }, key = { "approval-${it.id}" }) { item ->
                    Column(Modifier.fillMaxWidth().clip(cardShape).background(ink.warningCard).padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("需要你批准", color = ink.waiting, fontWeight = FontWeight.Bold)
                        Text(item.title, color = ink.text)
                        item.detail?.let { Text(it, color = ink.secondary, fontFamily = FontFamily.Monospace) }
                        if (detail.canApprove && item.canApprove && connected) {
                            ApprovalButtons(!state.busy, { actions.approve(target.computerId, item, true) },
                                { actions.approve(target.computerId, item, false) })
                        }
                    }
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
                item("end") { Spacer(Modifier.height(10.dp)) }
            }
        }
        Rule()
        Box(Modifier.fillMaxWidth().background(ink.bar).padding(horizontal = 14.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth()) {
                when {
                    !connected -> Text("这台电脑现在连不上，请确认它开着并且联网", Modifier.padding(10.dp), color = ink.secondary)
                    detail.conversation.status in setOf("running", "waiting") -> Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (detail.conversation.status == "waiting") "先处理上面的批准，这一轮结束后再发送"
                            else "正在运行，这一轮结束后再发送", Modifier.weight(1f), color = ink.secondary)
                        val activeTurn = detail.activeTurnId
                        if (detail.canInterrupt && activeTurn != null) {
                            QuietButton("停止", enabled = !state.busy) { actions.interrupt(target, activeTurn) }
                        }
                    }
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
                submissionMessage?.let { Text(it, color = ink.failed, fontSize = 13.sp) }
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
internal fun ChangesPanel(modifier: Modifier, state: TabletState, close: () -> Unit, refresh: () -> Unit) {
    var chosen by remember(state.page) { mutableStateOf<RemoteChangeKey?>(null) }
    val selected = state.changes.firstOrNull { it.key == chosen } ?: state.changes.firstOrNull()
    Column(modifier.testTag("changes-panel").fillMaxHeight().background(ink.background)) {
        Row(Modifier.fillMaxWidth().background(ink.bar).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("变更", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 17.sp, color = ink.text)
            QuietButton("刷新", enabled = !state.changesLoading, onClick = refresh)
            IconAction("×", "关闭变更", close)
        }
        Rule()
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.changes.isEmpty()) Empty(if (state.changesLoading) "正在读取变更…" else "没有变更")
            else Group {
                state.changes.forEachIndexed { index, change ->
                    if (index > 0) Rule()
                    val counts = listOfNotNull(change.additions?.let { "+$it" }, change.deletions?.let { "−$it" })
                    RowItem(change.path.substringAfterLast('/').substringAfterLast('\\'),
                        trailing = counts.joinToString(" "), active = selected?.key == change.key,
                        modifier = Modifier.testTag("change-row-$index")) { chosen = change.key }
                }
            }
            if (selected != null) Group(Modifier.testTag("change-diff")) {
                RowItem(selected.path)
                Rule()
                val diff = selected.diff
                if (diff == null) RowItem("没有可显示的逐行差异") else {
                    Column(Modifier.testTag("change-diff-lines").horizontalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                        diff.lineSequence().forEachIndexed { lineIndex, line ->
                            val added = line.startsWith("+") && !line.startsWith("+++")
                            val removed = line.startsWith("-") && !line.startsWith("---")
                            val color = if (added) ink.done else if (removed) ink.failed else ink.text
                            Text(line.ifEmpty { " " }, Modifier.testTag("change-line-$lineIndex").fillMaxWidth().background(color.copy(alpha = if (added || removed) .12f else 0f))
                                .padding(horizontal = 8.dp, vertical = 2.dp), color = color,
                                fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SettingsPage(state: TabletState, page: TabletPage.Settings, actions: TabletActions, go: (TabletPage) -> Unit) {
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
            SettingSection.Connection -> {
                Segments(listOf("自动" to (state.mode == ConnectionMode.AUTO), "只走 Relay" to (state.mode == ConnectionMode.RELAY))) {
                    actions.setMode(if (it == 1) ConnectionMode.RELAY else ConnectionMode.AUTO)
                }
                Group {
                    state.computers.forEach { entry ->
                        RowItem(entry.computer.name, when (entry.connection?.transport) {
                            "direct" -> "直连 · Supervisor"
                            "relay" -> "Relay · Supervisor"
                            else -> entry.problem ?: "正在检查连接"
                        })
                    }
                    state.keyProtection?.let { RowItem("设备密钥保护", it) }
                    QuietButton("重新检查", enabled = !state.busy, onClick = actions::refresh)
                }
            }
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
internal fun SearchSheet(
    loaded: List<Pair<String, RemoteConversation>>,
    onDismiss: () -> Unit,
    open: (String, RemoteConversation) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    CenterSheet("搜索会话", onDismiss) {
        InkField(query, { query = it.take(240) }, "按标题搜索")
        Text("只搜索已经读取的会话标题。", color = ink.secondary, fontSize = 13.sp)
        val filtered = loaded.filter { (_, row) -> row.title.contains(query.trim(), ignoreCase = true) }.take(40)
        if (filtered.isEmpty()) Empty("没有匹配的会话") else {
            Group(Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState())) {
                filtered.forEachIndexed { index, (computer, row) ->
                    if (index > 0) Rule()
                    RowItem(row.title, providerLabel(row.provider)) { open(computer, row) }
                }
            }
        }
    }
}

@Composable
internal fun CreateSheet(
    state: TabletState,
    onDismiss: () -> Unit,
    submit: (String, RemoteProject, String, String, String?, String) -> Unit,
) {
    val available = state.computers.flatMap { entry ->
        entry.workspace?.projects.orEmpty().map { entry to it }
    }
    var selectedComputerId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedMachineId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedProjectId by rememberSaveable { mutableStateOf<String?>(null) }
    var providerSelection by rememberSaveable(selectedComputerId, selectedMachineId, selectedProjectId) { mutableStateOf<String?>(null) }
    var reasoning by rememberSaveable(selectedComputerId, selectedMachineId, selectedProjectId, providerSelection) { mutableStateOf<String?>(null) }
    var text by rememberSaveable { mutableStateOf("") }
    var pendingActionId by rememberSaveable { mutableStateOf<String?>(null) }
    var submissionMessage by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = available.firstOrNull { (entry, row) ->
        entry.computer.id == selectedComputerId && row.machineId == selectedMachineId && row.id == selectedProjectId
    }
    val project = selected?.let { it.first.computer.id to it.second }
    val machine = project?.let { state.machine(it.first, it.second.machineId) }
    val provider = machine?.providers?.firstOrNull { it.id == providerSelection }
    val owner = project?.let { state.computer(it.first) }
    val stillAvailable = owner?.workspace?.projects?.any { it.id == project?.second?.id && it.available } == true
    val enabled = stillAvailable && owner?.connection != null && owner.workspace?.canControl == true &&
        machine?.available == true && provider?.canStart == true && text.isNotBlank() && !state.busy && pendingActionId == null
    LaunchedEffect(state.createOutcome, pendingActionId) {
        val outcome = state.createOutcome?.takeIf { it.actionId == pendingActionId }
        when (outcome?.status) {
            MutationStatus.Success -> onDismiss()
            MutationStatus.Failed -> {
                pendingActionId = null
                submissionMessage = outcome.message
            }
            MutationStatus.Unknown -> submissionMessage = outcome.message ?: "暂时无法确认这次操作的结果。"
            MutationStatus.Pending, null -> Unit
        }
    }
    fun send() {
        val selection = project ?: return
        val tool = provider ?: return
        if (enabled) {
            val actionId = newSubmissionActionId()
            pendingActionId = actionId
            submissionMessage = null
            submit(selection.first, selection.second, tool.id, text.trim(), reasoning, actionId)
        }
    }
    CenterSheet("新建会话", onDismiss) {
        Column(Modifier.heightIn(max = 530.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle("项目")
            if (available.isEmpty()) Empty("没有可以使用的项目") else Group {
                available.forEachIndexed { index, (entry, row) ->
                    if (index > 0) Rule()
                    val canUse = row.available && entry.connection != null && entry.workspace?.canControl == true
                    RowItem(row.name, if (canUse) entry.computer.name else "${entry.computer.name} · 暂时不能使用",
                        active = project == (entry.computer.id to row),
                        modifier = Modifier.testTag("new-project-${row.id}"),
                        onClick = if (canUse && !state.busy && pendingActionId == null) ({
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
                            onClick = if (tool.canStart && !state.busy && pendingActionId == null) ({ providerSelection = tool.id }) else null)
                    }
                }
            }
            if (provider?.id == "claude-code" && provider.reasoning.isNotEmpty()) {
                SectionTitle("推理强度")
                val options = listOf(null to "默认") + provider.reasoning.map { it.id to it.label }
                Segments(options.map { it.second to (reasoning == it.first) }) {
                    if (!state.busy && pendingActionId == null) reasoning = options[it].first
                }
            }
            InkField(text, { text = it.take(64 * 1024) }, "第一条消息", Modifier.onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.isCtrlPressed && event.key == Key.Enter) {
                    send()
                    true
                } else false
            }, singleLine = false, enabled = !state.busy && pendingActionId == null)
            submissionMessage?.let { Text(it, color = ink.failed, fontSize = 13.sp) }
            InkButton("创建会话", Modifier.fillMaxWidth(), enabled, ::send)
        }
    }
}

private fun newSubmissionActionId(): String = "act_${UUID.randomUUID().toString().replace("-", "")}"
