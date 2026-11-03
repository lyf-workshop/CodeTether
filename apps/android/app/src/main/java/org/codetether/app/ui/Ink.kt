package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

internal data class InkColors(
    val dark: Boolean,
    val background: Color,
    val card: Color,
    val bar: Color,
    val selected: Color,
    val text: Color,
    val secondary: Color,
    val rule: Color,
    val ink: Color,
    val onInk: Color,
    val link: Color,
    val running: Color,
    val waiting: Color,
    val done: Color,
    val failed: Color,
    val warningCard: Color,
    val failedCard: Color,
)

private val Light = InkColors(
    false, Color(0xfff2f2f7), Color.White, Color(0xfff8f8fa), Color(0xffdedee6),
    Color(0xff1c1c1e), Color(0xff66666e), Color(0xffd8d8de), Color(0xff1c1c1e),
    Color.White, Color(0xff135e9c), Color(0xff1a7fd0), Color(0xff9a5800),
    Color(0xff1e7940), Color(0xffad2028), Color(0xfffbf0dc), Color(0xfffae8e9),
)
private val Dark = InkColors(
    true, Color.Black, Color(0xff1c1c1e), Color(0xff141416), Color(0xff38383e),
    Color(0xfff2f2f7), Color(0xffb5b5be), Color(0xff414146), Color(0xfff2f2f7),
    Color(0xff1c1c1e), Color(0xff7cc0f2), Color(0xff7cc0f2), Color(0xfff3b45c),
    Color(0xff84d29a), Color(0xfff99095), Color(0xff382918), Color(0xff391d21),
)

private val LocalInk = staticCompositionLocalOf { Light }
internal val ink: InkColors @Composable get() = LocalInk.current
internal val cardShape = RoundedCornerShape(12.dp)

@Composable
internal fun TabletInk(appearance: Appearance, content: @Composable () -> Unit) {
    val dark = when (appearance) {
        Appearance.System -> isSystemInDarkTheme()
        Appearance.Dark -> true
        Appearance.Light -> false
    }
    val palette = if (dark) Dark else Light
    val theme = if (dark) darkColorScheme(
        primary = palette.ink, onPrimary = palette.onInk,
        background = palette.background, onBackground = palette.text,
        surface = palette.card, onSurface = palette.text,
        surfaceVariant = palette.bar, onSurfaceVariant = palette.secondary,
        error = palette.failed, outline = palette.rule,
    ) else lightColorScheme(
        primary = palette.ink, onPrimary = palette.onInk,
        background = palette.background, onBackground = palette.text,
        surface = palette.card, onSurface = palette.text,
        surfaceVariant = palette.bar, onSurfaceVariant = palette.secondary,
        error = palette.failed, outline = palette.rule,
    )
    CompositionLocalProvider(LocalInk provides palette) {
        MaterialTheme(colorScheme = theme, content = content)
    }
}

@Composable
internal fun Brand(modifier: Modifier = Modifier) {
    Box(modifier.size(36.dp).clip(RoundedCornerShape(9.dp)).background(ink.ink), contentAlignment = Alignment.Center) {
        Text(">_", color = ink.onInk, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
internal fun InkButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 48.dp),
        enabled = enabled,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = ink.ink,
            contentColor = ink.onInk,
            disabledContainerColor = ink.selected,
            disabledContentColor = ink.secondary,
        ),
    ) { Text(label, fontWeight = FontWeight.SemiBold) }
}

@Composable
internal fun QuietButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 48.dp).clip(cardShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (enabled) ink.link else ink.secondary, fontWeight = FontWeight.Medium) }
}

@Composable
internal fun IconAction(symbol: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(cardShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(symbol, fontSize = 20.sp, color = ink.text) }
}

@Composable
internal fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(cardShape).background(ink.card), content = content)
}

@Composable
internal fun Rule() = HorizontalDivider(color = ink.rule, thickness = 0.5.dp)

@Composable
internal fun RowItem(
    title: String,
    subtitle: String? = null,
    trailing: String? = null,
    active: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val base = modifier.fillMaxWidth().heightIn(min = 48.dp)
        .background(if (active) ink.selected else Color.Transparent)
    Row(
        if (onClick != null) base.clickable(role = Role.Button, onClick = onClick).padding(12.dp) else base.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = ink.text, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = ink.secondary, fontSize = 13.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            Text(trailing, color = ink.secondary, fontSize = 13.sp)
        }
        if (onClick != null) {
            Spacer(Modifier.width(10.dp))
            Text("›", color = ink.secondary, fontSize = 19.sp)
        }
    }
}

@Composable
internal fun PageTitle(title: String, summary: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontSize = 32.sp, fontWeight = FontWeight.Bold, color = ink.text, lineHeight = 39.sp)
        if (summary != null) Text(summary, color = ink.secondary, fontSize = 14.sp)
    }
}

@Composable
internal fun SectionTitle(label: String) {
    Text(label, Modifier.padding(horizontal = 12.dp), fontWeight = FontWeight.SemiBold, color = ink.text)
}

@Composable
internal fun InkField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    keyboard: KeyboardType = KeyboardType.Text,
    transformation: VisualTransformation = VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
        label = { Text(label) },
        singleLine = singleLine,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation = transformation,
        shape = cardShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = ink.ink,
            unfocusedBorderColor = ink.rule,
            focusedContainerColor = ink.bar,
            unfocusedContainerColor = ink.bar,
            disabledContainerColor = ink.bar,
        ),
    )
}

@Composable
internal fun Badge(status: String) {
    val color = when (status) {
        "running", "starting" -> ink.running
        "waiting" -> ink.waiting
        "completed" -> ink.done
        "failed", "interrupted" -> ink.failed
        else -> ink.secondary
    }
    Text(statusLabel(status), Modifier.clip(CircleShape).background(color.copy(alpha = .12f))
        .padding(horizontal = 9.dp, vertical = 3.dp), color = color, fontSize = 12.sp)
}

internal fun statusLabel(status: String): String = when (status) {
    "starting", "running" -> "运行中"
    "waiting" -> "等待批准"
    "completed" -> "已完成"
    "failed" -> "失败"
    "interrupted" -> "已停止"
    "archived" -> "已归档"
    else -> "空闲"
}

@Composable
internal fun Segments(options: List<Pair<String, Boolean>>, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(cardShape).background(ink.selected).padding(3.dp)) {
        options.forEachIndexed { index, (label, selected) ->
            val foreground = if (selected) ink.onInk else ink.text
            Box(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(cardShape)
                    .background(if (selected) ink.ink else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(index) }.padding(6.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, color = foreground, fontSize = 13.sp, maxLines = 2) }
        }
    }
}

@Composable
internal fun CenterSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp))
                    .border(0.5.dp, ink.rule, RoundedCornerShape(20.dp)).background(ink.card).padding(22.dp)
                    .onPreviewKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown && event.key == Key.Escape) {
                            onDismiss()
                            true
                        } else false
                    }.focusRequester(focus).focusable(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 22.sp, color = ink.text)
                    IconAction("×", "关闭窗口", onDismiss)
                }
                content()
            }
        }
    }
}
