package org.codetether.app.remote

import java.time.Instant
import java.util.UUID
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.codetether.app.account.AccountFailure
import org.codetether.app.account.AccountFailureReason
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.TabletAccount
import org.json.JSONException
import org.json.JSONObject
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.MobileException
import uniffi.supervisor_mobile.SupervisorSession

/** A foreground connection to a single selected computer. Reading may reconnect once. */
class RemoteSupervisor(private val account: TabletAccount) {
    private data class Selection(val computer: PairedComputer, val mode: ConnectionMode)

    private class Attached(val native: SupervisorSession, val info: RemoteConnection) {
        @Volatile var usable = true
            private set

        @Synchronized
        fun cancelWire() {
            if (!usable) return
            usable = false
            native.disconnect()
        }

        @Synchronized
        fun close() {
            cancelWire()
            native.close()
        }
    }

    private val lock = Mutex()
    private var selected: Selection? = null
    private var attached: Attached? = null

    suspend fun computers(): List<PairedComputer> = account.computers()

    suspend fun connect(computer: PairedComputer, mode: ConnectionMode = ConnectionMode.AUTO): RemoteConnection = lock.withLock {
        releaseConnection()
        selected = Selection(computer, mode)
        ensureAttached().info
    }

    suspend fun disconnect() = lock.withLock {
        selected = null
        releaseConnection()
    }

    suspend fun workspace(): Pair<RemoteWorkspace, RemoteConnection> = read { session ->
        val summary = request(session, "machine.list").rows("machines", 128)
        val machines = summary.map { row ->
            val id = row.text("machineId")
            val detail = request(session, "machine.get", "machineId" to id)
            detail.obj("machine").machine(detail).also { if (it.id != id) invalidResponse() }
        }
        if (machines.map { it.id }.toSet().size != machines.size) invalidResponse()
        val summaries = summary.associateBy { it.text("machineId") }
        val projects = machines.flatMap { machine ->
            val row = summaries.getValue(machine.id)
            val available = machine.available && row.obj("capabilities").flag("projectAccess")
            pages(session, "project.list", "projects", "machineId" to machine.id) {
                it.project(machine.id, available)
            }
        }
        val recentRows = machines.flatMap { machine ->
            request(session, "conversation.recent", "machineId" to machine.id, "limit" to 30)
                .rows("conversations", 30).map { row ->
                    row.conversation().also { if (it.target.machineId != machine.id) invalidResponse() }
                }
        }
        val recent = recentRows.filterNot { it.archived }.groupBy { it.target.machineId }
            .values.flatMap { it.take(5) }
        val attention = attentionPage(session)
        val machineById = machines.associateBy { it.id }
        val conversationsById = recentRows.associateBy { it.target.conversationId }
        val items = attention.rows("items", 50).map { row ->
            val projectId = row.text("projectId")
            val conversationId = row.text("conversationId")
            val conversation = conversationsById[conversationId]?.takeIf { it.target.projectId == projectId }
                ?: findAttentionConversation(session, projects, projectId, conversationId)
            val provider = conversation?.let { c ->
                machineById[c.target.machineId]?.providers?.firstOrNull { it.id == c.provider }
            }
            row.attention(conversation, provider, session.info.canControl)
        }
        RemoteWorkspace(machines, projects, recent, items, session.info.canControl,
            attention.optJSONObject("summary")?.count("totalOpen") ?: items.size) to session.info
    }

    suspend fun projectConversations(
        project: RemoteProject,
        archived: Boolean = false,
        status: String? = null,
    ): List<RemoteConversation> = read { session ->
        pages(session, "conversation.list", "conversations", "machineId" to project.machineId, "projectId" to project.id) {
            it.conversation().also { conversation ->
                if (conversation.target.machineId != project.machineId || conversation.target.projectId != project.id) invalidResponse()
            }
        }.filter { it.archived == archived && (status == null || it.status == status) }
    }

    suspend fun project(project: RemoteProject): RemoteProject = read { session ->
        val row = request(session, "project.get", "machineId" to project.machineId, "projectId" to project.id).obj("project")
        row.project(project.machineId, project.available).also { if (it.id != project.id) invalidResponse() }
    }

    suspend fun conversation(target: ConversationTarget): RemoteConversationDetail = read { session ->
        readDetail(session, target)
    }

    suspend fun olderHistory(target: ConversationTarget, cursor: String): RemoteHistory = read { session ->
        readHistory(session, target, cursor)
    }

    fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory? = null): Flow<RemoteConversationDetail> = flow {
        var current = read { session -> readDetail(session, target, loadedHistory) }
        emit(current)
        while (true) {
            delay(750)
            val (updated, hasEvents) = read { session ->
                val page = readSizedPage(16) { limit ->
                    request(session, "conversation.live.read", *target.fields(),
                        "cursor" to current.history.liveCursor, "limit" to limit, "waitMs" to 0)
                }.livePage(target)
                val reconcile = page.reset || page.events.any { event ->
                    event.text("type") in setOf("turn.completed", "turn.failed", "turn.interrupted")
                }
                val next = if (reconcile) {
                    readDetail(session, target, current.history)
                } else {
                    val live = current.applyLive(page)
                    val detail = live.copy(
                        history = mergeHistory(current.history, live.history),
                        canControl = session.info.canControl,
                    )
                    val attentionChanged = page.events.any {
                        val type = it.text("type")
                        type.startsWith("attention.") || type.startsWith("approval.")
                    }
                    if (attentionChanged) {
                        detail.copy(attention = conversationAttention(session, detail.conversation, detail.provider))
                    } else detail
                }
                next to (page.reset || page.events.isNotEmpty())
            }
            val changed = updated.copy(history = updated.history.copy(liveCursor = current.history.liveCursor)) != current
            current = updated
            if (changed || hasEvents) emit(current)
        }
    }

    suspend fun changes(target: ConversationTarget): List<RemoteChange> = read { session ->
        val conversation = readConversation(session, target)
        if (readProvider(session, conversation)?.diff != true) throw RemoteFailure("unsupported")
        val items = mutableListOf<RemoteChange>()
        var offset = 0
        while (true) {
            val page = request(session, "conversation.changes", *target.fields(), "offset" to offset)
            if (page.text("conversationId") != target.conversationId) invalidResponse()
            items += page.rows("changes").map { it.change() }
            val next = page.count("nextOffset") ?: break
            if (next <= offset || next > 2048) invalidResponse()
            offset = next
        }
        items
    }

    suspend fun create(
        project: RemoteProject,
        provider: String,
        text: String,
        reasoning: String? = null,
        actionId: String = newActionId(),
    ): ConversationTarget = lock.withLock {
        val session = requireControl()
        val detail = request(session, "machine.get", "machineId" to project.machineId)
        val machine = detail.obj("machine").machine(detail)
        val tool = machine.providers.firstOrNull { it.id == provider } ?: throw RemoteFailure("unsupported")
        if (machine.id != project.machineId) invalidResponse()
        if (!project.available || !tool.canStart) throw RemoteFailure("unsupported")
        if (reasoning != null && tool.reasoning.none { it.id == reasoning }) throw RemoteFailure("invalid_request")
        val response = mutate(session, "conversation.create", "machineId" to project.machineId,
            "projectId" to project.id, "provider" to provider, "reasoning" to reasoning, "input" to textInput(text),
            "actionId" to actionId)
        response.obj("data").obj("conversation").scope().also {
            if (it.machineId != project.machineId || it.projectId != project.id) invalidResponse()
        }
    }

    suspend fun send(target: ConversationTarget, text: String, actionId: String = newActionId()): Unit = lock.withLock {
        val session = requireControl()
        mutate(session, "conversation.turn.start", *target.fields(), "input" to textInput(text), "actionId" to actionId)
    }

    suspend fun approve(item: RemoteAttention, accept: Boolean): Unit = lock.withLock {
        val session = requireControl()
        val target = item.target ?: throw RemoteFailure("unsupported")
        val approvalId = item.approvalId ?: throw RemoteFailure("unsupported")
        if (!item.canApprove || readProvider(session, readConversation(session, target))?.approvals != true) {
            throw RemoteFailure("unsupported")
        }
        mutate(session, "approval.resolve", "approvalId" to approvalId, "decision" to if (accept) "accept" else "decline")
    }

    suspend fun resolveAttention(item: RemoteAttention): Unit = lock.withLock {
        val session = requireControl()
        if (item.type !in setOf("completed_review", "failed")) throw RemoteFailure("unsupported")
        mutate(session, "attention.resolve", "attentionId" to item.id)
    }

    suspend fun interrupt(target: ConversationTarget, turnId: String): Unit = lock.withLock {
        val session = requireControl()
        if (readProvider(session, readConversation(session, target))?.interrupt != true) throw RemoteFailure("unsupported")
        mutate(session, "turn.interrupt", *target.fields(), "turnId" to turnId)
    }

    suspend fun archive(target: ConversationTarget): Unit = lock.withLock {
        try {
            mutate(requireControl(), "conversation.archive", *target.fields())
        } catch (failure: RemoteFailure) {
            if (failure.code == "conflict" || failure.httpStatus == 409) throw RemoteFailure("archive_busy", 409)
            throw failure
        }
    }

    suspend fun action(actionId: String): RemoteAction = read { session ->
        val row = request(session, "action.get", "actionId" to actionId)
        if (row.text("actionId") != actionId) invalidResponse()
        RemoteAction(actionId, row.text("status"), row.optionalText("conversationId"), row.optionalText("turnId"))
    }

    private suspend fun readDetail(
        session: Attached,
        target: ConversationTarget,
        loadedHistory: RemoteHistory? = null,
    ): RemoteConversationDetail {
        val history = reconcileHistory(loadedHistory, readHistory(session, target, null)) { cursor ->
            readHistory(session, target, cursor)
        }
        val conversation = readConversation(session, target)
        val provider = readProvider(session, conversation)
        return RemoteConversationDetail(conversation, history, provider, conversationAttention(session, conversation, provider), session.info.canControl)
    }

    private suspend fun conversationAttention(session: Attached, conversation: RemoteConversation, provider: RemoteProvider?): List<RemoteAttention> =
        attentionPage(session, conversation.target.projectId).rows("items", 50)
            .filter { it.text("conversationId") == conversation.target.conversationId && it.text("projectId") == conversation.target.projectId }
            .map { it.attention(conversation, provider, session.info.canControl) }

    private suspend fun attentionPage(session: Attached, projectId: String? = null): JSONObject =
        request(session, "attention.list", "status" to "open", "limit" to 50, "projectId" to projectId)

    private suspend fun findAttentionConversation(
        session: Attached,
        projects: List<RemoteProject>,
        projectId: String,
        conversationId: String,
    ): RemoteConversation? {
        for (candidate in projects.filter { it.id == projectId }) {
            try {
                return readConversation(session, ConversationTarget(candidate.machineId, projectId, conversationId))
            } catch (error: RemoteFailure) {
                if (error.code != "not_found") throw error
            }
        }
        return null
    }

    private suspend fun readConversation(session: Attached, target: ConversationTarget): RemoteConversation =
        request(session, "conversation.get", *target.fields()).obj("conversation").conversation().also {
            if (it.target != target) invalidResponse()
        }

    private suspend fun readProvider(session: Attached, conversation: RemoteConversation): RemoteProvider? {
        val id = conversation.target.machineId
        val detail = request(session, "machine.get", "machineId" to id)
        val machine = detail.obj("machine").machine(detail)
        if (machine.id != id) invalidResponse()
        return machine.providers.firstOrNull { it.id == conversation.provider }
    }

    private suspend fun readHistory(session: Attached, target: ConversationTarget, cursor: String?): RemoteHistory =
        readSizedPage(8) { limit ->
            request(session, "conversation.history", *target.fields(), "limit" to limit, "cursor" to cursor)
        }.history(target)

    private suspend fun readSizedPage(initialLimit: Int, load: suspend (Int) -> JSONObject): JSONObject {
        // The B1 server reports an oversized frame as an internal error.
        var limit = initialLimit
        while (true) {
            try {
                return load(limit)
            } catch (failure: RemoteFailure) {
                if (failure.code != "internal" || limit == 1) throw failure
                limit /= 2
            }
        }
    }

    private suspend fun <T> pages(
        session: Attached,
        operation: String,
        listKey: String,
        vararg fields: Pair<String, Any?>,
        project: (JSONObject) -> T,
    ): List<T> {
        val result = mutableListOf<T>()
        val seen = mutableSetOf<String>()
        var cursor: String? = null
        repeat(128) {
            val page = request(session, operation, *fields, "limit" to 50, "cursor" to cursor)
            result += page.rows(listKey, 50).map(project)
            val next = page.optionalText("nextCursor")
            if (page.flag("hasMore") != (next != null)) invalidResponse()
            if (next == null) return result
            if (!seen.add(next)) invalidResponse()
            cursor = next
        }
        throw RemoteFailure("directory_too_large")
    }

    private suspend fun <T> read(block: suspend (Attached) -> T): T = lock.withLock {
        val session = ensureAttached()
        try {
            block(session)
        } catch (failure: RemoteFailure) {
            if (failure.code !in reconnectErrors) throw failure
            releaseConnection()
            val target = selected ?: throw failure
            val current = confirmDirectory(target)
            selected = current
            val next = open(current)
            attached = next
            block(next)
        }
    }

    private suspend fun requireControl(): Attached = ensureAttached().also {
        if (!it.info.canControl) throw RemoteFailure("operation_not_allowed")
    }

    private suspend fun ensureAttached(): Attached {
        val current = attached
        if (current != null && current.usable && Instant.parse(current.info.expiresAt).isAfter(Instant.now().plusSeconds(3))) return current
        val target = selected ?: throw RemoteFailure("connection_closed")
        if (current != null) releaseConnection()
        val starting = if (current != null) confirmDirectory(target) else target
        selected = starting
        val session = try {
            open(starting)
        } catch (failure: RemoteFailure) {
            if (failure.code !in directoryCheckErrors) throw failure
            val latest = confirmDirectory(starting)
            selected = latest
            if (failure.code != "authorization_revoked") throw failure
            open(latest)
        }
        attached = session
        return session
    }

    private suspend fun confirmDirectory(target: Selection): Selection {
        val directory = try {
            account.computers()
        } catch (failure: AccountFailure) {
            throw failure.asRemoteFailure()
        }
        val current = directory.firstOrNull { it.id == target.computer.id }
            ?: throw RemoteFailure("computer_removed", removed = true)
        return target.copy(computer = current)
    }

    private suspend fun open(target: Selection): Attached {
        var opened: SupervisorSession? = null
        return try {
            val credentials = account.connection(target.computer, target.mode)
            withContext(Dispatchers.IO) {
                val session = credentials.connect()
                opened = session
                val expiration = session.expiresAt()
                Instant.parse(expiration)
                Attached(session, RemoteConnection(session.transport(), session.control() == "control", expiration))
            }
        } catch (failure: Exception) {
            opened?.let { it.disconnect(); it.close() }
            throw when (failure) {
                is CancellationException -> failure
                is AccountFailure -> failure.asRemoteFailure()
                is MobileException.Failure -> failure.asRemoteFailure()
                else -> RemoteFailure("connection_failed")
            }
        } catch (_: LinkageError) {
            throw RemoteFailure("runtime_unavailable")
        }
    }

    private fun releaseConnection() {
        val current = attached
        attached = null
        current?.close()
    }

    private suspend fun request(session: Attached, operation: String, vararg fields: Pair<String, Any?>): JSONObject {
        currentCoroutineContext().ensureActive()
        if (!session.usable) throw RemoteFailure("connection_closed")
        val input = json("operation" to operation, *fields).toString()
        val output = suspendCancellableCoroutine<String> { continuation ->
            continuation.invokeOnCancellation { session.cancelWire() }
            Dispatchers.IO.dispatch(continuation.context, Runnable {
                if (!continuation.isActive) return@Runnable
                val result = try {
                    session.native.request(input)
                } catch (failure: MobileException.Failure) {
                    continuation.resumeWithException(failure.asRemoteFailure())
                    return@Runnable
                } catch (_: Exception) {
                    continuation.resumeWithException(RemoteFailure("connection_failed"))
                    return@Runnable
                } catch (_: LinkageError) {
                    continuation.resumeWithException(RemoteFailure("runtime_unavailable"))
                    return@Runnable
                }
                continuation.resumeWith(Result.success(result))
            })
        }
        return try {
            JSONObject(output).protocol()
        } catch (_: JSONException) {
            invalidResponse()
        }
    }

    private suspend fun mutate(session: Attached, operation: String, vararg fields: Pair<String, Any?>): JSONObject {
        val actionId = fields.firstOrNull { it.first == "actionId" }?.second as? String ?: newActionId()
        val result = try {
            request(session, operation, *fields, "actionId" to actionId)
        } catch (failure: RemoteFailure) {
            if (failure.code in reconnectErrors) releaseConnection()
            if (failure.code in uncertainErrors) throw RemoteFailure(failure.code, failure.httpStatus, uncertainActionId = actionId)
            throw failure
        }
        if (result.optionalText("actionId") != actionId) throw RemoteFailure("invalid_response", uncertainActionId = actionId)
        when (result.optionalText("status")) {
            "accepted", "completed" -> return result
            "rejected" -> throw RemoteFailure("operation_not_allowed")
            else -> throw RemoteFailure("invalid_response", uncertainActionId = actionId)
        }
    }

    private companion object {
        val reconnectErrors = setOf("connection_closed", "connection_failed", "session_expired", "authorization_revoked", "remote_host_unreachable", "timeout")
        val directoryCheckErrors = reconnectErrors + setOf("request_failed", "computer_unavailable", "authorization_unavailable", "control_plane_unavailable")
        val uncertainErrors = reconnectErrors + setOf("invalid_response", "internal")
    }
}

private fun ConversationTarget.fields(): Array<Pair<String, Any?>> =
    arrayOf("machineId" to machineId, "projectId" to projectId, "conversationId" to conversationId)

private fun newActionId(): String = "act_${UUID.randomUUID().toString().replace("-", "")}"

private fun textInput(text: String): JSONObject {
    if (text.isBlank() || text.length > 1_048_576) throw RemoteFailure("invalid_request")
    return json("type" to "text", "text" to text)
}

private fun MobileException.Failure.asRemoteFailure(): RemoteFailure = RemoteFailure(code, httpStatus?.toInt())

private fun AccountFailure.asRemoteFailure(): RemoteFailure = RemoteFailure(when (reason) {
    AccountFailureReason.SIGN_IN_REQUIRED -> "sign_in_required"
    AccountFailureReason.CONFIGURATION_MISSING -> "configuration_missing"
    AccountFailureReason.COMPUTER_UNAVAILABLE -> "computer_unavailable"
    AccountFailureReason.AUTHORIZATION_UNAVAILABLE -> "authorization_unavailable"
    AccountFailureReason.INVALID_RESPONSE -> "invalid_response"
    else -> "request_failed"
})
