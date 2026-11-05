package org.codetether.app.ui

import android.app.Application
import android.os.Bundle
import android.os.Parcel
import android.os.SystemClock
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.codetether.app.account.AccountProfile
import org.codetether.app.account.KeyProtection
import org.codetether.app.account.PairedComputer
import org.codetether.app.account.PairingResult
import org.codetether.app.remote.ConversationTarget
import org.codetether.app.remote.RemoteAction
import org.codetether.app.remote.RemoteAttention
import org.codetether.app.remote.RemoteChange
import org.codetether.app.remote.RemoteConnection
import org.codetether.app.remote.RemoteConversation
import org.codetether.app.remote.RemoteConversationDetail
import org.codetether.app.remote.RemoteFailure
import org.codetether.app.remote.RemoteHistory
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectionMode

/** The fake computer admits once before losing a response, then deduplicates an explicit retry. */
@RunWith(AndroidJUnit4::class)
class ScopedMutationRetryTest {
    @Test
    fun unknownSendIsOnlyReadAutomaticallyAndExplicitRetryReusesTheWholeRequest() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(SEND_ID) }
        Harness(backend).use { harness ->
            harness.ready()
            harness.onMain { send(PAGE_A, ORIGINAL_TEXT, SEND_ID) }
            awaitState { harness.sendEntry(PAGE_A)?.status == MutationStatus.Unknown }
            assertEquals(ORIGINAL_TEXT, harness.sendEntry(PAGE_A)?.request?.text)
            harness.resumeForeground()
            awaitState { SEND_ID in backend.actionReads }
            harness.onMain { }
            assertEquals(1, backend.attempts(SEND_ID).size)
            assertEquals(MutationStatus.Unknown, harness.sendEntry(PAGE_A)?.status)

            harness.onMain { retryMutation(SEND_ID) }
            awaitState { harness.sendEntry(PAGE_A)?.status == MutationStatus.Success }
            assertDeduplicatedRetry(backend, SEND_ID)
            assertEquals(ORIGINAL_TEXT.trim(), backend.attempts(SEND_ID).singlePayload().text)
            assertEquals(TARGET_A, harness.sendEntry(PAGE_A)?.result)
        }
    }

    @Test
    fun unknownCreateRetainsProviderProjectReasoningAndTextForItsExplicitRetry() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(CREATE_ID) }
        Harness(backend).use { harness ->
            harness.ready()
            harness.onMain { create(COMPUTER_A.id, PROJECT_A, "claude-code", ORIGINAL_TEXT, "high", CREATE_ID) }
            awaitState { harness.createEntry(COMPUTER_A.id, PROJECT_A)?.status == MutationStatus.Unknown }
            harness.resumeForeground()
            awaitState { CREATE_ID in backend.actionReads }
            assertEquals(1, backend.attempts(CREATE_ID).size)

            harness.onMain { retryMutation(CREATE_ID) }
            awaitState { harness.createEntry(COMPUTER_A.id, PROJECT_A)?.status == MutationStatus.Success }
            assertDeduplicatedRetry(backend, CREATE_ID)
            val call = backend.attempts(CREATE_ID).singlePayload()
            assertEquals(COMPUTER_A.id, call.computerId)
            assertEquals(PROJECT_A.machineId, call.machineId)
            assertEquals(PROJECT_A.id, call.projectId)
            assertEquals("claude-code", call.provider)
            assertEquals("high", call.reasoning)
            assertEquals(ORIGINAL_TEXT.trim(), call.text)
            assertEquals(backend.result(call), harness.createEntry(COMPUTER_A.id, PROJECT_A)?.result)
            assertEquals(TabletPage.Home, harness.controller.state.value.page)
        }
    }

    @Test
    fun unknownSendBlocksOnlyItsExactComputerMachineProjectAndConversation() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(SEND_ID) }
        Harness(backend).use { harness ->
            harness.ready()
            harness.onMain { send(PAGE_A, ORIGINAL_TEXT, SEND_ID) }
            awaitState { harness.sendEntry(PAGE_A)?.status == MutationStatus.Unknown }
            harness.onMain {
                send(PAGE_A, "replacement must not be sent", "act_synthetic_blocked_send")
                send(PAGE_B, "synthetic second conversation", "act_synthetic_other_conversation")
                send(PAGE_C, "synthetic other computer", "act_synthetic_other_computer")
                send(PAGE_MACHINE, "synthetic other machine", "act_synthetic_other_machine")
            }
            awaitState { backend.calls.size == 4 }
            harness.onMain { }
            assertEquals(1, backend.attempts(SEND_ID).size)
            assertTrue(backend.attempts("act_synthetic_blocked_send").isEmpty())
            assertEquals(SEND_ID, harness.sendEntry(PAGE_A)?.actionId)
            assertEquals(MutationStatus.Unknown, harness.sendEntry(PAGE_A)?.status)
            assertEquals(MutationStatus.Success, harness.sendEntry(PAGE_B)?.status)
            assertEquals(MutationStatus.Success, harness.sendEntry(PAGE_C)?.status)
            assertEquals(MutationStatus.Success, harness.sendEntry(PAGE_MACHINE)?.status)
        }
    }

    @Test
    fun unknownCreateBlocksItsProjectButAllowsOtherProjectsMachinesAndComputers() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(CREATE_ID) }
        Harness(backend).use { harness ->
            harness.ready()
            harness.onMain { create(COMPUTER_A.id, PROJECT_A, "codex", ORIGINAL_TEXT, null, CREATE_ID) }
            awaitState { harness.createEntry(COMPUTER_A.id, PROJECT_A)?.status == MutationStatus.Unknown }
            harness.onMain {
                create(COMPUTER_A.id, PROJECT_A, "claude-code", "must not be sent", null, "act_synthetic_blocked_create")
                create(COMPUTER_A.id, PROJECT_B, "codex", "synthetic other project", null, "act_synthetic_other_project")
                create(COMPUTER_C.id, PROJECT_A, "codex", "synthetic other computer", null, "act_synthetic_other_host_create")
                create(COMPUTER_A.id, PROJECT_MACHINE, "codex", "synthetic other machine", null, "act_synthetic_other_machine_create")
            }
            awaitState { backend.calls.size == 4 }
            harness.onMain { }
            assertTrue(backend.attempts("act_synthetic_blocked_create").isEmpty())
            assertEquals(CREATE_ID, harness.createEntry(COMPUTER_A.id, PROJECT_A)?.actionId)
            assertEquals(MutationStatus.Unknown, harness.createEntry(COMPUTER_A.id, PROJECT_A)?.status)
            assertEquals(MutationStatus.Success, harness.createEntry(COMPUTER_A.id, PROJECT_B)?.status)
            assertEquals(MutationStatus.Success, harness.createEntry(COMPUTER_C.id, PROJECT_A)?.status)
            assertEquals(MutationStatus.Success, harness.createEntry(COMPUTER_A.id, PROJECT_MACHINE)?.status)
        }
    }

    @Test
    fun parcelRestoredUnknownSendKeepsItsPayloadAndNeverWritesUntilRetry() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(SEND_ID) }
        val account = Account()
        val saved = Harness(backend, account).use { original ->
            original.ready()
            original.onMain {
                navigate(PAGE_A)
                send(PAGE_A, ORIGINAL_TEXT, SEND_ID)
            }
            awaitState { original.sendEntry(PAGE_A)?.status == MutationStatus.Unknown }
            parcelClone(original.handle)
        }
        Harness(backend, account, saved).use { restored ->
            restored.ready()
            awaitState { SEND_ID in backend.actionReads }
            val pending = requireNotNull(restored.sendEntry(PAGE_A))
            assertEquals(PAGE_A, restored.controller.state.value.page)
            assertEquals(MutationStatus.Unknown, pending.status)
            assertEquals(MutationRequest.Send(SEND_ID, COMPUTER_A.id, TARGET_A, ORIGINAL_TEXT), pending.request)
            assertEquals(1, backend.attempts(SEND_ID).size)
            restored.onMain { retryMutation(SEND_ID) }
            awaitState { restored.sendEntry(PAGE_A)?.status == MutationStatus.Success }
            assertDeduplicatedRetry(backend, SEND_ID)
        }
    }

    @Test
    fun parcelSnapshotOfRunningCreateRestoresAsUnknownAndRetriesTheOriginalSelection() = runBlocking {
        val backend = Backend().apply { suspendedResponses.add(CREATE_ID) }
        val account = Account()
        val saved = Harness(backend, account).use { original ->
            original.ready()
            original.onMain { create(COMPUTER_A.id, PROJECT_A, "claude-code", ORIGINAL_TEXT, "high", CREATE_ID) }
            awaitState { CREATE_ID in backend.suspendedEntered }
            assertEquals(MutationStatus.Pending, original.createEntry(COMPUTER_A.id, PROJECT_A)?.status)
            // Clone before cancelling the old ViewModel. A shallow Bundle copy would mask this regression.
            parcelClone(original.handle)
        }
        assertTrue(savedStatuses(saved).contains(MutationStatus.Pending.name))
        backend.suspendedResponses.remove(CREATE_ID)
        Harness(backend, account, saved).use { restored ->
            restored.ready()
            val pending = requireNotNull(restored.createEntry(COMPUTER_A.id, PROJECT_A))
            assertEquals(MutationStatus.Unknown, pending.status)
            assertEquals(MutationRequest.Create(CREATE_ID, COMPUTER_A.id, PROJECT_A, "claude-code", ORIGINAL_TEXT, "high"), pending.request)
            assertEquals(1, backend.attempts(CREATE_ID).size)
            restored.onMain { retryMutation(CREATE_ID) }
            awaitState { restored.createEntry(COMPUTER_A.id, PROJECT_A)?.status == MutationStatus.Success }
            assertDeduplicatedRetry(backend, CREATE_ID)
        }
    }

    @Test
    fun acknowledgementCannotDiscardPendingOrUnknownButCanDiscardSuccess() = runBlocking {
        val backend = Backend().apply { suspendedResponses.add(SEND_ID) }
        Harness(backend).use { harness ->
            harness.ready()
            harness.onMain { send(PAGE_A, ORIGINAL_TEXT, SEND_ID) }
            awaitState { SEND_ID in backend.suspendedEntered }
            harness.onMain { acknowledgeMutation(SEND_ID) }
            assertEquals(MutationStatus.Pending, harness.sendEntry(PAGE_A)?.status)
            harness.onMain { foreground(false) }
            awaitState { harness.sendEntry(PAGE_A)?.status == MutationStatus.Unknown }
            harness.onMain { acknowledgeMutation(SEND_ID) }
            assertEquals(MutationStatus.Unknown, harness.sendEntry(PAGE_A)?.status)
            backend.suspendedResponses.remove(SEND_ID)
            harness.onMain { foreground(true) }
            awaitState { harness.controller.state.value.computer(COMPUTER_A.id)?.connection != null }
            harness.onMain { retryMutation(SEND_ID) }
            awaitState { harness.sendEntry(PAGE_A)?.status == MutationStatus.Success }
            harness.onMain { acknowledgeMutation(SEND_ID) }
            assertNull(harness.sendEntry(PAGE_A))
            assertDeduplicatedRetry(backend, SEND_ID)
        }
    }

    @Test
    fun restoredRequestsAreDiscardedWhenTheSignedInOwnerChanges() = runBlocking {
        val backend = Backend().apply { lostFirstResponses.add(SEND_ID) }
        val saved = Harness(backend).use { original ->
            original.ready()
            original.onMain { send(PAGE_A, ORIGINAL_TEXT, SEND_ID) }
            awaitState { original.sendEntry(PAGE_A)?.status == MutationStatus.Unknown }
            parcelClone(original.handle)
        }
        val other = Account().apply { profile = AccountProfile("usr_synthetic_other_owner", "other@example.invalid") }
        Harness(backend, other, saved).use { restored ->
            restored.ready()
            assertTrue(restored.controller.state.value.mutations.isEmpty())
            restored.onMain { retryMutation(SEND_ID) }
            assertEquals(1, backend.attempts(SEND_ID).size)
        }
    }

    @Test
    fun logoutClearsRequestsAndCancelledCompletionsCannotRecreateThem() = runBlocking {
        val backend = Backend().apply { suspendedResponses.add(SEND_ID) }
        val account = Account()
        val saved = Harness(backend, account).use { original ->
            original.ready()
            original.onMain { send(PAGE_A, ORIGINAL_TEXT, SEND_ID) }
            awaitState { SEND_ID in backend.suspendedEntered }
            original.onMain { signOut() }
            awaitState { !original.controller.state.value.busy && original.controller.state.value.profile == null }
            original.onMain { }
            assertTrue(original.controller.state.value.mutations.isEmpty())
            parcelClone(original.handle)
        }
        Harness(backend, account, saved).use { restored ->
            restored.initialized()
            restored.onMain { foreground(true) }
            assertEquals(TabletPage.SignIn, restored.controller.state.value.page)
            assertTrue(restored.controller.state.value.mutations.isEmpty())
            assertEquals(1, backend.attempts(SEND_ID).size)
        }
    }

    private data class Call(
        val actionId: String,
        val kind: String,
        val computerId: String,
        val machineId: String,
        val projectId: String,
        val conversationId: String?,
        val provider: String?,
        val reasoning: String?,
        val text: String,
    )

    private class Backend {
        val calls = CopyOnWriteArrayList<Call>()
        val admissions = ConcurrentHashMap<String, Call>()
        val actionReads = CopyOnWriteArrayList<String>()
        val lostFirstResponses: MutableSet<String> = ConcurrentHashMap.newKeySet()
        val suspendedResponses: MutableSet<String> = ConcurrentHashMap.newKeySet()
        val suspendedEntered: MutableSet<String> = ConcurrentHashMap.newKeySet()

        suspend fun invoke(call: Call) {
            calls += call
            val previous = admissions.putIfAbsent(call.actionId, call)
            check(previous == null || previous == call) { "Synthetic retry changed the admitted request" }
            if (call.actionId in suspendedResponses) {
                suspendedEntered += call.actionId
                awaitCancellation()
            }
            if (previous == null && call.actionId in lostFirstResponses) {
                throw RemoteFailure("connection_closed", uncertainActionId = call.actionId)
            }
        }

        fun attempts(actionId: String): List<Call> = calls.filter { it.actionId == actionId }
        fun result(call: Call): ConversationTarget = ConversationTarget(call.machineId, call.projectId,
            call.conversationId ?: "conv_synthetic_created_${call.actionId.removePrefix("act_")}")
    }

    private class Account : ControllerAccount {
        @Volatile var profile: AccountProfile? = OWNER
        override suspend fun restore(): AccountProfile? = profile
        override suspend fun computers(): List<PairedComputer> = listOf(COMPUTER_A, COMPUTER_C)
        override suspend fun keyProtection(): KeyProtection = KeyProtection.TEE
        override suspend fun signOut(onLocalCleared: suspend () -> Unit) = withContext(NonCancellable) {
            profile = null
            onLocalCleared()
        }
        override suspend fun requestCode(email: String) = Unit
        override suspend fun verifyCode(email: String, code: String): AccountProfile = requireNotNull(profile)
        override suspend fun pair(code: String, onClaimed: () -> Unit): PairingResult = error("Unexpected synthetic pairing")
        override suspend fun removeComputer(computer: PairedComputer) = Unit
    }

    private class Session(private val backend: Backend) : ControllerSession {
        private lateinit var computerId: String
        private var transport = "direct"
        private fun connection() = RemoteConnection(transport, true, "2099-01-01T00:00:00Z")
        override suspend fun connect(computer: PairedComputer, mode: ConnectionMode): RemoteConnection {
            computerId = computer.id
            transport = if (mode == ConnectionMode.RELAY) "relay" else "direct"
            return connection()
        }
        override suspend fun disconnect() = Unit
        override suspend fun workspace(): Pair<RemoteWorkspace, RemoteConnection> = RemoteWorkspace(
            emptyList(), listOf(PROJECT_A, PROJECT_B, PROJECT_MACHINE), emptyList(), emptyList(), true,
        ) to connection()
        override suspend fun send(target: ConversationTarget, text: String, actionId: String) {
            backend.invoke(Call(actionId, "send", computerId, target.machineId, target.projectId,
                target.conversationId, null, null, text))
        }
        override suspend fun create(project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String): ConversationTarget {
            val call = Call(actionId, "create", computerId, project.machineId, project.id, null, provider, reasoning, text)
            backend.invoke(call)
            return backend.result(call)
        }
        override suspend fun action(actionId: String): RemoteAction {
            backend.actionReads += actionId
            return RemoteAction(actionId, "not_found", null, null)
        }
        override fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?): Flow<RemoteConversationDetail> = flow {
            emit(RemoteConversationDetail(RemoteConversation(target, "Synthetic conversation", "codex", "completed", "created", false,
                "2026-11-04T00:00:00Z"), RemoteHistory(emptyList(), emptyList(), null, "synthetic-cursor", true, false),
                null, emptyList(), true))
            awaitCancellation()
        }
        override suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?): List<RemoteConversation> = emptyList()
        override suspend fun olderHistory(target: ConversationTarget, cursor: String): RemoteHistory = error("Unexpected synthetic history pagination")
        override suspend fun changes(target: ConversationTarget): List<RemoteChange> = emptyList()
        override suspend fun approve(item: RemoteAttention, accept: Boolean) = Unit
        override suspend fun resolveAttention(item: RemoteAttention) = Unit
        override suspend fun interrupt(target: ConversationTarget, turnId: String) = Unit
        override suspend fun archive(target: ConversationTarget) = Unit
    }

    private class Harness(
        val backend: Backend,
        val account: Account = Account(),
        val handle: SavedStateHandle = SavedStateHandle(),
    ) : AutoCloseable {
        private val instrumentation = InstrumentationRegistry.getInstrumentation()
        private val store = ViewModelStore()
        lateinit var controller: TabletController
            private set

        init {
            onUi {
                val application = instrumentation.targetContext.applicationContext as Application
                val factory = object : ViewModelProvider.Factory {
                    override fun <T : ViewModel> create(modelClass: Class<T>): T = modelClass.cast(
                        TabletController(application, ControllerDependencies(account) { Session(backend) }, handle),
                    )
                }
                controller = ViewModelProvider(store, factory)[TabletController::class.java]
            }
        }
        fun onMain(block: TabletController.() -> Unit) = onUi { controller.block() }
        fun sendEntry(page: TabletPage.Conversation): PendingMutation? = controller.state.value.sendMutation(page)
        fun createEntry(computerId: String, project: RemoteProject): PendingMutation? = controller.state.value.createMutation(computerId, project)
        suspend fun initialized() = awaitState { !controller.state.value.busy }
        suspend fun ready() {
            initialized()
            onMain { foreground(true) }
            awaitState { (controller.state.value.page == TabletPage.Home || controller.state.value.page is TabletPage.Conversation) &&
                listOf(COMPUTER_A.id, COMPUTER_C.id).all { controller.state.value.computer(it)?.connection != null } }
        }
        suspend fun resumeForeground() {
            onMain { foreground(false) }
            onMain { foreground(true) }
            awaitState { controller.state.value.computer(COMPUTER_A.id)?.connection != null }
        }
        override fun close() {
            onMain { foreground(false) }
            onUi { store.clear() }
            instrumentation.waitForIdleSync()
        }
    }

    private companion object {
        val OWNER = AccountProfile("usr_synthetic_retry_owner", "synthetic@example.invalid")
        const val SEND_ID = "act_synthetic_retry_send"
        const val CREATE_ID = "act_synthetic_retry_create"
        const val ORIGINAL_TEXT = " \n  synthetic text Ω 😀\nsecond synthetic line  \t\n "
        val TARGET_A = ConversationTarget("machine_synthetic_A", "proj_synthetic_A", "conv_synthetic_A")
        val TARGET_B = TARGET_A.copy(conversationId = "conv_synthetic_B")
        val TARGET_MACHINE = TARGET_A.copy(machineId = "machine_synthetic_B")
        val PROJECT_A = RemoteProject(TARGET_A.projectId, TARGET_A.machineId, "Synthetic project A", true, 2)
        val PROJECT_B = PROJECT_A.copy(id = "proj_synthetic_B", name = "Synthetic project B")
        val PROJECT_MACHINE = PROJECT_A.copy(machineId = TARGET_MACHINE.machineId)
        val COMPUTER_A = computer("host_synthetic_A")
        val COMPUTER_C = computer("host_synthetic_C")
        val PAGE_A = TabletPage.Conversation(COMPUTER_A.id, TARGET_A)
        val PAGE_B = TabletPage.Conversation(COMPUTER_A.id, TARGET_B)
        val PAGE_C = TabletPage.Conversation(COMPUTER_C.id, TARGET_A)
        val PAGE_MACHINE = TabletPage.Conversation(COMPUTER_A.id, TARGET_MACHINE)

        fun computer(id: String) = PairedComputer(id, "Synthetic computer", "Synthetic", true,
            "2099-01-01T00:00:00Z", "hauth_synthetic_retry", "synthetic-fingerprint", 1uL, "{}", "{}", "{}")

        fun onUi(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }

        suspend fun awaitState(condition: () -> Boolean) {
            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (!condition()) {
                check(SystemClock.elapsedRealtime() < deadline) { "Synthetic scoped mutation state did not settle" }
                delay(10)
            }
        }

        fun assertDeduplicatedRetry(backend: Backend, actionId: String) {
            val attempts = backend.attempts(actionId)
            assertEquals(2, attempts.size)
            assertEquals(attempts[0], attempts[1])
            assertEquals(1, backend.admissions.values.count { it.actionId == actionId })
        }

        fun List<Call>.singlePayload(): Call {
            assertEquals(1, distinct().size)
            return first()
        }

        @Suppress("DEPRECATION")
        fun parcelClone(handle: SavedStateHandle): SavedStateHandle {
            lateinit var copy: SavedStateHandle
            onUi {
                val bundle = Bundle()
                for (key in handle.keys()) {
                    when (val value = handle.get<Any?>(key)) {
                        null -> bundle.putString(key, null)
                        is String -> bundle.putString(key, value)
                        is Bundle -> bundle.putBundle(key, value)
                        is ArrayList<*> -> bundle.putParcelableArrayList(key, ArrayList(value.map {
                            it as? Bundle ?: error("Unexpected synthetic saved-state element")
                        }))
                        else -> error("Unexpected synthetic saved-state value")
                    }
                }
                val output = Parcel.obtain()
                val bytes = try { output.writeBundle(bundle); output.marshall() } finally { output.recycle() }
                val input = Parcel.obtain()
                try {
                    input.unmarshall(bytes, 0, bytes.size)
                    input.setDataPosition(0)
                    val restored = requireNotNull(input.readBundle(ScopedMutationRetryTest::class.java.classLoader))
                    copy = SavedStateHandle(restored.keySet().associateWith { restored.get(it) })
                } finally { input.recycle() }
            }
            return copy
        }

        fun savedStatuses(handle: SavedStateHandle): List<String> {
            var values = emptyList<String>()
            onUi {
                values = handle.keys().flatMap { key ->
                    (handle.get<Any?>(key) as? ArrayList<*>)?.filterIsInstance<Bundle>()
                        ?.mapNotNull { it.getString("status") }.orEmpty()
                }
            }
            return values
        }
    }
}
