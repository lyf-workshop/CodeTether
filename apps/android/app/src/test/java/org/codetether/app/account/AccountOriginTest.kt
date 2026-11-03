package org.codetether.app.account

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class AccountOriginTest {
    @Test
    fun admitsAnHttpsOriginWithAnExplicitPort() {
        val origin = configurationOrigin(" https://account.example.test:8443 ")
        assertEquals("https://account.example.test:8443/", origin.toString())
    }

    @Test
    fun rejectsOriginsThatCouldMisrouteAccountCredentials() {
        for (input in listOf(
            "",
            "http://account.example.test",
            "https://user@account.example.test",
            "https://account.example.test/api",
            "https://account.example.test/?redirect=other",
            "https://account.example.test/#fragment",
        )) {
            try {
                configurationOrigin(input)
                fail("Unexpected origin admission.")
            } catch (failure: AccountFailure) {
                assertEquals(AccountFailureReason.CONFIGURATION_MISSING, failure.reason)
            }
        }
    }
}
