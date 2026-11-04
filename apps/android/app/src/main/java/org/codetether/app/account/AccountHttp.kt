package org.codetether.app.account

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal class HttpStatus(val status: Int) : IOException()

internal class AccountHttp(
    private val client: Call.Factory = OkHttpClient.Builder()
        .callTimeout(12, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .followRedirects(false)
        .followSslRedirects(false)
        .build(),
) {

    suspend fun request(
        origin: HttpUrl,
        resource: String,
        method: String,
        headers: Map<String, String>,
        bytes: ByteArray? = null,
    ): JSONObject = suspendCancellableCoroutine { continuation ->
        val url = origin.resolve(resource)
        if (url == null || url.host != origin.host || url.port != origin.port || url.scheme != "https") {
            continuation.resumeWithException(AccountFailure(AccountFailureReason.CONFIGURATION_MISSING))
            return@suspendCancellableCoroutine
        }
        val request = Request.Builder()
            .url(url)
            .method(method, bytes?.toRequestBody(JSON))
            .apply { headers.forEach { (name, value) -> header(name, value) } }
            .build()
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWithException(AccountFailure(AccountFailureReason.REQUEST_FAILED))
            }

            override fun onResponse(call: Call, response: Response) {
                val result = runCatching {
                    response.use {
                        if (!it.isSuccessful) throw HttpStatus(it.code)
                        val source = it.body?.source() ?: return@use JSONObject()
                        if (source.request(MAX_RESPONSE_BYTES + 1)) invalidResponse()
                        val data = source.readUtf8()
                        if (data.isBlank()) JSONObject() else parseJson(data)
                    }
                }.recoverCatching {
                    if (it is HttpStatus || it is AccountFailure) throw it
                    throw AccountFailure(AccountFailureReason.REQUEST_FAILED)
                }
                continuation.resumeWith(result)
            }
        })
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val MAX_RESPONSE_BYTES = 2L * 1024 * 1024
    }
}

internal fun configurationOrigin(value: String): HttpUrl {
    val origin = value.trim().toHttpUrlOrNull()
    if (origin == null || !origin.isHttps || origin.username.isNotEmpty() ||
        origin.password.isNotEmpty() || origin.encodedPath != "/" ||
        origin.encodedQuery != null || origin.fragment != null
    ) throw AccountFailure(AccountFailureReason.CONFIGURATION_MISSING)
    return origin
}

internal fun parseJson(value: String): JSONObject = try {
    JSONObject(value)
} catch (_: JSONException) {
    invalidResponse()
}

internal fun JSONObject.objectValue(key: String): JSONObject = optJSONObject(key) ?: invalidResponse()

internal fun JSONObject.arrayValue(key: String, maxCount: Int = 256): JSONArray =
    (optJSONArray(key) ?: invalidResponse()).also { if (it.length() > maxCount) invalidResponse() }

internal fun JSONObject.stringValue(key: String, maxLength: Int = 160): String {
    val value = opt(key) as? String ?: invalidResponse()
    if (value.isEmpty() || value.length > maxLength || value.any { it.isISOControl() }) invalidResponse()
    return value
}

internal fun JSONObject.longValue(key: String): Long = when (val value = opt(key)) {
    is Int -> value.toLong()
    is Long -> value
    else -> invalidResponse()
}.also { if (it !in 0..9_007_199_254_740_991L) invalidResponse() }

internal fun JSONObject.idValue(key: String, prefix: String): String = stringValue(key, 160).also {
    if (!it.startsWith(prefix) || !it.matches(IDENTIFIER) || it.length <= prefix.length) invalidResponse()
}

internal fun JSONObject.expect(key: String, value: String) {
    if (opt(key) != value) invalidResponse()
}

internal fun invalidResponse(): Nothing = throw AccountFailure(AccountFailureReason.INVALID_RESPONSE)

private val IDENTIFIER = Regex("^[A-Za-z0-9_-]+$")
