"""Run the Android Keystore / Supervisor JNI interop test on the T1a emulator.

Build @codetether/relay... and @codetether/control-plane... in the repository
first. With the debug app and test APK already installed on the dedicated
emulator, run:

    python apps/android/tools/test-supervisor-emulator.py --adb <path-to-adb>

The runner uses a synthetic local fixture and a temporary Android Keystore
identity. It sends the public JWK and fixture metadata through private pipes.
"""

import argparse
import json
import os
from pathlib import Path
import queue
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import uuid


SERIAL = "emulator-5580"
AVD = "codetether_t1a_pixel_tablet_api36"
APP = "org.codetether.app"
TEST = f"{APP}.remote.SupervisorEmulatorInteropTest"
RUNNER = f"{APP}.test/androidx.test.runner.AndroidJUnitRunner"
REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / "packages" / "supervisor-mobile" / "tests" / "interop-fixture.mjs"
SYSTEM_VARIABLES = (
    "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "TMPDIR",
)


class TestFailure(RuntimeError):
    """A failure whose message is safe to display without tool output."""


def child_environment(adb, node):
    env = {name: os.environ[name] for name in SYSTEM_VARIABLES if name in os.environ}
    paths = [adb.parent, node.parent]
    if system_root := env.get("SystemRoot"):
        paths.extend((Path(system_root) / "System32", Path(system_root)))
    env["PATH"] = os.pathsep.join(map(str, paths))
    return env


def require_avd(adb_call):
    try:
        with socket.create_connection(("127.0.0.1", 5037), timeout=1):
            pass
    except OSError:
        raise TestFailure("Start the ADB server and the dedicated T1a emulator first.") from None
    result = adb_call("emu", "avd", "name")
    lines = [line.strip() for line in result.stdout.decode(errors="replace").splitlines() if line.strip()]
    if result.returncode or lines != [AVD, "OK"]:
        raise TestFailure(f"Expected {AVD} on {SERIAL}.")


def device_public_jwk(adb_call, path, test_process):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and test_process.poll() is None:
        result = adb_call("exec-out", "run-as", APP, "cat", path)
        if result.returncode == 0:
            try:
                jwk = json.loads(result.stdout)
            except ValueError:
                time.sleep(0.2)
                continue
            if (
                isinstance(jwk, dict)
                and set(jwk) == {"kty", "crv", "x", "y"}
                and jwk["kty"] == "EC"
                and jwk["crv"] == "P-256"
            ):
                return jwk
            raise TestFailure("The app did not return the expected public EC JWK.")
        time.sleep(0.2)
    raise TestFailure("Instrumentation did not publish a Keystore public key.")


def fixture_metadata(process):
    lines = queue.Queue(maxsize=1)
    reader = threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True)
    reader.start()
    try:
        line = lines.get(timeout=20)
    except queue.Empty:
        raise TestFailure("The local Supervisor/Relay fixture did not start.") from None
    try:
        fixture = json.loads(line)
    except ValueError:
        raise TestFailure("The local fixture returned no metadata. Check the TypeScript builds.") from None
    required = (
        "hostId", "hostFingerprint", "publicJwk", "deviceId", "grant", "descriptor",
        "accessToken", "machineId", "projectId", "conversationId",
    )
    if not isinstance(fixture, dict) or not all(key in fixture for key in required):
        raise TestFailure("The local fixture returned incomplete metadata.")
    return json.dumps({key: fixture[key] for key in required}).encode()


def run(adb, node):
    env = child_environment(adb, node)
    adb_command = [str(adb), "-s", SERIAL]

    def adb_call(*args, input_data=None):
        return subprocess.run(
            [*adb_command, *args], input=input_data, capture_output=True, timeout=8, env=env,
        )

    require_avd(adb_call)
    run_id = uuid.uuid4().hex
    basename = f"files/t1a-supervisor-{run_id}"
    fixture_path = f"{basename}-fixture.json"
    test = subprocess.Popen(
        [
            *adb_command, "shell", "am", "instrument", "-w",
            "-e", "class", TEST, "-e", "t1aSupervisorInteropRun", run_id, RUNNER,
        ],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
    )
    try:
        jwk = device_public_jwk(adb_call, f"{basename}-device.json", test)
        with tempfile.TemporaryDirectory(prefix="ct-android-interop-") as directory:
            jwk_path = Path(directory) / "t1a-interop-device.json"
            jwk_path.write_text(json.dumps(jwk), encoding="utf-8")
            fixture = subprocess.Popen(
                [str(node), str(FIXTURE), "--android-device-jwk", str(jwk_path)],
                cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, env=env,
            )
            try:
                metadata = fixture_metadata(fixture)
                publish = f"cat > {fixture_path}.tmp && mv {fixture_path}.tmp {fixture_path}"
                result = adb_call(
                    "shell", "-T", f"run-as {APP} sh -c '{publish}'", input_data=metadata,
                )
                if result.returncode:
                    raise TestFailure("Could not deliver fixture metadata to the debug app.")
                output, _ = test.communicate(timeout=90)
                if test.returncode or b"OK (1 test)" not in output:
                    if diagnostic := re.search(rb"T1A interop (direct|relay): [a-z_]{1,48}\b", output):
                        raise TestFailure(diagnostic[0].decode("ascii"))
                    raise TestFailure("Android Supervisor interop instrumentation failed.")
            finally:
                fixture.stdin.close()
                try:
                    fixture.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    fixture.kill()
                    fixture.wait()
                fixture.stdout.close()
    finally:
        try:
            test.communicate(timeout=65)
        except subprocess.TimeoutExpired:
            test.terminate()
            test.communicate()
    print("PASS Android Keystore + Supervisor JNI: Direct and Relay read/write")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", required=True, type=Path)
    parser.add_argument("--node", type=Path, default=shutil.which("node"))
    args = parser.parse_args()
    if not args.adb.is_file() or args.node is None or not args.node.is_file():
        parser.error("Provide valid adb and Node executables.")
    try:
        run(args.adb.resolve(), args.node.resolve())
    except (TestFailure, subprocess.TimeoutExpired, OSError) as failure:
        message = str(failure) if isinstance(failure, TestFailure) else "A local test tool failed or timed out."
        parser.exit(1, f"{message}\n")


if __name__ == "__main__":
    main()
