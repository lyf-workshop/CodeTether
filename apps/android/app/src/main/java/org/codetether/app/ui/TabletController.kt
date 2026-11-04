package org.codetether.app.ui

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import org.codetether.app.account.AccountFailure
import org.codetether.app.account.AccountFailureReason
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.PairingResult
import org.codetether.app.account.TabletAccount
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteFailure
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.mergeHistory
import uniffi.supervisor_mobile.ConnectionMode

internal class TabletController private constructor(
    application: Application,
    private val account: TabletAccount,
    private val dependencies: ControllerDependencies,
) : AndroidViewModel(application), TabletActions {
    constructor(application: Application) : this(application, TabletAccount(application))
    private constructor(application: Application, account: TabletAccount) : this(application, account, ControllerDependencies(account))
    internal constructor(application: Application, dependencies: ControllerDependencies) : this(application, TabletAccount(application), dependencies)
    private val accountApi get() = dependencies.account
    private val preferences = application.getSharedPreferences("tablet-appearance", Context.MODE_PRIVATE)
    private val savedAppearance = Appearance.entries.firstOrNull {
        it.name == preferences.getString("appearance", null)
    } ?: Appearance.System
    private val mutable = MutableStateFlow(TabletState(appearance = savedAppearance, busy = true))
    val state = mutable.asStateFlow()

    private val clients = mutableMapOf<String, ControllerSession>()
    private val directoryMutex = Mutex()
    private val parallelComputers = Semaphore(3)
    private var foreground = false
    private var directoryJob: Job? = null
    private var watchJob: Job? = null
    private var projectJob: Job? = null
    private var changesJob: Job? = null
    private var actionJob: Job? = null
    private data class PendingMutation(val actionId: String, val computerId: String, val target: ConversationTarget?, val project: RemoteProject?)
    private val pendingMutations = linkedMapOf<String, PendingMutation>()

    init {
        viewModelScope.launch {
            try {
                val profile = accountApi.restore()
                mutable.update { it.copy(profile = profile, busy = false) }
                if (profile != null && foreground) readDirectory(first = true)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (!resetIfSessionEnded(failure)) mutable.update { it.copy(busy = false, error = friendly(failure)) }
            }
        }
    }

    fun foreground(active: Boolean) {
        if (foreground == active) return
        foreground = active
        if (!active) {
            directoryJob?.cancel()
            watchJob?.cancel()
            projectJob?.cancel()
            changesJob?.cancel()
            actionJob?.cancel()
            val open = clients.values.toList()
            clients.clear()
            mutable.update { current ->
                current.copy(
                    computers = current.computers.map { it.copy(connection = null) },
                    projectLoading = current.projectLoading || current.page is TabletPage.Project,
                )
            }
            viewModelScope.launch { open.forEach { it.disconnect() } }
            return
        }
        directoryJob = viewModelScope.launch {
            while (isActive) {
                if (state.value.profile != null && !state.value.busy) {
                    try {
                        readDirectory(first = state.value.page == TabletPage.SignIn)
                        val current = state.value.page
                        if (current is TabletPage.Conversation && watchJob?.isActive != true) {
                            observe(current)
                        }
                        if (current is TabletPage.Project && projectJob?.isActive != true && state.value.projectLoading) {
                            loadProject(current)
                        }
                        confirmPendingMutations()
                    } catch (cancel: CancellationException) {
                        throw cancel
                    } catch (failure: Exception) {
                        resetIfSessionEnded(failure)
                    }
                }
                delay(5_000)
            }
        }
    }

    override fun navigate(page: TabletPage) {
        watchJob?.cancel()
        projectJob?.cancel()
        changesJob?.cancel()
        mutable.update {
            it.copy(
                page = page,
                detail = null,
                olderMessages = emptyList(),
                olderCursor = null,
                changes = emptyList(),
                changesLoading = false,
                projectRows = emptyList(),
                projectLoading = page is TabletPage.Project,
                projectArchived = false,
                projectStatus = null,
                error = null,
                lastPairedName = null,
            )
        }
        when (page) {
            is TabletPage.Conversation -> observe(page)
            is TabletPage.Project -> loadProject(page)
            else -> Unit
        }
    }

    override fun requestCode(email: String) = action {
        val address = email.trim()
        accountApi.requestCode(address)
        mutable.update { it.copy(otpEmail = address) }
    }

    override fun editEmail() {
        mutable.update { it.copy(otpEmail = null, error = null) }
    }

    override fun verifyCode(email: String, code: String) = action {
        val profile = accountApi.verifyCode(email, code)
        mutable.update { it.copy(profile = profile, otpEmail = null, page = TabletPage.Pair) }
        readDirectory(first = true)
    }

    override fun pair(code: String) = action {
        mutable.update { it.copy(pairingInProgress = true, pairingClaimed = false, lastPairedName = null) }
        when (val result = accountApi.pair(code) { mutable.update { it.copy(pairingClaimed = true) } }) {
            is PairingResult.Paired -> {
                mutable.update { it.copy(lastPairedName = result.computer.name) }
                readDirectory()
            }
            is PairingResult.Rejected -> {
                mutable.update { it.copy(error = result.reason.message(result.remainingAttempts)) }
            }
        }
        mutable.update { it.copy(pairingClaimed = false) }
    }

    override fun cancelPairing() {
        if (state.value.pairingInProgress) actionJob?.cancel()
    }

    override fun removeComputer(computer: PairedComputer) = action {
        accountApi.removeComputer(computer)
        clients.remove(computer.id)?.disconnect()
        mutable.update { current ->
            current.copy(
                computers = current.computers.filterNot { it.computer.id == computer.id },
                loaded = current.loaded.filterNot { it.first == computer.id },
            )
        }
        readDirectory()
    }

    override fun signOut() = action {
        accountApi.signOut {
            withContext(NonCancellable) {
                directoryJob?.cancel()
                directoryMutex.withLock { clearAccountView() }
            }
        }
    }

    private suspend fun clearAccountView(error: String? = null) {
        watchJob?.cancel()
        projectJob?.cancel()
        changesJob?.cancel()
        val open = clients.values.toList()
        clients.clear()
        pendingMutations.clear()
        mutable.update { TabletState(appearance = it.appearance, mode = it.mode, busy = it.busy, error = error) }
        open.forEach { it.disconnect() }
    }

    private suspend fun resetIfSessionEnded(failure: Exception): Boolean {
        val ended = (failure is AccountFailure && failure.reason == AccountFailureReason.SIGN_IN_REQUIRED) ||
            (failure is RemoteFailure && failure.code == "sign_in_required")
        if (!ended) return false
        return directoryMutex.withLock {
            if (accountApi.restore() != null) return@withLock false
            clearAccountView(friendly(failure))
            true
        }
    }

    override fun setAppearance(value: Appearance) {
        preferences.edit().putString("appearance", value.name).apply()
        mutable.update { it.copy(appearance = value) }
    }

    override fun setMode(value: ConnectionMode) = action {
        if (state.value.mode != value) {
            watchJob?.cancel()
            directoryMutex.withLock {
                clients.values.toList().forEach { it.disconnect() }
                clients.clear()
                mutable.update { current ->
                    current.copy(mode = value, computers = current.computers.map { it.copy(connection = null) })
                }
            }
        }
        readDirectory()
    }

    override fun refresh() = action { readDirectory() }

    override fun setProjectFilter(archived: Boolean, status: String?) {
        val page = state.value.page as? TabletPage.Project ?: return
        mutable.update { it.copy(projectArchived = archived, projectStatus = status, projectRows = emptyList(), projectLoading = true) }
        loadProject(page)
    }

    override fun older() = action {
        val current = state.value
        val page = current.page as? TabletPage.Conversation ?: return@action
        val cursor = current.olderCursor ?: return@action
        val history = requireClient(page.computerId).olderHistory(page.target, cursor)
        mutable.update {
            if (it.page != page || it.detail == null) it else {
                val merged = mergeHistory(it.detail.history, history, olderPage = true)
                it.copy(detail = it.detail.copy(history = merged), olderMessages = emptyList(), olderCursor = merged.beforeCursor)
            }
        }
    }

    override fun loadChanges() {
        val page = state.value.page as? TabletPage.Conversation ?: return
        if (!foreground || state.value.detail?.canShowChanges != true || state.value.changesLoading) return
        mutable.update { it.copy(changesLoading = true) }
        changesJob = viewModelScope.launch {
            try {
                val result = requireClient(page.computerId).changes(page.target)
                mutable.update { if (it.page == page) it.copy(changes = result) else it }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (!resetIfSessionEnded(failure)) {
                    mutable.update { if (it.page == page) it.copy(error = friendly(failure)) else it }
                }
            } finally {
                mutable.update { if (it.page == page) it.copy(changesLoading = false) else it }
            }
        }
    }

    override fun create(computerId: String, project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String) =
        mutation(PendingMutation(actionId, computerId, null, project)) {
            val target = requireClient(computerId).create(project, provider, text, reasoning, actionId)
            navigate(TabletPage.Conversation(computerId, target))
        }

    override fun send(target: TabletPage.Conversation, text: String, actionId: String) = mutation(
        PendingMutation(actionId, target.computerId, target.target, null),
    ) {
        requireClient(target.computerId).send(target.target, text, actionId)
    }

    override fun approve(computerId: String, item: RemoteAttention, accept: Boolean) = action {
        if (!item.canApprove) return@action
        requireClient(computerId).approve(item, accept)
        removeAttention(computerId, item)
    }

    override fun resolveAttention(computerId: String, item: RemoteAttention) = action {
        requireClient(computerId).resolveAttention(item)
        removeAttention(computerId, item)
    }

    override fun interrupt(target: TabletPage.Conversation, turnId: String) = action {
        if (state.value.page == target && state.value.detail?.canInterrupt == true) {
            requireClient(target.computerId).interrupt(target.target, turnId)
        }
    }

    override fun archive(target: TabletPage.Conversation) = action {
        requireClient(target.computerId).archive(target.target)
        navigate(TabletPage.Home)
        readDirectory()
    }

    override fun dismissError() { mutable.update { it.copy(error = null) } }

    private fun removeAttention(computerId: String, item: RemoteAttention) {
        mutable.update { current ->
            val open = current.page as? TabletPage.Conversation
            val detail = current.detail
            current.copy(
                detail = if (open?.computerId == computerId && detail != null) {
                    detail.copy(attention = detail.attention.filterNot { it.id == item.id })
                } else detail,
                computers = current.computers.map { computer ->
                    val workspace = computer.workspace
                    if (computer.computer.id == computerId && workspace != null) {
                        val remaining = workspace.attention.filterNot { it.id == item.id }
                        computer.copy(workspace = workspace.copy(
                            attention = remaining,
                            attentionCount = (workspace.attentionCount - (workspace.attention.size - remaining.size))
                                .coerceAtLeast(remaining.size),
                        ))
                    } else computer
                },
            )
        }
    }

    private fun outcome(pending: PendingMutation, status: MutationStatus, message: String? = null) {
        mutable.update {
            val result = MutationOutcome(pending.actionId, status, message)
            if (pending.project != null) it.copy(createOutcome = result) else it.copy(sendOutcome = result)
        }
    }

    private fun mutation(pending: PendingMutation, work: suspend () -> Unit) {
        if (!pending.actionId.matches(Regex("act_[A-Za-z0-9][A-Za-z0-9_-]{5,95}"))) {
            outcome(pending, MutationStatus.Failed, "请重新打开输入窗口后再试。")
            return
        }
        if (!foreground || state.value.busy || pendingMutations.values.any { (it.project == null) == (pending.project == null) }) {
            outcome(pending, MutationStatus.Failed, "请先等当前操作完成或确认上次操作的结果。")
            return
        }
        pendingMutations[pending.actionId] = pending
        outcome(pending, MutationStatus.Pending)
        mutable.update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try {
                work()
                pendingMutations.remove(pending.actionId)
                outcome(pending, MutationStatus.Success)
            } catch (cancel: CancellationException) {
                outcome(pending, MutationStatus.Unknown, "暂时无法确认这次操作的结果，回来后会重新读取。请勿重复提交。")
                throw cancel
            } catch (failure: Exception) {
                if (failure is RemoteFailure && failure.uncertainActionId != null) {
                    outcome(pending, MutationStatus.Unknown, friendly(failure))
                } else {
                    pendingMutations.remove(pending.actionId)
                    outcome(pending, MutationStatus.Failed, friendly(failure))
                }
                if (!resetIfSessionEnded(failure)) mutable.update { it.copy(error = friendly(failure)) }
            } finally {
                mutable.update { it.copy(busy = false) }
            }
        }
    }

    /** Resolve uncertainty with reads only. A mutation is never replayed after cancellation. */
    private suspend fun confirmPendingMutations() {
        for (pending in pendingMutations.values.toList()) {
            if (!foreground) return
            val client = clients[pending.computerId] ?: continue
            try {
                val result = client.action(pending.actionId)
                when (result.status) {
                    "accepted", "running", "completed", "failed" -> {
                        if (result.turnId == null) continue
                        if (pending.target != null && result.conversationId != pending.target.conversationId) continue
                        if (pending.project != null) {
                            val conversationId = result.conversationId ?: continue
                            // Scope comes from the original local selection, never from an arbitrary response path.
                            val target = ConversationTarget(pending.project.machineId, pending.project.id, conversationId)
                            if (state.value.page !is TabletPage.Conversation) navigate(TabletPage.Conversation(pending.computerId, target))
                        }
                        pendingMutations.remove(pending.actionId)
                        outcome(pending, MutationStatus.Success)
                    }
                    "rejected" -> {
                        pendingMutations.remove(pending.actionId)
                        outcome(pending, MutationStatus.Failed, "这次操作未被接受，输入已保留。")
                    }
                    else -> Unit // Unknown remains pending; refreshing the conversation is safe, replaying is not.
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (resetIfSessionEnded(failure)) return
            }
        }
    }

    private fun action(work: suspend () -> Unit) {
        if (!foreground || state.value.busy) return
        mutable.update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try {
                work()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (!resetIfSessionEnded(failure)) {
                    mutable.update { it.copy(error = friendly(failure), pairingClaimed = false) }
                }
            } finally {
                mutable.update { it.copy(busy = false, pairingClaimed = false, pairingInProgress = false) }
            }
        }
    }

    private suspend fun readDirectory(first: Boolean = false) = directoryMutex.withLock {
        val listed = accountApi.computers()
        val before = state.value
        val listedIds = listed.map { it.id }.toSet()
        val removed = before.computers.filter { it.computer.id !in listedIds }
        for (entry in removed) clients.remove(entry.computer.id)?.disconnect()
        val pageComputer = when (val page = before.page) {
            is TabletPage.Conversation -> page.computerId
            is TabletPage.Device -> page.computerId
            is TabletPage.Project -> page.computerId
            else -> null
        }
        val removedView = removed.firstOrNull { it.computer.id == pageComputer }
            ?: removed.firstOrNull()?.takeIf { before.page != TabletPage.Pair }
        if (removedView != null) navigate(TabletPage.Removed(removedView.computer.name))
        if (!foreground) return@withLock
        val mode = state.value.mode
        val availableClients = listed.associate { computer ->
            computer.id to clients.getOrPut(computer.id) { dependencies.session() }
        }
        val results = coroutineScope {
            listed.map { computer ->
                async {
                    parallelComputers.withPermit {
                        val client = availableClients.getValue(computer.id)
                        val previous = before.computer(computer.id)
                        try {
                            previous?.connection?.takeIf {
                                java.time.Instant.parse(it.expiresAt).isAfter(java.time.Instant.now().plusSeconds(15))
                            } ?: client.connect(computer, mode)
                            val (workspace, connection) = client.workspace()
                            ComputerView(computer, workspace, connection)
                        } catch (cancel: CancellationException) {
                            throw cancel
                        } catch (failure: Exception) {
                            client.disconnect()
                            if ((failure is AccountFailure && failure.reason == AccountFailureReason.SIGN_IN_REQUIRED) ||
                                (failure is RemoteFailure && failure.code == "sign_in_required")) {
                                throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
                            }
                            if (failure is RemoteFailure && failure.removed) return@withPermit null
                            ComputerView(computer, previous?.workspace, problem = friendly(failure))
                        }
                    }
                }
            }.awaitAll().filterNotNull()
        }
        val availableIds = results.map { it.computer.id }.toSet()
        val revoked = listed.filter { it.id !in availableIds }
        revoked.forEach { clients.remove(it.id) }
        if (state.value.page !is TabletPage.Removed) {
            (revoked.firstOrNull { it.id == pageComputer } ?: revoked.firstOrNull())?.let {
                navigate(TabletPage.Removed(it.name))
            }
        }
        val protection = try { accountApi.keyProtection().name } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: AccountFailure) {
            if (failure.reason == AccountFailureReason.SIGN_IN_REQUIRED) throw failure
            null
        } catch (_: Exception) { null }
        mutable.update { current ->
            val nextPage = if (first && current.page !is TabletPage.Removed) {
                if (results.isEmpty()) TabletPage.Pair else TabletPage.Home
            } else current.page
            val recent = results.flatMap { row ->
                row.workspace?.recent.orEmpty().map { row.computer.id to it }
            }
            val retained = current.loaded.filter { it.first in availableIds }
            current.copy(
                page = nextPage,
                computers = results,
                loaded = retainConversations(recent, retained),
                keyProtection = protection,
            )
        }
    }

    private fun observe(page: TabletPage.Conversation) {
        watchJob?.cancel()
        val client = clients[page.computerId] ?: return
        if (!foreground) return
        watchJob = viewModelScope.launch {
            try {
                val seed = state.value.detail?.takeIf { it.conversation.target == page.target }?.history
                client.watchConversation(page.target, seed).collect { detail ->
                    mutable.update {
                        if (it.page != page) it else {
                            val merged = mergeHistory(it.detail?.history, detail.history)
                            it.copy(
                                detail = detail.copy(history = merged), olderMessages = emptyList(), olderCursor = merged.beforeCursor,
                                loaded = retainConversations(listOf(page.computerId to detail.conversation), it.loaded),
                            )
                        }
                    }
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (!resetIfSessionEnded(failure)) {
                    mutable.update { if (it.page == page) it.copy(error = friendly(failure)) else it }
                    if (foreground) {
                        try { readDirectory() } catch (cancel: CancellationException) {
                            throw cancel
                        } catch (directoryFailure: Exception) { resetIfSessionEnded(directoryFailure) }
                    }
                }
            }
        }
    }

    private fun loadProject(page: TabletPage.Project) {
        projectJob?.cancel()
        if (!foreground) return
        mutable.update { if (it.page == page) it.copy(projectLoading = true) else it }
        projectJob = viewModelScope.launch {
            try {
                val current = state.value
                val rows = requireClient(page.computerId).projectConversations(
                    page.project, current.projectArchived, current.projectStatus,
                )
                mutable.update {
                    if (it.page != page) it else it.copy(
                        projectRows = rows,
                        projectLoading = false,
                        loaded = retainConversations(rows.map { row -> page.computerId to row }, it.loaded),
                    )
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (!resetIfSessionEnded(failure)) {
                    mutable.update { if (it.page == page) it.copy(error = friendly(failure), projectLoading = false) else it }
                }
            }
        }
    }

    private fun requireClient(computerId: String): ControllerSession =
        clients[computerId] ?: error("Computer session unavailable")

    private fun retainConversations(
        incoming: List<Pair<String, RemoteConversation>>,
        cached: List<Pair<String, RemoteConversation>>,
    ) = (incoming + cached).distinctBy { (computer, row) -> computer to row.target }.take(400)

    private fun friendly(failure: Exception): String = when (failure) {
        is AccountFailure -> failure.message ?: "现在无法完成，请稍后再试"
        is RemoteFailure -> when {
            failure.httpStatus == 409 -> "会话正在运行或等待批准，请等工作结束后再试（409）"
            failure.httpStatus == 422 -> "这个 AI 工具不支持该操作"
            else -> failure.message ?: "这台电脑现在连不上，请确认它开着并且联网"
        }
        else -> "这台电脑现在连不上，请确认它开着并且联网"
    }
}
