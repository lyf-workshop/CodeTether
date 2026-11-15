package org.codetether.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.codetether.app.R
import org.codetether.app.remote.RemoteAttention
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

@Composable
internal fun ConversationApprovalCard(
    item: RemoteAttention,
    location: String,
    actionable: Boolean,
    enabled: Boolean,
    approve: () -> Unit,
    decline: () -> Unit,
) {
    val warning = if (ink.dark) Color(0xffffb340) else Color(0xfff29a0c)
    val warningText = if (ink.dark) Color(0xffffc66b) else Color(0xff8f5600)
    val title = when (item.title) {
        "执行命令", "运行命令" -> "需要你批准：运行命令"
        "需要审批" -> "需要你批准"
        else -> "需要你批准：${item.title}"
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(warning.copy(alpha = if (ink.dark) .16f else .14f))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ApprovalShield(warningText)
            Text(title, color = warningText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        if (location.isNotEmpty()) {
            Text(location, Modifier.padding(top = 6.dp), color = ink.secondary, fontSize = 13.sp)
        }
        item.detail?.takeIf { it.isNotBlank() }?.let { command ->
            Text(
                command,
                Modifier.padding(top = 8.dp).fillMaxWidth().testTag("conversation-approval-command")
                    .clip(RoundedCornerShape(10.dp)).background(ink.card)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                color = ink.text,
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                lineHeight = 19.5.sp,
            )
        }
        if (actionable) {
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                InkButton("允许一次", enabled = enabled, onClick = approve)
                Box(
                    Modifier.heightIn(min = 48.dp).clip(CircleShape)
                        .clickable(enabled = enabled, role = Role.Button, onClick = decline),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.height(44.dp).alpha(if (enabled) 1f else .4f).clip(CircleShape)
                            .background(Color(0xff767680).copy(alpha = if (ink.dark) .24f else .12f))
                            .padding(horizontal = 18.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("拒绝", color = ink.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
internal fun RunningTimelineStatus(provider: String, action: String) {
    Column(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(provider, fontSize = 13.sp, color = ink.text, fontWeight = FontWeight.Bold)
            RunningSpinner()
        }
        Text(action, color = ink.secondary, fontSize = 15.sp)
    }
}

@Composable
internal fun WaitingComposerStatus(enabled: Boolean, stop: (() -> Unit)?) {
    ComposerStatusPill {
        ApprovalShield(ink.secondary)
        Text("先处理上面的批准，这一轮结束后再发送", Modifier.weight(1f), color = ink.secondary, fontSize = 14.sp)
        if (stop != null) StopTurnButton(enabled, stop)
    }
}

@Composable
internal fun RunningComposerStatus(action: String, startedAt: String?, enabled: Boolean, stop: (() -> Unit)?) {
    val started = remember(startedAt) {
        try {
            startedAt?.let(Instant::parse)
        } catch (_: DateTimeParseException) {
            null
        }
    }
    var elapsed by remember(started) { mutableStateOf(started?.let(::elapsedRunningTime)) }
    LaunchedEffect(started) {
        if (started != null) {
            while (true) {
                elapsed = elapsedRunningTime(started)
                delay(1_000L)
            }
        }
    }
    val blue = runningBlue()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        LinearProgressIndicator(
            Modifier.fillMaxWidth().height(2.dp).clip(CircleShape).testTag("conversation-running-progress"),
            color = blue, trackColor = blue.copy(alpha = .12f),
        )
        ComposerStatusPill {
            RunningSpinner()
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    action, Modifier.weight(1f, fill = false).testTag("conversation-running-action"),
                    color = ink.secondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                elapsed?.let {
                    Text(" · $it", Modifier.testTag("conversation-running-elapsed"), color = ink.secondary, fontSize = 14.sp,
                        maxLines = 1)
                }
            }
            if (stop != null) StopTurnButton(enabled, stop)
            else Text("这台设备上不能停止", Modifier.padding(end = 10.dp), color = ink.secondary, fontSize = 13.sp)
        }
    }
}

private fun elapsedRunningTime(started: Instant): String? {
    val elapsed = Duration.between(started, Instant.now())
    return when {
        elapsed.isNegative -> null
        elapsed.toDays() > 0 -> "已运行 ${elapsed.toDays()} 天"
        elapsed.toHours() > 0 -> "已运行 ${elapsed.toHours()} 小时"
        elapsed.toMinutes() > 0 -> "已运行 ${elapsed.toMinutes()} 分钟"
        else -> "已运行 ${elapsed.seconds} 秒"
    }
}

@Composable
private fun ComposerStatusPill(content: @Composable RowScope.() -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(shape).background(ink.card)
            .border(.75.dp, ink.rule, shape).padding(start = 16.dp, end = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun ApprovalShield(color: Color) {
    Icon(painterResource(R.drawable.tablet_conversation_shield), null, Modifier.size(16.dp), tint = color)
}

@Composable
private fun runningBlue(): Color = if (ink.dark) Color(0xff3c9be3) else ink.running

@Composable
private fun RunningSpinner() {
    val blue = runningBlue()
    CircularProgressIndicator(
        Modifier.size(16.dp).clearAndSetSemantics {},
        color = blue, trackColor = blue.copy(alpha = .1f), strokeWidth = 2.dp,
    )
}

@Composable
private fun StopTurnButton(enabled: Boolean, stop: () -> Unit) {
    val red = if (ink.dark) Color(0xffff6961) else Color(0xffe5392f)
    val foreground = if (ink.dark) Color(0xffff8a84) else Color(0xffb42318)
    Box(
        Modifier.heightIn(min = 48.dp).clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = stop),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).alpha(if (enabled) 1f else .4f).clip(CircleShape)
                .background(red.copy(alpha = if (ink.dark) .16f else .1f)).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Canvas(Modifier.size(16.dp)) {
                val inset = size.width * 7f / 24f
                val side = size.width * 10f / 24f
                drawRect(foreground, Offset(inset, inset), Size(side, side), style = Stroke(1.25.dp.toPx()))
            }
            Text("停止", color = foreground, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}
