package org.codetether.app.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import org.codetether.app.remote.RemoteChangeKey

internal class ChangesPanelState(
    open: Boolean = false,
    selected: RemoteChangeKey? = null,
    listOffset: Int = 0,
    diffOffset: Int = 0,
) {
    var open by mutableStateOf(open)
    var selected by mutableStateOf(selected)
    val listScroll = ScrollState(listOffset)
    val diffScroll = ScrollState(diffOffset)

    companion object {
        val Saver = mapSaver(
            save = { panel: ChangesPanelState ->
                mapOf(
                    "open" to panel.open,
                    "turn" to panel.selected?.turnId,
                    "item" to panel.selected?.itemId,
                    "path" to panel.selected?.path,
                    "order" to panel.selected?.order,
                    "listOffset" to panel.listScroll.value,
                    "diffOffset" to panel.diffScroll.value,
                )
            },
            restore = { saved ->
                val selected = (saved["turn"] as? String)?.let { turn ->
                    RemoteChangeKey(turn, saved["item"] as? String, saved["path"] as String, saved["order"] as Long)
                }
                ChangesPanelState(saved["open"] as Boolean, selected, saved["listOffset"] as Int, saved["diffOffset"] as Int)
            },
        )
    }
}

@Composable
internal fun rememberChangesPanelState(owner: String?, conversation: TabletPage.Conversation?): ChangesPanelState =
    key(owner, conversation) { rememberSaveable(saver = ChangesPanelState.Saver) { ChangesPanelState() } }
