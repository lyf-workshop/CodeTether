import Foundation

struct IpadConfiguration {
    let controlPlaneURL: URL
    let supabaseURL: URL
    let publishableKey: String
    let relayEndpoint: String?
    let relayID: String?
    let relayFingerprint: String?

    init(bundle: Bundle = .main) throws {
        guard
            let control = bundle.object(forInfoDictionaryKey: "CodeTetherControlPlaneURL") as? String,
            let supabase = bundle.object(forInfoDictionaryKey: "CodeTetherSupabaseURL") as? String,
            let key = bundle.object(forInfoDictionaryKey: "CodeTetherSupabasePublishableKey") as? String,
            Self.validOrigin(control), Self.validOrigin(supabase),
            !key.isEmpty, key.utf8.count <= 2_048, key.unicodeScalars.allSatisfy({ $0.value >= 33 && $0.value <= 126 })
        else {
            throw ClientFailure.configurationMissing
        }

        let relayValues = [
            bundle.object(forInfoDictionaryKey: "CodeTetherRelayEndpoint") as? String,
            bundle.object(forInfoDictionaryKey: "CodeTetherRelayID") as? String,
            bundle.object(forInfoDictionaryKey: "CodeTetherRelayFingerprint") as? String,
        ]
        let present = relayValues.compactMap { $0 }.filter { !$0.isEmpty }.count
        guard present == 0 || present == relayValues.count else { throw ClientFailure.configurationMissing }

        controlPlaneURL = URL(string: control)!
        supabaseURL = URL(string: supabase)!
        publishableKey = key
        relayEndpoint = present == 0 ? nil : relayValues[0]
        relayID = present == 0 ? nil : relayValues[1]
        relayFingerprint = present == 0 ? nil : relayValues[2]
    }

    private static func validOrigin(_ value: String) -> Bool {
        guard let components = URLComponents(string: value) else { return false }
        return components.scheme == "https" && components.host != nil && components.user == nil &&
            components.password == nil && (components.path.isEmpty || components.path == "/") &&
            components.query == nil && components.fragment == nil
    }
}

enum ClientFailure: Error, LocalizedError {
    case configurationMissing
    case invalidEmail
    case invalidCode
    case sendCodeFailed
    case verifyCodeFailed
    case signInRequired
    case sessionStorageFailed
    case requestRateLimited
    case requestFailed
    case invalidResponse
    case deviceIdentityUnavailable
    case pairingInvalid(Int)
    case pairingExpired
    case pairingUsed
    case pairingCancelled
    case pairingRateLimited
    case computerRemoved
    case computerUnavailable
    case operationNotAllowed
    case actionUncertain(String)
    case unsupported
    case archiveBusy
    case connectionClosed

    var errorDescription: String? {
        switch self {
        case .configurationMissing: "此版本还没有配置登录服务。"
        case .invalidEmail: "请输入有效的邮箱地址。"
        case .invalidCode: "验证码格式不正确。"
        case .sendCodeFailed: "验证码暂时无法发送，请稍后重试。"
        case .verifyCodeFailed: "验证码不正确或已过期，请检查后重试。"
        case .signInRequired: "登录已过期，请重新登录。"
        case .sessionStorageFailed: "本地登录信息未能清除，请重新尝试退出。"
        case .requestRateLimited: "尝试次数过多，请稍后再试。"
        case .requestFailed: "暂时无法连接服务，请检查网络后重试。"
        case .invalidResponse: "暂时无法读取，请稍后重试。"
        case .deviceIdentityUnavailable: "此设备暂时无法安全登录。"
        case .pairingInvalid(let attempts): "配对码不对，还可以试 \(attempts) 次。"
        case .pairingExpired: "配对码已过期，请在电脑上重新生成。"
        case .pairingUsed: "配对码已使用，请在电脑上重新生成。"
        case .pairingCancelled: "配对已取消，请在电脑上重新开始。"
        case .pairingRateLimited: "尝试次数过多，请在电脑上重新生成配对码。"
        case .computerRemoved: "这台电脑已移除了此设备。要继续使用，请重新配对。"
        case .computerUnavailable, .connectionClosed: "这台电脑现在连不上，请确认它开着并且联网。"
        case .operationNotAllowed: "这台电脑当前不能执行此操作。"
        case .actionUncertain: "暂时无法确认这次操作的结果。可以使用原请求重试。"
        case .unsupported: "当前会话不支持此操作。"
        case .archiveBusy: "会话正在运行或等待批准，工作结束后才能归档。"
        }
    }
}
