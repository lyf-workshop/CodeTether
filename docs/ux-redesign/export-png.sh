#!/usr/bin/env bash
# Export prototype v3 screens to docs/ux-redesign/png using headless Chrome.
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
# 02 · 项目与会话（浅色）：会话按 项目 › 文件夹（电脑上的位置）› 会话 组织
shot 02-01-projects                  $D $H /projects
shot 02-02-project-detail            $D $H /projects/p-web
shot 02-03-project-archived          $D $H "/projects/p-api?view=archived"
shot 02-04-project-search            $D $H "/projects/p-web/search?q=%E9%87%8D%E8%BF%9E"
shot 02-05-inbox                     $D $H /inbox
shot 02-06-palette                   $D $H /projects/p-web "os=win&modal=palette"
shot 02-07-new-session               $D $H /c/c8 "os=win&modal=new~p-web,m-mac"
shot 02-08-new-session-folder        $D $H /projects/p-web "os=win&modal=new:p-web,m-local"
shot 02-09-new-session-claude        $D $H /projects/p-web "os=win&modal=new:p-web,m-local,claude"
shot 02-10-add-project               $D $H /projects "os=win&modal=addproj"
shot 02-11-add-folder                $D $H /projects/p-api "os=win&modal=addloc:p-api"
shot 02-12-remove-folder             $D $H /projects/p-docs "os=win&modal=rmloc:p-docs,m-mac"
shot 02-13-conv-approval             $D $H /c/c1
shot 02-14-conv-panel-changes        $D $H "/c/c1?panel=files&tab=changes"
shot 02-15-conv-panel-output         $D $H "/c/c1?panel=files&tab=output"
shot 02-16-conv-running              $D $H /c/c8
shot 02-17-conv-claude-review        $D $H /c/c2
shot 02-18-conv-remote-readonly      $D $H /c/rc1
shot 02-19-conv-rename               $D $H /c/c3 "os=win&modal=rename:c3"
# 02 · 电脑与连接
shot 02-20-computers                 $D $H /computers
shot 02-21-computer-local            $D $H /computers/m-local
shot 02-22-computer-paired           $D $H /computers/m-mac
shot 02-23-computer-add-folder       $D $H /computers/m-mac "os=win&modal=addloc:m-mac"
shot 02-24-computer-unpair           $D $H /computers/m-mac "os=win&modal=unpair:m-mac"
shot 02-25-host-readonly             $D $H /computers/h-studio
shot 02-26-host-pending              $D $H /computers/h-lab
shot 02-27-add-computer              $D $H /add
shot 02-28-add-desktop               $D $H /add/desktop
shot 02-29-pair-1-prepare            $D $H "/add/node?step=1"
shot 02-30-pair-2-code               $D $H "/add/node?step=2"
shot 02-31-pair-3-verify             $D $H "/add/node?step=3"
shot 02-32-pair-4-done               $D $H "/add/node?step=4"
shot 02-33-signin-email              $D $H "/signin?step=email"
shot 02-34-signin-code               $D $H "/signin?step=code"
# 02 · 设置与首次启动
shot 02-35-settings-appearance       $D $H /settings/appearance
shot 02-36-settings-account          $D $H "/settings/account?host=claimed"
shot 02-37-settings-account-host-off $D $H "/settings/account?host=disabled"
shot 02-38-settings-notify           $D $H /settings/notify
shot 02-39-settings-background       $D $H /settings/background
shot 02-40-settings-about            $D $H /settings/about
shot 02-41-onboarding-welcome        $D $H "/onboarding?step=welcome" os=mac
shot 02-42-onboarding-tools          $D $H "/onboarding?step=tools"
shot 02-43-onboarding-project        $D $H "/onboarding?step=project"
shot 02-44-onboarding-previous       $D $H "/onboarding?step=previous"
shot 02-45-onboarding-remote         $D $H "/onboarding?step=remote"
shot 02-46-onboarding-ready          $D $H "/onboarding?step=ready"
# 03 · 关键状态
shot 03-01-projects-loading          $D $H "/projects?state=loading"
shot 03-02-projects-empty            $D $H "/projects?state=empty"
shot 03-03-projects-partial-error    $D $H "/projects?state=error"
shot 03-04-new-session-no-folder     $D $H /projects/p-ml "os=win&modal=new:p-ml"
shot 03-05-add-folder-none-free      $D $H /projects/p-web "os=win&modal=addloc:p-web"
shot 03-06-remove-folder-blocked     $D $H /projects/p-web "os=win&modal=rmloc:p-web,m-mac"
shot 03-07-remove-project-blocked    $D $H /projects/p-web "os=win&modal=rmproj:p-web"
shot 03-08-inbox-empty               $D $H "/inbox?f=none"
shot 03-09-computer-offline          $D $H /computers/m-linux
shot 03-10-computer-proj-error       $D $H "/computers/m-mac?proj=error"
shot 03-11-host-unreachable          $D $H /computers/h-office
shot 03-12-computers-access-states   $D $H "/computers?scroll=more"
shot 03-13-computers-signed-out      $D $H "/computers?account=out"
shot 03-14-conv-offline-failed       $D $H /c/c4
shot 03-15-conv-imported             $D $H /c/c5
shot 03-16-remote-disconnected       $D $H "/c/rc1?live=disconnected"
shot 03-17-signin-unconfigured       $D $H "/signin?step=unconfigured"
shot 03-18-account-host-unclaimed    $D $H "/settings/account?host=enabled_unclaimed"
shot 03-19-narrow-1100-project       1100 760 /projects/p-web
shot 03-20-narrow-1100-computer      1100 760 /computers/m-mac
shot 03-21-narrow-1100-conv          1100 760 /c/c2
# 04 · 平板 / 手机
shot 04-01-tablet-project            1024 768 /projects/p-web
shot 04-02-tablet-conv-panel         1024 768 "/c/c1?panel=files"
shot 04-03-tablet-computers          1024 768 /computers
shot 04-04-phone-projects             390 844 /projects
shot 04-05-phone-project              390 844 /projects/p-web
shot 04-06-phone-inbox                390 844 /inbox
shot 04-07-phone-conv                 390 844 /c/c1
shot 04-08-phone-conv-readonly        390 844 /c/rc1
shot 04-09-phone-computers            390 844 /computers
shot 04-10-phone-host                 390 844 /computers/h-studio
shot 04-11-phone-settings             390 844 /settings/account
shot 04-12-phone-new-session          390 844 /projects/p-web "os=win&modal=new~p-web"
# 05 · 后续规划
shot 05-01-roadmap                   $D $H /roadmap
# 06 · 深色主题
shot 06-01-dark-project              $D $H /projects/p-web "os=win&theme=dark"
shot 06-02-dark-conv-approval        $D $H /c/c1 "os=win&theme=dark"
shot 06-03-dark-conv-panel           $D $H "/c/c1?panel=files" "os=win&theme=dark"
shot 06-04-dark-conv-claude          $D $H /c/c2 "os=win&theme=dark"
shot 06-05-dark-new-session          $D $H /projects/p-web "os=win&theme=dark&modal=new:p-web,m-local,claude"
shot 06-06-dark-computers            $D $H /computers "os=win&theme=dark"
shot 06-07-dark-host                 $D $H /computers/h-studio "os=win&theme=dark"
shot 06-08-dark-settings             $D $H /settings/appearance "os=win&theme=dark"
shot 06-09-dark-palette              $D $H /projects/p-web "os=win&theme=dark&modal=palette"
shot 06-10-dark-onboarding           $D $H "/onboarding?step=welcome" "os=mac&theme=dark"
shot 06-11-dark-phone-project         390 844 /projects/p-web "os=win&theme=dark"
shot 06-12-dark-phone-conv            390 844 /c/c1 "os=win&theme=dark"
# 00 · 总览整页图（高度为 overview.html 在 1440 宽、无滚动条时的实际高度；增减截图后需同步修改）
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1440,6282 --virtual-time-budget=4000 \
  --screenshot="$(pwd -W)/png/00-overview.png" "file:///$(pwd -W)/overview.html" >/dev/null 2>&1 </dev/null
echo "png/00-overview.png"
