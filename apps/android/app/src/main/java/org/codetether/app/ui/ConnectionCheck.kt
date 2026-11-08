package org.codetether.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import org.codetether.app.BuildConfig
import uniffi.supervisor_mobile.ConnectionMode

@Composable
internal fun ConnectionCheckHeader(showSidebarToggle: Boolean, toggleSidebar: () -> Unit, backToSettings: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).background(ink.bar).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showSidebarToggle) IconAction("☰", "侧栏", toggleSidebar)
        val foreground = ink.text
        Column(
            Modifier.heightIn(min = 48.dp).clip(CircleShape).testTag("connection-settings-back")
                .clickable(role = Role.Button, onClick = backToSettings).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Canvas(Modifier.size(16.dp)) {
                val tip = Offset(size.width * .375f, size.height * .5f)
                drawLine(foreground, Offset(size.width * .625f, size.height * .25f), tip, 1.5.dp.toPx(), StrokeCap.Round)
                drawLine(foreground, tip, Offset(size.width * .625f, size.height * .75f), 1.5.dp.toPx(), StrokeCap.Round)
            }
            Text("设置", color = foreground, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
internal fun ConnectionCheckPage(state: TabletState, actions: TabletActions) {
    val tint = Color(0xff767680).copy(alpha = if (ink.dark) .24f else .12f)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 820.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(start = 28.dp, end = 28.dp, bottom = 40.dp),
        ) {
            Text("连接检查", Modifier.padding(top = 6.dp, bottom = 2.dp), color = ink.text,
                fontSize = 32.sp, lineHeight = 39.sp, letterSpacing = (-0.4f).sp, fontWeight = FontWeight.Bold)
            Text("连接是自动的：同一网络里直接连，不在一起时经互联网连接。", color = ink.secondary,
                fontSize = 15.sp, lineHeight = 22.sp)
            Spacer(Modifier.height(18.dp))
            Group {
                state.computers.forEachIndexed { index, entry ->
                    if (index > 0) ConnectionRowDivider()
                    val machines = entry.workspace?.machines.orEmpty()
                    val localMachine = machines.firstOrNull { it.isLocal }
                    val computerName = localMachine?.name ?: entry.computer.name
                    val connected = entry.connection != null
                    val connectionDescription = when (entry.connection?.transport) {
                        "direct" -> "同一网络，直接连接"
                        "relay" -> "经互联网连接"
                        else -> if (connected) null else offlineConnectionDescription(localMachine?.lastSeenAt)
                    }
                    ConnectionCheckRow(computerName, connectionDescription, connected, tint)
                    machines.filterNot { it.isLocal }.forEach { machine ->
                        ConnectionRowDivider()
                        val reachable = connected && machine.available && machine.status == "online"
                        val description = when {
                            reachable -> "经由 $computerName"
                            !connected -> "要等 $computerName 上线"
                            else -> "连不上"
                        }
                        ConnectionCheckRow(machine.name, description, reachable, tint)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Box(
                Modifier.heightIn(min = 48.dp).clip(CircleShape)
                    .clickable(enabled = !state.busy, role = Role.Button, onClick = actions::refresh),
                contentAlignment = Alignment.TopCenter,
            ) {
                Box(Modifier.height(36.dp).alpha(if (state.busy) .4f else 1f).clip(CircleShape)
                    .background(tint).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text("重新检查", color = ink.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            if (BuildConfig.DEBUG) {
                Segments(listOf("自动" to (state.mode == ConnectionMode.AUTO),
                    "只经互联网连接" to (state.mode == ConnectionMode.RELAY))) {
                    actions.setMode(if (it == 1) ConnectionMode.RELAY else ConnectionMode.AUTO)
                }
                state.keyProtection?.let { RowItem("设备密钥保护", it) }
            }
        }
    }
}

@Composable
private fun ConnectionRowDivider() {
    HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 1.dp, color = ink.rule)
}

internal fun offlineConnectionDescription(lastSeenAt: String?, now: Instant = Instant.now()): String {
    val seen = try {
        lastSeenAt?.let(Instant::parse)
    } catch (_: DateTimeParseException) {
        null
    }
    if (seen == null || seen.isAfter(now)) return "连不上"

    val elapsed = Duration.between(seen, now)
    val relativeTime = when {
        elapsed.toDays() > 0 -> "${elapsed.toDays()} 天前"
        elapsed.toHours() > 0 -> "${elapsed.toHours()} 小时前"
        elapsed.toMinutes() > 0 -> "${elapsed.toMinutes()} 分钟前"
        else -> "刚刚"
    }
    return "连不上 · ${relativeTime}在线"
}

@Composable
private fun ConnectionCheckRow(name: String, description: String?, connected: Boolean, tint: Color) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(name, color = ink.text, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (description != null) Text(description, color = ink.secondary, fontSize = 13.sp, lineHeight = 19.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val background = if (!connected) tint else if (ink.dark) Color(0xff32d74b).copy(alpha = .16f)
            else Color(0xff28a745).copy(alpha = .12f)
        val foreground = if (!connected) ink.secondary else if (ink.dark) Color(0xff5ee077) else Color(0xff1d7a34)
        Box(Modifier.height(22.dp).clip(CircleShape).background(background).padding(horizontal = 8.dp),
            contentAlignment = Alignment.Center) {
            Text(if (connected) "已连接" else "离线", color = foreground, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
