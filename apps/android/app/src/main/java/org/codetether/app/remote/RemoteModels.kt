package org.codetether.app.remote

data class RemoteConnection(val transport: String, val canControl: Boolean, val expiresAt: String)

data class RemoteWorkspace(
    val machines: List<RemoteMachine>,
    val projects: List<RemoteProject>,
    val recent: List<RemoteConversation>,
    val attention: List<RemoteAttention>,
    val canControl: Boolean,
    val attentionCount: Int = attention.size,
)

data class RemoteMachine(
    val id: String,
    val name: String,
    val platform: String,
    val isLocal: Boolean,
    val status: String,
    val providers: List<RemoteProvider>,
    val available: Boolean = true,
    val connection: String? = null,
    val modelsTruncated: Boolean = false,
)

data class RemoteReasoning(val id: String, val label: String)
data class RemoteModel(val id: String, val name: String, val description: String?)
data class RemoteModelCatalog(
    val providerId: String,
    val availability: String,
    val availableModels: List<RemoteModel>,
    val reasoning: List<RemoteReasoning>,
    val modelSelection: Boolean,
    val reasoningControl: Boolean,
    val truncated: Boolean,
)

data class RemoteProvider(
    val id: String,
    val displayName: String,
    val status: String,
    val reasoning: List<RemoteReasoning>,
    val canStart: Boolean,
    val approvals: Boolean,
    val interrupt: Boolean,
    val diff: Boolean,
    val availableModels: List<RemoteModel> = emptyList(),
)

data class RemoteProject(
    val id: String,
    val machineId: String,
    val name: String,
    val available: Boolean,
    val conversationCount: Int = 0,
)

data class RemoteProjectLocation(
    val projectId: String,
    val machineId: String,
    val rootPath: String,
    val availability: String,
)

data class RemoteProjectProjection(
    val omittedLocationCount: Int,
    val completeSizeEstimate: Int,
)

/** A projected result contains only the requested Machine's location. */
data class RemoteProjectCreateResult(
    val projectId: String,
    val name: String,
    val created: Boolean,
    val locations: List<RemoteProjectLocation>,
    val projection: RemoteProjectProjection?,
)

data class ConversationTarget(val machineId: String, val projectId: String, val conversationId: String)

data class RemoteConversation(
    val target: ConversationTarget,
    val title: String,
    val provider: String,
    val status: String,
    val origin: String,
    val archived: Boolean,
    val lastActivityAt: String,
    val resumable: Boolean = true,
    val currentModel: String? = null,
    val currentReasoning: String? = null,
)

/** The direct ConversationSummary returned by conversation.updateModel. */
data class RemoteConversationSummary(
    val target: ConversationTarget,
    val title: String,
    val titleSource: String,
    val origin: String?,
    val pinnedAt: String?,
    val archivedAt: String?,
    val provider: String,
    val model: String?,
    val reasoning: String?,
    val currentModel: String?,
    val currentReasoning: String?,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val lastActivityAt: String,
)

data class RemoteConversationMetadata(
    val target: ConversationTarget,
    val title: String,
    val provider: String,
    val status: String,
    val pinnedAt: String?,
    val archivedAt: String?,
    val lastActivityAt: String,
)

data class RemoteSearchMatch(
    val conversation: RemoteConversationMetadata,
    val matchedField: String,
    val matchPreview: String?,
    val matchedTurnId: String?,
)

data class RemoteSearchPage(
    val results: List<RemoteSearchMatch>,
    val nextCursor: String?,
)

data class RemoteAttention(
    val id: String,
    val target: ConversationTarget?,
    val type: String,
    val title: String,
    val approvalId: String?,
    val turnId: String?,
    val createdAt: String,
    val detail: String?,
    val canApprove: Boolean,
)

data class RemoteConversationDetail(
    val conversation: RemoteConversation,
    val history: RemoteHistory,
    val provider: RemoteProvider?,
    val attention: List<RemoteAttention>,
    val canControl: Boolean,
) {
    val activeTurnId: String? get() = history.turns.lastOrNull { it.status == "running" }?.id
    val canApprove: Boolean get() = canControl && provider?.approvals == true
    val canInterrupt: Boolean get() = canControl && provider?.interrupt == true &&
        conversation.status in listOf("running", "waiting") && activeTurnId != null
    val canShowChanges: Boolean get() = provider?.diff == true
    val canSend: Boolean get() = canControl && !conversation.archived &&
        (conversation.origin != "adopted_native" || conversation.resumable) &&
        conversation.status !in listOf("running", "waiting") && provider?.canStart == true
}

data class RemoteHistory(
    val messages: List<RemoteMessage>,
    val turns: List<RemoteTurn>,
    val beforeCursor: String?,
    val liveCursor: String,
    val complete: Boolean,
    val native: Boolean,
    val nativeStatus: String? = null,
)

data class RemoteMessage(
    val id: String,
    val role: String,
    val text: String,
    val timestamp: String,
    val status: String,
    val turnId: String? = null,
)

data class RemoteTurn(
    val id: String,
    val status: String,
    val input: String?,
    val startedAt: String,
    val completedAt: String?,
    val error: String?,
    val canRetry: Boolean,
)

data class RemoteChange(
    val path: String,
    val kind: String,
    val diff: String?,
    val additions: Int?,
    val deletions: Int?,
    val turnId: String = "",
    val itemId: String? = null,
    val order: Long = 0L,
) {
    val key: RemoteChangeKey get() = RemoteChangeKey(turnId, itemId, path, order)
}

data class RemoteChangeKey(val turnId: String, val itemId: String?, val path: String, val order: Long)

data class RemoteAction(val id: String, val status: String, val conversationId: String?, val turnId: String?)

class RemoteFailure(
    val code: String,
    val httpStatus: Int? = null,
    val removed: Boolean = false,
    val uncertainActionId: String? = null,
    val reason: String? = null,
) : Exception(remoteFailureMessage(code, httpStatus, removed, uncertainActionId, reason))

private fun remoteFailureMessage(code: String, status: Int?, removed: Boolean, uncertainActionId: String?, reason: String?): String {
    if (removed) return "这台电脑已移除了此设备。要继续使用，请在电脑上生成新的配对码。"
    if (uncertainActionId != null) return "暂时无法确认这次操作的结果。请重新打开会话查看状态。"
    when (reason) {
        "project_has_conversations" -> return "项目中还有会话，先处理这些会话后再移除项目。"
        "project_location_has_conversations" -> return "此位置还有会话，先处理这些会话后再移除位置。"
        "project_location_invalid" -> return "项目文件夹路径无效，请检查路径后重试。"
        "project_location_missing" -> return "找不到项目文件夹，请确认它仍在这台电脑上。"
        "project_location_inaccessible", "project_location_unavailable" -> return "目前无法访问项目文件夹，请检查这台电脑上的文件夹。"
        "project_location_conflict" -> return "此文件夹已属于另一个项目。"
        "project_unavailable" -> return "项目目前不可用，请检查这台电脑上的项目文件夹。"
        "conversation_archived" -> return "会话已归档，请先恢复后再操作。"
        "machine_unreachable" -> return "这台电脑目前离线，请重新连接后重试。"
    }
    if (code == "archive_busy") return "会话正在运行或等待批准，工作结束后才能归档。"
    if (status == 409 || code == "conflict") return "当前操作与会话状态冲突。请等正在运行的工作结束后再试。"
    return when (code) {
        "operation_not_allowed" -> "这台电脑当前不能执行此操作。"
        "unsupported" -> "当前会话不支持此操作。"
        "not_found" -> "找不到此项目或会话。"
        "sign_in_required" -> "登录已过期，请重新登录。"
        "configuration_missing" -> "此版本还没有配置登录服务。"
        "invalid_request" -> "请检查输入后重试。"
        "invalid_response" -> "暂时无法读取，请稍后重试。"
        "directory_too_large" -> "列表太长，暂时无法完整读取。"
        "runtime_unavailable" -> "这台设备暂时无法建立连接。"
        else -> "这台电脑现在连不上，请确认它开着并且联网。"
    }
}
