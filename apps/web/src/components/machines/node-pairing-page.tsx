import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import {
  Button,
  SegmentedControl,
  SegmentedControlItem,
  cn,
} from '@codetether/ui'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { NodeSetupInstructions } from './node-setup-instructions'
import {
  nodePairingSearch,
  nodePairingStep,
  type NodePairingStep,
} from './node-pairing-model'
import {
  MachinePairingComplete,
  MachinePairingConfirmation,
  MachinePairingEntry,
} from './machine-pairing-steps'
import { useRemoteMachinePairing } from './use-remote-machine-pairing'

const stepLabels = ['运行 Node', '输入配对码', '核对验证码', '完成'] as const

export function NodePairingPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const requestedStep = nodePairingSearch(
    search as Record<string, unknown>,
  ).step
  const pairing = useRemoteMachinePairing()
  const step = nodePairingStep(
    requestedStep,
    pairing.candidate !== undefined,
    pairing.pairedMachine !== undefined,
  )
  const addressRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const [platform, setPlatform] = useState<'linux' | 'macos'>('linux')
  const [projectOpen, setProjectOpen] = useState(false)
  useEffect(() => {
    if (step === 2) addressRef.current?.focus()
    else if (step === 3) confirmationHeadingRef.current?.focus()
    else headingRef.current?.focus()
  }, [step])
  function goToStep(next: NodePairingStep) {
    void navigate({ to: '/add/node', search: { step: next }, replace: true })
  }
  async function backToEntry() {
    if (await pairing.cancel()) goToStep(2)
  }
  return (
    <main
      className="mx-auto w-full min-w-0 max-w-(--pairing-w) space-y-6 px-4 py-6 sm:px-6"
      data-node-pairing-step={step}
    >
      <header className="space-y-3">
        <Button asChild size="sm" variant="link" className="px-0">
          <Link to="/add">返回添加设备</Link>
        </Button>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-page font-semibold outline-none"
        >
          配对 Node 设备
        </h1>
        <p className="text-md text-text-secondary">
          只连接你能够核对身份的设备，配对本身不会启动 AI 工作。
        </p>
      </header>
      <ol className="grid grid-cols-4 gap-2" aria-label="设备配对进度">
        {stepLabels.map((label, index) => (
          <li
            key={label}
            aria-current={index + 1 === step ? 'step' : undefined}
            className={cn(
              'min-w-0 border-t-2 border-border pt-3 text-sm text-text-muted',
              index + 1 <= step && 'border-text-primary text-text-primary',
            )}
          >
            <span className="mb-1 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-xs">
              {index + 1 < step ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span className="break-words">{label}</span>
          </li>
        ))}
      </ol>
      <div className="min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-7">
        {step === 1 ? (
          <section className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">在设备上运行 Node</h2>
              <p className="mt-2 text-md text-text-secondary">
                请选择要添加的设备系统，按已有安装路径开启一次性配对。
              </p>
            </div>
            <SegmentedControl
              value={platform}
              onValueChange={(value) => {
                if (value === 'linux' || value === 'macos') setPlatform(value)
              }}
              aria-label="Node 所在设备的系统"
            >
              <SegmentedControlItem value="linux">Linux</SegmentedControlItem>
              <SegmentedControlItem value="macos">macOS</SegmentedControlItem>
            </SegmentedControl>
            <NodeSetupInstructions platform={platform} />
            <div className="flex justify-end">
              <Button onClick={() => goToStep(2)}>已开启配对，下一步</Button>
            </div>
          </section>
        ) : step === 2 ? (
          <MachinePairingEntry
            pairing={pairing}
            addressRef={addressRef}
            onBack={() => goToStep(1)}
          />
        ) : step === 3 && pairing.candidate !== undefined ? (
          <MachinePairingConfirmation
            candidate={pairing.candidate}
            error={pairing.error}
            busy={pairing.busy}
            confirming={pairing.confirming}
            headingRef={confirmationHeadingRef}
            onBack={() => {
              void backToEntry()
            }}
            onConfirm={pairing.confirm}
          />
        ) : pairing.pairedMachine !== undefined ? (
          <MachinePairingComplete
            machine={pairing.pairedMachine}
            onAddProject={() => setProjectOpen(true)}
            onViewDevice={() => {
              if (pairing.pairedMachine !== undefined)
                void navigate({
                  to: '/devices/$machineId',
                  params: { machineId: pairing.pairedMachine.machineId },
                })
            }}
          />
        ) : null}
      </div>
      {pairing.pairedMachine !== undefined ? (
        <AddProjectDialog
          fixedMachineId={pairing.pairedMachine.machineId}
          open={projectOpen}
          onOpenChange={setProjectOpen}
        />
      ) : null}
    </main>
  )
}
