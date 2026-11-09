package org.codetether.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteMachine

internal val listTint: Color
    @Composable get() = Color(0xff767680).copy(alpha = if (ink.dark) .24f else .12f)

private val listMuted: Color
    @Composable get() = if (ink.dark) Color(0xffebebf5).copy(alpha = .42f) else Color(0xff3c3c43).copy(alpha = .5f)

// Paths match the shared icons used by the tablet HTML prototype.
internal enum class TabletListGlyph(val path: String) {
    Home("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"),
    Inbox("M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"),
    Monitor("M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 20h8M12 16v4"),
    Laptop("M5 5h14a1 1 0 0 1 1 1v9H4V6a1 1 0 0 1 1-1ZM2 18.5h20"),
    Server("M5 3h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM5 14h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM8 6.5h.01M8 17.5h.01"),
    Folder("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"),
    Settings("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"),
    Search("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"),
    Plus("M12 5v14M5 12h14"),
    Chevron("M9 18l6-6-6-6"),
    Down("M6 9l6 6 6-6"),
    Check("M20 6 9 17l-5-5"),
    Shield("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"),
    Alert("M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"),
    Sidebar("M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 4v16"),
    WifiOff("M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M12 20h.01M1.4 9a16 16 0 0 1 4.7-2.9M10.7 5a16 16 0 0 1 11.9 4"),
    Map("M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"),
}

@Composable
internal fun TabletListIcon(glyph: TabletListGlyph, color: Color = ink.secondary, dimension: Dp = 20.dp) {
    val path = remember(glyph) { PathParser().parsePathString(glyph.path).toPath() }
    Canvas(Modifier.size(dimension)) {
        withTransform({ scale(size.width / 24f, size.height / 24f, Offset.Zero) }) {
            drawPath(path, color, style = Stroke(width = 1.9f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

@Composable
internal fun TabletListPage(
    title: String,
    summary: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 820.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(start = 28.dp, end = 28.dp, top = 6.dp, bottom = 40.dp),
        ) {
            Text(title, color = ink.text, fontSize = 32.sp, lineHeight = 39.sp,
                letterSpacing = (-.4f).sp, fontWeight = FontWeight.Bold)
            if (summary != null) {
                Text(summary, Modifier.padding(top = 2.dp), color = ink.secondary, fontSize = 15.sp, lineHeight = 22.sp)
            }
            content()
        }
    }
}

@Composable
internal fun TabletListSection(
    title: String,
    caption: String? = null,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 22.dp, bottom = 6.dp, start = 16.dp, end = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = ink.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        caption?.let { Text(it, color = ink.secondary, fontSize = 13.sp) }
        if (action != null) {
            Spacer(Modifier.weight(1f))
            Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onAction),
                contentAlignment = Alignment.Center) {
                Text(action, color = ink.link, fontSize = 15.sp)
            }
        }
    }
}

@Composable
internal fun TabletListRule(inset: Dp = 16.dp) {
    HorizontalDivider(Modifier.padding(start = inset), thickness = 1.dp, color = ink.rule)
}

@Composable
internal fun TabletListEmpty(text: String) {
    Group {
        Box(Modifier.heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            contentAlignment = Alignment.CenterStart) {
            Text(text, color = ink.secondary, fontSize = 13.sp)
        }
    }
}

@Composable
internal fun TabletListSegments(
    options: List<Pair<String, Boolean>>,
    modifier: Modifier = Modifier,
    optionEnabled: (Int) -> Boolean = { true },
    select: (Int) -> Unit,
) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(Modifier.fillMaxWidth().height(38.dp).background(listTint, RoundedCornerShape(9.dp)))
        Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp).selectableGroup()) {
            options.forEachIndexed { index, (label, selected) ->
                val enabled = optionEnabled(index)
                Box(Modifier.weight(1f).heightIn(min = 48.dp)
                    .selectable(selected, enabled = enabled, role = Role.Tab, onClick = { select(index) }),
                    contentAlignment = Alignment.Center) {
                    val shape = RoundedCornerShape(7.dp)
                    Box(Modifier.fillMaxWidth().height(34.dp)
                        .then(if (selected) Modifier.shadow(1.dp, shape).background(ink.card, shape) else Modifier)
                        .padding(horizontal = 3.dp), contentAlignment = Alignment.Center) {
                        Text(label, color = if (enabled) ink.text else ink.secondary,
                            fontSize = 14.sp, lineHeight = 16.sp, textAlign = TextAlign.Center,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, maxLines = 2)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TabletListChips(options: List<Pair<String, Boolean>>, select: (Int) -> Unit) {
    FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEachIndexed { index, (label, selected) ->
            Box(Modifier.heightIn(min = 48.dp).selectable(selected, role = Role.Tab, onClick = { select(index) }),
                contentAlignment = Alignment.Center) {
                Box(Modifier.height(34.dp).background(if (selected) ink.ink else ink.card, CircleShape)
                    .then(if (selected) Modifier else Modifier.border(1.dp, ink.rule, CircleShape))
                    .padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text(label, color = if (selected) ink.onInk else ink.text, fontSize = 14.sp)
                }
            }
        }
    }
}

@Composable
internal fun TabletStatusDot(status: String) {
    val running = status == "running" || status == "starting"
    val dark = ink.dark
    val color = when (status) {
        "running", "starting" -> if (dark) Color(0xff3c9be3) else Color(0xff1a7fd0)
        "waiting" -> if (dark) Color(0xffffb340) else Color(0xfff29a0c)
        "completed" -> if (dark) Color(0xff32d74b) else Color(0xff28a745)
        "failed", "interrupted" -> if (dark) Color(0xffff6961) else Color(0xffe5392f)
        else -> if (dark) Color(0xff8e8e93) else Color(0xffa1a1a6)
    }
    Canvas(Modifier.size(9.dp)) {
        if (running) drawCircle(color.copy(alpha = if (dark) .18f else .1f), radius = 7.5.dp.toPx())
        drawCircle(color)
    }
}

@Composable
internal fun ConversationListRow(
    computerId: String,
    row: RemoteConversation,
    state: TabletState,
    withDevice: Boolean = false,
    open: () -> Unit,
) {
    val computer = state.computer(computerId)
    val project = computer?.workspace?.projects?.firstOrNull {
        it.id == row.target.projectId && it.machineId == row.target.machineId
    }?.name
    val machine = if (withDevice) state.machine(computerId, row.target.machineId)?.name ?: computer?.computer?.name else null
    val status = statusLabel(row.status).takeUnless { it == "空闲" }
    val providerColor = if (row.provider == "claude-code") {
        if (ink.dark) Color(0xffe8916f) else Color(0xffd97757)
    } else ink.text
    val metadata = buildAnnotatedString {
        withStyle(SpanStyle(color = providerColor, fontWeight = FontWeight.SemiBold)) { append(providerLabel(row.provider)) }
        for (label in listOfNotNull(machine, project, status)) append(" · $label")
    }
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = open)
        .padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        TabletStatusDot(row.status)
        Column(Modifier.weight(1f)) {
            Text(row.title, color = ink.text, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(metadata, color = ink.secondary, fontSize = 13.sp, lineHeight = 19.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            tabletRelativeTime(row.lastActivityAt)?.let { Text(it, color = listMuted, fontSize = 13.sp) }
            TabletListIcon(TabletListGlyph.Chevron, listMuted, 16.dp)
        }
    }
}

internal fun listMachineSubtitle(entry: ComputerView, machine: RemoteMachine): String {
    val via = if (machine.isLocal) null
        else entry.workspace?.machines?.firstOrNull { it.isLocal }?.name ?: entry.computer.name
    if (entry.connection == null && via != null) return "离线 · 要等 $via 上线"
    val online = entry.connection != null && machine.available && (machine.isLocal || machine.status == "online")
    val lastSeen = if (online) null else tabletRelativeTime(machine.lastSeenAt)?.let { "${it}在线" }
    return listOfNotNull(if (online) "在线" else "离线", lastSeen, via?.let { "经由 $it" }).joinToString(" · ")
}

internal fun tabletMachineGlyph(machine: RemoteMachine): TabletListGlyph = when {
    machine.name.startsWith("MacBook", ignoreCase = true) -> TabletListGlyph.Laptop
    !machine.isLocal -> TabletListGlyph.Server
    else -> TabletListGlyph.Monitor
}
