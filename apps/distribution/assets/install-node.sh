#!/bin/sh
set -eu
case "$(uname -s)/$(uname -m)" in
  @NATIVE_TARGET@) ;;
  *) echo 'This CodeTether Node artifact does not match this operating system/architecture.' >&2; exit 2 ;;
esac
if [ "$(id -u)" = 0 ]; then
  echo 'Run this installer as the intended non-root user, without sudo.' >&2
  exit 2
fi
artifact_dir=$(CDPATH='' cd -P "$(dirname "$0")" && pwd)
if [ "$(uname -s)" = Darwin ]; then
  observed=$(shasum -a 256 "$artifact_dir/codetether-node")
else
  observed=$(sha256sum "$artifact_dir/codetether-node")
fi
observed=${observed%% *}
if [ "$observed" != '@NODE_SHA256@' ]; then
  echo 'CodeTether Node checksum mismatch. Download and verify the artifact again.' >&2
  exit 2
fi
exec "$artifact_dir/codetether-node" service install
