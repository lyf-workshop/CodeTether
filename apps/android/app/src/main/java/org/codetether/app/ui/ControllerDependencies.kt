package org.codetether.app.ui

import kotlinx.coroutines.flow.Flow
import org.codetether.app.account.AccountProfile
import org.codetether.app.account.KeyProtection
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.PairingResult
import org.codetether.app.account.TabletAccount
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAction
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteSupervisor
import org.codetether.app.remote.RemoteWorkspace
import uniffi.supervisor_mobile.ConnectionMode

/** Typed side effects allow lifecycle regressions without starting a computer or Provider. */
internal interface ControllerAccount {
    suspend fun restore(): AccountProfile?
    suspend fun requestCode(email: String)
    suspend fun verifyCode(email: String, code: String): AccountProfile
    suspend fun computers(): List<PairedComputer>
    suspend fun pair(code: String, onClaimed: () -> Unit): PairingResult
    suspend fun removeComputer(computer: PairedComputer)
    suspend fun signOut(onLocalCleared: suspend () -> Unit)
    suspend fun keyProtection(): KeyProtection
}

internal interface ControllerSession {
    suspend fun connect(computer: PairedComputer, mode: ConnectionMode): RemoteConnection
    suspend fun disconnect()
    suspend fun workspace(): Pair<RemoteWorkspace, RemoteConnection>
    suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?): List<RemoteConversation>
    suspend fun projectConversationDirectory(project: RemoteProject): List<RemoteConversation> =
        projectConversations(project, archived = false, status = null) +
            projectConversations(project, archived = true, status = null)
    fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?): Flow<RemoteConversationDetail>
    suspend fun olderHistory(target: ConversationTarget, cursor: String): RemoteHistory
    suspend fun changes(target: ConversationTarget): List<RemoteChange>
    suspend fun create(project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String): ConversationTarget
    suspend fun send(target: ConversationTarget, text: String, actionId: String)
    suspend fun action(actionId: String): RemoteAction
    suspend fun approve(item: RemoteAttention, accept: Boolean)
    suspend fun resolveAttention(item: RemoteAttention)
    suspend fun interrupt(target: ConversationTarget, turnId: String)
    suspend fun archive(target: ConversationTarget)
}

internal class ControllerDependencies(val account: ControllerAccount, val session: () -> ControllerSession) {
    constructor(real: TabletAccount) : this(
        object : ControllerAccount {
            override suspend fun restore() = real.restore()
            override suspend fun requestCode(email: String) = real.requestCode(email)
            override suspend fun verifyCode(email: String, code: String) = real.verifyCode(email, code)
            override suspend fun computers() = real.computers()
            override suspend fun pair(code: String, onClaimed: () -> Unit) = real.pair(code, onClaimed)
            override suspend fun removeComputer(computer: PairedComputer) = real.removeComputer(computer)
            override suspend fun signOut(onLocalCleared: suspend () -> Unit) = real.signOut(onLocalCleared)
            override suspend fun keyProtection() = real.keyProtection()
        },
        { LiveControllerSession(RemoteSupervisor(real)) },
    )
}

private class LiveControllerSession(private val real: RemoteSupervisor) : ControllerSession {
    override suspend fun connect(computer: PairedComputer, mode: ConnectionMode) = real.connect(computer, mode)
    override suspend fun disconnect() = real.disconnect()
    override suspend fun workspace() = real.workspace()
    override suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?) =
        real.projectConversations(project, archived, status)
    override suspend fun projectConversationDirectory(project: RemoteProject) = real.projectConversationDirectory(project)
    override fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?) =
        real.watchConversation(target, loadedHistory)
    override suspend fun olderHistory(target: ConversationTarget, cursor: String) = real.olderHistory(target, cursor)
    override suspend fun changes(target: ConversationTarget) = real.changes(target)
    override suspend fun create(project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String) =
        real.create(project, provider, text, reasoning, actionId)
    override suspend fun send(target: ConversationTarget, text: String, actionId: String) = real.send(target, text, actionId)
    override suspend fun action(actionId: String) = real.action(actionId)
    override suspend fun approve(item: RemoteAttention, accept: Boolean) = real.approve(item, accept)
    override suspend fun resolveAttention(item: RemoteAttention) = real.resolveAttention(item)
    override suspend fun interrupt(target: ConversationTarget, turnId: String) = real.interrupt(target, turnId)
    override suspend fun archive(target: ConversationTarget) = real.archive(target)
}
