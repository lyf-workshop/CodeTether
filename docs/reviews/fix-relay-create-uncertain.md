# 审核记录：fix/relay-create-uncertain

日期：2026-11-07。审核对象：`origin/fix/relay-create-uncertain` 的 `e4bdd57`，对比 `fd1d905`。任务：`docs/reviews/relay-create-uncertain-fix-prompt.md`。执行报告：`D:/Projects/Software/agenthub-archive/relay-create-uncertain-report.md`。

## 第 1 轮

结论：没有“必须改”。

改动只有 `apps/relay/src/supervisor-rendezvous.ts` 和它的集成测试。

核对过、没有问题的：

- **原来的竞态，前一半**：Relay 收到确认（ack）后，先等转发给原发送方完成，才清掉“未确认”的序号。发送方收到确认就会发下一块，这一块可能在 Relay 清掉序号之前到达，被判成 `flow_control_violation`，通道被关。修复把清除挪到转发之前。
- **后一半**：Relay 转发数据块时，等写完才设确认超时。对方如果在写回调完成前就确认了，原代码会在确认之后再设一个超时，到点误判。修复在设超时前检查这一块是否仍未确认、通道是否还是同一个。检查和 `setTimeout` 之间没有 `await`，不会插进别的事件。
- 两个方向的数据块走不同的连接，先清除再转发，不改变同一连接上的顺序。
- 三个客户端都是一次只有一块未确认：`packages/relay-client/src/machine-channel.ts`、`packages/supervisor-transport/src/relay.ts`、`packages/supervisor-mobile/src/relay.rs`，和修复的假设一致。

影响：只改 Relay 服务端。Host、桌面、安卓、iPad 都不用改，也不用重装。要生效，必须重新部署生产 Relay（us-vps-01 的 `codetether-relay.service`），提示词见 `docs/reviews/relay-deploy-ack-fix-prompt.md`。

建议改：

1. **原 vivo 事件没能归因**，因为 Windows 安装版没有留下 Host 诊断。`fd1d905` 加的诊断在安装版里写到哪里、事后能不能查，要补清楚，否则以后真机上的失败还是查不到原因。
2. **用生产 Relay 的日志给原事件归因**：日志如果记了通道关闭的原因，对照 vivo 复测的时间找 `flow_control_violation`。部署提示词里让部署前先查一次。
3. 集成测试只看了范围，没有逐条核对它能不能稳定复现竞态。
