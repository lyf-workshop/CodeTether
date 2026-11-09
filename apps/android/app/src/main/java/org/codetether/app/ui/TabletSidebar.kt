package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteWorkspace

@Composable
internal fun TabletSidebar(
    modifier: Modifier,
    state: TabletState,
    go: (TabletPage) -> Unit,
    close: (() -> Unit)? = null,
    search: () -> Unit,
) {
    val workspaces = state.computers.mapNotNull { it.workspace }
    val attentionCount = workspaces.sumOf { it.attentionCount }.takeIf { workspaces.size == state.computers.size }
    val rule = ink.rule
    Column(modifier.fillMaxHeight().background(if (ink.dark) ink.card else ink.background)
        .drawBehind { drawLine(rule, Offset(size.width - .5f, 0f), Offset(size.width - .5f, size.height), 1.dp.toPx()) }) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 3.dp)
            .heightIn(min = 34.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Brand(Modifier.size(30.dp))
            Text("CodeTether", Modifier.weight(1f), color = ink.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            if (close != null) {
                Box(Modifier.size(48.dp).clip(cardShape).clickable(role = Role.Button, onClick = close)
                    .semantics { contentDescription = "收起侧栏" }, contentAlignment = Alignment.Center) {
                    TabletListIcon(TabletListGlyph.Sidebar)
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp)
            .clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button, onClick = search),
            contentAlignment = Alignment.Center) {
            Row(Modifier.fillMaxWidth().height(38.dp).background(listTint, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TabletListIcon(TabletListGlyph.Search, dimension = 16.dp)
                Text("搜索会话", color = ink.secondary, fontSize = 15.sp)
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp).verticalScroll(rememberScrollState())
            .padding(top = 4.dp, bottom = 12.dp)) {
            SidebarLink("最近的会话", state.page == TabletPage.Home || state.page is TabletPage.Removed, TabletListGlyph.Home) {
                go(TabletPage.Home)
            }
            SidebarLink("待处理", state.page == TabletPage.Inbox, TabletListGlyph.Inbox, badge = attentionCount) {
                go(TabletPage.Inbox)
            }
            Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 1.dp, top = 7.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("设备", color = ink.secondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Box(Modifier.heightIn(min = 48.dp).clip(cardShape).clickable(role = Role.Button) { go(TabletPage.Devices) }
                    .padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                    Text("全部设备", color = ink.link, fontSize = 13.sp)
                }
            }
            state.computers.forEach { entry ->
                val workspace = entry.workspace
                if (workspace == null) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        TabletListIcon(TabletListGlyph.Monitor)
                        SidebarTitle(entry.computer.name, "暂时连不上", selected = false, modifier = Modifier.weight(1f))
                    }
                } else workspace.machines.forEach { machine ->
                    key(entry.computer.id, machine.id) { SidebarMachine(entry, workspace, machine, state.page, go) }
                }
            }
        }
        HorizontalDivider(color = ink.rule, thickness = 1.dp)
        Box(Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp)) {
            SidebarLink("设置", state.page is TabletPage.Settings, TabletListGlyph.Settings) { go(TabletPage.Settings()) }
        }
    }
}

@Composable
private fun SidebarMachine(
    entry: ComputerView,
    workspace: RemoteWorkspace,
    machine: RemoteMachine,
    page: TabletPage,
    go: (TabletPage) -> Unit,
) {
    var machineOpen by rememberSaveable { mutableStateOf(true) }
    val id = entry.computer.id
    val selected = page == TabletPage.Device(id, machine.id)
    val online = entry.connection != null && machine.available && (machine.isLocal || machine.status == "online")
    val icon = when {
        !machine.isLocal -> TabletListGlyph.Server
        machine.platform.startsWith("mac", ignoreCase = true) -> TabletListGlyph.Laptop
        else -> TabletListGlyph.Monitor
    }
    Column(Modifier.alpha(if (online) 1f else .55f)) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
            .background(if (selected) ink.selected else Color.Transparent), verticalAlignment = Alignment.CenterVertically) {
            SidebarTwisty(machine.name, machineOpen) { machineOpen = !machineOpen }
            SidebarLink(machine.name, selected, icon, Modifier.weight(1f), subtitle = listMachineSubtitle(entry, machine)) {
                go(TabletPage.Device(id, machine.id))
            }
        }
        if (machineOpen) workspace.projects.filter { it.machineId == machine.id }.forEach { project ->
            key(project.id) {
                val projectPage = page as? TabletPage.Project
                val conversationPage = page as? TabletPage.Conversation
                val selectedProject = projectPage?.computerId == id && projectPage.project.machineId == machine.id &&
                    projectPage.project.id == project.id
                val activeConversation = conversationPage?.computerId == id && conversationPage.target.machineId == machine.id &&
                    conversationPage.target.projectId == project.id
                var expanded by rememberSaveable { mutableStateOf<Boolean?>(null) }
                val projectOpen = expanded ?: (selectedProject || activeConversation)
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                    .background(if (selectedProject) ink.selected else Color.Transparent).padding(start = 20.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    SidebarTwisty(project.name, projectOpen) { expanded = !projectOpen }
                    SidebarLink(project.name, selectedProject, TabletListGlyph.Folder, Modifier.weight(1f), count = project.conversationCount) {
                        go(TabletPage.Project(id, project))
                    }
                }
                if (projectOpen) workspace.recent.asSequence().filter {
                    it.target.projectId == project.id && it.target.machineId == machine.id && !it.archived
                }.take(5).forEach { row ->
                    SidebarLink(row.title, page == TabletPage.Conversation(id, row.target), modifier = Modifier.padding(start = 42.dp),
                        status = row.status) { go(TabletPage.Conversation(id, row.target)) }
                }
            }
        }
    }
}

@Composable
private fun SidebarTwisty(name: String, open: Boolean, toggle: () -> Unit) {
    Box(Modifier.width(48.dp).heightIn(min = 48.dp).clip(cardShape).clickable(role = Role.Button, onClick = toggle)
        .semantics { contentDescription = "展开或收起 $name" }, contentAlignment = Alignment.Center) {
        TabletListIcon(if (open) TabletListGlyph.Down else TabletListGlyph.Chevron, dimension = 16.dp)
    }
}

@Composable
private fun SidebarLink(
    title: String,
    selected: Boolean,
    glyph: TabletListGlyph? = null,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    badge: Int? = null,
    count: Int? = null,
    status: String? = null,
    open: () -> Unit,
) {
    val nested = count != null || subtitle != null
    Row(modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp))
        .background(if (selected && !nested) ink.selected else Color.Transparent)
        .selectable(selected, role = Role.Button, onClick = open).padding(start = if (nested) 0.dp else 10.dp, end = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        glyph?.let { TabletListIcon(it, dimension = if (count != null) 16.dp else 20.dp) }
        status?.let { TabletStatusDot(it) }
        SidebarTitle(title, subtitle, selected, Modifier.weight(1f))
        if (badge != null) {
            Box(Modifier.widthIn(min = 22.dp).height(22.dp).background(listTint, CircleShape).padding(horizontal = 7.dp),
                contentAlignment = Alignment.Center) {
                Text(badge.toString(), color = ink.secondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        if (count != null) Text(count.toString(), color = ink.secondary, fontSize = 13.sp)
    }
}

@Composable
private fun SidebarTitle(title: String, subtitle: String?, selected: Boolean, modifier: Modifier) {
    Column(modifier) {
        Text(title, color = ink.text, fontSize = 15.sp, lineHeight = 20.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        subtitle?.let { Text(it, color = ink.secondary, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}
