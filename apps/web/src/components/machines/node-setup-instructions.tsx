import { CommandBlock, Notice } from '@codetether/ui'
import { nodePairingCommands } from './node-pairing-model'

/** Shared copy-only instructions; no command execution or environment import. */
export function NodeSetupInstructions({
  platform = 'linux',
}: {
  platform?: 'linux' | 'macos'
}) {
  const commands = nodePairingCommands(platform)
  return (
    <div
      className="min-w-0 space-y-4 text-md text-text-secondary"
      data-node-setup-platform={platform}
    >
      <p>
        在要添加的设备上安装 CodeTether Node。支持 Linux x64 / ARM64、macOS
        ARM64；Windows 暂时不能作为配对设备。无需登录账号。
      </p>
      <ol className="list-decimal space-y-3 pl-5 marker:text-text-muted">
        <li>
          下载对应平台的 Node 安装包，解压后以使用 AI
          工具的普通用户运行以下安装命令。不要以管理员或 root 身份运行 AI 工具。
          <CommandBlock code="./install.sh" label="安装命令" />
        </li>
        <li>
          如果后台服务已经运行，先停止服务，再临时开启一次性配对：
          <CommandBlock
            code={`${commands.stop}\n${commands.pair}`}
            label="一次性配对命令"
          />
        </li>
        <li>
          保持这个窗口打开，复制 Node
          显示的配对链接或可达地址和六位配对码，在下一步输入。
        </li>
        <li>
          两端核对验证码并确认完成后，结束临时配对进程，再恢复后台服务：
          <CommandBlock code={commands.start} label="恢复后台服务命令" />
        </li>
      </ol>
      <Notice tone="warn" title="沿用现有数据目录">
        上方命令使用新安装的默认目录。已有安装、自定义目录或旧版目录（如
        ~/.codetether-node）必须将 --data-dir
        改为原服务实际使用的同一目录，不能新建身份。已配对的 Node
        不会生成新码；请先使用原有配对，不要自动清除信任。
      </Notice>
      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium text-text-primary">
          连接方式与安装说明
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            上方配对命令默认只在本机监听。跨电脑连接可使用 Node 现有 Relay
            配置生成的配对链接；未配置 Relay
            时，请按安装说明在可信局域网绑定设备的局域网地址。不要开放公网 Node
            端口或关闭防火墙。
          </p>
          <p>
            Relay 的首次配置可能仍需管理员协助；Relay
            已连接不代表已经建立设备信任。
          </p>
          <a
            className="text-primary underline underline-offset-4"
            href="https://github.com/lyf-workshop/CodeTether/blob/main/docs/PHASE8D-CROSS-PLATFORM-DISTRIBUTION.md"
            target="_blank"
            rel="noreferrer"
          >
            查看 Node 安装与后台服务说明
          </a>
        </div>
      </details>
    </div>
  )
}
