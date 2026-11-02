import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { MachineId } from '@codetether/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Notice,
} from '@codetether/ui'
import { AddProjectDialog } from '../projects/add-project-dialog'
import {
  MachinePairingComplete,
  MachinePairingConfirmation,
  MachinePairingEntry,
} from './machine-pairing-steps'
import { useRemoteMachinePairing } from './use-remote-machine-pairing'

interface AddRemoteMachineDialogProps {
  onPaired?: (machineId: MachineId) => Promise<void> | void
  presentation?: 'technical' | 'ordinary'
  trigger: ReactElement
}

/** Compatibility entry for onboarding; guided /add/node shares this controller. */
export function AddRemoteMachineDialog({
  onPaired,
  presentation = 'technical',
  trigger,
}: AddRemoteMachineDialogProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [projectMachineId, setProjectMachineId] = useState<MachineId>()
  const addressInputRef = useRef<HTMLInputElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const pairing = useRemoteMachinePairing({ onConfirmed: onPaired })
  const { candidate, busy } = pairing
  useEffect(() => {
    if (candidate !== undefined) confirmationHeadingRef.current?.focus()
  }, [candidate])
  async function handleOpenChange(nextOpen: boolean) {
    if (busy) return
    if (nextOpen) {
      pairing.resetState()
      setOpen(true)
      return
    }
    if (await pairing.cancel()) setOpen(false)
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          void handleOpenChange(value)
        }}
      >
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          closeLabel="关闭设备配对"
          className="max-w-lg overflow-x-hidden"
          showCloseButton={!busy}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            addressInputRef.current?.focus()
          }}
          data-pairing-presentation={presentation}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>添加 Node 设备</DialogTitle>
            <DialogDescription>
              输入设备地址和一次性配对码，然后核对两端验证码。
            </DialogDescription>
          </DialogHeader>
          {pairing.pairedMachine !== undefined ? (
            <>
              <MachinePairingComplete
                machine={pairing.pairedMachine}
                onAddProject={() => {
                  if (pairing.pairedMachine === undefined) return
                  setProjectMachineId(pairing.pairedMachine.machineId)
                  setOpen(false)
                  pairing.resetState()
                }}
                onViewDevice={() => {
                  if (pairing.pairedMachine === undefined) return
                  const machineId = pairing.pairedMachine.machineId
                  setOpen(false)
                  pairing.resetState()
                  void navigate({
                    to: '/devices/$machineId',
                    params: { machineId },
                  })
                }}
              />
              {pairing.error ? (
                <Notice tone="err">{pairing.error}</Notice>
              ) : null}
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  pairing.resetState()
                }}
              >
                完成
              </Button>
            </>
          ) : candidate !== undefined ? (
            <MachinePairingConfirmation
              candidate={candidate}
              error={pairing.error}
              busy={busy}
              confirming={pairing.confirming}
              headingRef={confirmationHeadingRef}
              onBack={() => {
                void pairing.cancel().then((cancelled) => {
                  if (cancelled)
                    requestAnimationFrame(() =>
                      addressInputRef.current?.focus(),
                    )
                })
              }}
              onConfirm={pairing.confirm}
            />
          ) : (
            <>
              <Notice tone="info" className="mb-4">
                需要先在 Linux x64 / ARM64 或 macOS ARM64 设备上安装并开启 Node
                配对。Windows 暂不支持作为配对设备。
              </Notice>
              <MachinePairingEntry
                pairing={pairing}
                addressRef={addressInputRef}
                onBack={() => {
                  void handleOpenChange(false)
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      {projectMachineId !== undefined ? (
        <AddProjectDialog
          fixedMachineId={projectMachineId}
          open
          onOpenChange={(value) => {
            if (!value) setProjectMachineId(undefined)
          }}
        />
      ) : null}
    </>
  )
}
