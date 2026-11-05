package org.codetether.app.remote

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the Android JSON projection entry points used by the foreground Flow. */
@RunWith(AndroidJUnit4::class)
class RemoteProjectionHistoryTest {
    @Test
    fun incrementalRealReplySupersedesTheFinalFallbackThroughTheLiveEntryPoint() {
        val initial = detail(listOf(fallback(TURN_ONE)))
        val first = initial.applyLive(page(event("message.delta", TURN_ONE, "item_synthetic_first", "delta", "first ")))
        assertEquals(listOf("item_synthetic_first"), first.history.messages.map { it.id })
        assertEquals("first ", first.history.messages.single().text)
        assertEquals("running", first.history.messages.single().status)

        val second = first.applyLive(page(event("message.delta", TURN_ONE, "item_synthetic_first", "delta", "second")))
        assertEquals("first second", second.history.messages.single().text)
        val completed = second.applyLive(page(event("message.completed", TURN_ONE, "item_synthetic_first", "message", "first second")))
        assertEquals("completed", completed.history.messages.single().status)

        // The watcher and Controller both merge their cached page with the projected page.
        val watched = mergeHistory(initial.history, completed.history)
        for (olderPage in listOf(false, true)) {
            val reread = mergeHistory(watched, initial.history, olderPage)
            assertEquals(listOf("item_synthetic_first"), reread.messages.map { it.id })
            assertEquals("first second", reread.messages.single().text)
        }
    }

    @Test
    fun identicalRealItemsStaySeparateAndAnotherTurnsFallbackIsKept() {
        val initial = detail(listOf(fallback(TURN_ONE), fallback(TURN_TWO)))
        val live = initial.applyLive(page(
            event("message.completed", TURN_ONE, "item_synthetic_first", "message", "same synthetic reply"),
            event("message.completed", TURN_ONE, "item_synthetic_second", "message", "same synthetic reply"),
        ))

        assertFalse(live.history.messages.any { it.id == "final:$TURN_ONE" })
        assertTrue(live.history.messages.any { it.id == "final:$TURN_TWO" })
        assertEquals(listOf("item_synthetic_first", "item_synthetic_second"),
            live.history.messages.filter { it.turnId == TURN_ONE }.map { it.id })
        assertEquals(3, live.history.messages.count { it.text == "same synthetic reply" })
    }

    @Test
    fun nativeHistoryAndToolEventsDoNotBecomeDurableAssistantReplyIdentities() {
        val native = JSONObject()
            .put("conversationId", TARGET.conversationId)
            .put("source", "native_provider")
            .put("historyComplete", true)
            .put("hasMoreBefore", false)
            .put("liveCursor", "synthetic-native-cursor")
            .put("native", JSONObject().put("conversationId", TARGET.conversationId).put("status", "available")
                .put("entries", JSONArray().put(JSONObject().put("conversationId", TARGET.conversationId)
                    .put("id", "native_synthetic_first").put("role", "assistant").put("content", "same synthetic reply"))))
            .history(TARGET)
        val loaded = mergeHistory(native, detail(listOf(fallback(TURN_ONE))).history)
        val toolEvent = JSONObject()
            .put("type", "tool.started").put("conversationId", TARGET.conversationId)
            .put("turnId", TURN_ONE).put("itemId", "item_synthetic_tool").put("timestamp", TIMESTAMP)
            .put("payload", JSONObject().put("name", "Synthetic tool"))
        val tool = detail(loaded.messages).applyLive(page(toolEvent))
        assertTrue(tool.history.messages.any { it.id == "native_synthetic_first" && it.turnId == null })
        assertTrue(tool.history.messages.any { it.id == "final:$TURN_ONE" })

        val replied = tool.applyLive(page(event("message.delta", TURN_ONE, "item_synthetic_reply", "delta", "same synthetic reply")))
        assertFalse(replied.history.messages.any { it.id == "final:$TURN_ONE" })
        assertTrue(replied.history.messages.any { it.id == "native_synthetic_first" && it.turnId == null })
        assertTrue(replied.history.messages.any { it.id == "item_synthetic_tool" && it.role == "tool" })
        assertEquals(2, replied.history.messages.count { it.role == "assistant" })
    }

    private fun detail(messages: List<RemoteMessage>): RemoteConversationDetail = RemoteConversationDetail(
        RemoteConversation(TARGET, "Synthetic history", "codex", "running", "created", false, TIMESTAMP),
        RemoteHistory(messages, listOf(
            RemoteTurn(TURN_ONE, "running", null, TIMESTAMP, null, null, false),
            RemoteTurn(TURN_TWO, "completed", null, TIMESTAMP, TIMESTAMP, null, false),
        ), null, "synthetic-live-cursor", true, false),
        null, emptyList(), true,
    )

    private fun fallback(turnId: String): RemoteMessage = RemoteMessage(
        "final:$turnId", "assistant", "same synthetic reply", TIMESTAMP, "completed", turnId,
    )

    private fun event(type: String, turnId: String, itemId: String, field: String, value: String): JSONObject = JSONObject()
        .put("type", type).put("conversationId", TARGET.conversationId)
        .put("turnId", turnId).put("itemId", itemId).put("timestamp", TIMESTAMP)
        .put("payload", JSONObject().put(field, value))

    private fun page(vararg events: JSONObject): RemoteLivePage = JSONObject()
        .put("conversationId", TARGET.conversationId).put("cursor", "synthetic-next-cursor")
        .put("resetRequired", false).put("events", JSONArray(events.toList())).livePage(TARGET)

    private companion object {
        val TARGET = ConversationTarget("machine_synthetic_000001", "proj_synthetic_00000001", "conv_synthetic_00000001")
        const val TURN_ONE = "turn_synthetic_00000001"
        const val TURN_TWO = "turn_synthetic_00000002"
        const val TIMESTAMP = "2026-11-04T00:00:00Z"
    }
}
