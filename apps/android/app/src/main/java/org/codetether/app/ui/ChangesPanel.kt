package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.codetether.app.R
import org.codetether.app.remote.RemoteChange

@Composable
internal fun ChangesPanel(
    modifier: Modifier,
    state: TabletState,
    close: () -> Unit,
    refresh: () -> Unit,
    panel: ChangesPanelState = rememberChangesPanelState(state.profile?.id, state.page as? TabletPage.Conversation),
) {
    val changes = state.changes
    val selected = changes.firstOrNull { it.key == panel.selected } ?: changes.firstOrNull()
    // An empty loading frame must not clamp the saved offset before the changes arrive.
    val scrolling = if (changes.isEmpty()) Modifier else Modifier.verticalScroll(panel.listScroll)
    Column(modifier.testTag("changes-panel").fillMaxHeight().background(ink.background)) {
        Box(Modifier.fillMaxWidth().background(ink.bar).heightIn(min = 52.dp)) {
            Column(
                Modifier.align(Alignment.Center).fillMaxWidth().padding(horizontal = 80.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("变更", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = ink.text)
                if (changes.isNotEmpty() || !state.changesLoading) {
                    Text(changeSummary(changes), color = ink.secondary, fontSize = 12.sp, textAlign = TextAlign.Center)
                }
            }
            QuietButton("刷新", modifier = Modifier.align(Alignment.CenterStart), enabled = !state.changesLoading, onClick = refresh)
            Box(Modifier.align(Alignment.CenterEnd)) { IconAction("×", "关闭变更", close) }
        }
        Rule()
        Column(
            Modifier.testTag("changes-panel-body").fillMaxWidth().then(scrolling).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Group {
                if (changes.isEmpty()) {
                    RowItem(if (state.changesLoading) "正在读取变更…" else "没有变更")
                } else {
                    changes.forEachIndexed { index, change ->
                        if (index > 0) Rule()
                        ChangeFileRow(change, selected?.key == change.key, Modifier.testTag("change-row-$index")) {
                            panel.selected = change.key
                        }
                    }
                }
            }
            if (selected != null) Group(Modifier.testTag("change-diff")) {
                // The remote project directory does not expose a root for display-only shortening.
                Text(
                    selected.path, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    color = ink.secondary, fontFamily = FontFamily.Monospace, fontSize = 12.sp,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Rule()
                val diff = selected.diff
                if (diff == null) RowItem("没有可显示的逐行差异") else {
                    // Measure to the larger of the viewport or longest line so every background
                    // covers the complete scrolling row, including beyond the text itself.
                    Column(
                        Modifier.testTag("change-diff-lines").fillMaxWidth()
                            .horizontalScroll(panel.diffScroll).width(IntrinsicSize.Max),
                    ) {
                        var inHunk = false
                        diff.lineSequence().forEachIndexed { lineIndex, line ->
                            val hunk = line.startsWith("@@")
                            if (hunk) inHunk = true
                            if (line.startsWith("diff --git ")) inHunk = false
                            val added = line.startsWith("+") && (inHunk || !line.startsWith("+++ "))
                            val removed = line.startsWith("-") && (inHunk || !line.startsWith("--- "))
                            val background = when {
                                added -> ink.done.copy(alpha = if (ink.dark) .16f else .12f)
                                removed -> ink.failed.copy(alpha = if (ink.dark) .16f else .10f)
                                hunk -> ink.secondary.copy(alpha = if (ink.dark) .24f else .12f)
                                else -> Color.Transparent
                            }
                            Text(
                                line.ifEmpty { " " }, Modifier.testTag("change-line-$lineIndex").fillMaxWidth()
                                    .background(background).padding(horizontal = 12.dp),
                                color = if (hunk) ink.secondary else ink.text,
                                fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 20.sp,
                                softWrap = false, maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun changeSummary(changes: List<RemoteChange>): String {
    // Omitted counters are unknown, not zero. Show a total only for a complete counter column.
    val additions = changes.mapNotNull { it.additions }
    val deletions = changes.mapNotNull { it.deletions }
    val totals = listOfNotNull(
        additions.takeIf { it.isNotEmpty() && it.size == changes.size }?.let { "+${it.sumOf(Int::toLong)}" },
        deletions.takeIf { it.isNotEmpty() && it.size == changes.size }?.let { "−${it.sumOf(Int::toLong)}" },
    )
    val files = "${changes.distinctBy { it.path }.size} 个文件"
    return if (totals.isEmpty()) files else "$files · ${totals.joinToString(" ")}"
}

@Composable
private fun ChangeFileRow(change: RemoteChange, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).background(if (selected) ink.selected else Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(R.drawable.tablet_change_file), contentDescription = null,
            modifier = Modifier.size(16.dp), tint = ink.text,
        )
        Text(
            change.path.substringAfterLast('/').substringAfterLast('\\'), Modifier.weight(1f),
            color = ink.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        change.additions?.let { Text("+$it", color = ink.done, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
        change.deletions?.let { Text("−$it", color = ink.failed, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
    }
}
