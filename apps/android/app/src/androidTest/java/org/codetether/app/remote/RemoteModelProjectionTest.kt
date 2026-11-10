package org.codetether.app.remote

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the JSON boundary shared by directory, detail, and model updates. */
@RunWith(AndroidJUnit4::class)
class RemoteModelProjectionTest {
    @Test
    fun modelUpdateDecodesTheDirectConversationSummary() {
        val summary = conversationSummary()
        val updated = summary.conversationSummary()

        assertEquals(TARGET, updated.target)
        assertEquals("codex", updated.provider)
        assertEquals("gpt-5.1", updated.currentModel)
        assertEquals("high", updated.currentReasoning)
        assertEquals("gpt-5.1", updated.model)
        assertEquals("medium", updated.reasoning)
    }

    @Test
    fun directoryAndDetailConversationRowsKeepCurrentSelections() {
        val directory = conversationRow().conversation()
        val detail = conversationRow().conversation()

        for (conversation in listOf(directory, detail)) {
            assertEquals(TARGET, conversation.target)
            assertEquals("gpt-5.1", conversation.currentModel)
            assertEquals("high", conversation.currentReasoning)
            assertFalse(conversation.archived)
        }
    }

    @Test
    fun machineDetailKeepsAvailableModelsAndTheFrameTruncationMarker() {
        val descriptor = JSONObject()
            .put("provider", "codex")
            .put("displayName", "Codex")
            .put("availability", "available")
            .put("capabilities", JSONObject()
                .put("modelSelection", true)
                .put("reasoningControl", true)
                .put("approvals", false)
                .put("interrupt", false)
                .put("diff", false))
            .put("availableModels", JSONArray().put(JSONObject()
                .put("id", "gpt-5.1")
                .put("name", "GPT-5.1")
                .put("description", "Fixture model")))
        val machine = JSONObject()
            .put("machineId", TARGET.machineId)
            .put("displayName", "This computer")
            .put("platform", "Windows")
            .put("architecture", "x64")
            .put("isLocal", true)
            .put("connectionState", "local")
            .put("availability", "available")
            .put("capabilities", JSONObject().put("providerExecution", true))
        val detail = JSONObject()
            .put("machine", machine)
            .put("providers", JSONArray().put(descriptor))
            .put("_truncated", true)

        val projected = machine.machine(detail)
        assertTrue(projected.modelsTruncated)
        assertEquals(listOf(RemoteModel("gpt-5.1", "GPT-5.1", "Fixture model")),
            projected.providers.single().availableModels)

        val refreshed = JSONObject()
            .put("protocolVersion", 1)
            .put("provider", descriptor)
            .put("_truncated", true)
        val catalog = refreshed.protocol().obj("provider")
            .modelCatalog(refreshed.opt("_truncated") as? Boolean ?: false)
        assertEquals("codex", catalog.providerId)
        assertEquals(projected.providers.single().availableModels, catalog.availableModels)
        assertTrue(catalog.modelSelection)
        assertTrue(catalog.truncated)
    }

    private fun conversationRow(): JSONObject = JSONObject()
        .put("machineId", TARGET.machineId)
        .put("projectId", TARGET.projectId)
        .put("conversationId", TARGET.conversationId)
        .put("title", "Fixture conversation")
        .put("provider", "codex")
        .put("status", "idle")
        .put("origin", "created")
        .put("archived", false)
        .put("lastActivityAt", TIMESTAMP)
        .put("resumability", "resumable")
        .put("currentModel", "gpt-5.1")
        .put("currentReasoning", "high")

    private fun conversationSummary(): JSONObject = JSONObject()
        .put("machineId", TARGET.machineId)
        .put("projectId", TARGET.projectId)
        .put("conversationId", TARGET.conversationId)
        .put("title", "Fixture conversation")
        .put("titleSource", "manual")
        .put("origin", "created")
        .put("provider", "codex")
        .put("model", "gpt-5.1")
        .put("reasoning", "medium")
        .put("currentModel", "gpt-5.1")
        .put("currentReasoning", "high")
        .put("status", "idle")
        .put("createdAt", TIMESTAMP)
        .put("updatedAt", TIMESTAMP)
        .put("lastActivityAt", TIMESTAMP)

    private companion object {
        val TARGET = ConversationTarget("machine_synthetic_000001", "proj_synthetic_00000001", "conv_synthetic_00000001")
        const val TIMESTAMP = "2026-11-04T00:00:00Z"
    }
}
