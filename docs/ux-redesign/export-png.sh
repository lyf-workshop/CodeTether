#!/usr/bin/env bash
# Export prototype v2 screens to docs/ux-redesign/png using headless Chrome.
# Usage: bash docs/ux-redesign/export-png.sh
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="file:///$(cd prototype && pwd -W)"
mkdir -p png
shot() { # name width height hash [query]   query 默认 os=win，可附加 theme=dark、modal=…
  local q="${5:-os=win}" url
  # Headless Chrome enforces a ~500px minimum window; phone widths render inside an exact-size iframe.
  if [ "$2" -lt 600 ]; then url="$BASE/frame.html?w=$2&h=$3&$q#$4"; else url="$BASE/index.html?$q#$4"; fi
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2,$3" --virtual-time-budget=2000 \
    --screenshot="$(pwd -W)/png/$1.png" "$url" >/dev/null 2>&1 </dev/null
  echo "png/$1.png"
}
D=1440; H=900
# 02 · 桌面全部页面（浅色）
shot 02-01-home                      $D $H /home
shot 02-02-inbox                     $D $H /inbox
shot 02-03-sessions                  $D $H /sessions
shot 02-04-sessions-archived         $D $H "/sessions?view=archived"
shot 02-05-search                    $D $H /search
shot 02-06-palette                   $D $H /home "os=win&modal=palette"
shot 02-07-new-session               $D $H /home "os=win&modal=new"
shot 02-08-conv-approval             $D $H /c/c1
shot 02-09-conv-panel-changes        $D $H "/c/c1?panel=files&tab=changes"
shot 02-10-conv-panel-output         $D $H "/c/c1?panel=files&tab=output"
shot 02-11-conv-running              $D $H /c/c8
shot 02-12-conv-claude-review        $D $H /c/c2
shot 02-13-conv-remote-readonly      $D $H /c/rc1
shot 02-14-conv-rename               $D $H /c/c3 "os=win&modal=rename:c3"
shot 02-15-projects                  $D $H /projects
shot 02-16-project-detail            $D $H /projects/p-web
shot 02-17-computers                 $D $H /computers
shot 02-18-computer-local            $D $H /computers/m-local
shot 02-19-computer-paired           $D $H /computers/m-mac
shot 02-20-computer-unpair           $D $H /computers/m-mac "os=win&modal=unpair:m-mac"
shot 02-21-host-readonly             $D $H /computers/h-studio
shot 02-22-host-pending              $D $H /computers/h-lab
shot 02-23-add-computer              $D $H /add
shot 02-24-add-desktop               $D $H /add/desktop
shot 02-25-pair-1-prepare            $D $H "/add/node?step=1"
shot 02-26-pair-2-code               $D $H "/add/node?step=2"
shot 02-27-pair-3-verify             $D $H "/add/node?step=3"
shot 02-28-pair-4-done               $D $H "/add/node?step=4"
shot 02-29-signin-email              $D $H "/signin?step=email"
shot 02-30-signin-code               $D $H "/signin?step=code"
shot 02-31-settings-appearance       $D $H /settings/appearance
shot 02-32-settings-account          $D $H "/settings/account?host=claimed"
shot 02-33-settings-account-host-off $D $H "/settings/account?host=disabled"
shot 02-34-settings-notify           $D $H /settings/notify
shot 02-35-settings-background       $D $H /settings/background
shot 02-36-settings-about            $D $H /settings/about
shot 02-37-onboarding-welcome        $D $H "/onboarding?step=welcome" os=mac
shot 02-38-onboarding-tools          $D $H "/onboarding?step=tools"
shot 02-39-onboarding-project        $D $H "/onboarding?step=project"
shot 02-40-onboarding-previous       $D $H "/onboarding?step=previous"
shot 02-41-onboarding-remote         $D $H "/onboarding?step=remote"
shot 02-42-onboarding-ready          $D $H "/onboarding?step=ready"
# 03 · 关键状态
shot 03-01-home-loading              $D $H "/home?state=loading"
shot 03-02-home-empty                $D $H "/home?state=empty"
shot 03-03-home-partial-error        $D $H "/home?state=error"
shot 03-04-inbox-empty               $D $H "/inbox?f=none"
shot 03-05-computer-offline          $D $H /computers/m-linux
shot 03-06-computer-proj-error       $D $H "/computers/m-mac?proj=error"
shot 03-07-host-unreachable          $D $H /computers/h-office
shot 03-08-computers-access-states   $D $H "/computers?scroll=more"
shot 03-09-computers-signed-out      $D $H "/computers?account=out"
shot 03-10-conv-offline-failed       $D $H /c/c4
shot 03-11-conv-imported             $D $H /c/c5
shot 03-12-remote-disconnected       $D $H "/c/rc1?live=disconnected"
shot 03-13-signin-unconfigured       $D $H "/signin?step=unconfigured"
shot 03-14-account-host-unclaimed    $D $H "/settings/account?host=enabled_unclaimed"
shot 03-15-narrow-1100-computer      1100 760 /computers/m-mac
shot 03-16-narrow-1100-conv          1100 760 /c/c2
# 04 · 平板 / 手机
shot 04-01-tablet-home               1024 768 /home
shot 04-02-tablet-conv-panel         1024 768 "/c/c1?panel=files"
shot 04-03-tablet-computers          1024 768 /computers
shot 04-04-phone-home                 390 844 /home
shot 04-05-phone-inbox                390 844 /inbox
shot 04-06-phone-conv                 390 844 /c/c1
shot 04-07-phone-conv-readonly        390 844 /c/rc1
shot 04-08-phone-computers            390 844 /computers
shot 04-09-phone-host                 390 844 /computers/h-studio
shot 04-10-phone-settings             390 844 /settings/account
shot 04-11-phone-new-session          390 844 /home "os=win&modal=new"
# 05 · 后续规划
shot 05-01-roadmap                   $D $H /roadmap
# 06 · 深色主题
shot 06-01-dark-home                 $D $H /home "os=win&theme=dark"
shot 06-02-dark-conv-approval        $D $H /c/c1 "os=win&theme=dark"
shot 06-03-dark-conv-panel           $D $H "/c/c1?panel=files" "os=win&theme=dark"
shot 06-04-dark-conv-claude          $D $H /c/c2 "os=win&theme=dark"
shot 06-05-dark-computers            $D $H /computers "os=win&theme=dark"
shot 06-06-dark-host                 $D $H /computers/h-studio "os=win&theme=dark"
shot 06-07-dark-settings             $D $H /settings/appearance "os=win&theme=dark"
shot 06-08-dark-palette              $D $H /home "os=win&theme=dark&modal=palette"
shot 06-09-dark-onboarding           $D $H "/onboarding?step=welcome" "os=mac&theme=dark"
shot 06-10-dark-phone-home            390 844 /home "os=win&theme=dark"
shot 06-11-dark-phone-conv            390 844 /c/c1 "os=win&theme=dark"
# 00 · 总览整页图（高度为 overview.html 在 1440 宽下的实际高度；增减截图后需同步修改）
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1440,5586 --virtual-time-budget=4000 \
  --screenshot="$(pwd -W)/png/00-overview.png" "file:///$(pwd -W)/overview.html" >/dev/null 2>&1 </dev/null
echo "png/00-overview.png"
