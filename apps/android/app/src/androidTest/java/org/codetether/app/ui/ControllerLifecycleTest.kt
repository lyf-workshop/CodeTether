package org.codetether.app.ui

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.codetether.app.account.AccountFailure
import org.codetether.app.account.AccountFailureReason
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
import org.codetether.app.remote.RemoteMachine
import org.codetether.app.remote.RemoteProject
import org.codetether.app.remote.RemoteProvider
import org.codetether.app.remote.RemoteTurn
import org.codetether.app.remote.RemoteWorkspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectionMode

/** Runs the actual ViewModel state machine with synthetic, cancellable side effects. */
@RunWith(AndroidJUnit4::class)
class ControllerLifecycleTest {
    @Test
    fun cancelledRemoteSignOutCannotRestoreTheClearedLocalAccount() = runBlocking {
        val account = FakeAccount().apply { suspendRemoteSignOut = true }
        Harness(account).use { first ->
            first.ready()
            first.onMain { signOut() }
            awaitState { account.remoteSignOutEntered.isCompleted }
            assertNull(account.persistedProfile)
            assertNull(first.controller.state.value.profile)
            assertEquals(TabletPage.SignIn, first.controller.state.value.page)

            first.onMain { foreground(false) }
            awaitState { account.remoteSignOutCancelled.isCompleted && !first.controller.state.value.busy }
        }
        Harness(account).use { reopened ->
            reopened.initialized()
            reopened.onMain { foreground(true) }
            assertNull(reopened.controller.state.value.profile)
            assertEquals(TabletPage.SignIn, reopened.controller.state.value.page)
            assertNull(account.persistedProfile)
        }
    }

    @Test
    fun rejectedAccountSessionWithNoRestorableProfileReturnsToSignIn() = runBlocking {
        Harness().use { harness ->
            harness.ready()
            harness.account.clearProfileOnDirectoryFailure = true
            harness.account.directoryFailure = AccountFailureReason.SIGN_IN_REQUIRED
            harness.onMain { refresh() }

            awaitState { !harness.controller.state.value.busy && harness.controller.state.value.profile == null }
            val state = harness.controller.state.value
            assertEquals(TabletPage.SignIn, state.page)
            assertTrue(state.computers.isEmpty())
            assertTrue(state.loaded.isEmpty())
            assertNull(state.detail)
        }
    }

    @Test
    fun deviceAuthorizationRejectionPreservesTheSignedInAccount() = runBlocking {
        Harness().use { harness ->
            harness.ready()
            harness.account.directoryFailure = AccountFailureReason.AUTHORIZATION_UNAVAILABLE
            harness.onMain { refresh() }

            awaitState { !harness.controller.state.value.busy && harness.controller.state.value.error != null }
            assertEquals(PROFILE.id, harness.controller.state.value.profile?.id)
            assertEquals(TabletPage.Home, harness.controller.state.value.page)
            assertEquals(PROFILE.id, harness.account.persistedProfile?.id)
        }
    }

    @Test
    fun cancelledProjectReadStaysLoadingUntilForegroundRetriesIt() = runBlocking {
        Harness().use { harness ->
            harness.session.suspendFirstProjectRead = true
            harness.ready()
            val page = TabletPage.Project(COMPUTER.id, PROJECT)
            harness.onMain { navigate(page) }
            awaitState { harness.session.projectEntered.isCompleted }
            assertTrue(harness.controller.state.value.projectLoading)
            assertTrue(harness.controller.state.value.projectRows.isEmpty())

            harness.onMain { foreground(false) }
            awaitState { harness.session.projectCancelled.isCompleted }
            assertTrue(harness.controller.state.value.projectLoading)
            harness.onMain { foreground(true) }

            awaitState { !harness.controller.state.value.projectLoading && harness.controller.state.value.projectRows.isNotEmpty() }
            assertEquals(page, harness.controller.state.value.page)
            assertEquals(listOf(TARGET), harness.controller.state.value.projectRows.map { it.target })
            assertEquals(2, harness.session.projectReads.get())
        }
    }

    @Test
    fun failedProjectReadStopsLoadingAndPreservesTheProjectPage() = runBlocking {
        Harness().use { harness ->
            harness.session.projectFailure = RemoteFailure("unavailable")
            harness.ready()
            val page = TabletPage.Project(COMPUTER.id, PROJECT)
            harness.onMain { navigate(page) }

            awaitState { !harness.controller.state.value.projectLoading && harness.controller.state.value.error != null }
            assertEquals(page, harness.controller.state.value.page)
            assertTrue(harness.controller.state.value.projectRows.isEmpty())
            assertEquals(1, harness.session.projectReads.get())
        }
    }

    @Test
    fun cancellingPairingWaitReleasesBusyAndAllowsAnotherAction() = runBlocking {
        Harness().use { harness ->
            harness.ready()
            harness.onMain {
                navigate(TabletPage.Pair)
                pair("246810")
            }
            awaitState { harness.account.pairEntered.isCompleted }
            assertTrue(harness.controller.state.value.pairingClaimed)
            assertTrue(harness.controller.state.value.pairingInProgress)
            assertTrue(harness.controller.state.value.busy)
            harness.onMain { cancelPairing() }

            awaitState { harness.account.pairCancelled.isCompleted && !harness.controller.state.value.busy }
            assertFalse(harness.controller.state.value.pairingInProgress)
            assertFalse(harness.controller.state.value.pairingClaimed)
            assertEquals(PROFILE.id, harness.controller.state.value.profile?.id)
            harness.onMain { requestCode("synthetic@example.invalid") }
            awaitState { harness.account.codeRequests.get() == 1 && !harness.controller.state.value.busy }
        }
    }

    @Test
    fun cancelledSendKeepsItsActionIdAndForegroundOnlyReadsTheUnknownResult() = runBlocking {
        Harness().use { harness ->
            harness.conversationReady()
            harness.cancelSendInBackground()
            val watchesBeforeResume = harness.session.watches.get()
            harness.onMain { foreground(true) }

            awaitState { harness.session.lastReadActionId == ACTION_ID && harness.session.watches.get() > watchesBeforeResume }
            harness.onMain { }
            assertEquals(1, harness.session.sends.get())
            assertEquals(ACTION_ID, harness.session.lastSentActionId)
            assertEquals(ACTION_ID, harness.session.lastReadActionId)
            assertEquals(ACTION_ID, harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.actionId)
            assertEquals(MutationStatus.Unknown, harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.status)
            assertTrue(!harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.message.isNullOrBlank())
            assertTrue(harness.session.sendCancelled.isCompleted)
        }
    }

    @Test
    fun admittedActionReadConfirmsCancelledSendWithoutSendingAgain() = runBlocking {
        for (status in listOf("accepted", "completed")) {
            Harness().use { harness ->
                harness.conversationReady()
                harness.cancelSendInBackground()
                harness.session.actionStatus = status
                harness.onMain { foreground(true) }

                awaitState { harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.status == MutationStatus.Success }
                assertEquals(ACTION_ID, harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.actionId)
                assertEquals(ACTION_ID, harness.session.lastReadActionId)
                assertEquals(1, harness.session.sends.get())
            }
        }
    }

    @Test
    fun actionAdmissionForAnotherConversationCannotConfirmThePendingSend() = runBlocking {
        Harness().use { harness ->
            harness.conversationReady()
            harness.cancelSendInBackground()
            harness.session.actionStatus = "accepted"
            harness.session.actionConversationId = "conv_synthetic_other_0000001"
            harness.onMain { foreground(true) }

            awaitState { harness.session.lastReadActionId == ACTION_ID }
            harness.onMain { }
            assertEquals(MutationStatus.Unknown, harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.status)
            assertEquals(ACTION_ID, harness.controller.state.value.sendMutation(CONVERSATION_PAGE)?.actionId)
            assertEquals(1, harness.session.sends.get())
        }
    }

    @Test
    fun waitingConversationArchiveConflictExplainsTheApprovalWait() = runBlocking {
        Harness().use { harness ->
            harness.session.conversationStatus = "waiting"
            harness.session.archiveFailure = RemoteFailure("unsupported", 409)
            harness.conversationReady()
            harness.onMain { archive(CONVERSATION_PAGE) }

            awaitState { !harness.controller.state.value.busy && harness.controller.state.value.error != null }
            val state = harness.controller.state.value
            assertEquals(CONVERSATION_PAGE, state.page)
            assertEquals("waiting", state.detail?.conversation?.status)
            assertTrue(state.error.orEmpty().contains("等待批准"))
            assertTrue(state.error.orEmpty().contains("409"))
        }
    }

    private class Harness(
        val account: FakeAccount = FakeAccount(),
        val session: FakeSession = FakeSession(),
    ) : AutoCloseable {
        private val instrumentation = InstrumentationRegistry.getInstrumentation()
        private val store = ViewModelStore()
        lateinit var controller: TabletController
            private set

        init {
            instrumentation.runOnMainSync {
                val application = instrumentation.targetContext.applicationContext as Application
                val factory = object : ViewModelProvider.Factory {
                    override fun <T : ViewModel> create(modelClass: Class<T>): T =
                        modelClass.cast(TabletController(application, ControllerDependencies(account) { session }))
                }
                controller = ViewModelProvider(store, factory)[TabletController::class.java]
            }
        }

        fun onMain(block: TabletController.() -> Unit) {
            instrumentation.runOnMainSync { controller.block() }
        }

        suspend fun initialized() {
            awaitState { !controller.state.value.busy && account.restores.get() > 0 }
        }

        suspend fun ready() {
            initialized()
            // Start foreground after init has finished, so init cannot duplicate the directory read.
            onMain { foreground(true) }
            awaitState {
                val state = controller.state.value
                !state.busy && state.page == TabletPage.Home && state.computer(COMPUTER.id)?.connection != null
            }
        }

        suspend fun conversationReady() {
            ready()
            onMain { navigate(CONVERSATION_PAGE) }
            awaitState { controller.state.value.detail?.conversation?.target == TARGET }
        }

        suspend fun cancelSendInBackground() {
            onMain { send(CONVERSATION_PAGE, "synthetic prompt", ACTION_ID) }
            awaitState { session.sendEntered.isCompleted }
            assertEquals(MutationStatus.Pending, controller.state.value.sendMutation(CONVERSATION_PAGE)?.status)
            onMain { foreground(false) }
            awaitState { !controller.state.value.busy && controller.state.value.sendMutation(CONVERSATION_PAGE)?.status == MutationStatus.Unknown }
        }

        override fun close() {
            instrumentation.runOnMainSync {
                controller.foreground(false)
                store.clear()
            }
            instrumentation.waitForIdleSync()
        }
    }

    private class FakeAccount : ControllerAccount {
        @Volatile var persistedProfile: AccountProfile? = PROFILE
        @Volatile var directoryFailure: AccountFailureReason? = null
        @Volatile var clearProfileOnDirectoryFailure = false
        @Volatile var suspendRemoteSignOut = false
        val restores = AtomicInteger()
        val codeRequests = AtomicInteger()
        val remoteSignOutEntered = CompletableDeferred<Unit>()
        val remoteSignOutCancelled = CompletableDeferred<Unit>()
        val pairEntered = CompletableDeferred<Unit>()
        val pairCancelled = CompletableDeferred<Unit>()

        override suspend fun restore(): AccountProfile? {
            restores.incrementAndGet()
            return persistedProfile
        }

        override suspend fun computers(): List<PairedComputer> {
            directoryFailure?.let { failure ->
                if (clearProfileOnDirectoryFailure) persistedProfile = null
                throw AccountFailure(failure)
            }
            return listOf(COMPUTER)
        }

        override suspend fun requestCode(email: String) { codeRequests.incrementAndGet() }
        override suspend fun verifyCode(email: String, code: String): AccountProfile = PROFILE
        override suspend fun removeComputer(computer: PairedComputer) = Unit
        override suspend fun keyProtection(): KeyProtection = KeyProtection.TEE

        override suspend fun signOut(onLocalCleared: suspend () -> Unit) {
            withContext(NonCancellable) {
                persistedProfile = null
                onLocalCleared()
            }
            if (suspendRemoteSignOut) {
                remoteSignOutEntered.complete(Unit)
                try { awaitCancellation() } finally { remoteSignOutCancelled.complete(Unit) }
            }
        }

        override suspend fun pair(code: String, onClaimed: () -> Unit): PairingResult {
            onClaimed()
            pairEntered.complete(Unit)
            try { awaitCancellation() } finally { pairCancelled.complete(Unit) }
        }
    }

    private class FakeSession : ControllerSession {
        val projectReads = AtomicInteger()
        val watches = AtomicInteger()
        val sends = AtomicInteger()
        val actionReads = AtomicInteger()
        val projectEntered = CompletableDeferred<Unit>()
        val projectCancelled = CompletableDeferred<Unit>()
        val sendEntered = CompletableDeferred<Unit>()
        val sendCancelled = CompletableDeferred<Unit>()
        @Volatile var suspendFirstProjectRead = false
        @Volatile var projectFailure: RemoteFailure? = null
        @Volatile var archiveFailure: RemoteFailure? = null
        @Volatile var conversationStatus = "completed"
        @Volatile var actionStatus = "not_found"
        @Volatile var actionConversationId = TARGET.conversationId
        @Volatile var lastSentActionId: String? = null
        @Volatile var lastReadActionId: String? = null
        private var transport = "direct"
        private fun connection() = RemoteConnection(transport, true, "2099-01-01T00:00:00Z")
        private fun conversation() = RemoteConversation(TARGET, "Synthetic conversation", "codex", conversationStatus,
            "created", false, "2026-11-04T00:00:00Z")

        override suspend fun connect(computer: PairedComputer, mode: ConnectionMode): RemoteConnection {
            transport = if (mode == ConnectionMode.RELAY) "relay" else "direct"
            return connection()
        }

        override suspend fun disconnect() = Unit

        override suspend fun workspace(): Pair<RemoteWorkspace, RemoteConnection> = RemoteWorkspace(
            listOf(RemoteMachine(TARGET.machineId, "Synthetic machine", "Synthetic", true, "local", listOf(PROVIDER))),
            listOf(PROJECT), listOf(conversation()), emptyList(), true,
        ) to connection()

        override suspend fun projectConversations(project: RemoteProject, archived: Boolean, status: String?): List<RemoteConversation> {
            val attempt = projectReads.incrementAndGet()
            if (suspendFirstProjectRead && attempt == 1) {
                projectEntered.complete(Unit)
                try { awaitCancellation() } finally { projectCancelled.complete(Unit) }
            }
            projectFailure?.let { throw it }
            return listOf(conversation())
        }

        override fun watchConversation(target: ConversationTarget, loadedHistory: RemoteHistory?): Flow<RemoteConversationDetail> = flow {
            watches.incrementAndGet()
            val running = conversationStatus in setOf("waiting", "running")
            emit(RemoteConversationDetail(conversation(), RemoteHistory(
                emptyList(), listOf(RemoteTurn("turn_synthetic_00000001", if (running) "running" else "completed",
                    "synthetic prompt", "2026-11-04T00:00:00Z", if (running) null else "2026-11-04T00:00:01Z", null, false)),
                null, "synthetic-live-cursor", true, false,
            ), PROVIDER, emptyList(), true))
            awaitCancellation()
        }

        override suspend fun send(target: ConversationTarget, text: String, actionId: String) {
            sends.incrementAndGet()
            lastSentActionId = actionId
            sendEntered.complete(Unit)
            try { awaitCancellation() } finally { sendCancelled.complete(Unit) }
        }

        override suspend fun action(actionId: String): RemoteAction {
            actionReads.incrementAndGet()
            lastReadActionId = actionId
            return RemoteAction(actionId, actionStatus, actionConversationId, "turn_synthetic_00000001")
        }

        override suspend fun archive(target: ConversationTarget) { archiveFailure?.let { throw it } }
        override suspend fun olderHistory(target: ConversationTarget, cursor: String): RemoteHistory = error("Unexpected synthetic older read")
        override suspend fun changes(target: ConversationTarget): List<RemoteChange> = emptyList()
        override suspend fun create(project: RemoteProject, provider: String, text: String, reasoning: String?, actionId: String): ConversationTarget =
            error("Unexpected synthetic create")
        override suspend fun approve(item: RemoteAttention, accept: Boolean) = Unit
        override suspend fun resolveAttention(item: RemoteAttention) = Unit
        override suspend fun interrupt(target: ConversationTarget, turnId: String) = Unit
    }

    private companion object {
        val PROFILE = AccountProfile("usr_synthetic_000000001", "synthetic@example.invalid")
        val TARGET = ConversationTarget("machine_synthetic_000001", "proj_synthetic_00000001", "conv_synthetic_00000001")
        val PROJECT = RemoteProject(TARGET.projectId, TARGET.machineId, "Synthetic project", true, 1)
        val COMPUTER = PairedComputer("host_synthetic_00000001", "Synthetic computer", "Synthetic", true,
            "2099-01-01T00:00:00Z", "hauth_synthetic_0000001", "synthetic-fingerprint", 1uL, "{}", "{}", "{}")
        val PROVIDER = RemoteProvider("codex", "Synthetic provider", "available", emptyList(), true, true, true, true)
        const val ACTION_ID = "act_synthetic_send_000001"
        val CONVERSATION_PAGE = TabletPage.Conversation(COMPUTER.id, TARGET)

        suspend fun awaitState(condition: () -> Boolean) {
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (!condition()) {
                check(SystemClock.elapsedRealtime() < deadline) { "Synthetic controller state did not settle" }
                delay(10)
            }
        }
    }
}
