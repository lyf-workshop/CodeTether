package org.codetether.app

import android.util.Log

/** Privacy-bounded connection stages for debug builds only. Never log request or exception text. */
internal object ConnectionDebug {
    private const val TAG = "CTConnection"
    private val safeWord = Regex("^[A-Za-z][A-Za-z0-9._-]{0,63}$")

    fun mark(stage: String, result: String, failure: Throwable? = null, code: String? = null, route: String? = null) {
        if (!BuildConfig.DEBUG) return
        fun safe(value: String?) = value?.takeIf(safeWord::matches) ?: "unknown"
        val errorClass = failure?.javaClass?.simpleName?.let(::safe) ?: "none"
        val transport = route?.takeIf { it == "direct" || it == "relay" } ?: "unknown"
        Log.d(TAG, "stage=${safe(stage)} result=${safe(result)} errorClass=$errorClass code=${safe(code)} route=$transport")
    }
}
