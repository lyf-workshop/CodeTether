package org.codetether.app.remote

import org.json.JSONArray
import org.json.JSONObject

internal fun json(vararg entries: Pair<String, Any?>): JSONObject = JSONObject().apply {
    entries.forEach { (key, value) -> if (value != null) put(key, value) }
}

internal fun invalidResponse(): Nothing = throw RemoteFailure("invalid_response")

internal fun JSONObject.protocol(): JSONObject {
    if (opt("protocolVersion") != 1) invalidResponse()
    return this
}

internal fun JSONObject.text(key: String): String = optionalText(key) ?: invalidResponse()
internal fun JSONObject.optionalText(key: String): String? = opt(key) as? String
internal fun JSONObject.flag(key: String): Boolean = opt(key) as? Boolean ?: invalidResponse()
internal fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: invalidResponse()
internal fun JSONObject.count(key: String): Int? = (opt(key) as? Number)?.toLong()
    ?.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()

internal fun JSONObject.rows(key: String, max: Int = 2048): List<JSONObject> =
    (optJSONArray(key) ?: invalidResponse()).objects(max)

private fun JSONArray.objects(max: Int): List<JSONObject> {
    if (length() > max) invalidResponse()
    return List(length()) { optJSONObject(it) ?: invalidResponse() }
}

internal fun JSONObject.scope(): ConversationTarget = ConversationTarget(
    machineId = text("machineId"),
    projectId = text("projectId"),
    conversationId = text("conversationId"),
)

internal fun JSONObject.machine(detail: JSONObject? = null): RemoteMachine {
    val machineId = text("machineId")
    if (detail != null && detail.obj("machine").text("machineId") != machineId) invalidResponse()
    val available = text("availability") == "available"
    val canExecute = available && obj("capabilities").flag("providerExecution")
    return RemoteMachine(
        id = machineId,
        name = text("displayName").takeUnless { it == "CodeTether Node" } ?: "远程电脑",
        platform = listOf(text("platform"), text("architecture")).joinToString(" · "),
        isLocal = flag("isLocal"),
        status = text("connectionState"),
        providers = detail?.rows("providers", 8).orEmpty().map { it.provider(canExecute) },
        available = available,
        connection = detail?.optJSONObject("connection")?.optionalText("executionTransport"),
        lastSeenAt = optionalText("lastSeenAt"),
    )
}

private fun JSONObject.provider(canExecute: Boolean): RemoteProvider {
    val capabilities = obj("capabilities")
    val availability = text("availability")
    val executable = canExecute && availability == "available" &&
        optJSONObject("executionHealth")?.optionalText("state") != "unavailable"
    return RemoteProvider(
        id = text("provider"),
        displayName = text("displayName"),
        status = availability,
        reasoning = if (capabilities.flag("reasoningControl")) {
            optJSONArray("reasoningOptions")?.objects(16).orEmpty().map {
                RemoteReasoning(it.text("id"), it.text("label"))
            }
        } else emptyList(),
        canStart = executable,
        approvals = capabilities.flag("approvals"),
        interrupt = capabilities.flag("interrupt"),
        diff = capabilities.flag("diff"),
    )
}

internal fun JSONObject.project(machineId: String, available: Boolean): RemoteProject {
    if (text("machineId") != machineId) invalidResponse()
    return RemoteProject(text("projectId"), machineId, text("name"), available, count("conversationCount") ?: invalidResponse())
}

internal fun JSONObject.conversation(): RemoteConversation = RemoteConversation(
    target = scope(),
    title = text("title"),
    provider = text("provider"),
    status = text("status"),
    origin = text("origin"),
    archived = flag("archived"),
    lastActivityAt = text("lastActivityAt"),
    resumable = text("resumability") == "resumable",
)

internal fun JSONObject.attention(conversation: RemoteConversation?, provider: RemoteProvider?, control: Boolean): RemoteAttention {
    val type = text("type")
    val payload = obj("payload")
    val open = text("status") == "open"
    val approvalId = if (type == "approval") payload.text("approvalId") else null
    return RemoteAttention(
        id = text("attentionId"),
        target = conversation?.target,
        type = type,
        title = if (type == "approval") payload.text("actionTitle") else payload.text("conversationTitle"),
        approvalId = approvalId,
        turnId = optionalText("turnId"),
        createdAt = text("createdAt"),
        detail = when (type) {
            "approval" -> payload.optionalText("actionSubtitle")
            "failed" -> payload.optJSONObject("error")?.friendlyFailure()
            else -> null
        },
        canApprove = open && control && approvalId != null && provider?.approvals == true && conversation != null,
    )
}

internal fun JSONObject.change() = RemoteChange(
    path = text("path"),
    kind = text("kind"),
    diff = optionalText("diff"),
    additions = count("additions"),
    deletions = count("deletions"),
    turnId = text("turnId"),
    itemId = optionalText("itemId"),
    order = (opt("order") as? Number)?.toLong() ?: invalidResponse(),
)

internal fun JSONObject.history(target: ConversationTarget): RemoteHistory {
    if (text("conversationId") != target.conversationId) invalidResponse()
    val before = optionalText("beforeCursor")
    val complete = flag("historyComplete")
    if (flag("hasMoreBefore") != (before != null) || (complete && before != null)) invalidResponse()
    val cursor = text("liveCursor")
    return when (text("source")) {
        "native_provider" -> {
            val native = obj("native")
            if (native.text("conversationId") != target.conversationId) invalidResponse()
            val entries = native.rows("entries", 100).map {
                if (it.text("conversationId") != target.conversationId) invalidResponse()
                RemoteMessage(it.text("id"), it.text("role"), it.text("content"), it.optionalText("occurredAt").orEmpty(), "completed")
            }
            RemoteHistory(entries, emptyList(), before, cursor, complete, native = true, nativeStatus = native.text("status"))
        }
        "durable" -> {
            val runtime = obj("runtime")
            if (runtime.text("conversationId") != target.conversationId) invalidResponse()
            val turnRecords = runtime.rows("turns", 64)
            val turns = turnRecords.map {
                if (it.text("conversationId") != target.conversationId) invalidResponse()
                it.turn()
            }
            val responses = runtime.rows("messages").sortedBy { it.optLong("order") }.groupBy { it.text("turnId") }
            val tools = runtime.rows("tools").groupBy { it.text("turnId") }
            val messages = buildList {
                turns.forEachIndexed { index, turn ->
                    turn.input?.let { add(RemoteMessage("input:${turn.id}", "user", it, turn.startedAt, "completed", turn.id)) }
                    val ordered = (responses[turn.id].orEmpty().map { it to false } + tools[turn.id].orEmpty().map { it to true })
                        .sortedBy { it.first.optLong("order") }
                    ordered.forEach { (record, tool) ->
                        add(if (tool) record.tool(turn.id) else RemoteMessage(
                            record.text("itemId"), "assistant", record.text("text"),
                            record.text("timestamp"), record.text("status"), turn.id,
                        ))
                    }
                    if (responses[turn.id].isNullOrEmpty()) {
                        turnRecords[index].optionalText("finalMessage")?.takeIf { it.isNotEmpty() }?.let {
                            add(RemoteMessage("final:${turn.id}", "assistant", it, turn.completedAt ?: turn.startedAt, turn.status, turn.id))
                        }
                    }
                }
            }
            RemoteHistory(messages, turns, before, cursor, complete, native = false)
        }
        else -> invalidResponse()
    }
}

private fun JSONObject.tool(turnId: String) = RemoteMessage(
    id = text("itemId"),
    role = "tool",
    text = optionalText("summary") ?: optionalText("outputSummary") ?: text("name"),
    timestamp = text("startedAt"),
    status = text("status"),
    turnId = turnId,
)

private fun JSONObject.turn(): RemoteTurn {
    val error = optJSONObject("error")
    val input = optJSONObject("input")?.optionalText("text")
    return RemoteTurn(
        id = text("turnId"),
        status = text("status"),
        input = input,
        startedAt = text("startedAt"),
        completedAt = optionalText("completedAt"),
        error = error?.friendlyFailure(),
        canRetry = input != null && error?.allowsExplicitRetry() == true,
    )
}

private fun JSONObject.friendlyFailure(): String = when (optJSONObject("failure")?.optionalText("category")) {
    "authentication" -> "请在电脑上检查 AI 工具的登录状态。"
    "quota" -> "AI 工具的额度暂时不足，请稍后再试。"
    "transport", "machine" -> "连接中断，请检查网络后重新打开会话。"
    else -> "这次工作未完成，请检查电脑上的会话。"
}

private fun JSONObject.allowsExplicitRetry(): Boolean {
    val failure = optJSONObject("failure") ?: return false
    return failure.optionalText("userAction") == "retry" &&
        failure.optionalText("retryability") in listOf("retry_now", "retry_later")
}

internal data class RemoteLivePage(val cursor: String, val reset: Boolean, val events: List<JSONObject>)

internal fun JSONObject.livePage(target: ConversationTarget): RemoteLivePage {
    if (text("conversationId") != target.conversationId) invalidResponse()
    val events = rows("events", 64)
    val reset = flag("resetRequired")
    if ((reset && events.isNotEmpty()) || events.any { it.text("conversationId") != target.conversationId }) invalidResponse()
    return RemoteLivePage(text("cursor"), reset, events)
}

internal fun RemoteConversationDetail.applyLive(page: RemoteLivePage): RemoteConversationDetail {
    var conversation = this.conversation
    val messages = history.messages.associateByTo(linkedMapOf()) { it.id }
    val turns = history.turns.associateByTo(linkedMapOf()) { it.id }
    for (event in page.events) {
        val payload = event.obj("payload")
        val timestamp = event.text("timestamp")
        val turnId = event.optionalText("turnId")
        val itemId = event.optionalText("itemId")
        when (event.text("type")) {
            "turn.started" -> {
                val record = payload.obj("turn")
                if (record.text("conversationId") != conversation.target.conversationId) invalidResponse()
                val turn = record.turn()
                turns[turn.id] = turn
                turn.input?.let { messages["input:${turn.id}"] = RemoteMessage("input:${turn.id}", "user", it, turn.startedAt, "completed", turn.id) }
                conversation = conversation.copy(status = "running")
            }
            "message.delta", "message.completed" -> if (itemId != null) {
                val existing = messages[itemId]
                val completed = event.text("type") == "message.completed"
                val content = if (completed) payload.text("message") else existing?.text.orEmpty() + payload.text("delta")
                messages[itemId] = RemoteMessage(itemId, "assistant", content.take(1_048_576), existing?.timestamp ?: timestamp,
                    if (completed) "completed" else "running", turnId)
            }
            "tool.started", "tool.completed" -> if (itemId != null) {
                val previous = messages[itemId]
                val status = when {
                    event.text("type") == "tool.started" -> "running"
                    payload.opt("success") == false -> "failed"
                    else -> "completed"
                }
                messages[itemId] = RemoteMessage(itemId, "tool", payload.optionalText("summary") ?: payload.text("name"),
                    previous?.timestamp ?: timestamp, status, turnId)
            }
            "approval.requested" -> conversation = conversation.copy(status = "waiting")
            "approval.resolved" -> conversation = conversation.copy(status = "running")
            "conversation.updated", "conversation.started" -> {
                val summary = payload.obj("conversation")
                if (summary.scope() != conversation.target) invalidResponse()
                conversation = conversation.copy(
                    title = summary.optionalText("title") ?: conversation.title,
                    status = summary.text("status"),
                    archived = summary.optionalText("archivedAt") != null,
                    lastActivityAt = summary.optionalText("lastActivityAt") ?: conversation.lastActivityAt,
                )
            }
        }
    }
    return copy(conversation = conversation, history = history.copy(
        messages = messages.values.toList().withoutSupersededFinals().takeLast(2048),
        turns = turns.values.toList().takeLast(64),
        liveCursor = page.cursor,
    ))
}
