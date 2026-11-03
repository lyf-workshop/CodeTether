package org.codetether.app.ui

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
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
import org.codetether.app.remote.RemoteSupervisor
import uniffi.supervisor_mobile.ConnectionMode

internal class TabletController(application: Application) : AndroidViewModel(application), TabletActions {
    private val account = TabletAccount(application)
    private val preferences = application.getSharedPreferences("tablet-appearance", Context.MODE_PRIVATE)
    private val savedAppearance = Appearance.entries.firstOrNull {
        it.name == preferences.getString("appearance", null)
    } ?: Appearance.System
    private val mutable = MutableStateFlow(TabletState(appearance = savedAppearance, busy = true))
    val state = mutable.asStateFlow()

    private val clients = mutableMapOf<String, RemoteSupervisor>()
    private val directoryMutex = Mutex()
    private val parallelComputers = Semaphore(3)
    private var foreground = false
    private var directoryJob: Job? = null
    private var watchJob: Job? = null
    private var projectJob: Job? = null
    private var changesJob: Job? = null
    private var actionJob: Job? = null

    init {
        viewModelScope.launch {
            try {
                val profile = account.restore()
                mutable.update { it.copy(profile = profile, busy = false) }
                if (profile != null && foreground) readDirectory(first = true)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                mutable.update { it.copy(busy = false, error = friendly(failure)) }
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
                current.copy(computers = current.computers.map { it.copy(connection = null) })
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
        account.requestCode(address)
        mutable.update { it.copy(otpEmail = address) }
    }

    override fun editEmail() {
        mutable.update { it.copy(otpEmail = null, error = null) }
    }

    override fun verifyCode(email: String, code: String) = action {
        val profile = account.verifyCode(email, code)
        mutable.update { it.copy(profile = profile, otpEmail = null, page = TabletPage.Pair) }
        readDirectory(first = true)
    }

    override fun pair(code: String) = action {
        mutable.update { it.copy(pairingClaimed = false, lastPairedName = null) }
        when (val result = account.pair(code) { mutable.update { it.copy(pairingClaimed = true) } }) {
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

    override fun removeComputer(computer: PairedComputer) = action {
        account.removeComputer(computer)
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
        directoryMutex.withLock {
            clearAccountView()
            account.signOut()
        }
    }

    private suspend fun clearAccountView(error: String? = null) {
        watchJob?.cancel()
        projectJob?.cancel()
        changesJob?.cancel()
        val open = clients.values.toList()
        clients.clear()
        mutable.update { TabletState(appearance = it.appearance, mode = it.mode, busy = it.busy, error = error) }
        open.forEach { it.disconnect() }
    }

    private suspend fun resetIfSessionEnded(failure: Exception): Boolean {
        if (failure !is AccountFailure || failure.reason != AccountFailureReason.SIGN_IN_REQUIRED) return false
        return directoryMutex.withLock {
            if (account.restore() != null) return@withLock false
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
        mutable.update { it.copy(projectArchived = archived, projectStatus = status, projectRows = emptyList()) }
        loadProject(page)
    }

    override fun older() = action {
        val current = state.value
        val page = current.page as? TabletPage.Conversation ?: return@action
        val cursor = current.olderCursor ?: return@action
        val history = requireClient(page.computerId).olderHistory(page.target, cursor)
        mutable.update {
            if (it.page == page) it.copy(
                olderMessages = (history.messages + it.olderMessages).distinctBy { entry -> entry.id },
                olderCursor = history.beforeCursor,
            ) else it
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
                mutable.update { if (it.page == page) it.copy(error = friendly(failure)) else it }
            } finally {
                mutable.update { if (it.page == page) it.copy(changesLoading = false) else it }
            }
        }
    }

    override fun create(computerId: String, project: RemoteProject, provider: String, text: String, reasoning: String?) =
        action {
            val target = requireClient(computerId).create(project, provider, text, reasoning)
            navigate(TabletPage.Conversation(computerId, target))
        }

    override fun send(target: TabletPage.Conversation, text: String) = action {
        requireClient(target.computerId).send(target.target, text)
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
                mutable.update { it.copy(busy = false, pairingClaimed = false) }
            }
        }
    }

    private suspend fun readDirectory(first: Boolean = false) = directoryMutex.withLock {
        val listed = account.computers()
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
            computer.id to clients.getOrPut(computer.id) { RemoteSupervisor(account) }
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
        val protection = runCatching { account.keyProtection().name }.getOrNull()
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
                client.watchConversation(page.target).collect { detail ->
                    mutable.update {
                        if (it.page != page) it else it.copy(
                            detail = detail,
                            olderCursor = if (it.detail == null) detail.history.beforeCursor else it.olderCursor,
                            loaded = retainConversations(listOf(page.computerId to detail.conversation), it.loaded),
                        )
                    }
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                mutable.update { if (it.page == page) it.copy(error = friendly(failure)) else it }
                if (foreground) runCatching { readDirectory() }
            }
        }
    }

    private fun loadProject(page: TabletPage.Project) {
        projectJob?.cancel()
        projectJob = viewModelScope.launch {
            try {
                val current = state.value
                val rows = requireClient(page.computerId).projectConversations(
                    page.project, current.projectArchived, current.projectStatus,
                )
                mutable.update {
                    if (it.page != page) it else it.copy(
                        projectRows = rows,
                        loaded = retainConversations(rows.map { row -> page.computerId to row }, it.loaded),
                    )
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                mutable.update { if (it.page == page) it.copy(error = friendly(failure)) else it }
            }
        }
    }

    private fun requireClient(computerId: String): RemoteSupervisor =
        clients[computerId] ?: error("Computer session unavailable")

    private fun retainConversations(
        incoming: List<Pair<String, RemoteConversation>>,
        cached: List<Pair<String, RemoteConversation>>,
    ) = (incoming + cached).distinctBy { (computer, row) -> computer to row.target }.take(400)

    private fun friendly(failure: Exception): String = when (failure) {
        is AccountFailure -> failure.message ?: "现在无法完成，请稍后再试"
        is RemoteFailure -> when {
            failure.httpStatus == 409 -> "会话正在运行，请等这一轮结束后再试（409）"
            failure.httpStatus == 422 -> "这个 AI 工具不支持该操作"
            else -> failure.message ?: "这台电脑现在连不上，请确认它开着并且联网"
        }
        else -> "这台电脑现在连不上，请确认它开着并且联网"
    }
}
