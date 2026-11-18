# Task: X1c Voice Input in the Desktop Composer

**Where it runs.** On Windows first. Goal 7 needs the Mac. Run that part there yourself, or hand it to the Mac agent with the Owner's help.

**Windows-only scope (Owner, 2026-11-18; AD-13).**

- **Postponed:**
  - goal 7 (macOS)
  - the Mac half of goal 9's speed target
  - the Mac desktop build in the gates
- **Still required:** keep the macOS code path compiling where the code is shared.
- **Acceptance:** Windows only.

**Branch and worktree.** Start from the current `origin/main` after task 5 (D2 model-control integration) has been merged (fetch first). Create branch `feat/x1c-voice-input` in worktree `D:/Projects/Software/agenthub-work/feat-x1c-voice-input`. If X1b has merged by then, start after it instead; both add a button to the Composer's action bar.

**Why this task exists.** The Composer shows a disabled "语音" button. The Owner wants voice input to work (AD-12): hold to speak, release to get the text into the draft, in Chinese, English or a mix of both.

**Decisions in AD-12:**

- **Engine.** Transcription runs on this computer with whisper.cpp and a multilingual Whisper model. It does not use the operating system's speech services or any cloud service.
- **Download.** The model is downloaded on first use, not bundled with the installer.
- **Privacy.** Audio never leaves the computer and is never written to disk.
- **Platforms.** Desktop only: Windows and macOS. In standalone browser mode, the button is absent. The tablet and phone already have the keyboard's voice typing (04 W4).

**References** (read with `git show origin/ux/design:<path>`):

- `docs/reviews/2026-11-13-assessment-and-plan.md`, AD-2 (revised) and AD-12
- `docs/ux-redesign/10-desktop-improvements.md` §1 (I3, "Voice input": hold the microphone button, transcribe on release, Chinese and English) and §3.3 (action bar)
- `docs/ux-redesign/05-desktop-update.md` (how update files are hosted and verified; the model download follows the same trust model)
- `docs/ux-redesign/03-project-plan.md` §6 (invariants)
- `docs/FROZEN-BOUNDARIES.md` (the desktop shell's minimal native boundary: exact commands only, no generic filesystem, shell or process permission)
- `docs/reviews/b4b-folder-browse-prompt.md` (macOS privacy-permission behavior with the current signing)

Before starting, confirm this file has 4 second-level headings and that the last one is "Report".

## Goals

**Must:**

1. **Speaking into the Composer.**
   - **Hold** "语音" to record; release to transcribe.
   - **Click** to start and click again to stop, for keyboard and pointer users alike.
   - **Esc** cancels without inserting anything.
   - **While recording,** the Composer shows that it is listening, the elapsed time and a level meter. Recording stops by itself at 2 minutes.
   - **After release,** "正在转写…" shows until the text is inserted at the caret in the draft. Voice input never sends a Turn.
   - The button is keyboard reachable and announces its state.
2. **The engine runs locally in the desktop shell.**
   - Microphone capture and whisper.cpp transcription run in the Tauri process, off the UI thread.
   - Only the transcript crosses into the web layer. The Host, the Providers and every log see neither audio nor transcript, until the user sends the draft as an ordinary Turn.
   - Audio stays in memory and is dropped after transcription or cancel.
3. **Chinese, English and mixed speech.**
   - Language detection is automatic.
   - Transcribe these three recorded samples, about 15 seconds each, and include the transcripts in the report:
     - a Mandarin request
     - an English request
     - a mixed request such as "把这个 function 改成 async，然后跑一下 tests"
   - Chinese output uses simplified characters.
4. **First use explains, then downloads.**
   - The first press explains that a speech model of about N MB will be downloaded once, and that speech is processed only on this computer. It then asks to confirm.
   - The download shows progress and can be cancelled. It verifies a pinned SHA-256 before the model is used, and a failed or mismatched download leaves nothing behind.
   - Settings has one row for the model, showing whether it is downloaded and how large it is, with "删除".
5. **Permissions are handled in plain language.**
   - When the operating system denies the microphone, the Composer says so in Chinese and names the exact setting to change:
     - Windows: 设置 › 隐私和安全性 › 麦克风
     - macOS: 系统设置 › 隐私与安全性 › 麦克风
   - The button stays usable, so the user can try again after fixing it.
   - On macOS, the app declares why it needs the microphone, in Chinese.
6. **The native boundary stays narrow.**
   - Add only the exact commands this feature needs (start, stop, cancel, model status, download, delete), granted to the `main` window only.
   - No generic audio, filesystem, shell or network permission.
   - The model is downloaded only from the pinned URL and checked against the pinned hash.
7. **macOS.**
   - The signed app records, downloads and transcribes on the Mac.
   - Check what happens to the microphone permission after an app update with the current signing, and report it. B4b covers the same question for folder access.
8. **Quality gate:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
   - `pnpm format:check` for changed files
   - `cargo test` and `cargo clippy` for `apps/desktop/src-tauri`
   - the desktop build on Windows, and on the Mac for goal 7
   - tests for:
     - the Composer states (idle, recording, transcribing, error, cancelled)
     - insertion at the caret
     - the browser-mode absence
     - the model download's hash check and cleanup
     - the command permissions

**Should:**

9. **Speed.** Transcribing 30 seconds of speech takes at most about 5 seconds on the Owner's Windows PC and on the Mac. Choose the model size to meet that while keeping goal 3 readable. Report the timings and the model chosen.
10. **Technical vocabulary.** Bias recognition toward programming terms, for example through whisper.cpp's initial prompt. The project name and common commands should come out spelled correctly.

## Known facts

- **Why not the operating system's speech services.**
  - Windows' WinRT dictation needs the "online speech recognition" privacy setting, which sends audio to Microsoft. It also needs a speech pack for each language.
  - macOS `SFSpeechRecognizer` works on one locale at a time.
  - Neither handles mixed Chinese and English well, and the two would mean two separate implementations.
  - WebView2 does not provide working Web Speech recognition. Confirm this, and if it turns out wrong, report it before building on it.
- **The Composer today.** `apps/web/src/components/conversation/composer.tsx:338-349` on `4801ef1` renders the disabled "语音" button (title "即将推出", `aria-label` "语音即将推出"). Task 5 rewrites the surrounding bar. Build on its version.
- **The desktop shell.**
  - `apps/desktop/src-tauri/Cargo.toml` pins Tauri `=2.11.5` and its plugins exactly; pin new crates exactly too.
  - Capabilities are in `apps/desktop/src-tauri/capabilities/main.json`.
  - On macOS, `tauri.macos.conf.json` sets `hardenedRuntime: false`, ad-hoc signing (`signingIdentity: "-"`), a minimum of macOS 13.5, and `Info.plist` as the plist. With ad-hoc signing, macOS may ask for privacy permissions again after each update (see B4b).
- **Building whisper.cpp.**
  - The Rust bindings compile it from C++ source, which needs CMake and a C++ toolchain. MSVC is already required on Windows, and Xcode's command-line tools on the Mac.
  - The CI baseline from the hygiene task (AD-8) builds the desktop shell, so the new build requirement must work there as well. Report what CI needed.
  - On the Mac, Metal acceleration is available.
- **Licenses.** whisper.cpp and the Whisper model weights are MIT-licensed. Record the model file's source and license in the report.
- **Hosting.**
  - Update files are hosted at `codetether.org/updates/alpha` (U1).
  - Uploading the model file there is a production change for the Owner. During development, use the official model file from a verifiable source with its published hash, and make the URL configurable at build time.
- **Microphone capture.** Capturing in the web layer would depend on each WebView's media-permission handling, which differs between WebView2 and WKWebView. Capturing in the Rust shell keeps audio out of the web layer, which goal 2 requires.

## Boundaries

- **Decide yourself:**
  - the capture and binding crates (pinned exactly)
  - the model size, within goals 3 and 9
  - the threading model
  - the recording UI within the tokens and 10 §3.3
  - the Settings row's placement in the existing Settings sections
  - test changes and commit splitting
- **Ask the Owner first:**
  - uploading the model to `codetether.org`
  - bundling the model in the installer
  - growing the installer by more than 20 MB
  - any cloud or operating-system speech service
  - enabling the macOS hardened runtime or changing signing
  - replacing the installed desktop app
- **Do not:**
  - send audio or transcripts anywhere
  - write audio to disk
  - auto-send a Turn
  - add generic native permissions
  - edit `AGENTS.md` or `docs/`
  - push `main`, merge or tag
  - read or print credentials

Push `feat/x1c-voice-input` to `origin`.

## Report

Write to `D:/Projects/Software/agenthub-archive/x1c-voice-input-report.md`, with screenshots in `D:/Projects/Software/agenthub-archive/x1c-voice-input/`:

- **Engine:** the crates and versions, the model file (name, size, source, SHA-256, license), and the build requirements on each platform and in CI.
- **Quality:** the three transcripts from goal 3 next to what was said, and the timings from goal 9 on each computer.
- **Boundary:** the new commands and capability entries, quoted.
- **Privacy:** how you verified that audio is not written to disk and that nothing goes over the network except the model download.
- **Permissions:** the denied-microphone behavior on both platforms, and the macOS after-update result.
- **Installer:** its size before and after, on both platforms.
- **Screenshots:** first-use explanation, download, recording, transcribing, permission denied, and the Settings row, in light and dark themes.
- **Gates:** results for each check, with failures quoted verbatim.
- **Commits:** your commits and the pushed remote commit.
- **Status:** anything not done and why, and the completion level reached.
