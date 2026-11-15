package org.codetether.app.ui

import org.codetether.app.account.AccountProfile
import org.codetether.app.account.PairedComputer
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteMessage
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteWorkspace
import uniffi.supervisor_mobile.ConnectionMode

internal sealed interface TabletPage {
    data object SignIn : TabletPage
    data object Pair : TabletPage
    data object Home : TabletPage
    data object Inbox : TabletPage
    data object Devices : TabletPage
    data class Device(val computerId: String, val machineId: String) : TabletPage
    data class Project(val computerId: String, val project: RemoteProject) : TabletPage
    data class Conversation(val computerId: String, val target: ConversationTarget) : TabletPage
    data class Settings(val section: SettingSection = SettingSection.Overview) : TabletPage
    data class Removed(val computerName: String) : TabletPage
}

internal enum class SettingSection { Overview, Connection, Plans }

internal enum class Appearance(val label: String) {
    System("跟随系统"), Light("浅色"), Dark("深色"),
}

internal enum class MutationStatus { Pending, Success, Failed, Unknown }

internal data class ProjectConversationCounts(val active: Int, val archived: Int)

internal data class ComputerView(
    val computer: PairedComputer,
    val workspace: RemoteWorkspace? = null,
    val connection: RemoteConnection? = null,
    val problem: String? = null,
)

internal data class TabletState(
    val page: TabletPage = TabletPage.SignIn,
    val profile: AccountProfile? = null,
    val otpEmail: String? = null,
    val computers: List<ComputerView> = emptyList(),
    val loaded: List<Pair<String, RemoteConversation>> = emptyList(),
    val detail: RemoteConversationDetail? = null,
    val olderMessages: List<RemoteMessage> = emptyList(),
    val olderCursor: String? = null,
    val changes: List<RemoteChange> = emptyList(),
    val changesLoading: Boolean = false,
    val projectRows: List<RemoteConversation> = emptyList(),
    val projectLoading: Boolean = false,
    val projectCounts: ProjectConversationCounts? = null,
    val projectArchived: Boolean = false,
    val projectStatus: String? = null,
    val appearance: Appearance = Appearance.System,
    val mode: ConnectionMode = ConnectionMode.AUTO,
    val busy: Boolean = false,
    val error: String? = null,
    val pairingClaimed: Boolean = false,
    val pairingInProgress: Boolean = false,
    val mutations: List<PendingMutation> = emptyList(),
    val lastPairedName: String? = null,
    val keyProtection: String? = null,
) {
    fun computer(id: String): ComputerView? = computers.firstOrNull { it.computer.id == id }

    fun machine(computerId: String, machineId: String): RemoteMachine? =
        computer(computerId)?.workspace?.machines?.firstOrNull { it.id == machineId }

    fun sendMutation(page: TabletPage.Conversation): PendingMutation? = mutations.firstOrNull {
        it.scope == MutationScope(page.computerId, page.target.machineId, page.target.projectId, page.target.conversationId)
    }

    fun createMutation(computerId: String, project: RemoteProject): PendingMutation? = mutations.firstOrNull {
        it.scope == MutationScope(computerId, project.machineId, project.id, null)
    }
}

internal interface TabletActions {
    fun navigate(page: TabletPage)
    fun requestCode(email: String)
    fun verifyCode(email: String, code: String)
    fun editEmail()
    fun pair(code: String)
    fun cancelPairing()
    fun removeComputer(computer: PairedComputer)
    fun signOut()
    fun setAppearance(value: Appearance)
    fun setMode(value: ConnectionMode)
    fun refresh()
    fun setProjectFilter(archived: Boolean, status: String?)
    fun older()
    fun loadChanges()
    fun create(computerId: String, project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String)
    fun send(target: TabletPage.Conversation, text: String, actionId: String)
    fun retryMutation(actionId: String)
    fun acknowledgeMutation(actionId: String)
    fun approve(computerId: String, item: RemoteAttention, accept: Boolean)
    fun resolveAttention(computerId: String, item: RemoteAttention)
    fun interrupt(target: TabletPage.Conversation, turnId: String)
    fun archive(target: TabletPage.Conversation)
    fun dismissError()
}
