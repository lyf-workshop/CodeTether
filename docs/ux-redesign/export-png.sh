#!/usr/bin/env bash
# Export prototype v4 screens to docs/ux-redesign/png using headless Chrome.
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
# 02 · 设备与项目（浅色）：账号 › 设备 › 项目（设备上的一个文件夹）› 会话
shot 02-01-devices                   $D $H /devices
shot 02-02-device-local              $D $H /devices/m-local
shot 02-03-device-paired             $D $H /devices/m-mac
shot 02-04-project-detail            $D $H /projects/p-web
shot 02-05-project-previous          $D $H "/projects/p-web?scroll=native"
shot 02-06-project-archived          $D $H "/projects/p-api?view=archived"
shot 02-07-project-search            $D $H "/projects/p-api/search?q=%E9%87%8D%E8%AF%95"
shot 02-08-add-project               $D $H /devices "os=win&modal=addproj:m-local"
shot 02-09-add-project-remote        $D $H /devices/m-mac "os=win&modal=addproj:m-mac"
shot 02-10-add-project-found         $D $H /devices "os=win&modal=addproj:m-local:found"
shot 02-11-inbox                     $D $H /inbox
shot 02-12-palette                   $D $H /devices "os=win&modal=palette"
shot 02-13-new-session               $D $H /devices "os=win&modal=new@m-mac"
shot 02-14-new-session-project       $D $H /projects/p-web "os=win&modal=new:p-web"
shot 02-15-conv-approval             $D $H /c/c1
shot 02-16-conv-panel-changes        $D $H "/c/c1?panel=files&tab=changes"
shot 02-17-conv-panel-output         $D $H "/c/c1?panel=files&tab=output"
shot 02-18-conv-running-paired       $D $H /c/c8
shot 02-19-conv-claude-review        $D $H /c/c2
shot 02-20-conv-rename               $D $H /c/c3 "os=win&modal=rename:c3"
shot 02-21-device-unpair             $D $H /devices/m-mac "os=win&modal=unpair:m-mac"
shot 02-22-device-address            $D $H /devices/m-mac "os=win&modal=addr:m-mac"
shot 02-23-add-device                $D $H /add
shot 02-24-pair-1-prepare            $D $H "/add/node?step=1"
shot 02-25-pair-2-code               $D $H "/add/node?step=2"
shot 02-26-pair-3-verify             $D $H "/add/node?step=3"
shot 02-27-pair-4-done               $D $H "/add/node?step=4"
shot 02-28-signin-email              $D $H "/signin?step=email"
shot 02-29-signin-code               $D $H "/signin?step=code"
# 02 · 设置与首次启动
shot 02-30-settings-appearance       $D $H /settings/appearance
shot 02-31-settings-account          $D $H /settings/account
shot 02-32-settings-notify           $D $H /settings/notify
shot 02-33-settings-background       $D $H /settings/background
shot 02-34-settings-about            $D $H /settings/about
shot 02-35-onboarding-welcome        $D $H "/onboarding?step=welcome" os=mac
shot 02-36-onboarding-tools          $D $H "/onboarding?step=tools"
shot 02-37-onboarding-project        $D $H "/onboarding?step=project"
shot 02-38-onboarding-previous       $D $H "/onboarding?step=previous"
shot 02-39-onboarding-remote         $D $H "/onboarding?step=remote"
shot 02-40-onboarding-ready          $D $H "/onboarding?step=ready"
# 03 · 关键状态
shot 03-01-devices-loading           $D $H "/devices?state=loading"
shot 03-02-devices-empty             $D $H "/devices?state=empty"
shot 03-03-device-offline            $D $H /devices/m-linux
shot 03-04-device-proj-error         $D $H "/devices/m-local?proj=error"
shot 03-05-project-unreadable        $D $H /projects/p-docs
shot 03-06-project-device-offline    $D $H /projects/p-ml
shot 03-07-new-session-unavailable   $D $H /projects/p-ml "os=win&modal=new:p-ml"
shot 03-08-remove-project            $D $H /projects/p-docs "os=win&modal=rmproj:p-docs"
shot 03-09-remove-project-blocked    $D $H /projects/p-web "os=win&modal=rmproj:p-web"
shot 03-10-unpair-blocked            $D $H /devices/m-mac "os=win&modal=unpair:m-mac"
shot 03-11-inbox-empty               $D $H "/inbox?f=none"
shot 03-12-conv-offline-failed       $D $H /c/c4
shot 03-13-conv-imported             $D $H /c/c5
shot 03-14-account-signed-out        $D $H "/settings/account?account=out"
shot 03-15-signin-unconfigured       $D $H "/signin?step=unconfigured"
shot 03-16-narrow-1100-device        1100 760 /devices/m-local
shot 03-17-narrow-1100-project       1100 760 /projects/p-web
shot 03-18-narrow-1100-conv          1100 760 /c/c2
# 04 · 平板 / 手机
shot 04-01-tablet-devices            1024 768 /devices
shot 04-02-tablet-project            1024 768 /projects/p-web
shot 04-03-tablet-conv-panel         1024 768 "/c/c1?panel=files"
shot 04-04-phone-devices              390 844 /devices
shot 04-05-phone-device               390 844 /devices/m-mac
shot 04-06-phone-project              390 844 /projects/p-web
shot 04-07-phone-inbox                390 844 /inbox
shot 04-08-phone-conv                 390 844 /c/c1
shot 04-09-phone-add-project          390 844 /devices "os=win&modal=addproj:m-local:found"
shot 04-10-phone-settings             390 844 /settings/account
shot 04-11-phone-new-session          390 844 /devices "os=win&modal=new@m-local"
# 05 · 后续规划
shot 05-01-roadmap                   $D $H /roadmap
# 06 · 深色主题
shot 06-01-dark-devices              $D $H /devices "os=win&theme=dark"
shot 06-02-dark-project              $D $H /projects/p-web "os=win&theme=dark"
shot 06-03-dark-conv-approval        $D $H /c/c1 "os=win&theme=dark"
shot 06-04-dark-conv-panel           $D $H "/c/c1?panel=files" "os=win&theme=dark"
shot 06-05-dark-conv-claude          $D $H /c/c2 "os=win&theme=dark"
shot 06-06-dark-add-project-found    $D $H /devices "os=win&theme=dark&modal=addproj:m-local:found"
shot 06-07-dark-new-session          $D $H /projects/p-web "os=win&theme=dark&modal=new:p-web"
shot 06-08-dark-settings             $D $H /settings/appearance "os=win&theme=dark"
shot 06-09-dark-palette              $D $H /devices "os=win&theme=dark&modal=palette"
shot 06-10-dark-onboarding           $D $H "/onboarding?step=welcome" "os=mac&theme=dark"
shot 06-11-dark-phone-devices         390 844 /devices "os=win&theme=dark"
shot 06-12-dark-phone-conv            390 844 /c/c1 "os=win&theme=dark"
# 00 · 总览整页图（高度为 overview.html 在 1440 宽、无滚动条时的实际高度；增减截图后需同步修改）
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1440,5341 --virtual-time-budget=4000 \
  --screenshot="$(pwd -W)/png/00-overview.png" "file:///$(pwd -W)/overview.html" >/dev/null 2>&1 </dev/null
echo "png/00-overview.png"
