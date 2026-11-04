package org.codetether.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.remote.RemoteConversation

private enum class Sheet { Search, Create, Archive }

@Composable
internal fun TabletApp(state: TabletState, actions: TabletActions) {
    TabletInk(state.appearance) {
        val appModifier = Modifier.fillMaxSize().background(ink.background).safeDrawingPadding().imePadding()
        when (val page = state.page) {
            TabletPage.SignIn -> Box(appModifier, contentAlignment = Alignment.Center) {
                SignIn(state, actions)
            }
            TabletPage.Pair -> Box(appModifier, contentAlignment = Alignment.Center) {
                PairScreen(state, actions, canReturn = state.computers.isNotEmpty())
            }
            is TabletPage.Removed -> Box(appModifier, contentAlignment = Alignment.Center) {
                EntryCard {
                    PageTitle("这台电脑移除了此设备")
                    Text("${page.computerName} 已断开。要再次使用，请在电脑上生成新的配对码。", color = ink.secondary)
                    InkButton("重新配对", Modifier.fillMaxWidth()) { actions.navigate(TabletPage.Pair) }
                    if (state.computers.isNotEmpty()) {
                        QuietButton("返回最近的会话") { actions.navigate(TabletPage.Home) }
                    }
                }
            }
            else -> Workspace(appModifier, state, actions)
        }
    }
}

@Composable
private fun SignIn(state: TabletState, actions: TabletActions) {
    var email by remember { mutableStateOf("") }
    var code by remember(state.otpEmail) { mutableStateOf("") }
    EntryCard {
        Brand()
        PageTitle(if (state.otpEmail == null) "登录 CodeTether" else "输入登录码")
        Text(
            if (state.otpEmail == null) "用电脑上登录的同一个账号。" else "请查看邮箱并输入收到的登录码。",
            color = ink.secondary,
        )
        if (state.otpEmail == null) {
            InkField(email, { email = it.take(254) }, "邮箱", enabled = !state.busy, keyboard = KeyboardType.Email)
            InkButton("发送登录码", Modifier.fillMaxWidth(), email.contains("@") && !state.busy) {
                actions.requestCode(email)
            }
            Text("现在只能登录已有账号。", color = ink.secondary, fontSize = 13.sp)
        } else {
            InkField(code, { code = it.filter(Char::isDigit).take(12) }, "登录码", enabled = !state.busy,
                keyboard = KeyboardType.NumberPassword, transformation = PasswordVisualTransformation())
            InkButton("登录", Modifier.fillMaxWidth(), code.length >= 6 && !state.busy) {
                actions.verifyCode(state.otpEmail, code)
            }
            Row {
                QuietButton("重发登录码", enabled = !state.busy) { actions.requestCode(state.otpEmail) }
                QuietButton("换一个邮箱", enabled = !state.busy) { actions.editEmail() }
            }
        }
        if (state.busy) Text("请稍候…", color = ink.secondary, fontSize = 13.sp)
        state.error?.let { Text(it, color = ink.failed, fontSize = 14.sp) }
    }
}

@Composable
private fun PairScreen(state: TabletState, actions: TabletActions, canReturn: Boolean) {
    var code by remember { mutableStateOf("") }
    EntryCard {
        Brand()
        val connected = state.lastPairedName
        if (connected != null) {
            PageTitle("已连接")
            Text(connected, color = ink.secondary)
            InkButton("完成", Modifier.fillMaxWidth()) { actions.navigate(TabletPage.Home) }
        } else {
            PageTitle("连接你的电脑")
            Text("在电脑上打开「设备 › 添加设备 › 添加手机或平板」，输入显示的 6 位配对码。", color = ink.secondary)
            InkField(code, { code = it.filter { char -> char in '0'..'9' }.take(6) }, "配对码",
                enabled = !state.busy, keyboard = KeyboardType.NumberPassword, transformation = PasswordVisualTransformation())
            InkButton("连接", Modifier.fillMaxWidth(), code.length == 6 && !state.busy) {
                actions.pair(code)
                code = ""
            }
            if (state.busy) Text(
                if (state.pairingClaimed) "正在等电脑完成连接，请保持电脑上的窗口打开。" else "正在连接…",
                color = ink.secondary,
            )
            if (state.pairingInProgress) QuietButton("取消等待", onClick = actions::cancelPairing)
            state.error?.let { Text(it, color = ink.failed, fontSize = 14.sp) }
            if (canReturn) QuietButton("返回", enabled = !state.busy) { actions.navigate(TabletPage.Home) }
            QuietButton("退出登录", enabled = !state.busy) { actions.signOut() }
        }
    }
}

@Composable
private fun EntryCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.padding(16.dp).widthIn(max = 440.dp).fillMaxWidth().clip(cardShape)
            .background(ink.card).verticalScroll(rememberScrollState()).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
private fun Workspace(modifier: Modifier, state: TabletState, actions: TabletActions) {
    var sheet by rememberSaveable { mutableStateOf<Sheet?>(null) }
    var changesOpen by remember(state.page) { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    BoxWithConstraints(modifier) {
        val landscape = maxWidth >= 900.dp && maxWidth > maxHeight
        var sidebarOpen by remember(landscape) { mutableStateOf(landscape) }
        val conversation = state.page as? TabletPage.Conversation
        val connected = conversation?.let { state.computer(it.computerId)?.connection != null } == true
        val allowChanges = state.detail?.canShowChanges == true && connected
        val showChanges = changesOpen && allowChanges
        fun go(page: TabletPage) {
            sheet = null
            if (!landscape) sidebarOpen = false
            actions.navigate(page)
        }
        fun dismiss() {
            when {
                sheet != null -> sheet = null
                changesOpen -> changesOpen = false
                sidebarOpen && !landscape -> sidebarOpen = false
                state.page != TabletPage.Home -> go(TabletPage.Home)
            }
        }
        BackHandler(sheet != null || changesOpen || (sidebarOpen && !landscape) || state.page != TabletPage.Home) {
            dismiss()
        }
        LaunchedEffect(Unit) { focus.requestFocus() }
        LaunchedEffect(showChanges, state.detail?.history?.messages?.size, state.detail?.history?.turns?.lastOrNull()?.status) {
            if (showChanges) actions.loadChanges()
        }
        Box(Modifier.fillMaxSize().onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            when {
                event.key == Key.Escape && (sheet != null || changesOpen || (sidebarOpen && !landscape)) -> {
                    dismiss()
                    true
                }
                event.isCtrlPressed && event.key == Key.K -> {
                    sheet = Sheet.Search
                    true
                }
                event.isCtrlPressed && event.key == Key.N &&
                    state.computers.any { it.workspace?.canControl == true && it.connection != null } -> {
                    sheet = Sheet.Create
                    true
                }
                else -> false
            }
        }.focusRequester(focus).focusable()) {
            Row(Modifier.fillMaxSize()) {
                if (landscape && sidebarOpen) Sidebar(Modifier.width(300.dp), state, ::go) { sheet = Sheet.Search }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Header(
                        state = state,
                        toggleSidebar = { sidebarOpen = !sidebarOpen },
                        newConversation = { sheet = Sheet.Create },
                        changes = if (allowChanges) ({
                            changesOpen = !changesOpen
                            if (changesOpen) {
                                if (landscape) sidebarOpen = false
                            }
                        }) else null,
                        archive = if (connected && state.detail?.canControl == true &&
                            state.detail.conversation.archived.not()) ({ sheet = Sheet.Archive }) else null,
                    )
                    state.error?.let { error ->
                        Row(Modifier.fillMaxWidth().background(ink.failedCard).padding(start = 16.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(error, Modifier.weight(1f), color = ink.failed, fontSize = 14.sp)
                            IconAction("×", "关闭提示", actions::dismissError)
                        }
                    }
                    when (val page = state.page) {
                        TabletPage.Home -> HomePage(state, ::go)
                        TabletPage.Inbox -> InboxPage(state, actions, ::go)
                        TabletPage.Devices -> DevicesPage(state, ::go)
                        is TabletPage.Device -> DevicePage(state, page, ::go)
                        is TabletPage.Project -> ProjectPage(state, page, actions, ::go)
                        is TabletPage.Conversation -> ConversationPage(state, page, actions)
                        is TabletPage.Settings -> SettingsPage(state, page, actions, ::go)
                        else -> Unit
                    }
                }
                if (landscape && showChanges) {
                    ChangesPanel(Modifier.width(420.dp), state, { changesOpen = false }, actions::loadChanges)
                }
            }
            if (!landscape && showChanges) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .22f))
                    .clickable { changesOpen = false })
                ChangesPanel(Modifier.align(Alignment.CenterEnd).widthIn(max = 520.dp)
                    .fillMaxWidth(), state, { changesOpen = false }, actions::loadChanges)
            }
            if (!landscape && sidebarOpen) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .25f))
                    .clickable { sidebarOpen = false })
                Sidebar(Modifier.width(300.dp).align(Alignment.CenterStart), state, ::go) {
                    sidebarOpen = false
                    sheet = Sheet.Search
                }
            }
        }
        when (sheet) {
            Sheet.Search -> SearchSheet(state.loaded, onDismiss = { sheet = null }) { computer, row ->
                go(TabletPage.Conversation(computer, row.target))
            }
            Sheet.Create -> CreateSheet(state, onDismiss = { sheet = null }) { computer, project, provider, text, reasoning, actionId ->
                actions.create(computer, project, provider, text, reasoning, actionId)
            }
            Sheet.Archive -> CenterSheet("归档会话", { sheet = null }) {
                Text("归档后可在项目的已归档列表里查看。", color = ink.secondary)
                InkButton("归档", Modifier.fillMaxWidth(), !state.busy) {
                    val target = state.page as? TabletPage.Conversation
                    sheet = null
                    if (target != null) actions.archive(target)
                }
            }
            null -> Unit
        }
    }
}

@Composable
private fun Header(
    state: TabletState,
    toggleSidebar: () -> Unit,
    newConversation: () -> Unit,
    changes: (() -> Unit)?,
    archive: (() -> Unit)?,
) {
    val page = state.page
    var menuOpen by remember(page) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().background(ink.bar).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconAction("☰", "侧栏", toggleSidebar)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            if (page is TabletPage.Conversation) {
                val summary = state.detail?.conversation
                Text(summary?.title ?: "会话", fontWeight = FontWeight.SemiBold, color = ink.text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                val computer = state.computer(page.computerId)
                val machine = state.machine(page.computerId, page.target.machineId)?.name ?: computer?.computer?.name
                val project = computer?.workspace?.projects?.firstOrNull { it.id == page.target.projectId }?.name
                val provider = summary?.provider?.let(::providerLabel)
                Text(listOfNotNull(listOfNotNull(machine, project).joinToString(" › ").takeIf(String::isNotBlank), provider)
                    .joinToString(" · "), color = ink.secondary, fontSize = 12.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (page is TabletPage.Conversation) {
            if (changes != null) IconAction("▤", "变更", changes)
            if (archive != null) Box {
                IconAction("⋯", "更多") { menuOpen = true }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("归档") }, onClick = {
                        menuOpen = false
                        archive()
                    })
                }
            }
        } else if (state.computers.any { it.workspace?.canControl == true && it.connection != null }) {
            InkButton("＋ 新建会话", enabled = !state.busy, onClick = newConversation)
        }
    }
    Rule()
}

@Composable
private fun Sidebar(modifier: Modifier, state: TabletState, go: (TabletPage) -> Unit, search: () -> Unit) {
    val attentionCount = state.computers.sumOf { it.workspace?.attentionCount ?: 0 }
    Column(modifier.fillMaxHeight().background(ink.background).padding(10.dp)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Brand()
            Spacer(Modifier.width(8.dp))
            Text("CodeTether", color = ink.text, fontSize = 21.sp, fontWeight = FontWeight.Bold)
        }
        QuietButton("搜索会话  Ctrl K", Modifier.fillMaxWidth(), onClick = search)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            NavItem("最近的会话", state.page == TabletPage.Home) { go(TabletPage.Home) }
            NavItem(if (attentionCount > 0) "待处理  ${attentionCount}" else "待处理", state.page == TabletPage.Inbox) {
                go(TabletPage.Inbox)
            }
            Spacer(Modifier.height(10.dp))
            NavItem("设备", state.page == TabletPage.Devices) { go(TabletPage.Devices) }
            state.computers.forEach { entry ->
                val workspace = entry.workspace
                if (workspace == null) {
                    RowItem(entry.computer.name, "暂时连不上")
                } else workspace.machines.forEach { machine ->
                    var machineOpen by remember(entry.computer.id, machine.id) { mutableStateOf(true) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconAction(if (machineOpen) "⌄" else "›", "展开或收起 ${machine.name}") { machineOpen = !machineOpen }
                        Column(Modifier.weight(1f)) {
                            NavItem(machine.name, state.page == TabletPage.Device(entry.computer.id, machine.id)) {
                                go(TabletPage.Device(entry.computer.id, machine.id))
                            }
                        }
                    }
                    if (machineOpen) workspace.projects.filter { it.machineId == machine.id }.forEach { project ->
                        var projectOpen by remember(entry.computer.id, project.id) { mutableStateOf(false) }
                        Row(Modifier.padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            IconAction(if (projectOpen) "⌄" else "›", "展开或收起 ${project.name}") { projectOpen = !projectOpen }
                            Column(Modifier.weight(1f)) {
                                NavItem(project.name, state.page == TabletPage.Project(entry.computer.id, project)) {
                                    go(TabletPage.Project(entry.computer.id, project))
                                }
                            }
                        }
                        if (projectOpen) workspace.recent.filter { it.target.projectId == project.id && it.target.machineId == machine.id }
                            .take(5).forEach { row ->
                                Box(Modifier.padding(start = 44.dp)) {
                                    NavItem(row.title, state.page == TabletPage.Conversation(entry.computer.id, row.target)) {
                                        go(TabletPage.Conversation(entry.computer.id, row.target))
                                    }
                                }
                            }
                    }
                }
            }
        }
        Rule()
        NavItem("设置", state.page is TabletPage.Settings) { go(TabletPage.Settings()) }
    }
}

@Composable
private fun NavItem(label: String, selected: Boolean, onClick: () -> Unit) {
    RowItem(label, active = selected, onClick = onClick)
}

internal fun providerLabel(id: String): String = when (id) {
    "codex" -> "Codex"
    "claude-code" -> "Claude Code"
    else -> "AI 工具"
}
