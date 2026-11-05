package org.codetether.app.ui

import android.os.Bundle
import androidx.lifecycle.SavedStateHandle
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteProject

internal data class MutationScope(
    val computerId: String,
    val machineId: String,
    val projectId: String,
    val conversationId: String?,
)

/** Only the original operation is retained here; credentials never enter saved UI state. */
internal sealed interface MutationRequest {
    val actionId: String
    val computerId: String
    val text: String
    val scope: MutationScope

    data class Send(
        override val actionId: String,
        override val computerId: String,
        val target: ConversationTarget,
        override val text: String,
    ) : MutationRequest {
        override val scope get() = MutationScope(computerId, target.machineId, target.projectId, target.conversationId)
        override fun toString() = "Send(actionId=$actionId, scope=$scope, text=redacted)"
    }

    data class Create(
        override val actionId: String,
        override val computerId: String,
        val project: RemoteProject,
        val provider: String,
        override val text: String,
        val reasoning: String? = null,
    ) : MutationRequest {
        override val scope get() = MutationScope(computerId, project.machineId, project.id, null)
        override fun toString() = "Create(actionId=$actionId, scope=$scope, text=redacted)"
    }
}

internal data class PendingMutation(
    val request: MutationRequest,
    val status: MutationStatus,
    val message: String? = null,
    val result: ConversationTarget? = null,
) {
    val actionId get() = request.actionId
    val scope get() = request.scope
    val unresolved get() = status == MutationStatus.Pending || status == MutationStatus.Unknown
}

/** One authority for request identity, payload, scope and receipts across process restoration. */
internal class PendingMutationStore(private val savedState: SavedStateHandle) {
    private val entries = linkedMapOf<MutationScope, PendingMutation>()
    private var owner: String? = runCatching { savedState.get<String>(OWNER) }.getOrNull()

    init {
        val restored = runCatching { savedState.get<ArrayList<Bundle>>(KEY).orEmpty() }.getOrDefault(emptyList())
        restored.mapNotNull(::decode).forEach { entry ->
            val recovered = if (entry.status == MutationStatus.Pending) entry.copy(
                status = MutationStatus.Unknown, message = UNKNOWN_MESSAGE,
            ) else entry
            entries[recovered.scope] = recovered
        }
        persist()
    }

    fun bindOwner(profileId: String?) {
        if (profileId == null || (entries.isNotEmpty() && owner != profileId)) entries.clear()
        owner = profileId
        persist()
    }

    fun all(): List<PendingMutation> = entries.values.toList()
    fun forScope(scope: MutationScope): PendingMutation? = entries[scope]
    fun find(actionId: String): PendingMutation? = entries.values.firstOrNull { it.actionId == actionId }

    fun put(entry: PendingMutation) {
        entries[entry.scope] = entry
        persist()
    }

    fun remove(actionId: String) {
        entries.entries.removeAll { it.value.actionId == actionId }
        persist()
    }

    fun clear() {
        entries.clear()
        owner = null
        persist()
    }

    private fun persist() {
        savedState[OWNER] = owner
        savedState[KEY] = ArrayList(entries.values.map(::encode))
    }

    private fun encode(entry: PendingMutation): Bundle = Bundle().apply {
        val request = entry.request
        putString("action", request.actionId)
        putString("computer", request.computerId)
        putString("machine", request.scope.machineId)
        putString("project", request.scope.projectId)
        putString("text", request.text)
        putString("status", entry.status.name)
        putString("message", entry.message)
        when (request) {
            is MutationRequest.Send -> putString("conversation", request.target.conversationId)
            is MutationRequest.Create -> {
                putString("projectName", request.project.name)
                putBoolean("available", request.project.available)
                putInt("conversationCount", request.project.conversationCount)
                putString("provider", request.provider)
                putString("reasoning", request.reasoning)
            }
        }
        entry.result?.let {
            putString("resultMachine", it.machineId)
            putString("resultProject", it.projectId)
            putString("resultConversation", it.conversationId)
        }
    }

    private fun decode(bundle: Bundle): PendingMutation? = runCatching {
        fun id(key: String): String = requireNotNull(bundle.getString(key)).also {
            require(it.length in 1..160 && it.matches(Regex("[A-Za-z0-9_-]+")))
        }
        val actionId = id("action").also { require(it.matches(Regex("act_[A-Za-z0-9][A-Za-z0-9_-]{5,95}"))) }
        val computerId = id("computer")
        val machineId = id("machine")
        val projectId = id("project")
        val text = requireNotNull(bundle.getString("text")).also { require(it.isNotBlank() && it.length <= 65_536) }
        val request = if (bundle.containsKey("conversation")) {
            MutationRequest.Send(actionId, computerId, ConversationTarget(machineId, projectId, id("conversation")), text)
        } else {
            MutationRequest.Create(
                actionId, computerId,
                RemoteProject(projectId, machineId, requireNotNull(bundle.getString("projectName")), bundle.getBoolean("available"), bundle.getInt("conversationCount")),
                id("provider"), text, bundle.getString("reasoning"),
            )
        }
        val result = if (bundle.containsKey("resultConversation")) ConversationTarget(
            id("resultMachine"), id("resultProject"), id("resultConversation"),
        ) else null
        if (result != null) {
            require(result.machineId == request.scope.machineId && result.projectId == request.scope.projectId)
            if (request is MutationRequest.Send) require(result == request.target)
        }
        PendingMutation(request, MutationStatus.valueOf(requireNotNull(bundle.getString("status"))), bundle.getString("message"), result)
    }.getOrNull()

    companion object {
        const val UNKNOWN_MESSAGE = "暂时无法确认这次操作的结果，可以重试。"
        private const val KEY = "tablet.pending-mutations.v1"
        private const val OWNER = "tablet.pending-mutations.owner.v1"
    }
}
