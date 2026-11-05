package org.codetether.app.remote

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryMergeTest {
    @Test
    fun ninthCompletedTurnRetainsTheFirstTurnAndCompleteBoundary() = runBlocking {
        val loaded = history(1, 8).copy(turns = history(1, 8).turns.map {
            if (it.id == turnId(8)) it.copy(status = "running", completedAt = null) else it
        })
        val merged = reconcileHistory(loaded, history(2, 9)) { error("Overlapping latest window must not fetch older pages") }

        assertEquals((1..9).map(::turnId), merged.turns.map { it.id })
        assertEquals((1..9).flatMap { listOf("input:${turnId(it)}", "reply:$it") }, merged.messages.map { it.id })
        assertEquals("completed", merged.turns.single { it.id == turnId(8) }.status)
        assertNull(merged.beforeCursor)
        assertTrue(merged.complete)
        assertEquals("live_9", merged.liveCursor)
    }

    @Test
    fun previouslyLoadedOlderPagesStayContiguousAfterLatestWindowMoves() {
        val loaded = mergeHistory(history(9, 16), history(1, 8), olderPage = true)
        val merged = mergeHistory(loaded, history(13, 20))

        assertEquals((1..20).map(::turnId), merged.turns.map { it.id })
        assertEquals(40, merged.messages.size)
        assertNull(merged.beforeCursor)
        assertTrue(merged.complete)
    }

    @Test
    fun olderPageAdvancesTheOldestBoundaryWithoutAdvancingTheLiveCursor() {
        val merged = mergeHistory(history(17, 24), history(9, 16), olderPage = true)

        assertEquals((9..24).map(::turnId), merged.turns.map { it.id })
        assertEquals("before_9", merged.beforeCursor)
        assertFalse(merged.complete)
        assertEquals("live_24", merged.liveCursor)
    }

    @Test
    fun refreshBridgesEveryPageBeforeJoiningDisjointCachedHistory() = runBlocking {
        val requested = mutableListOf<String>()
        val pages = mapOf("before_18" to history(10, 17), "before_10" to history(2, 9))
        val merged = reconcileHistory(history(1, 8), history(18, 25)) { cursor ->
            requested += cursor
            pages.getValue(cursor)
        }

        assertEquals(listOf("before_18", "before_10"), requested)
        assertEquals((1..25).map(::turnId), merged.turns.map { it.id })
        assertEquals(50, merged.messages.size)
        assertEquals("live_25", merged.liveCursor)
        assertNull(merged.beforeCursor)
    }

    @Test
    fun largerRefreshedPageCanExtendBeforeTheCachedPage() {
        val merged = mergeHistory(history(9, 12), history(7, 14))

        assertEquals((7..14).map(::turnId), merged.turns.map { it.id })
        assertEquals("before_7", merged.beforeCursor)
        assertFalse(merged.complete)
    }

    @Test
    fun cursorIsRenewedWhenTheOldestLoadedRecordIsStillTheSame() {
        val incoming = history(2, 10).copy(beforeCursor = "renewed_before_2")
        val merged = mergeHistory(history(2, 9), incoming)

        assertEquals("renewed_before_2", merged.beforeCursor)
        assertEquals((2..10).map(::turnId), merged.turns.map { it.id })
    }

    @Test
    fun prependingAnOverlappingPageDoesNotReplaceNewerLiveRecords() {
        val loaded = history(9, 16).copy(messages = history(9, 16).messages.map {
            if (it.id == "reply:9") it.copy(text = "newer live response") else it
        })
        val merged = mergeHistory(loaded, history(1, 9), olderPage = true)

        assertEquals((1..16).map(::turnId), merged.turns.map { it.id })
        assertEquals("newer live response", merged.messages.single { it.id == "reply:9" }.text)
        assertEquals("live_16", merged.liveCursor)
    }

    @Test
    fun importedHistoryIsBridgedAndRetainedBeforeTheFirstDurableTurns() = runBlocking {
        val loaded = nativeHistory(1, 8)
        val latest = history(1, 2).copy(beforeCursor = "native_boundary", complete = false)
        val merged = reconcileHistory(loaded, latest) { cursor ->
            assertEquals("native_boundary", cursor)
            nativeHistory(5, 8)
        }

        assertEquals((1..8).map { "native_$it" }, merged.messages.take(8).map { it.id })
        assertEquals(12, merged.messages.size)
        assertEquals(listOf(turnId(1), turnId(2)), merged.turns.map { it.id })
        assertEquals("native_before_1", merged.beforeCursor)
        assertFalse(merged.native)
        assertEquals("live_2", merged.liveCursor)
    }

    @Test
    fun aRepeatedBridgeCursorFailsInsteadOfLoopingForever() = runBlocking {
        val latest = history(18, 25)
        try {
            reconcileHistory(history(1, 8), latest) { latest }
            error("A repeated history cursor must be rejected")
        } catch (failure: RemoteFailure) {
            assertEquals("invalid_response", failure.code)
        }
    }

    @Test
    fun realReplyReplacesOnlyItsTurnsFallbackInBothMergeDirections() {
        val fallbackPage = history(1, 1).copy(messages = listOf(fallback(1)))
        val real = reply(1, "real", "same synthetic reply")
        val replyPage = history(1, 1).copy(messages = listOf(real))
        for (olderPage in listOf(false, true)) {
            for ((loaded, incoming) in listOf(fallbackPage to replyPage, replyPage to fallbackPage)) {
                assertEquals(listOf(real), mergeHistory(loaded, incoming, olderPage).messages)
            }
        }
    }

    @Test
    fun initialAndEmptyMergePathsAlsoRemoveSupersededFallbacks() = runBlocking {
        val real = reply(1, "real", "same synthetic reply")
        val mixed = history(1, 1).copy(messages = listOf(fallback(1), real))
        val empty = mixed.copy(messages = emptyList(), turns = emptyList())

        assertEquals(listOf(real), mergeHistory(null, mixed).messages)
        assertEquals(listOf(real), mergeHistory(empty, mixed).messages)
        assertEquals(listOf(real), mergeHistory(mixed, empty).messages)
        assertEquals(listOf(real), mergeHistory(mixed, empty, olderPage = true).messages)
        assertEquals(listOf(real), reconcileHistory(null, mixed) { error("Initial normalization needs no request") }.messages)
    }

    @Test
    fun equalTextDoesNotCollapseDistinctRealRepliesOrOtherTurnsFallbacks() {
        val first = reply(1, "first", "same synthetic reply")
        val second = reply(1, "second", first.text)
        val differentTurn = reply(3, "third", first.text)
        val retainedFallback = fallback(2)
        val merged = mergeHistory(null, history(1, 3).copy(
            messages = listOf(fallback(1), first, second, retainedFallback, differentTurn),
        ))

        assertEquals(listOf(first, second, retainedFallback, differentTurn), merged.messages)
    }

    @Test
    fun userAndToolMessagesDoNotSupersedeAnAssistantFallback() {
        val placeholder = fallback(1)
        val user = reply(1, "input", placeholder.text).copy(role = "user")
        val tool = reply(1, "tool", placeholder.text).copy(role = "tool")
        val merged = mergeHistory(null, history(1, 1).copy(messages = listOf(placeholder, user, tool)))

        assertEquals(listOf(placeholder, user, tool), merged.messages)
    }

    @Test
    fun nativeEntriesWithoutTurnIdentityRemainSeparateFromDurableReplies() {
        val native = nativeHistory(1, 2).copy(messages = nativeHistory(1, 2).messages.map {
            it.copy(text = "same synthetic reply")
        })
        val real = reply(1, "real", "same synthetic reply")
        val durable = history(1, 1).copy(messages = listOf(fallback(1), real))
        val merged = mergeHistory(native, durable)

        assertEquals(native.messages + real, merged.messages)
        assertEquals(native.beforeCursor, merged.beforeCursor)
        assertFalse(merged.native)
    }

    @Test
    fun incrementalRealItemUpdatesStayUniqueAfterAStaleFallbackReturns() {
        val base = history(1, 1)
        val placeholder = base.copy(messages = listOf(fallback(1)))
        val partial = reply(1, "stream", "partial").copy(status = "running")
        val live = mergeHistory(placeholder, base.copy(messages = listOf(partial)))
        val completed = partial.copy(text = "partial completed", status = "completed")
        val terminal = mergeHistory(live, base.copy(messages = listOf(completed)))
        val reread = mergeHistory(terminal, placeholder)

        assertEquals(listOf(partial), live.messages)
        assertEquals(listOf(completed), terminal.messages)
        assertEquals(listOf(completed), reread.messages)
    }

    @Test
    fun olderFallbackDeduplicationPreservesTheOldestPaginationBoundary() {
        val loaded = history(9, 16)
        val older = history(1, 9).copy(messages = history(1, 9).messages.filterNot {
            it.id == "reply:9"
        } + fallback(9))
        val merged = mergeHistory(loaded, older, olderPage = true)

        assertFalse(merged.messages.any { it.id == "final:${turnId(9)}" })
        assertEquals(1, merged.messages.count { it.id == "reply:9" })
        assertEquals((1..16).map(::turnId), merged.turns.map { it.id })
        assertNull(merged.beforeCursor)
        assertTrue(merged.complete)
        assertEquals(loaded.liveCursor, merged.liveCursor)
    }

    private fun fallback(number: Int): RemoteMessage = RemoteMessage(
        "final:${turnId(number)}", "assistant", "same synthetic reply", "2026-11-04T00:00:00Z", "completed", turnId(number),
    )

    private fun reply(number: Int, item: String, text: String): RemoteMessage = RemoteMessage(
        "item_synthetic_$item", "assistant", text, "2026-11-04T00:00:00Z", "completed", turnId(number),
    )

    private fun history(first: Int, last: Int): RemoteHistory {
        val turns = (first..last).map { number ->
            RemoteTurn(turnId(number), "completed", "input $number", "2026-11-04T00:00:${number.toString().padStart(2, '0')}Z",
                "2026-11-04T00:01:${number.toString().padStart(2, '0')}Z", null, false)
        }
        return RemoteHistory(
            messages = turns.flatMapIndexed { index, turn ->
                val number = first + index
                listOf(
                    RemoteMessage("input:${turn.id}", "user", "input $number", turn.startedAt, "completed", turn.id),
                    RemoteMessage("reply:$number", "assistant", "reply $number", turn.startedAt, "completed", turn.id),
                )
            },
            turns = turns,
            beforeCursor = if (first == 1) null else "before_$first",
            liveCursor = "live_$last",
            complete = first == 1,
            native = false,
        )
    }

    private fun nativeHistory(first: Int, last: Int): RemoteHistory = RemoteHistory(
        messages = (first..last).map { RemoteMessage("native_$it", "assistant", "native $it", "", "completed") },
        turns = emptyList(),
        beforeCursor = "native_before_$first",
        liveCursor = "native_live_$last",
        complete = false,
        native = true,
        nativeStatus = "available",
    )

    private fun turnId(number: Int): String = "turn_${number.toString().padStart(8, '0')}"
}
