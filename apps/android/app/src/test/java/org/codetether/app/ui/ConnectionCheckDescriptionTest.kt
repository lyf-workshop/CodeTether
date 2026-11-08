package org.codetether.app.ui

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionCheckDescriptionTest {
    private val now = Instant.parse("2026-11-08T14:00:00Z")

    @Test
    fun offlineDescriptionShowsActualRelativeTime() {
        assertEquals("连不上 · 2 小时前在线", offlineConnectionDescription("2026-11-08T11:31:00Z", now))
    }

    @Test
    fun offlineDescriptionOmitsMissingOrUnusableTime() {
        assertEquals("连不上", offlineConnectionDescription(null, now))
        assertEquals("连不上", offlineConnectionDescription("invalid", now))
        assertEquals("连不上", offlineConnectionDescription("2026-11-08T14:01:00Z", now))
    }
}
