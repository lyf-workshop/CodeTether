import SwiftUI

@main
struct CodeTetherApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = TabletAppModel()

    var body: some Scene {
        WindowGroup {
            TabletRootView(state: model.state, actions: model.actions)
                .task {
                    await model.start()
                    model.taskDidStart()
                }
                .onChange(of: scenePhase) { phase in model.sceneChanged(phase) }
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("新建会话") {
                    NotificationCenter.default.post(name: .tabletNewSessionShortcut, object: nil)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandMenu("会话") {
                Button("搜索会话") {
                    NotificationCenter.default.post(name: .tabletSearchShortcut, object: nil)
                }
                .keyboardShortcut("k", modifiers: .command)
            }
        }
    }
}
