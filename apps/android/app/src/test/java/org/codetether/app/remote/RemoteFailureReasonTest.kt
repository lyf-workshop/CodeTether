package org.codetether.app.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteFailureReasonTest {
    @Test
    fun projectConflictReasonGivesSpecificGuidance() {
        val failure = RemoteFailure("conflict", reason = "project_has_conversations")
        assertEquals("项目中还有会话，先处理这些会话后再移除项目。", failure.message)
    }

    @Test
    fun uncertainMutationKeepsReconciliationGuidance() {
        val failure = RemoteFailure(
            "connection_closed",
            uncertainActionId = "act_test_123456",
            reason = "project_has_conversations",
        )
        assertEquals("暂时无法确认这次操作的结果。请重新打开会话查看状态。", failure.message)
    }
}
