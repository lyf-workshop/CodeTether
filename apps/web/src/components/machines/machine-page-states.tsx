import { Button, SectionState } from '@codetether/ui'

export function MachinesLoadingState() {
  return <SectionState state="loading" title="正在读取设备" />
}

export function MachinesErrorState({
  incompatible = false,
  onRetry,
}: {
  incompatible?: boolean
  onRetry: () => void
}) {
  return (
    <SectionState
      state="error"
      title={incompatible ? 'CodeTether 版本不兼容' : '暂时无法读取设备'}
      description={
        incompatible
          ? '请更新 CodeTether 后重试。'
          : '设备记录和已有会话历史会继续保留，请恢复连接后重试。'
      }
      action={
        <Button variant="secondary" onClick={onRetry}>
          重试
        </Button>
      }
    />
  )
}

export function MachinesEmptyState() {
  return (
    <SectionState
      state="empty"
      title="还没有设备记录"
      description="CodeTether 尚未读取到这台电脑的记录，重新连接后再试。"
    />
  )
}
