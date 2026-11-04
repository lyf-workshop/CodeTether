package org.codetether.app.account

import uniffi.supervisor_mobile.ConnectOptions
import uniffi.supervisor_mobile.DeviceSigner
import uniffi.supervisor_mobile.SupervisorSession
import uniffi.supervisor_mobile.connectSupervisor

class AccountProfile internal constructor(val id: String, val email: String)

enum class KeyProtection { STRONGBOX, TEE, SOFTWARE }

enum class AccountFailureReason(val userMessage: String) {
    CONFIGURATION_MISSING("此版本还没有配置登录服务。"),
    INVALID_EMAIL("请输入有效的邮箱地址。"),
    INVALID_CODE("请输入邮件中的 6 到 10 位数字登录码。"),
    SEND_CODE_FAILED("暂时无法发送登录码。请稍后重试。"),
    VERIFY_CODE_FAILED("登录码验证失败，请检查邮箱和登录码后重试。"),
    SIGN_IN_REQUIRED("登录已过期，请重新登录。"),
    DEVICE_IDENTITY_UNAVAILABLE("这台设备的安全密钥不可用。"),
    REQUEST_FAILED("暂时连不上，请检查网络后重试。"),
    RATE_LIMITED("请求太频繁，请稍后重试。"),
    INVALID_RESPONSE("暂时无法读取，请稍后重试。"),
    COMPUTER_UNAVAILABLE("这台电脑现在连不上，请确认它开着并且联网。"),
    AUTHORIZATION_UNAVAILABLE("这台电脑暂时不能使用，请检查配对状态。"),
}

class AccountFailure(val reason: AccountFailureReason) : Exception(reason.userMessage)

class PairedComputer internal constructor(
    val id: String,
    val name: String,
    val platform: String,
    val allowsControl: Boolean,
    val expiresAt: String,
    internal val authorizationId: String,
    internal val fingerprint: String,
    internal val generation: ULong,
    internal val publicKeyJson: String,
    internal val grantJson: String?,
    internal val descriptorJson: String?,
) {
    val isAvailable: Boolean get() = grantJson != null && descriptorJson != null
}

sealed interface PairingResult {
    class Paired(val computer: PairedComputer) : PairingResult
    class Rejected(val reason: PairingRejection, val remainingAttempts: Int?) : PairingResult
}

enum class PairingRejection {
    INVALID_CODE, EXPIRED, USED, CANCELLED, RATE_LIMITED;

    fun message(remainingAttempts: Int?): String = when (this) {
        INVALID_CODE -> if (remainingAttempts != null && remainingAttempts > 0) {
            "配对码不对，还可以试 $remainingAttempts 次。"
        } else {
            "请输入电脑上显示的 6 位配对码。"
        }
        EXPIRED -> "配对码已过期，请在电脑上重新生成。"
        USED -> "这个配对码已经用过了，请在电脑上重新生成。"
        CANCELLED -> "配对码已作废，请在电脑上重新生成。"
        RATE_LIMITED -> "输错次数过多，配对码已作废。请在电脑上重新生成。"
    }
}

class ConnectionCredentials internal constructor(
    private val options: ConnectOptions,
    private val signer: DeviceSigner,
) {
    internal fun connect(): SupervisorSession = connectSupervisor(options, signer)

    override fun toString(): String = "ConnectionCredentials(redacted)"
}
