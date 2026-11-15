package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteProvider

@Composable
internal fun DevicesPage(state: TabletState, go: (TabletPage) -> Unit, onPair: () -> Unit) {
    TabletListPage("设备", "能运行 AI 工具的电脑和服务器。每台设备一节，节里是它上面的项目。") {
        state.computers.forEach { entry ->
            val workspace = entry.workspace
            val computerId = entry.computer.id
            if (workspace == null || workspace.machines.isEmpty()) {
                TabletListSection(entry.computer.name)
                Group(Modifier.alpha(.55f)) {
                    val subtitle = listOfNotNull(displayDevicePlatform(entry.computer.platform), entry.problem ?: "正在连接…")
                        .joinToString(" · ")
                    DeviceInfoRow(entry.computer.name, subtitle, icon = TabletListGlyph.Monitor)
                }
            } else {
                workspace.machines.forEach { machine ->
                    val reachable = deviceReachable(entry, machine)
                    TabletListSection(machine.name, listMachineSubtitle(entry, machine))
                    Group(Modifier.alpha(if (reachable) 1f else .55f)) {
                        DeviceInfoRow(machine.name, displayDevicePlatform(machine.platform), icon = tabletMachineGlyph(machine),
                            modifier = Modifier.testTag("devices-machine/$computerId/${machine.id}")) {
                            go(TabletPage.Device(computerId, machine.id))
                        }
                        workspace.projects.filter { it.machineId == machine.id }.forEachIndexed { index, project ->
                            TabletListRule(inset = if (index == 0) 16.dp else 48.dp)
                            DeviceInfoRow(project.name, "${project.conversationCount} 个会话", icon = TabletListGlyph.Folder,
                                modifier = Modifier.testTag("devices-project/$computerId/${machine.id}/${project.id}")) {
                                go(TabletPage.Project(computerId, project))
                            }
                        }
                    }
                }
            }
        }
        TabletListSection("添加电脑")
        Group {
            DeviceInfoRow("输入配对码", "在那台电脑上打开 设备 › 添加设备，会显示 6 位配对码",
                icon = TabletListGlyph.Plus, accent = true, chevron = false, modifier = Modifier.testTag("devices-pair"), open = onPair)
        }
        DeviceFootnote("电脑可以在它的设备页里随时移除这台平板。")
    }
}

@Composable
internal fun DevicePage(state: TabletState, page: TabletPage.Device, go: (TabletPage) -> Unit) {
    val entry = state.computer(page.computerId)
    val machine = state.machine(page.computerId, page.machineId)
    if (entry == null || machine == null) {
        TabletListPage("设备") {
            DeviceOfflineNotice(entry?.problem ?: "这台电脑现在连不上，请确认它开着并且联网。")
        }
        return
    }

    val workspace = entry.workspace
    val reachable = deviceReachable(entry, machine)
    val ownerName = workspace?.machines?.firstOrNull { it.isLocal }?.name ?: entry.computer.name
    val status = listOfNotNull(displayDevicePlatform(machine.platform), listMachineSubtitle(entry, machine)).joinToString(" · ")
    TabletListPage(machine.name, status) {
        if (!reachable) {
            val reason = if (!machine.isLocal && entry.connection == null) {
                "${machine.name} 经由 $ownerName 访问，要等那台电脑上线。"
            } else {
                "这台电脑现在连不上，请确认它开着并且联网。"
            }
            DeviceOfflineNotice("$reason 下面是上次读取的内容。")
        }

        TabletListSection("项目")
        val projects = workspace?.projects.orEmpty().filter { it.machineId == machine.id }
        if (projects.isEmpty()) TabletListEmpty("没有项目") else Group {
            projects.forEachIndexed { index, project ->
                if (index > 0) TabletListRule()
                DeviceInfoRow(project.name, icon = TabletListGlyph.Folder, trailing = "${project.conversationCount} 个会话",
                    modifier = Modifier.testTag("device-project/${page.computerId}/${machine.id}/${project.id}")) {
                    go(TabletPage.Project(page.computerId, project))
                }
            }
        }

        TabletListSection("最近的会话")
        val recent = workspace?.recent.orEmpty().filter { it.target.machineId == machine.id && !it.archived }.take(5)
        if (recent.isEmpty()) TabletListEmpty("还没有会话") else Group {
            recent.forEachIndexed { index, row ->
                if (index > 0) TabletListRule()
                ConversationListRow(page.computerId, row, state) { go(TabletPage.Conversation(page.computerId, row.target)) }
            }
        }

        if (machine.providers.isNotEmpty()) {
            TabletListSection("AI 工具")
            Group {
                machine.providers.forEachIndexed { index, provider ->
                    if (index > 0) TabletListRule()
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(provider.displayName, Modifier.weight(1f), color = ink.text, fontSize = 15.sp)
                        DeviceProviderBadge(provider)
                    }
                }
            }
            DeviceFootnote("安装和登录 AI 工具要在那台电脑上做。")
        }

        val how = if (!machine.isLocal) "经由 $ownerName" else when (entry.connection?.transport) {
            "direct" -> "同一网络，直接连接"
            "relay" -> "经互联网连接"
            else -> null
        }
        if (how != null) {
            TabletListSection("连接")
            Group { DeviceInfoRow("连接方式", trailing = how) }
        }
    }
}

private fun deviceReachable(entry: ComputerView, machine: RemoteMachine): Boolean =
    entry.connection != null && machine.available && (machine.isLocal || machine.status == "online")

private fun displayDevicePlatform(platform: String): String? {
    val name = platform.substringBefore(" · ")
    val display = when (name.lowercase()) {
        "win32", "windows" -> "Windows"
        "darwin", "macos" -> "macOS"
        "linux" -> "Linux"
        "", "unknown" -> return null
        else -> name
    }
    return display + platform.removePrefix(name)
}

@Composable
private fun DeviceInfoRow(
    title: String,
    subtitle: String? = null,
    icon: TabletListGlyph? = null,
    trailing: String? = null,
    accent: Boolean = false,
    chevron: Boolean = true,
    modifier: Modifier = Modifier,
    open: (() -> Unit)? = null,
) {
    val click = if (open == null) Modifier else Modifier.clickable(role = Role.Button, onClick = open)
    Row(modifier.fillMaxWidth().heightIn(min = 52.dp).then(click).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (icon != null) {
            Box(Modifier.size(30.dp).background(if (accent) ink.ink else listTint, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center) {
                TabletListIcon(icon, if (accent) ink.onInk else ink.secondary,
                    dimension = if (icon == TabletListGlyph.Folder || accent) 16.dp else 20.dp)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(title, color = ink.text, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = ink.secondary, fontSize = 13.sp, lineHeight = 19.sp,
                maxLines = if (accent) 2 else 1, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null || open != null && chevron) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (trailing != null) Text(trailing, color = ink.secondary, fontSize = 13.sp)
                if (open != null && chevron) TabletListIcon(TabletListGlyph.Chevron, dimension = 16.dp)
            }
        }
    }
}

@Composable
private fun DeviceOfflineNotice(text: String) {
    Row(Modifier.fillMaxWidth().padding(top = 18.dp).background(ink.card, cardShape)
        .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        TabletListIcon(TabletListGlyph.WifiOff)
        Text(text, color = ink.secondary, fontSize = 14.sp, lineHeight = 20.sp)
    }
}

@Composable
private fun DeviceProviderBadge(provider: RemoteProvider) {
    val dark = ink.dark
    val warning = provider.requiresSignIn || provider.status == "unsupported_version"
    val available = !warning && provider.status == "available" && provider.canStart
    val label = when {
        provider.requiresSignIn -> "需要在电脑上登录"
        available -> "可以使用"
        provider.status == "not_installed" -> "没有安装"
        provider.status == "unsupported_version" -> "版本不支持"
        else -> "暂时不可用"
    }
    val background = when {
        warning -> (if (dark) Color(0xffffb340) else Color(0xfff29a0c)).copy(alpha = if (dark) .16f else .14f)
        available -> (if (dark) Color(0xff32d74b) else Color(0xff28a745)).copy(alpha = if (dark) .16f else .12f)
        else -> listTint
    }
    val foreground = when {
        warning -> if (dark) Color(0xffffc66b) else Color(0xff8f5600)
        available -> if (dark) Color(0xff5ee077) else Color(0xff1d7a34)
        else -> ink.secondary
    }
    Box(Modifier.height(22.dp).background(background, CircleShape).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, color = foreground, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun DeviceFootnote(text: String) {
    Text(text, Modifier.padding(start = 16.dp, top = 6.dp), color = ink.secondary, fontSize = 13.sp)
}
