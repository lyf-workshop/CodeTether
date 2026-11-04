package org.codetether.app.remote

/** Keeps one contiguous loaded range while accepting newer versions of its records. */
internal fun mergeHistory(
    loaded: RemoteHistory?,
    incoming: RemoteHistory,
    olderPage: Boolean = false,
): RemoteHistory {
    if (loaded == null || loaded.isEmpty()) return incoming
    if (incoming.isEmpty()) {
        return if (olderPage) loaded.copy(beforeCursor = incoming.beforeCursor, complete = incoming.complete)
        else loaded.copy(liveCursor = incoming.liveCursor, nativeStatus = incoming.nativeStatus)
    }
    val incomingFirst = incoming.firstRecord()
    val loadedFirst = loaded.firstRecord()
    val incomingBeginsEarlier = when {
        incomingFirst == loadedFirst -> true
        loaded.containsRecord(incomingFirst) -> false
        incoming.containsRecord(loadedFirst) -> true
        else -> olderPage
    }
    val earliest = if (incomingBeginsEarlier) incoming else loaded
    val latest = if (incomingBeginsEarlier) loaded else incoming
    val messages = (earliest.messages + latest.messages).associateByTo(linkedMapOf()) { it.id }
    val turns = (earliest.turns + latest.turns).associateByTo(linkedMapOf()) { it.id }
    // A page requested before a cursor must not overwrite a later live update.
    val authoritative = if (olderPage) loaded else incoming
    authoritative.messages.forEach { messages[it.id] = it }
    authoritative.turns.forEach { turns[it.id] = it }
    val current = if (olderPage) loaded else incoming
    return current.copy(
        messages = messages.values.toList(),
        turns = turns.values.toList(),
        beforeCursor = earliest.beforeCursor,
        complete = earliest.complete,
    )
}

/** Latest windows may have advanced beyond the last loaded range during a disconnect. */
internal suspend fun reconcileHistory(
    loaded: RemoteHistory?,
    latest: RemoteHistory,
    loadBefore: suspend (String) -> RemoteHistory,
): RemoteHistory {
    if (loaded == null || loaded.isEmpty()) return latest
    var refreshed = latest
    val cursors = mutableSetOf<String>()
    while (!loaded.overlaps(refreshed)) {
        val cursor = refreshed.beforeCursor ?: break
        if (!cursors.add(cursor)) invalidResponse()
        refreshed = mergeHistory(refreshed, loadBefore(cursor), olderPage = true)
    }
    return mergeHistory(loaded, refreshed)
}

private fun RemoteHistory.isEmpty(): Boolean = messages.isEmpty() && turns.isEmpty()

private data class HistoryRecord(val id: String, val turn: Boolean)

private fun RemoteHistory.firstRecord(): HistoryRecord {
    val firstMessage = messages.firstOrNull()
    // Imported native entries precede the first durable Turn in an adopted conversation.
    if (firstMessage != null && firstMessage.turnId == null) return HistoryRecord(firstMessage.id, false)
    return turns.firstOrNull()?.let { HistoryRecord(it.id, true) }
        ?: HistoryRecord(requireNotNull(firstMessage).id, false)
}

private fun RemoteHistory.containsRecord(record: HistoryRecord): Boolean =
    if (record.turn) turns.any { it.id == record.id } else messages.any { it.id == record.id }

private fun RemoteHistory.overlaps(other: RemoteHistory): Boolean {
    val turnIds = turns.mapTo(hashSetOf()) { it.id }
    val messageIds = messages.mapTo(hashSetOf()) { it.id }
    return other.turns.any { it.id in turnIds } || other.messages.any { it.id in messageIds }
}
