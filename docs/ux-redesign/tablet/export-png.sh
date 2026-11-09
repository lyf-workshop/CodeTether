#!/usr/bin/env bash
# 导出平板原型截图到 docs/ux-redesign/tablet/png（需要 Chrome，约 1 分钟）
# 用法：bash docs/ux-redesign/tablet/export-png.sh [名称前缀过滤]
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="file:///$(pwd -W)/index.html"
ONLY="${1:-}"
mkdir -p png
shot() { # 名称 hash [查询参数]   查询参数里 o=port 时按竖屏 800×1280 截图
  [[ -n "$ONLY" && "$1" != $ONLY* ]] && return 0
  local q="${3:-}" w=1280 h=800
  [[ "$q" == *o=port* ]] && { w=800; h=1280; }
  [[ "$q" == *bezel=1* ]] && { w=1390; h=910; }
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$w,$h" --virtual-time-budget=1500 \
    --screenshot="$(pwd -W)/png/$1.png" "$BASE?$q#$2" >/dev/null 2>&1 </dev/null
  echo "png/$1.png"
}
# 01 · 开始
shot 01-01-signin            /signin
shot 01-02-signin-code       "/signin?step=code"
shot 01-03-pair              /pair
shot 01-04-pair-wrong        "/pair?step=wrong"
shot 01-05-pair-done         "/pair?step=done"
# 02 · 会话和待处理
shot 02-01-home              /home
shot 02-02-inbox             /inbox
shot 02-03-conv-approval     /c/c1
shot 02-04-conv-changes      "/c/c1?panel=changes"
shot 02-05-conv-running      /c/c8
shot 02-06-conv-running-node /c/c12
shot 02-07-conv-failed       /c/c3
shot 02-08-conv-imported     /c/c5
shot 02-09-conv-menu         /c/c9 "menu=conv"
shot 02-10-new-session       /home "modal=new"
shot 02-11-new-claude        /projects/p-web "modal=new:p-web"
shot 02-12-search            /home "modal=search"
shot 02-13-conv-stop         /c/c8 "modal=stop"
shot 02-14-changes-nowrap    "/c/c1?panel=changes&wrap=0"
# 03 · 设备和项目
shot 03-01-devices           /devices
shot 03-02-device            /devices/m-win
shot 03-03-device-offline    /devices/m-mac
shot 03-04-project           /projects/p-web
shot 03-05-project-archived  "/projects/p-web?view=archived"
shot 03-06-project-search    "/projects/p-web/search?q=测试"
shot 03-07-add-folder        /devices "modal=addproj:m-win"
shot 03-08-add-name          /devices "modal=addproj:m-win:name"
shot 03-09-add-found         /devices "modal=addproj:m-win:found"
shot 03-10-rm-project        /projects/p-web "modal=rmproj:p-web"
# 04 · 设置
shot 04-01-settings          /settings
shot 04-02-unpair            /settings "modal=unpair:m-win"
shot 04-03-pair-more         /settings "modal=pair"
shot 04-04-connection        /settings/connection
shot 04-05-roadmap           /roadmap
shot 04-06-removed           "/home?removed=1"
# 05 · 竖屏和深色
shot 05-01-port-conv         /c/c1 "o=port"
shot 05-02-port-side         /c/c1 "o=port&side=1"
shot 05-03-port-changes      "/c/c1?panel=changes" "o=port"
shot 05-04-dark-home         /home "theme=dark"
shot 05-05-dark-conv         "/c/c1?panel=changes" "theme=dark"
shot 05-06-bezel             /c/c1 "bezel=1"
