package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteAttentionCounts
import org.codetether.app.remote.RemoteConversation

@Composable
internal fun HomePage(state: TabletState, go: (TabletPage) -> Unit) {
    TabletListPage("最近的会话", "所有电脑和设备上的会话，按设备分组。") {
        val live = state.computers.flatMap { entry ->
            entry.workspace?.recent.orEmpty()
                .filter { !it.archived && it.status in setOf("waiting", "running") }
                .map { entry.computer.id to it }
        }.sortedByDescending { it.second.lastActivityAt }
        TabletListSection("需要你处理", "${live.size} 个")
        if (live.isNotEmpty()) Group {
            live.forEachIndexed { index, (computer, row) ->
                if (index > 0) TabletListRule()
                ConversationListRow(computer, row, state, withDevice = true) {
                    go(TabletPage.Conversation(computer, row.target))
                }
            }
        }
        if (state.computers.isEmpty()) TabletListEmpty("配对一台电脑后，会话会显示在这里。")
        state.computers.forEach { entry ->
            val workspace = entry.workspace
            if (workspace == null) {
                TabletListSection(entry.computer.name)
                TabletListEmpty(entry.problem ?: "正在连接…")
            } else workspace.machines.forEach { machine ->
                val rows = workspace.recent.filter { it.target.machineId == machine.id && !it.archived }
                val reachable = entry.connection != null && machine.available && (machine.isLocal || machine.status == "online")
                TabletListSection(machine.name, listMachineSubtitle(entry, machine),
                    action = "查看全部".takeIf { rows.size > 5 }) {
                    go(TabletPage.Device(entry.computer.id, machine.id))
                }
                if (rows.isEmpty()) TabletListEmpty("还没有会话") else Group(Modifier.alpha(if (reachable) 1f else .55f)) {
                    rows.take(5).forEachIndexed { index, row ->
                        if (index > 0) TabletListRule()
                        ConversationListRow(entry.computer.id, row, state) {
                            go(TabletPage.Conversation(entry.computer.id, row.target))
                        }
                    }
                }
                if (!reachable) {
                    val ownerName = workspace.machines.firstOrNull { it.isLocal }?.name ?: entry.computer.name
                    val text = if (!machine.isLocal && entry.connection == null) "要等 $ownerName 上线才能打开。"
                        else "离线时只能看到上次读取的列表，打开会话要等它上线。"
                    Text(text, Modifier.padding(start = 16.dp, top = 6.dp), color = ink.secondary, fontSize = 13.sp)
                }
            }
        }
    }
}

private enum class InboxType(val wire: String, val tab: String, val label: String, val icon: TabletListGlyph) {
    Approval("approval", "等待批准", "等待批准", TabletListGlyph.Shield),
    Completed("completed_review", "已完成待查看", "已完成，等你查看", TabletListGlyph.Check),
    Failed("failed", "失败", "执行失败", TabletListGlyph.Alert);

    fun count(summary: RemoteAttentionCounts): Int = when (this) {
        Approval -> summary.approval
        Completed -> summary.completedReview
        Failed -> summary.failed
    }
}

@Composable
internal fun InboxPage(state: TabletState, actions: TabletActions, go: (TabletPage) -> Unit) {
    var filter by rememberSaveable { mutableStateOf<InboxType?>(null) }
    val filters = listOf(null) + InboxType.entries
    val workspaces = state.computers.mapNotNull { it.workspace }
    val summaries = workspaces.mapNotNull { it.attentionCounts }
    val countAll = workspaces.sumOf { it.attentionCount }.takeIf { workspaces.size == state.computers.size }
    fun countFor(type: InboxType?): Int? = if (type == null) countAll else {
        summaries.sumOf(type::count).takeIf { summaries.size == state.computers.size }
    }
    val attention = state.computers.flatMap { entry ->
        entry.workspace?.attention.orEmpty().map { entry to it }
    }.filter { filter == null || it.second.type == filter?.wire }
        .sortedByDescending { it.second.createdAt }

    TabletListPage("待处理", "处理后会从这里移除。") {
        Spacer(Modifier.height(14.dp))
        TabletListSegments(filters.map { type ->
            val label = type?.tab ?: "全部"
            val count = countFor(type)
            (if (count == null) label else "$label $count") to (type == filter)
        }) { filter = filters[it] }
        Spacer(Modifier.height(8.dp))
        if (attention.isEmpty()) {
            TabletListEmpty(if ((countFor(filter) ?: 0) > 0) "已读取的列表里没有这一组事项" else "没有待处理的事")
        } else Group {
            attention.forEachIndexed { index, (computer, item) ->
                if (index > 0) TabletListRule()
                InboxRow(state, computer, item, actions, go)
            }
        }
    }
}

@Composable
private fun InboxRow(state: TabletState, entry: ComputerView, item: RemoteAttention, actions: TabletActions, go: (TabletPage) -> Unit) {
    val type = InboxType.entries.firstOrNull { it.wire == item.type } ?: InboxType.Failed
    val dark = ink.dark
    val iconColor = when (type) {
        InboxType.Approval -> if (dark) Color(0xffffb340) else Color(0xfff29a0c)
        InboxType.Completed -> if (dark) Color(0xff32d74b) else Color(0xff28a745)
        InboxType.Failed -> if (dark) Color(0xffff6961) else Color(0xffe5392f)
    }
    val labelColor = when (type) {
        InboxType.Approval -> ink.waiting
        InboxType.Completed -> ink.done
        InboxType.Failed -> ink.failed
    }
    val target = item.target
    val computerId = entry.computer.id
    val machine = target?.let { state.machine(computerId, it.machineId)?.name } ?: entry.computer.name
    val project = target?.let { scope ->
        entry.workspace?.projects?.firstOrNull { it.id == scope.projectId && it.machineId == scope.machineId }?.name
    }
    val metadata = listOfNotNull(item.provider?.let(::providerLabel), machine, project).joinToString(" · ")
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(30.dp).background(listTint, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                TabletListIcon(type.icon, iconColor)
            }
            Column(Modifier.weight(1f)) {
                Text(item.conversationTitle ?: item.title, color = ink.text, fontSize = 15.sp, lineHeight = 21.sp,
                    fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.height(22.dp).background(iconColor.copy(alpha = if (dark) .16f else .12f), CircleShape)
                        .padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                        Text(type.label, color = labelColor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Text(metadata, color = ink.secondary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            tabletRelativeTime(item.createdAt)?.let { Text(it, color = ink.secondary, fontSize = 13.sp) }
        }
        if (type == InboxType.Approval) item.detail?.takeIf { it.isNotBlank() }?.let {
            Text(it, Modifier.fillMaxWidth().background(if (dark) Color(0xff161618) else Color(0xfff5f5f7),
                RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                color = ink.text, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (type == InboxType.Approval && item.canApprove && entry.connection != null) {
                TabletListButton("允许一次", filled = true, enabled = !state.busy) { actions.approve(computerId, item, true) }
                TabletListButton("拒绝", enabled = !state.busy) { actions.approve(computerId, item, false) }
            }
            if (target != null) {
                val label = if (type == InboxType.Completed) "查看" else "打开会话"
                TabletListButton(label, tinted = type != InboxType.Approval) {
                    go(TabletPage.Conversation(computerId, target))
                }
            }
            if (type != InboxType.Approval && entry.connection != null && entry.workspace?.canControl == true) {
                TabletListButton("知道了", enabled = !state.busy) { actions.resolveAttention(computerId, item) }
            }
        }
    }
}

@Composable
private fun TabletListButton(
    label: String,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    tinted: Boolean = true,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(modifier.heightIn(min = 48.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center) {
        val background = when {
            filled && enabled -> ink.ink
            tinted -> listTint
            else -> Color.Transparent
        }
        val foreground = when {
            !enabled -> ink.secondary
            filled -> ink.onInk
            else -> ink.text
        }
        Box(Modifier.height(36.dp).background(background, CircleShape).padding(horizontal = if (tinted) 14.dp else 10.dp),
            contentAlignment = Alignment.Center) {
            Text(label, color = foreground, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
internal fun ProjectPage(state: TabletState, page: TabletPage.Project, actions: TabletActions, go: (TabletPage) -> Unit) {
    val statuses = listOf(null to "全部", "running" to "运行中", "waiting" to "等待批准", "completed" to "已完成", "failed" to "失败")
    val machine = state.machine(page.computerId, page.project.machineId)
    val entry = state.computer(page.computerId)
    TabletListPage(page.project.name, machine?.name ?: entry?.computer?.name) {
        if (machine != null && (entry?.connection == null || !machine.available)) {
            Row(Modifier.fillMaxWidth().padding(top = 18.dp).background(ink.card, cardShape).padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TabletListIcon(TabletListGlyph.WifiOff)
                Text("${machine.name} 离线，现在不能新建和发送。", color = ink.secondary, fontSize = 14.sp)
            }
        }
        Spacer(Modifier.height(14.dp))
        TabletListSegments(listOf(
            (state.projectCounts?.let { "会话 ${it.active}" } ?: "会话") to !state.projectArchived,
            (state.projectCounts?.let { "已归档 ${it.archived}" } ?: "已归档") to state.projectArchived,
        ), Modifier.widthIn(max = 360.dp)) {
            actions.setProjectFilter(it == 1, state.projectStatus)
        }
        Spacer(Modifier.height(4.dp))
        TabletListChips(statuses.map { it.second to (it.first == state.projectStatus) }) {
            actions.setProjectFilter(state.projectArchived, statuses[it].first)
        }
        Spacer(Modifier.height(6.dp))
        when {
            state.projectLoading -> TabletListEmpty("正在读取会话…")
            state.projectRows.isEmpty() -> TabletListEmpty("没有符合条件的会话")
            else -> Group {
                state.projectRows.forEachIndexed { index, row ->
                    if (index > 0) TabletListRule()
                    ConversationListRow(page.computerId, row, state) {
                        go(TabletPage.Conversation(page.computerId, row.target))
                    }
                }
            }
        }
    }
}

@Composable
internal fun SearchSheet(state: TabletState, onDismiss: () -> Unit, open: (String, RemoteConversation) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val term = query.trim()
    val filtered = if (term.isEmpty()) state.loaded.filterNot { it.second.archived }.take(6)
        else state.loaded.filter { it.second.title.contains(term, ignoreCase = true) }.take(40)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        Column(Modifier.imePadding().padding(16.dp).widthIn(max = 680.dp).fillMaxWidth()
            .clip(RoundedCornerShape(16.dp)).background(ink.background).padding(start = 22.dp, end = 22.dp, bottom = 24.dp, top = 12.dp)
            .onPreviewKeyEvent {
                if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) {
                    onDismiss()
                    true
                } else false
            }.focusRequester(focus).focusable()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BasicTextField(query, { query = it.take(240) }, Modifier.weight(1f).testTag("search-query"),
                    textStyle = TextStyle(color = ink.text, fontSize = 15.sp), singleLine = true,
                    cursorBrush = SolidColor(ink.text),
                    decorationBox = { input ->
                        Box(Modifier.heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
                            Row(Modifier.fillMaxWidth().height(38.dp).background(listTint, RoundedCornerShape(10.dp))
                                .padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                TabletListIcon(TabletListGlyph.Search, dimension = 16.dp)
                                Box(Modifier.weight(1f)) {
                                    if (query.isEmpty()) Text("按标题找会话", color = ink.secondary, fontSize = 15.sp)
                                    input()
                                }
                            }
                        }
                    })
                TabletListButton("取消", Modifier.semantics { contentDescription = "关闭窗口" }, tinted = false, onClick = onDismiss)
            }
            TabletListSection(if (term.isEmpty()) "最近" else "结果")
            if (filtered.isEmpty()) TabletListEmpty("没有匹配的会话") else {
                Group(Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState())) {
                    filtered.forEachIndexed { index, (computer, row) ->
                        if (index > 0) TabletListRule()
                        ConversationListRow(computer, row, state, withDevice = true) { open(computer, row) }
                    }
                }
            }
            Text("在已读取的会话里按标题找。", Modifier.padding(start = 16.dp, top = 6.dp), color = ink.secondary, fontSize = 13.sp)
        }
    }
}
