# 配对速度测量

日期：2026-11-09。目标：测量配对从输入码到成功的各环节耗时，找出瓶颈。

## 测量方法

在 Windows Desktop 和 Mac 上各跑一次完整配对流程，记录每个环节的时间戳。

### 前端埋点（`apps/web`）

在以下位置添加 `console.time()` 和 `console.timeLog()`：

1. **点击"连接电脑"按钮** — `pairing:start`
2. **发送配对请求** — `pairing:request-sent`
3. **收到配对成功响应** — `pairing:response-received`
4. **SSE 收到设备上线事件** — `pairing:device-online`

文件：`apps/web/app/(main)/devices/pair/page.tsx` 或类似。

### 后端埋点（`packages/host`）

在以下位置添加日志（带时间戳）：

1. **收到配对请求** — `Pairing: received request`
2. **验证配对码开始** — `Pairing: validating code`
3. **验证配对码完成** — `Pairing: code validated`
4. **写入信任记录开始** — `Pairing: writing trust record`
5. **写入信任记录完成** — `Pairing: trust record written`
6. **写入端点记录开始** — `Pairing: writing endpoint record`
7. **写入端点记录完成** — `Pairing: endpoint record written`
8. **发起 TLS 握手开始** — `Pairing: starting TLS handshake`
9. **TLS 握手完成** — `Pairing: TLS handshake complete`
10. **返回配对成功响应** — `Pairing: response sent`

文件：`packages/host/src/pairing.ts` 或类似。

### Relay 埋点（如果走 Relay）

如果配对走 Relay 路径，在 Relay 端也加日志：

1. **收到 Enrollment 请求** — `Relay: enrollment request received`
2. **Enrollment 完成** — `Relay: enrollment complete`
3. **收到 Channel 建立请求** — `Relay: channel request received`
4. **Channel 建立完成** — `Relay: channel established`

### 测量步骤

#### Windows Desktop → Mac 配对

1. 在 Mac 上打开 Desktop，生成配对码
2. 在 Windows Desktop 上输入配对码，点击"连接电脑"
3. 记录以下时间（从浏览器控制台和 Host 日志）：
   - T0：点击"连接电脑"
   - T1：前端发送请求
   - T2：Host 收到请求
   - T3：验证配对码完成
   - T4：信任记录写入完成
   - T5：端点记录写入完成
   - T6：TLS 握手完成（如果有）
   - T7：Host 返回响应
   - T8：前端收到响应
   - T9：SSE 收到设备上线事件

#### Mac Desktop → Windows 配对（反向测试）

重复上面的步骤，Mac 输入 Windows 的配对码。

### 预期结果

| 环节                  | 目标耗时 | 实际耗时（Windows → Mac）| 实际耗时（Mac → Windows）|
| --------------------- | -------- | ------------------------ | ------------------------ |
| 前端 → 后端（T2-T0）  | < 100ms  |                          |                          |
| 验证配对码（T3-T2）   | < 50ms   |                          |                          |
| 写信任记录（T4-T3）   | < 200ms  |                          |                          |
| 写端点记录（T5-T4）   | < 200ms  |                          |                          |
| TLS 握手（T6-T5）     | < 1s     |                          |                          |
| 后端 → 前端（T8-T7）  | < 100ms  |                          |                          |
| SSE 推送（T9-T8）     | < 500ms  |                          |                          |
| **总耗时（T9-T0）**   | **≤ 3s** |                          |                          |

### 瓶颈分析

根据实际测量结果，找出最慢的环节：

- 如果 **TLS 握手** 超过 1s：考虑 session resumption 或预连接
- 如果 **数据库写入** 超过 500ms：考虑异步写入或批量事务
- 如果 **SSE 推送** 超过 1s：考虑改为主动推送而不是轮询
- 如果 **验证配对码** 超过 100ms：简化验证逻辑

### 优化方向（根据瓶颈决定）

1. **TLS 慢**：
   - 使用 TLS session resumption
   - 在输入配对码时预建立连接
   - 使用更快的加密算法

2. **数据库慢**：
   - 改为异步写入（先返回成功，后台持久化）
   - 使用事务批量写入
   - 优化索引

3. **网络慢**：
   - 减少往返次数
   - 使用 WebSocket 代替轮询
   - 主动推送代替被动拉取

4. **验证慢**：
   - 简化配对码验证逻辑
   - 去掉不必要的加密/解密
   - 缓存验证结果

## 实施

1. 在 `apps/web` 和 `packages/host` 里加埋点代码
2. 跑两次配对（双向）
3. 把时间数据填到上面的表格
4. 根据瓶颈写优化提示词

测完后把结果追加到这份文件，我再写 D2.4 的优化提示词。
