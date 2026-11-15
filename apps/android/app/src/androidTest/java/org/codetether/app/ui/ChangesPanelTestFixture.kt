package org.codetether.app.ui

import androidx.compose.ui.semantics.ScrollAxisRange
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
import org.codetether.app.remote.RemoteChange

internal val changesPanelFixture = listOf(
    RemoteChange("src/first.txt", "modified", "+first file", 1, 0, turnId = "turn_first", order = 1),
    RemoteChange(
        "src/second.txt", "modified",
        (listOf("@@ second file @@") + List(110) { "+${it} ${"wide line ".repeat(32)}" }).joinToString("\n"),
        110, 0, turnId = "turn_second", order = 2,
    ),
)

internal fun ComposeTestRule.scrollChangesFixture() {
    onNodeWithTag("changes-panel-body", useUnmergedTree = true)
        .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 240f) }
    onNodeWithTag("change-diff-lines", useUnmergedTree = true)
        .performSemanticsAction(SemanticsActions.ScrollBy) { it(120f, 0f) }
    waitForIdle()
}

internal fun ComposeTestRule.changesFixtureOffsets(): Pair<Float, Float> =
    onNodeWithTag("changes-panel-body", useUnmergedTree = true).offset(SemanticsProperties.VerticalScrollAxisRange) to
        onNodeWithTag("change-diff-lines", useUnmergedTree = true).offset(SemanticsProperties.HorizontalScrollAxisRange)

private fun SemanticsNodeInteraction.offset(axis: SemanticsPropertyKey<ScrollAxisRange>): Float =
    fetchSemanticsNode().config[axis].value()
