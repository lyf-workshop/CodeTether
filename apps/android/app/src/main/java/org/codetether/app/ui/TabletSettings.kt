package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.codetether.app.BuildConfig

@Composable
internal fun SettingsPage(
    state: TabletState,
    page: TabletPage.Settings,
    actions: TabletActions,
    go: (TabletPage) -> Unit,
    onPair: () -> Unit,
) {
    when (page.section) {
        SettingSection.Overview -> SettingsOverview(state, actions, go, onPair)
        SettingSection.Connection -> ConnectionCheckPage(state, actions)
        SettingSection.Plans -> SettingsRoadmap()
    }
}

@Composable
private fun SettingsOverview(state: TabletState, actions: TabletActions, go: (TabletPage) -> Unit, onPair: () -> Unit) {
    var removingId by rememberSaveable { mutableStateOf<String?>(null) }
    var signOut by rememberSaveable { mutableStateOf(false) }
    TabletListPage("设置") {
        val email = state.profile?.email.orEmpty()
        TabletListSection("账号")
        Group {
            SettingsRow(email.ifBlank { "已登录" }, "已登录".takeIf { email.isNotBlank() }, trailing = {
                TextButton(
                    onClick = { signOut = true }, enabled = !state.busy,
                    colors = ButtonDefaults.textButtonColors(contentColor = ink.text),
                ) { Text("退出登录", fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
            })
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 6.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("可以使用的电脑", Modifier.weight(1f), color = ink.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Box(Modifier.heightIn(min = 48.dp).testTag("settings-pair")
                .clickable(enabled = !state.busy, role = Role.Button, onClick = onPair),
                contentAlignment = Alignment.Center) {
                Text("输入配对码", color = if (state.busy) ink.secondary else ink.link, fontSize = 15.sp)
            }
        }
        Group {
            state.computers.forEachIndexed { index, entry ->
                if (index > 0) TabletListRule()
                SettingsRow(entry.computer.name, if (entry.connection != null) "在线" else "暂时连不上", trailing = {
                    SettingsPill("移除", settingsDangerTint, settingsDangerText, 36.dp, enabled = !state.busy,
                        modifier = Modifier.testTag("settings-remove-${entry.computer.id}")) { removingId = entry.computer.id }
                })
            }
        }
        Text(
            "经由这些电脑访问的设备会跟着出现。移除一台电脑后，要在那台电脑上生成新的配对码才能再用。",
            Modifier.padding(start = 16.dp, top = 6.dp, end = 16.dp),
            color = ink.secondary, fontSize = 13.sp, lineHeight = 19.sp,
        )
        TabletListSection("外观")
        Group {
            TabletListSegments(Appearance.entries.map { it.label to (state.appearance == it) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) { actions.setAppearance(Appearance.entries[it]) }
        }
        TabletListSection("关于")
        Group {
            SettingsRow("版本", trailing = { Text("${BuildConfig.VERSION_NAME} · 平板", color = ink.secondary, fontSize = 13.sp) })
            TabletListRule()
            SettingsRow("连接检查", "每台电脑现在怎么连上的", Modifier.clickable(role = Role.Button) {
                go(TabletPage.Settings(SettingSection.Connection))
            }, trailing = { TabletListIcon(TabletListGlyph.Chevron, dimension = 16.dp) })
            TabletListRule()
            SettingsRow("后续规划", "还没做的功能", Modifier.clickable(role = Role.Button) {
                go(TabletPage.Settings(SettingSection.Plans))
            }, trailing = { TabletListIcon(TabletListGlyph.Chevron, dimension = 16.dp) })
        }
    }
    removingId?.let(state::computer)?.let { entry ->
        SettingsRemovalSheet(entry, !state.busy, onDismiss = { removingId = null }) {
            removingId = null
            actions.removeComputer(entry.computer)
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

private val roadmapEntries = listOf(
    "切换 AI 工具用的服务" to "像 CC Switch 那样，在电脑上切换 Codex 和 Claude Code 用的 API 服务和模型配置，平板上也能切。需要先调查再设计",
    "在平板上登录 AI 工具" to "现在要在电脑上登录 Codex 和 Claude Code",
    "输入框增强" to "每一轮选模型和推理强度、斜杠命令、@文件、图片（X1，三端一起做）",
    "跨项目搜索" to "现在只能按标题搜索已读取的会话",
    "删除会话" to "现在只能归档",
    "运行中追加指令" to "现在要等这一轮结束再发送",
    "Claude Code 修改文件和执行命令" to "现在只读取和搜索",
    "配对设备上的停止和批准" to "经由电脑访问的设备上，Codex 现在只能对话",
    "添加项目、浏览文件夹和导入以前的会话" to "在平板上浏览电脑上的文件夹，登记项目并导入已有会话。",
    "移除项目和项目内搜索" to "在平板上移除项目登记，并在项目内搜索会话内容。",
    "置顶、重命名和恢复会话" to "整理会话列表，恢复已归档的会话。",
    "通知和后台保持连接" to "平板在后台也能收到等待批准、工作完成和执行失败的提醒。",
    "批准和停止前先解锁" to "在批准或停止前用设备的解锁方式确认身份。",
    "手机布局" to "在同一个应用里提供适合手机屏幕的布局。",
)

@Composable
private fun SettingsRoadmap() {
    TabletListPage("后续规划", "这些功能还没做，界面上其他地方不会出现它们的按钮。") {
        Group(Modifier.padding(top = 18.dp).testTag("settings-roadmap-page")) {
            roadmapEntries.forEachIndexed { index, (title, description) ->
                if (index > 0) TabletListRule()
                SettingsRow(title, description, leading = {
                    Box(Modifier.size(30.dp).background(listTint, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                        TabletListIcon(TabletListGlyph.Map, dimension = 16.dp)
                    }
                })
            }
        }
    }
}

@Composable
private fun SettingsRow(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Text(title, color = ink.text, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
            subtitle?.let { Text(it, color = ink.secondary, fontSize = 13.sp, lineHeight = 19.sp) }
        }
        trailing?.invoke()
    }
}

@Composable
private fun SettingsRemovalSheet(entry: ComputerView, enabled: Boolean, onDismiss: () -> Unit, confirm: () -> Unit) {
    val name = entry.computer.name
    val downstream = entry.workspace?.machines.orEmpty().filterNot { it.isLocal }.joinToString("、") { it.name }
    val disconnect = if (downstream.isEmpty()) "这台平板会立刻断开 $name。"
        else "这台平板会立刻断开 $name，经由它访问的 $downstream 也会一起断开。"
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        Column(
            Modifier.padding(16.dp).widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp))
                .background(ink.background).testTag("settings-removal-dialog")
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown && event.key == Key.Escape) {
                        onDismiss()
                        true
                    } else false
                }.focusRequester(focus).focusable().verticalScroll(rememberScrollState())
                .padding(start = 22.dp, top = 22.dp, end = 22.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("移除 $name？", color = ink.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text("${disconnect}电脑上正在运行的工作不受影响。要再用，需要在那台电脑上生成新的配对码。",
                Modifier.padding(top = 8.dp, bottom = 14.dp), color = ink.secondary, fontSize = 15.sp, lineHeight = 22.sp,
                textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SettingsPill("取消", listTint, ink.text, 44.dp, onClick = onDismiss)
                SettingsPill("移除", settingsDangerTint, settingsDangerText, 44.dp, Modifier.testTag("settings-confirm-remove"),
                    enabled, confirm)
            }
        }
    }
}

private val settingsDangerTint: Color
    @Composable get() = if (ink.dark) Color(0xffff6961).copy(alpha = .16f) else Color(0xffe5392f).copy(alpha = .10f)

private val settingsDangerText: Color
    @Composable get() = if (ink.dark) Color(0xffff8a84) else Color(0xffb42318)

@Composable
private fun SettingsPill(
    label: String,
    tint: Color,
    foreground: Color,
    height: Dp,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(modifier.heightIn(min = 48.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center) {
        Box(Modifier.height(height).alpha(if (enabled) 1f else .4f).background(tint, CircleShape)
            .padding(horizontal = if (height == 36.dp) 14.dp else 18.dp), contentAlignment = Alignment.Center) {
            Text(label, color = foreground, fontSize = if (height == 36.dp) 14.sp else 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
