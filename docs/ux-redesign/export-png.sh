#!/usr/bin/env bash
# Export prototype screens to docs/ux-redesign/png using headless Chrome.
# Usage: bash docs/ux-redesign/export-png.sh
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="file:///$(cd prototype && pwd -W)/index.html"
mkdir -p png
shot() { # name width height hash [os]
  local os="${5:-win}" url
  # Headless Chrome enforces a ~500px minimum window; phone widths render inside an exact-size iframe.
  if [ "$2" -lt 600 ]; then url="${BASE%index.html}frame.html?w=$2&h=$3&os=$os#$4"; else url="$BASE?os=$os#$4"; fi
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2,$3" --virtual-time-budget=2000 \
    --screenshot="$(pwd -W)/png/$1.png" "$url" >/dev/null 2>&1 </dev/null
  echo "png/$1.png"
}
# 02 · 桌面 1440
shot 02-01-onboarding-welcome      1440 900 /onboarding?step=welcome mac
shot 02-02-onboarding-tools        1440 900 /onboarding?step=tools
shot 02-03-onboarding-project      1440 900 /onboarding?step=project
shot 02-04-onboarding-ready        1440 900 /onboarding?step=ready
shot 02-05-sessions-home           1440 900 /sessions
shot 02-06-sessions-archived       1440 900 "/sessions?view=archived"
shot 02-07-search                  1440 900 /search
shot 02-08-devices                 1440 900 /devices
shot 02-09-device-detail-mac       1440 900 /devices/m-mac
shot 02-10-device-detail-local     1440 900 /devices/m-local mac
shot 02-11-device-tools            1440 900 "/devices/m-mac?tab=tools"
shot 02-12-device-access           1440 900 "/devices/m-mac?tab=access"
shot 02-13-conv-local-running      1440 900 /c/c1
shot 02-14-conv-remote-review      1440 900 /c/c2
shot 02-15-conv-inspector          1440 900 "/c/c1?panel=files"
shot 02-16-projects                1440 900 /projects
shot 02-17-project-detail          1440 900 /projects/p-api
shot 02-18-inbox                   1440 900 /inbox
shot 02-19-pair-1-prepare          1440 900 /pair?step=1
shot 02-20-pair-2-code             1440 900 /pair?step=2
shot 02-21-pair-3-verify           1440 900 /pair?step=3
shot 02-22-pair-4-done             1440 900 /pair?step=4
shot 02-23-settings-general        1440 900 /settings/general
shot 02-24-settings-notify         1440 900 /settings/notify
shot 02-25-settings-background     1440 900 /settings/background
shot 02-26-settings-advanced       1440 900 /settings/advanced
shot 02-27-doctor                  1440 900 /doctor
shot 02-28-host-detail             1440 900 /hosts/h-studio
shot 02-29-remote-conv-readonly    1440 900 /hosts/h-studio/c/rc1
shot 02-30-connect-choose          1440 900 /connect
shot 02-31-connect-desktop         1440 900 "/connect?mode=desktop"
shot 02-32-account-email           1440 900 "/account?step=email"
shot 02-33-account-code            1440 900 "/account?step=code"
shot 02-34-account-signed-in       1440 900 "/account?step=in&host=claimed"
shot 02-35-account-enable-host     1440 900 "/account?step=in&host=disabled"
shot 02-36-settings-account        1440 900 /settings/account
# 03 · 关键状态
shot 03-01-sessions-loading        1440 900 "/sessions?state=loading"
shot 03-02-sessions-partial-error  1440 900 "/sessions?state=error"
shot 03-03-sessions-empty          1440 900 "/sessions?state=empty"
shot 03-04-device-offline          1440 900 /devices/m-linux
shot 03-05-device-proj-error       1440 900 "/devices/m-mac?proj=error&conv=empty"
shot 03-06-conv-offline-failed     1440 900 /c/c4
shot 03-07-conv-adopted-native     1440 900 /c/c5
shot 03-08-inbox-empty             1440 900 "/inbox?f=none"
shot 03-09-narrow-desktop-1100     1100 760 /devices/m-mac
shot 03-10-narrow-conv-1100        1100 760 /c/c2
shot 03-11-host-unreachable        1440 900 /hosts/h-office
shot 03-12-remote-live-disconnected 1440 900 "/hosts/h-studio/c/rc1?live=disconnected"
shot 03-13-devices-signed-out      1440 900 "/devices?account=out"
shot 03-14-account-unconfigured    1440 900 "/account?step=unconfigured"
shot 03-15-devices-access-states   1440 900 "/devices?scroll=hosts"
# 04 · 平板 / 手机
shot 04-01-tablet-sessions         1024 768 /sessions
shot 04-02-tablet-conv             1024 768 /c/c2
shot 04-03-tablet-device           1024 768 /devices/m-mac
shot 04-04-phone-sessions           390 844 /sessions
shot 04-05-phone-devices            390 844 /devices
shot 04-06-phone-device-detail      390 844 /devices/m-mac
shot 04-07-phone-conv               390 844 /c/c2
shot 04-08-phone-inbox              390 844 /inbox
shot 04-09-phone-conv-offline       390 844 /c/c4
shot 04-10-phone-host-detail        390 844 /hosts/h-studio
shot 04-11-phone-remote-conv        390 844 /hosts/h-studio/c/rc1
shot 04-12-phone-connect            390 844 /connect
# 05 · 后续规划
shot 05-01-remote-control-roadmap  1440 900 /roadmap
