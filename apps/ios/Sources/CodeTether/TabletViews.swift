import SwiftUI

enum TabletRoute: Hashable {
    case home
    case inbox
    case devices
    case device(computerID: String, machineID: String)
    case project(computerID: String, projectID: String)
    case conversation(computerID: String, conversationID: String)
    case settings
    case connectionCheck
}

enum TabletSheet: Identifiable, Hashable {
    case pair
    case createSession(projectID: String? = nil)
    case search
    case removeComputer(String)

    var id: String {
        switch self {
        case .pair: "pair"
        case .createSession(let projectID): "create-session-\(projectID ?? "all")"
        case .search: "search"
        case .removeComputer(let id): "remove-\(id)"
        }
    }
}

enum TabletAppearance: String, CaseIterable, Identifiable {
    case system = "跟随系统"
    case light = "浅色"
    case dark = "深色"

    var id: String { rawValue }
}

enum TabletConnectionMode: String, CaseIterable, Identifiable {
    case automatic = "自动选择"
    case direct = "优先直连"
    case relay = "只走 Relay"

    var id: String { rawValue }
}

struct TabletViewState {
    var isAuthenticated = false
    var email = ""
    var codeRequested = false
    var isRemoved = false
    var removedComputerName = ""
    var pairingMessage: String?
    var isPairing = false
    var errorMessage: String?
    var createSessionErrorMessage: String?
    var isBusy = false
    var pendingActions: [TabletActionScope: TabletPendingAction] = [:]
    var route: TabletRoute = .home
    var appearance: TabletAppearance = .system
    var connectionMode: TabletConnectionMode = .automatic
    var isCheckingConnection = false
    var expandedSidebarIDs: Set<String> = []
    var conversationDrafts: [String: String] = [:]
    var computers: [TabletComputer] = []
    var attentions: [TabletAttention] = []
    var activeConversation: TabletConversationDetail?
    var searchResults: [TabletConversationSummary] = []
    var changes: [TabletDiffFile] = []
    var changesLoading = false
    var connectionStatus = ""
    var connectionTransport = ""
    var connectionDiagnostic = ""
    /// A non-modal status shown only while the foreground conversation poll is retrying.
    var conversationConnectionMessage: String?
}

struct TabletViewActions {
    var requestSignInCode: (String) -> Void = { _ in }
    var verifySignInCode: (String, String) -> Void = { _, _ in }
    var resetSignInCode: () -> Void = {}
    var signOut: () -> Void = {}
    var pair: (String) -> Void = { _ in }
    var cancelPair: () -> Void = {}
    var removeComputer: (String) -> Void = { _ in }
    var navigate: (TabletRoute) -> Void = { _ in }
    var toggleExpanded: (String) -> Void = { _ in }
    var setAppearance: (TabletAppearance) -> Void = { _ in }
    var setConnectionMode: (TabletConnectionMode) -> Void = { _ in }
    var refresh: () -> Void = {}
    var createConversation: (String, String, String?, String) -> Void = { _, _, _, _ in }
    var retryUncertainAction: (String) -> Void = { _ in }
    var send: (String, String) -> Void = { _, _ in }
    var updateDraft: (String, String) -> Void = { _, _ in }
    var approve: (String, Bool) -> Void = { _, _ in }
    var resolveAttention: (String) -> Void = { _ in }
    var interrupt: (String, String) -> Void = { _, _ in }
    var archive: (String) -> Void = { _ in }
    var loadChanges: (String) -> Void = { _ in }
    var loadOlder: (String, String) -> Void = { _, _ in }
    var search: (String) -> Void = { _ in }
    var dismissError: () -> Void = {}
}

extension Notification.Name {
    static let tabletNewSessionShortcut = Notification.Name("CodeTether.tablet.new-session")
    static let tabletSearchShortcut = Notification.Name("CodeTether.tablet.search")
}

struct TabletComputer: Identifiable {
    let id: String
    let name: String
    let platform: String
    let lastUsed: String
    let available: Bool
    let canControl: Bool
    let authorizationExpiresAt: String
    let machines: [TabletMachine]
}

struct TabletMachine: Identifiable {
    let id: String
    let name: String
    let platform: String
    let status: String
    let isLocal: Bool
    let projects: [TabletProject]
    let recent: [TabletConversationSummary]
    let providers: [TabletProvider]
    let unavailableReason: String?

    init(
        id: String,
        name: String,
        platform: String,
        status: String,
        isLocal: Bool,
        projects: [TabletProject],
        recent: [TabletConversationSummary],
        providers: [TabletProvider],
        unavailableReason: String? = nil
    ) {
        self.id = id
        self.name = name
        self.platform = platform
        self.status = status
        self.isLocal = isLocal
        self.projects = projects
        self.recent = recent
        self.providers = providers
        self.unavailableReason = unavailableReason
    }
}

struct TabletProject: Identifiable {
    let id: String
    let computerID: String
    let machineID: String
    let name: String
    let available: Bool
    let sessions: [TabletConversationSummary]
}

private struct TabletProjectChoice: Identifiable {
    let computer: TabletComputer
    let machine: TabletMachine
    let project: TabletProject

    var id: String { project.id }
}

struct TabletProvider: Identifiable {
    let id: String
    let name: String
    let status: String
    let canStart: Bool
    let canApprove: Bool
    let canInterrupt: Bool
    let canViewChanges: Bool
    let reasoningOptions: [TabletReasoningOption]
    let unavailableReason: String?
}

struct TabletReasoningOption: Identifiable {
    let id: String
    let name: String
}

struct TabletConversationSummary: Identifiable {
    let id: String
    let computerID: String
    let machineID: String
    let projectID: String
    let machineName: String
    let projectName: String
    let title: String
    let providerName: String
    let status: String
    let lastActivity: String
    let isArchived: Bool
    let isImported: Bool
}

struct TabletAttention: Identifiable {
    let id: String
    let conversationID: String?
    let computerID: String
    let projectID: String?
    let type: String
    let title: String
    let detail: String?
    let canApprove: Bool
    let computerName: String
    let projectName: String
}

struct TabletConversationDetail {
    let summary: TabletConversationSummary
    let messages: [TabletTimelineMessage]
    let attentions: [TabletAttention]
    let canSend: Bool
    let canArchive: Bool
    let canInterrupt: Bool
    let canViewChanges: Bool
    let isRunning: Bool
    let currentTurnID: String?
    let lastFailure: String?
    let olderCursor: String?
}

struct TabletTimelineMessage: Identifiable {
    let id: String
    let kind: Kind
    let text: String
    let timestamp: String

    enum Kind {
        case user
        case assistant
        case activity
    }
}

struct TabletDiffFile: Identifiable {
    let id: String
    let path: String
    let additions: Int
    let deletions: Int
    let lines: [TabletDiffLine]
}

struct TabletDiffLine: Identifiable {
    let id: String
    let kind: Kind
    let oldLine: Int?
    let newLine: Int?
    let text: String

    enum Kind {
        case context
        case added
        case removed
        case header
    }
}

struct TabletRootView: View {
    @ObservedObject var model: TabletAppModel

    @State private var sidebarVisible = false
    @State private var activeSheet: TabletSheet?
    @State private var changesVisible = false
    @State private var sidebarSearch = ""

    private var state: TabletViewState { model.state }
    private var actions: TabletViewActions { model.actions }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 900
            ZStack(alignment: .leading) {
                HStack(spacing: 0) {
                    if !compact && !changesVisible {
                        TabletSidebar(state: state, actions: actions, searchText: $sidebarSearch) {
                            activeSheet = .search
                        }
                        .frame(width: 300)
                        .transition(.move(edge: .leading))
                    }

                    VStack(spacing: 0) {
                        TabletToolbar(
                            title: toolbarTitle,
                            subtitle: toolbarSubtitle,
                            showsSidebarButton: state.isAuthenticated && (compact || changesVisible || !sidebarVisible),
                            showsBackButton: state.route == .connectionCheck,
                            isConversation: isConversation,
                            canViewChanges: state.activeConversation?.canViewChanges == true,
                            changesCount: state.changes.count,
                            canArchive: state.activeConversation?.canArchive == true,
                            showsCreateSession: canCreateSession,
                            onSidebar: { withAnimation(.easeInOut(duration: 0.2)) { sidebarVisible.toggle() } },
                            onChanges: openChanges,
                            onArchive: archiveCurrent,
                            onCreate: { presentCreateSession() },
                            onSubtitle: navigateToConversationProject,
                            onBack: { actions.navigate(.settings) }
                        )
                        .background(.ultraThinMaterial)

                        routeContent
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    if changesVisible && !compact {
                        TabletChangesPanel(state: state, onClose: closeChanges)
                            .frame(width: min(420, geometry.size.width * 0.44))
                            .transition(.move(edge: .trailing))
                    }
                }

                if ((compact && sidebarVisible) || (!compact && changesVisible && sidebarVisible)) && state.isAuthenticated {
                    Color.black.opacity(0.26)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { sidebarVisible = false } }
                        .accessibilityHidden(true)
                    TabletSidebar(state: state, actions: actions, searchText: $sidebarSearch) {
                        activeSheet = .search
                    }
                    .frame(width: min(300, geometry.size.width - 52))
                    .shadow(color: .black.opacity(0.14), radius: 20, x: 6)
                    .transition(.move(edge: .leading))
                    .zIndex(2)
                }

                if compact && changesVisible && isConversation {
                    Color.black.opacity(0.18)
                        .ignoresSafeArea()
                        .onTapGesture(perform: closeChanges)
                        .accessibilityHidden(true)
                    TabletChangesPanel(state: state, onClose: closeChanges)
                        .frame(width: min(520, geometry.size.width - 16))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                        .transition(.move(edge: .trailing))
                        .zIndex(3)
                }
            }
            .background(TabletColors.grouped)
            .animation(.easeInOut(duration: 0.2), value: changesVisible)
            .animation(.easeInOut(duration: 0.2), value: sidebarVisible)
            .onChange(of: geometry.size.width) { width in
                if !changesVisible { sidebarVisible = width >= 900 }
            }
            .onAppear {
                sidebarVisible = geometry.size.width >= 900
            }
            .sheet(item: $activeSheet) { sheet in
                TabletSheetContent(sheet: sheet, model: model) {
                    activeSheet = nil
                }
                .id(sheet.id)
                .presentationDetents(sheet == .search ? [.medium, .large] : [.large])
                .presentationDragIndicator(.visible)
            }
        }
        .preferredColorScheme(preferredColorScheme)
        .tint(TabletColors.accent)
        .onReceive(NotificationCenter.default.publisher(for: .tabletNewSessionShortcut)) { _ in
            guard state.isAuthenticated, !state.isRemoved else { return }
            activeSheet = .createSession()
        }
        .onReceive(NotificationCenter.default.publisher(for: .tabletSearchShortcut)) { _ in
            guard state.isAuthenticated, !state.isRemoved else { return }
            activeSheet = .search
        }
        .alert("操作未完成", isPresented: Binding(
            get: { state.errorMessage != nil },
            set: { if !$0 { actions.dismissError() } }
        )) {
            Button("好", role: .cancel) { actions.dismissError() }
        } message: {
            Text(state.errorMessage ?? "请稍后重试。")
        }
    }

    @ViewBuilder
    private var routeContent: some View {
        if !state.isAuthenticated {
            TabletSignInPage(state: state, actions: actions)
        } else {
            switch state.route {
            case .home:
                TabletHomePage(state: state, actions: actions, removedComputerName: state.isRemoved ? state.removedComputerName : nil) {
                    activeSheet = .pair
                } onOtherComputers: {
                    actions.navigate(.devices)
                }
            case .inbox:
                TabletInboxPage(state: state, actions: actions)
            case .devices:
                TabletDevicesPage(state: state, actions: actions)
            case .device(let computerID, let machineID):
                TabletDevicePage(state: state, computerID: computerID, machineID: machineID, actions: actions)
            case .project(let computerID, let projectID):
                TabletProjectPage(state: state, computerID: computerID, projectID: projectID, actions: actions)
            case .conversation(let computerID, let conversationID):
                TabletConversationPage(
                    state: state,
                    computerID: computerID,
                    conversationID: conversationID,
                    actions: actions,
                    onShowChanges: openChanges
                )
            case .settings:
                TabletSettingsPage(state: state, actions: actions, present: { activeSheet = $0 })
            case .connectionCheck:
                TabletConnectionPage(state: state, mode: state.connectionMode, onMode: actions.setConnectionMode, onRefresh: actions.refresh)
            }
        }
    }

    private var preferredColorScheme: ColorScheme? {
        switch state.appearance {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    private var isConversation: Bool {
        if case .conversation = state.route { return true }
        return false
    }

    private var canCreateSession: Bool {
        switch state.route {
        case .home: return true
        case .device(let computerID, let machineID):
            guard let computer = state.computers.first(where: { $0.id == computerID }),
                  let machine = computer.machines.first(where: { $0.id == machineID }) else { return false }
            return computer.available && (machine.status == "online" || machine.status == "local") &&
                machine.projects.contains(where: \.available)
        case .project(let computerID, let projectID):
            guard let computer = state.computers.first(where: { $0.id == computerID }),
                  let project = computer.machines.flatMap(\.projects).first(where: { $0.id == projectID }),
                  let machine = computer.machines.first(where: { $0.id == project.machineID }) else { return false }
            return computer.available && project.available && (machine.status == "online" || machine.status == "local")
        case .devices, .inbox, .conversation, .settings, .connectionCheck: return false
        }
    }

    private var toolbarTitle: String {
        guard isConversation, let detail = state.activeConversation else {
            return switch state.route {
            case .home: "最近的会话"
            case .inbox: "待处理"
            case .devices, .device(_, _): "设备"
            case .project(_, _): "项目"
            case .settings: "设置"
            case .connectionCheck: "连接检查"
            case .conversation(_, _): "会话"
            }
        }
        return detail.summary.title
    }

    private var toolbarSubtitle: String? {
        guard isConversation, let detail = state.activeConversation else { return nil }
        let summary = detail.summary
        return "\(summary.machineName) › \(summary.projectName) · \(summary.providerName)"
    }

    private func openChanges() {
        guard state.activeConversation?.canViewChanges == true else { return }
        changesVisible = true
        sidebarVisible = false
        if let detail = state.activeConversation { actions.loadChanges(detail.summary.id) }
    }

    private func presentCreateSession(preferredProjectID: String? = nil) {
        let projectID: String?
        if let preferredProjectID {
            projectID = preferredProjectID
        } else {
            switch state.route {
            case .project(_, let id): projectID = id
            case .device(let computerID, let machineID):
                projectID = state.computers.first(where: { $0.id == computerID })?.machines
                    .first(where: { $0.id == machineID })?.projects
                    .first(where: { $0.available })?.id
            default: projectID = nil
            }
        }
        activeSheet = .createSession(projectID: projectID)
    }

    private func closeChanges() { changesVisible = false }

    private func archiveCurrent() {
        guard let detail = state.activeConversation, detail.canArchive else { return }
        actions.archive(detail.summary.id)
    }

    private func navigateToConversationProject() {
        guard case .conversation(let computerID, _) = state.route,
              let detail = state.activeConversation else { return }
        actions.navigate(.project(computerID: computerID, projectID: detail.summary.projectID))
    }
}

private enum TabletColors {
    static let grouped = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let secondaryCard = Color(uiColor: .tertiarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    static let accent = Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
    static let link = Color(red: 19 / 255, green: 94 / 255, blue: 156 / 255)
    static let running = Color(red: 26 / 255, green: 127 / 255, blue: 208 / 255)
    static let waiting = Color(red: 181 / 255, green: 103 / 255, blue: 0 / 255)
    static let success = Color(red: 31 / 255, green: 131 / 255, blue: 71 / 255)
    static let failure = Color(red: 189 / 255, green: 46 / 255, blue: 40 / 255)
}

private struct TabletToolbar: View {
    let title: String
    let subtitle: String?
    let showsSidebarButton: Bool
    let showsBackButton: Bool
    let isConversation: Bool
    let canViewChanges: Bool
    let changesCount: Int
    let canArchive: Bool
    let showsCreateSession: Bool
    let onSidebar: () -> Void
    let onChanges: () -> Void
    let onArchive: () -> Void
    let onCreate: () -> Void
    let onSubtitle: () -> Void
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if showsBackButton {
                Button(action: onBack) {
                    Label("设置", systemImage: "chevron.left")
                        .font(.system(size: 15, weight: .medium))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("返回设置")
            } else if showsSidebarButton {
                Button(action: onSidebar) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("显示侧栏")
            }

            if isConversation {
                Spacer(minLength: 4)
                VStack(spacing: 2) {
                    Text(title).font(.headline).lineLimit(1)
                    if let subtitle {
                        Button(action: onSubtitle) {
                            Text(subtitle).font(.caption).foregroundStyle(TabletColors.link).lineLimit(1)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: 680)
                Spacer(minLength: 4)
                if canViewChanges {
                    Button(action: onChanges) {
                        Label("变更 \(changesCount)", systemImage: "rectangle.split.2x1")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("变更 \(changesCount)")
                }
                if canArchive {
                    Menu {
                        Button("归档会话", systemImage: "archivebox", action: onArchive)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 17, weight: .medium))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("更多操作")
                }
            } else {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if showsCreateSession {
                    Button(action: onCreate) {
                        Label("新建会话", systemImage: "plus")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .foregroundStyle(.white)
                            .background(TabletColors.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("new-session-button")
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 58)
        .overlay(alignment: .bottom) { TabletColors.separator.opacity(0.35).frame(height: 0.5) }
    }
}

private struct TabletSidebar: View {
    let state: TabletViewState
    let actions: TabletViewActions
    @Binding var searchText: String
    let onSearch: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.primary)
                    Text(">_").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(Color(uiColor: .systemBackground))
                }
                .frame(width: 30, height: 30)
                Text("CodeTether").font(.system(size: 22, weight: .bold)).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 16)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("搜索会话", text: $searchText)
                    .font(.system(size: 15))
                    .submitLabel(.search)
                    .onSubmit(onSearch)
                    .accessibilityIdentifier("sidebar-search-field")
                if !searchText.isEmpty {
                    Button { searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("清空搜索")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.bottom, 14)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 6) {
                    SidebarNavigationRow(title: "最近的会话", icon: "house", selected: state.route == .home) {
                        actions.navigate(.home)
                    }
                    SidebarNavigationRow(title: "待处理", icon: "tray", badge: state.attentions.count, selected: state.route == .inbox) {
                        actions.navigate(.inbox)
                    }
                    HStack {
                        Text("设备").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                        Spacer()
                        Button("全部设备") { actions.navigate(.devices) }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(TabletColors.link)
                            .frame(minHeight: 44)
                    }
                    .padding(.leading, 18)
                    .padding(.trailing, 12)
                    .padding(.top, 8)

                    if state.computers.isEmpty {
                        Text("配对一台电脑后，设备和会话会显示在这里。")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                    }

                    ForEach(state.computers) { computer in
                        SidebarComputerGroup(
                            computer: computer,
                            expandedIDs: state.expandedSidebarIDs,
                            route: state.route,
                            onToggle: actions.toggleExpanded,
                            onNavigate: actions.navigate
                        )
                    }
                }
                .padding(.horizontal, 8)
            }

            Divider()
            SidebarNavigationRow(title: "设置", icon: "gearshape", selected: state.route == .settings || state.route == .connectionCheck) {
                actions.navigate(.settings)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
        }
        .frame(maxHeight: .infinity)
        .background(TabletColors.grouped)
        .overlay(alignment: .trailing) { TabletColors.separator.opacity(0.55).frame(width: 0.5) }
    }
}

private struct SidebarNavigationRow: View {
    let title: String
    let icon: String
    var badge: Int = 0
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: icon).font(.system(size: 17, weight: .regular)).frame(width: 22)
                Text(title).font(.system(size: 15, weight: selected ? .semibold : .regular))
                Spacer()
                if badge > 0 {
                    Text("\(badge)").font(.system(size: 12, weight: .semibold)).padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color.primary.opacity(0.08), in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(selected ? Color.primary.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct SidebarComputerGroup: View {
    let computer: TabletComputer
    let expandedIDs: Set<String>
    let route: TabletRoute
    let onToggle: (String) -> Void
    let onNavigate: (TabletRoute) -> Void

    var body: some View {
        let expanded = expandedIDs.contains(computer.id)
        VStack(alignment: .leading, spacing: 2) {
            Button { onToggle(computer.id) } label: {
                HStack(spacing: 8) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary).frame(width: 14)
                    Image(systemName: "laptopcomputer.and.iphone").frame(width: 19)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(computer.name).font(.system(size: 14, weight: .medium)).lineLimit(1)
                        Text(computer.available ? "在线" : "离线")
                            .font(.system(size: 11)).foregroundStyle(computer.available ? TabletColors.success : .secondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).frame(minHeight: 48)
                .contentShape(Rectangle())
                .opacity(computer.available ? 1 : 0.62)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(computer.name)，\(computer.available ? "在线" : "离线")")

            if expanded {
                ForEach(computer.machines) { machine in
                    SidebarMachineGroup(
                        computer: computer,
                        machine: machine,
                        expandedIDs: expandedIDs,
                        route: route,
                        onToggle: onToggle,
                        onNavigate: onNavigate
                    )
                }
            }
        }
        .padding(.leading, 6)
    }
}

private struct SidebarMachineGroup: View {
    let computer: TabletComputer
    let machine: TabletMachine
    let expandedIDs: Set<String>
    let route: TabletRoute
    let onToggle: (String) -> Void
    let onNavigate: (TabletRoute) -> Void

    private var key: String { "machine:\(computer.id):\(machine.id)" }

    var body: some View {
        let expanded = expandedIDs.contains(key)
        VStack(alignment: .leading, spacing: 1) {
            Button {
                onToggle(key)
                onNavigate(.device(computerID: computer.id, machineID: machine.id))
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).frame(width: 14)
                    Image(systemName: machine.isLocal ? "desktopcomputer" : "externaldrive.connected.to.line.below")
                        .font(.system(size: 14)).frame(width: 19)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(machine.name).font(.system(size: 14, weight: .medium)).lineLimit(1)
                        Text(machineSubtitle(computer: computer, machine: machine))
                            .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 22).padding(.trailing, 10).frame(minHeight: 44)
                .contentShape(Rectangle())
                .opacity(machine.status == "online" || machine.status == "local" ? 1 : 0.58)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("sidebar-machine-\(machine.id)")

            if expanded {
                ForEach(machine.projects) { project in
                    SidebarProjectGroup(
                        project: project,
                        computer: computer,
                        expandedIDs: expandedIDs,
                        route: route,
                        onToggle: onToggle,
                        onNavigate: onNavigate
                    )
                }
            }
        }
    }

    private func machineSubtitle(computer: TabletComputer, machine: TabletMachine) -> String {
        let online = machine.status == "online" || machine.status == "local"
        let route = machine.isLocal ? nil : "经由 \(computer.name)"
        return [machine.unavailableReason ?? (online ? "在线" : "离线"), route].compactMap { $0 }.joined(separator: " · ")
    }
}

private struct SidebarProjectGroup: View {
    let project: TabletProject
    let computer: TabletComputer
    let expandedIDs: Set<String>
    let route: TabletRoute
    let onToggle: (String) -> Void
    let onNavigate: (TabletRoute) -> Void

    private var key: String { "project:\(computer.id):\(project.id)" }

    var body: some View {
        let expanded = expandedIDs.contains(key)
        VStack(alignment: .leading, spacing: 1) {
            Button {
                onToggle(key)
                onNavigate(.project(computerID: computer.id, projectID: project.id))
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).frame(width: 14)
                    Image(systemName: "folder").font(.system(size: 14)).frame(width: 19)
                    Text(project.name).font(.system(size: 14, weight: .regular)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(project.sessions.count)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .padding(.leading, 42).padding(.trailing, 10).frame(minHeight: 42)
                .contentShape(Rectangle())
                .opacity(project.available ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("sidebar-project-\(project.id)")

            if expanded {
                ForEach(project.sessions.prefix(5)) { session in
                    Button {
                        onNavigate(.conversation(computerID: computer.id, conversationID: session.id))
                    } label: {
                        HStack(spacing: 8) {
                            Circle().fill(statusColor(session.status)).frame(width: 7, height: 7)
                            Text(session.title).font(.system(size: 12, weight: isSelected(session) ? .semibold : .regular)).lineLimit(1)
                        }
                        .padding(.leading, 68).padding(.trailing, 8).frame(minHeight: 38)
                        .background(isSelected(session) ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("sidebar-conversation-\(session.id)")
                }
            }
        }
    }

    private func isSelected(_ session: TabletConversationSummary) -> Bool {
        if case .conversation(_, let id) = route { return id == session.id }
        return false
    }
}

private struct TabletHomePage: View {
    let state: TabletViewState
    let actions: TabletViewActions
    let removedComputerName: String?
    let onPair: () -> Void
    let onOtherComputers: () -> Void

    private var openItems: [TabletAttention] { state.attentions }

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: "最近的会话", subtitle: "所有电脑和设备上的会话，按设备分组。")
            if let removedComputerName {
                VStack(alignment: .leading, spacing: 10) {
                    Label("电脑已移除这台 iPad", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(TabletColors.failure)
                    if !removedComputerName.isEmpty {
                        Text(removedComputerName).font(.system(size: 14, weight: .medium))
                    }
                    Text("重新输入电脑上的配对码，或查看其他电脑。")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        Button("输入配对码", action: onPair).buttonStyle(TabletPrimaryButtonStyle())
                        Button("看其他电脑", action: onOtherComputers).buttonStyle(TabletSecondaryButtonStyle())
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.red.opacity(0.2)))
            }
            if !openItems.isEmpty {
                TabletSectionTitle(title: "需要你处理", count: openItems.count)
                VStack(spacing: 0) {
                    ForEach(Array(openItems.prefix(5).enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().padding(.leading, 16) }
                        AttentionRow(item: item) {
                            if let conversationID = item.conversationID {
                                actions.navigate(.conversation(computerID: item.computerID, conversationID: conversationID))
                            }
                        }
                    }
                }
                .tabletCard()
            }

            let runningItems = state.computers.flatMap { computer in
                computer.machines.flatMap { machine in
                    machine.recent.filter { !$0.isArchived && ["running", "starting", "waiting"].contains($0.status) }
                }
            }
            if !runningItems.isEmpty {
                TabletSectionTitle(title: "正在运行", count: runningItems.count)
                VStack(spacing: 0) {
                    ForEach(Array(runningItems.prefix(8).enumerated()), id: \.element.id) { index, session in
                        if index > 0 { Divider().padding(.leading, 16) }
                        TabletConversationRow(session: session) {
                            actions.navigate(.conversation(computerID: session.computerID, conversationID: session.id))
                        }
                    }
                }
                .tabletCard()
            }

            if state.computers.isEmpty {
                TabletEmptyState(icon: "laptopcomputer", title: "还没有配对的电脑", detail: "在电脑上打开 CodeTether，生成配对码后添加这台 iPad。")
            }

            ForEach(state.computers) { computer in
                ForEach(computer.machines) { machine in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(machine.name).font(.system(size: 19, weight: .semibold))
                                Text(machineSubtitle(computer, machine)).font(.system(size: 13)).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("查看全部") { actions.navigate(.device(computerID: computer.id, machineID: machine.id)) }
                                .font(.system(size: 14, weight: .medium)).foregroundStyle(TabletColors.link)
                                .frame(minHeight: 44)
                        }
                        let rows = machine.recent.filter { !$0.isArchived }.prefix(5)
                        if rows.isEmpty {
                            Text("这里还没有会话").font(.system(size: 14)).foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, alignment: .leading).tabletCard()
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, session in
                                    if index > 0 { Divider().padding(.leading, 16) }
                                    TabletConversationRow(session: session) {
                                        actions.navigate(.conversation(computerID: computer.id, conversationID: session.id))
                                    }
                                }
                            }
                            .tabletCard()
                        }
                    }
                }
            }
        }
        .refreshable { actions.refresh() }
    }

    private func machineSubtitle(_ computer: TabletComputer, _ machine: TabletMachine) -> String {
        let online = machine.status == "online" || machine.status == "local"
        return [machine.unavailableReason ?? (online ? "在线" : "离线"), machine.isLocal ? nil : "经由 \(computer.name)"].compactMap { $0 }.joined(separator: " · ")
    }
}

private struct TabletInboxPage: View {
    let state: TabletViewState
    let actions: TabletViewActions
    @State private var filter = "全部"

    private let filters = ["全部", "等待批准", "已完成待查看", "失败"]

    private var visibleItems: [TabletAttention] {
        guard filter != "全部" else { return state.attentions }
        let key = filter == "等待批准" ? "approval" : filter == "已完成待查看" ? "completed_review" : "failed"
        return state.attentions.filter { $0.type == key }
    }

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: "待处理", subtitle: "在这里处理需要批准、已完成和失败的工作。")
            Picker("筛选", selection: $filter) {
                ForEach(filters, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("inbox-filter")

            if visibleItems.isEmpty {
                TabletEmptyState(icon: "tray", title: "没有需要处理的事项", detail: "新的审批、完成项和失败记录会显示在这里。")
            } else {
                VStack(spacing: 12) {
                    ForEach(visibleItems) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            AttentionRow(item: item) {
                                if let conversationID = item.conversationID {
                                    actions.navigate(.conversation(computerID: item.computerID, conversationID: conversationID))
                                }
                            }
                            if let detail = item.detail {
                                Text(detail).font(.system(size: 14)).foregroundStyle(.secondary).padding(.horizontal, 16)
                            }
                            HStack(spacing: 10) {
                                if item.type == "approval" {
                                    if item.canApprove {
                                        Button("允许一次") { actions.approve(item.id, true) }
                                            .buttonStyle(TabletPrimaryButtonStyle())
                                        Button("拒绝") { actions.approve(item.id, false) }
                                            .buttonStyle(TabletSecondaryButtonStyle())
                                    } else {
                                        Text("此 AI 工具不支持远程批准")
                                            .font(.system(size: 13)).foregroundStyle(.secondary)
                                    }
                                } else {
                                    Button(item.type == "failed" ? "知道了" : "处理完成") { actions.resolveAttention(item.id) }
                                        .buttonStyle(TabletSecondaryButtonStyle())
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 16).padding(.bottom, 12)
                        }
                        .tabletCard()
                        .disabled(state.isBusy)
                    }
                }
            }
        }
        .refreshable { actions.refresh() }
    }
}

private struct TabletDevicesPage: View {
    let state: TabletViewState
    let actions: TabletViewActions

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: "设备", subtitle: "查看已连接的电脑和它们可以访问的设备。")
            if state.computers.isEmpty {
                TabletEmptyState(icon: "laptopcomputer", title: "还没有配对的电脑", detail: "输入电脑上显示的配对码。")
                Button("输入配对码") { actions.navigate(.settings) }.buttonStyle(TabletPrimaryButtonStyle())
            }
            ForEach(state.computers) { computer in
                TabletSectionTitle(title: computer.name, detail: computer.available ? "在线" : "离线")
                if computer.machines.isEmpty {
                    Text("暂时没有可用的设备").foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, alignment: .leading).tabletCard()
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(computer.machines.enumerated()), id: \.element.id) { index, machine in
                            if index > 0 { Divider().padding(.leading, 56) }
                            Button {
                                actions.navigate(.device(computerID: computer.id, machineID: machine.id))
                            } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: machine.isLocal ? "desktopcomputer" : "externaldrive.connected.to.line.below")
                                        .font(.system(size: 21)).frame(width: 28)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(machine.name).font(.system(size: 16, weight: .medium))
                                        Text(machine.isLocal ? machine.platform : "经由 \(computer.name) · \(machine.platform)")
                                            .font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer()
                                    StatusLabel(text: machine.unavailableReason ?? machineStatus(machine.status), color: machine.status == "online" || machine.status == "local" ? TabletColors.success : .secondary)
                                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                                }
                                .padding(.horizontal, 16).frame(minHeight: 64).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .tabletCard()
                }
            }
        }
        .refreshable { actions.refresh() }
    }
}

private struct TabletDevicePage: View {
    let state: TabletViewState
    let computerID: String
    let machineID: String
    let actions: TabletViewActions

    private var computer: TabletComputer? { state.computers.first { $0.id == computerID } }
    private var machine: TabletMachine? { computer?.machines.first { $0.id == machineID } }

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: machine?.name ?? "设备", subtitle: machine.map { "\($0.platform) · \(machineStatus($0.status))" })
            if let computer, let machine {
                if let reason = machine.unavailableReason {
                    TabletInlineNotice(text: reason, symbol: "exclamationmark.triangle")
                } else if !computer.available || !(machine.status == "online" || machine.status == "local") {
                    TabletInlineNotice(text: "这台电脑现在连不上，请确认它开着并且联网。", symbol: "wifi.slash")
                }
                TabletSectionTitle(title: "项目", count: machine.projects.count)
                if machine.projects.isEmpty {
                    Text("没有可用的项目").font(.system(size: 14)).foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, alignment: .leading).tabletCard()
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(machine.projects.enumerated()), id: \.element.id) { index, project in
                            if index > 0 { Divider().padding(.leading, 16) }
                            Button { actions.navigate(.project(computerID: computer.id, projectID: project.id)) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "folder").frame(width: 20)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(project.name).font(.system(size: 15, weight: .medium))
                                        if !project.available { Text("暂时无法访问").font(.system(size: 12)).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                    Text("\(project.sessions.count)").font(.system(size: 13)).foregroundStyle(.secondary)
                                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                                }
                                .padding(.horizontal, 16).frame(minHeight: 54).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(!project.available)
                        }
                    }
                    .tabletCard()
                }

                TabletSectionTitle(title: "最近的会话")
                let recent = machine.recent.filter { !$0.isArchived }.prefix(5)
                if recent.isEmpty {
                    Text("没有会话").font(.system(size: 14)).foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, alignment: .leading).tabletCard()
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(recent.enumerated()), id: \.element.id) { index, session in
                            if index > 0 { Divider().padding(.leading, 16) }
                            TabletConversationRow(session: session) {
                                actions.navigate(.conversation(computerID: computer.id, conversationID: session.id))
                            }
                        }
                    }
                    .tabletCard()
                }

                TabletSectionTitle(title: "AI 工具")
                VStack(spacing: 0) {
                    ForEach(Array(machine.providers.enumerated()), id: \.element.id) { index, provider in
                        if index > 0 { Divider().padding(.leading, 16) }
                        HStack(spacing: 12) {
                            Image(systemName: provider.id == "codex" ? "chevron.left.forwardslash.chevron.right" : "sparkle")
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(provider.name).font(.system(size: 15, weight: .medium))
                                Text(provider.unavailableReason ?? providerStatus(provider.status))
                                    .font(.system(size: 12)).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 16).frame(minHeight: 54)
                    }
                }
                .tabletCard()
            } else {
                TabletEmptyState(icon: "externaldrive", title: "设备不可用", detail: "请刷新后重试。")
            }
        }
        .refreshable { actions.refresh() }
    }
}

private struct TabletProjectPage: View {
    let state: TabletViewState
    let computerID: String
    let projectID: String
    let actions: TabletViewActions
    @State private var showArchived = false
    @State private var statusFilter = "全部"

    private let statusOptions = ["全部", "运行中", "等待批准", "已完成", "失败"]
    private var project: TabletProject? {
        state.computers.first(where: { $0.id == computerID })?.machines.flatMap(\.projects).first { $0.id == projectID }
    }
    private var sessions: [TabletConversationSummary] {
        guard let project else { return [] }
        let filtered = project.sessions.filter { $0.isArchived == showArchived }
        guard statusFilter != "全部" else { return filtered }
        let value: String = switch statusFilter {
        case "运行中": "running"
        case "等待批准": "waiting"
        case "已完成": "completed"
        default: "failed"
        }
        return filtered.filter { $0.status == value }
    }

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: project?.name ?? "项目", subtitle: machineName)
            Picker("会话范围", selection: $showArchived) {
                Text("会话").tag(false)
                Text("已归档").tag(true)
            }
            .pickerStyle(.segmented)
            Picker("状态", selection: $statusFilter) {
                ForEach(statusOptions, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("project-status-filter")
            if sessions.isEmpty {
                TabletEmptyState(icon: "bubble.left.and.bubble.right", title: "没有符合条件的会话", detail: "更改筛选条件后再查看。")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                        if index > 0 { Divider().padding(.leading, 16) }
                        TabletConversationRow(session: session) {
                            actions.navigate(.conversation(computerID: computerID, conversationID: session.id))
                        }
                    }
                }
                .tabletCard()
            }
        }
        .refreshable { actions.refresh() }
    }

    private var machineName: String? {
        guard let project else { return nil }
        return state.computers.first(where: { $0.id == computerID })?.machines.first(where: { $0.id == project.machineID })?.name
    }
}

private struct ConversationScrollBottomKey: PreferenceKey {
    static let defaultValue: CGFloat = .greatestFiniteMagnitude
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct TabletConversationPage: View {
    let state: TabletViewState
    let computerID: String
    let conversationID: String
    let actions: TabletViewActions
    let onShowChanges: () -> Void
    @FocusState private var composerFocused: Bool
    @State private var isAtBottom = true
    @State private var hasNewMessages = false
    @State private var scrollViewportHeight: CGFloat = 0
    @State private var showStopConfirmation = false
    @State private var scrollToBottomToken = 0

    private var draft: String { state.conversationDrafts[conversationID] ?? "" }
    private var draftBinding: Binding<String> {
        Binding(
            get: { state.conversationDrafts[conversationID] ?? "" },
            set: { actions.updateDraft(conversationID, $0) }
        )
    }

    private var detail: TabletConversationDetail? {
        guard state.activeConversation?.summary.id == conversationID else { return nil }
        return state.activeConversation
    }

    var body: some View {
        Group {
            if let detail {
                VStack(spacing: 0) {
                    GeometryReader { viewport in
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 14) {
                                HStack {
                                    Spacer()
                                    StatusLabel(text: conversationStatus(detail), color: statusColor(detail.summary.status))
                                    if detail.summary.isImported { StatusLabel(text: "已导入", color: .secondary) }
                                    Spacer()
                                }
                                .padding(.top, 12)

                                if let message = state.conversationConnectionMessage {
                                    TabletInlineNotice(text: message, symbol: "wifi.exclamationmark")
                                }

                                if let cursor = detail.olderCursor {
                                    Button("加载更早的会话") { actions.loadOlder(conversationID, cursor) }
                                        .buttonStyle(TabletSecondaryButtonStyle()).frame(maxWidth: .infinity)
                                }
                                ForEach(detail.messages) { message in
                                    TabletMessageRow(message: message)
                                        .id(message.id)
                                }
                                ForEach(detail.attentions.filter { $0.type == "approval" }) { item in
                                    TabletApprovalCard(item: item, canApprove: item.canApprove) { accepted in
                                        actions.approve(item.id, accepted)
                                    }
                                }
                                if let failure = detail.lastFailure {
                                    TabletFailureCard(message: failure)
                                }
                                Color.clear.frame(height: 1).id("bottom")
                                    .background(GeometryReader { geometry in
                                        Color.clear.preference(
                                            key: ConversationScrollBottomKey.self,
                                            value: geometry.frame(in: .named("conversation-scroll")).maxY
                                        )
                                    })
                            }
                            .frame(maxWidth: 760)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 18)
                        }
                        .coordinateSpace(name: "conversation-scroll")
                        .onPreferenceChange(ConversationScrollBottomKey.self) { bottom in
                            let atBottom = bottom <= scrollViewportHeight + 28
                            isAtBottom = atBottom
                            if atBottom { hasNewMessages = false }
                        }
                        .onChange(of: detail.messages.count) { _ in
                            if isAtBottom {
                                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                            } else {
                                hasNewMessages = true
                            }
                        }
                        .onChange(of: scrollToBottomToken) { _ in
                            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                        .onAppear {
                            scrollViewportHeight = viewport.size.height
                            DispatchQueue.main.async {
                                proxy.scrollTo("bottom", anchor: .bottom)
                                isAtBottom = true
                            }
                        }
                        .onChange(of: viewport.size.height) { height in
                            scrollViewportHeight = height
                        }
                    }
                    }

                    if hasNewMessages {
                        Button("有新消息 · 回到最新") {
                            hasNewMessages = false
                            isAtBottom = true
                            scrollToBottomToken &+= 1
                        }
                        .buttonStyle(TabletSecondaryButtonStyle())
                        .padding(.vertical, 6)
                    }

                    if let pending = state.pendingActions[.send(conversationID: conversationID)] {
                        HStack(spacing: 12) {
                            Text("上次发送结果尚未确认")
                                .font(.system(size: 13))
                                .foregroundStyle(TabletColors.failure)
                            Spacer(minLength: 4)
                            Button("使用原请求重试") {
                                actions.retryUncertainAction(pending.actionID)
                            }
                            .buttonStyle(TabletSecondaryButtonStyle())
                            .disabled(state.isBusy)
                            .accessibilityIdentifier("conversation-retry-uncertain")
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                    Divider()
                    HStack(alignment: .bottom, spacing: 10) {
                        TextField(composerPlaceholder(detail), text: draftBinding, axis: .vertical)
                            .lineLimit(1...5)
                            .focused($composerFocused)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(TabletColors.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .disabled(!detail.canSend || state.pendingActions[.send(conversationID: conversationID)] != nil)
                            .accessibilityIdentifier("conversation-composer")
                        if detail.isRunning, detail.canInterrupt, detail.currentTurnID != nil {
                            Button { showStopConfirmation = true } label: {
                                Image(systemName: "stop.fill").frame(width: 44, height: 44)
                            }
                            .buttonStyle(TabletIconButtonStyle())
                            .accessibilityLabel("停止")
                        } else {
                            Button { submit(detail) } label: {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(TabletColors.accent, in: Circle())
                            }
                            .buttonStyle(.plain)
                            .disabled(!detail.canSend || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state.pendingActions[.send(conversationID: conversationID)] != nil)
                            .opacity(!detail.canSend || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state.pendingActions[.send(conversationID: conversationID)] != nil ? 0.45 : 1)
                            .accessibilityLabel("发送")
                            .accessibilityIdentifier("conversation-send")
                            .keyboardShortcut(.return, modifiers: .command)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: 800)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial)
                }
                .background(TabletColors.grouped)
                .onAppear { composerFocused = false }
                .confirmationDialog("确认停止这轮工作？", isPresented: $showStopConfirmation) {
                    Button("停止", role: .destructive) {
                        if let turnID = detail.currentTurnID { actions.interrupt(conversationID, turnID) }
                    }
                    Button("取消", role: .cancel) { }
                } message: {
                    Text("停止后，这轮工作不会自动继续。")
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 40, coordinateSpace: .local).onEnded { value in
                        guard value.translation.width > 90,
                              abs(value.translation.height) < 80 else { return }
                        actions.navigate(.project(computerID: computerID, projectID: detail.summary.projectID))
                    }
                )
            } else {
                TabletEmptyState(icon: "arrow.triangle.2.circlepath", title: "正在读取会话…", detail: "会话历史会在连接可用后显示。")
            }
        }
    }

    private func submit(_ detail: TabletConversationDetail) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, detail.canSend,
              state.pendingActions[.send(conversationID: conversationID)] == nil else { return }
        actions.send(conversationID, text)
        composerFocused = true
    }

    private func composerPlaceholder(_ detail: TabletConversationDetail) -> String {
        if detail.summary.isArchived { return "此会话已归档" }
        if !detail.canSend { return "这台电脑暂时无法发送消息" }
        return "回复…"
    }
}

private struct TabletMessageRow: View {
    let message: TabletTimelineMessage

    var body: some View {
        switch message.kind {
        case .user:
            HStack {
                Spacer(minLength: 44)
                VStack(alignment: .leading, spacing: 6) {
                    Text(message.text).font(.system(size: 16)).foregroundStyle(.primary)
                    if !message.timestamp.isEmpty { Text(message.timestamp).font(.system(size: 11)).foregroundStyle(.secondary) }
                }
                .padding(14)
                .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        case .assistant:
            VStack(alignment: .leading, spacing: 6) {
                Text("CodeTether").font(.system(size: 13, weight: .semibold))
                Text(message.text).font(.system(size: 16)).textSelection(.enabled)
                if !message.timestamp.isEmpty { Text(message.timestamp).font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 5)
        case .activity:
            HStack(spacing: 8) {
                Image(systemName: "doc.text.magnifyingglass").foregroundStyle(.secondary)
                Text(message.text).font(.system(size: 14)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(TabletColors.secondaryCard, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct TabletApprovalCard: View {
    let item: TabletAttention
    let canApprove: Bool
    let onResolve: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("需要你批准", systemImage: "hand.raised.fill")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(TabletColors.waiting)
            Text(item.title).font(.system(size: 15, weight: .medium))
            if let detail = item.detail {
                Text(detail).font(.system(size: 13, design: .monospaced)).textSelection(.enabled)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
            if canApprove {
                HStack(spacing: 10) {
                    Button("允许一次") { onResolve(true) }.buttonStyle(TabletPrimaryButtonStyle())
                    Button("拒绝") { onResolve(false) }.buttonStyle(TabletSecondaryButtonStyle())
                }
            } else {
                Text("此 AI 工具不支持远程批准，请在电脑上处理。")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.orange.opacity(0.22)))
    }
}

private struct TabletFailureCard: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("这轮没有完成", systemImage: "exclamationmark.circle.fill")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(TabletColors.failure)
            Text(message).font(.system(size: 14)).foregroundStyle(.secondary)
            Text("已有的会话记录仍然保留。")
                .font(.system(size: 13)).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct TabletChangesPanel: View {
    let state: TabletViewState
    let onClose: () -> Void
    @State private var wrapsLines = true

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(spacing: 2) {
                    Text("变更").font(.system(size: 17, weight: .semibold))
                    let additions = state.changes.reduce(0) { $0 + $1.additions }
                    let deletions = state.changes.reduce(0) { $0 + $1.deletions }
                    Text("\(state.changes.count) 个文件 · +\(additions) −\(deletions)")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                Toggle("换行", isOn: $wrapsLines)
                    .toggleStyle(.switch)
                    .font(.system(size: 12))
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .medium)).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("关闭变更")
            }
            .padding(.horizontal, 14)
            .frame(height: 58)
            .background(.ultraThinMaterial)
            Divider()

            if state.changesLoading {
                ProgressView("正在读取变更…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if state.changes.isEmpty {
                TabletEmptyState(icon: "doc.text", title: "没有可显示的变更", detail: "此会话可能没有文件差异。")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(state.changes) { file in
                            VStack(alignment: .leading, spacing: 0) {
                                HStack(spacing: 8) {
                                    Image(systemName: "doc").font(.system(size: 14))
                                    Text(file.path).font(.system(size: 12, design: .monospaced)).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text("+\(file.additions)").foregroundStyle(TabletColors.success)
                                    Text("−\(file.deletions)").foregroundStyle(TabletColors.failure)
                                }
                                .padding(.horizontal, 12).frame(minHeight: 42)
                                .background(TabletColors.secondaryCard)
                                ForEach(file.lines) { line in
                                    HStack(spacing: 0) {
                                        Text(line.oldLine.map(String.init) ?? "")
                                            .frame(width: 36, alignment: .trailing)
                                        Text(line.newLine.map(String.init) ?? "")
                                            .frame(width: 36, alignment: .trailing)
                                        Text(line.text.isEmpty ? " " : line.text)
                                            .lineLimit(wrapsLines ? nil : 1)
                                            .fixedSize(horizontal: false, vertical: wrapsLines)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                    .font(.system(size: 11, design: .monospaced))
                                    .padding(.horizontal, 6).frame(minHeight: 20)
                                    .background(diffBackground(line.kind))
                                    .textSelection(.enabled)
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(TabletColors.separator.opacity(0.35)))
                        }
                    }
                    .padding(12)
                }
            }
        }
        .background(TabletColors.grouped)
        .overlay(alignment: .leading) { TabletColors.separator.opacity(0.55).frame(width: 0.5) }
    }

    private func diffBackground(_ kind: TabletDiffLine.Kind) -> Color {
        switch kind {
        case .added: Color.green.opacity(0.14)
        case .removed: Color.red.opacity(0.13)
        case .header: Color.blue.opacity(0.08)
        case .context: .clear
        }
    }
}

private struct TabletSettingsPage: View {
    let state: TabletViewState
    let actions: TabletViewActions
    let present: (TabletSheet) -> Void

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(title: "设置")
            TabletSectionTitle(title: "账号")
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.email).font(.system(size: 15, weight: .medium))
                    Text("已登录").font(.system(size: 12)).foregroundStyle(.secondary)
                }
                Spacer()
                Button("退出登录", role: .destructive, action: actions.signOut)
                    .font(.system(size: 14, weight: .medium)).frame(minHeight: 44)
            }
            .padding(.horizontal, 16).tabletCard()

            TabletSectionTitle(title: "可以使用的电脑")
            VStack(spacing: 0) {
                if state.computers.isEmpty {
                    Text("还没有配对的电脑").font(.system(size: 14)).foregroundStyle(.secondary)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(Array(state.computers.enumerated()), id: \.element.id) { index, computer in
                    if index > 0 { Divider().padding(.leading, 16) }
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(computer.name).font(.system(size: 15, weight: .medium))
                            Text("\(computer.platform) · 上次使用 \(computer.lastUsed)")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 6)
                        Button("移除", role: .destructive) { present(.removeComputer(computer.id)) }
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 12).frame(minHeight: 44)
                            .background(Color.red.opacity(0.08), in: Capsule())
                            .accessibilityIdentifier("remove-computer-\(computer.id)")
                    }
                    .padding(.horizontal, 16).frame(minHeight: 62)
                }
            }
            .tabletCard()
            Button("输入配对码") { present(.pair) }
                .font(.system(size: 14, weight: .medium)).foregroundStyle(TabletColors.link)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)

            TabletSectionTitle(title: "外观")
            Picker("外观", selection: Binding(get: { state.appearance }, set: actions.setAppearance)) {
                ForEach(TabletAppearance.allCases) { appearance in Text(appearance.rawValue).tag(appearance) }
            }
            .pickerStyle(.segmented)

            TabletSectionTitle(title: "关于")
            VStack(spacing: 0) {
                Button {
                    actions.navigate(.connectionCheck)
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("连接检查").font(.system(size: 15, weight: .medium))
                            Text("查看每台电脑现在是否连得上").font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 62)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("connection-check-row")
            }
            .tabletCard()

            TabletSectionTitle(title: "后续规划")
            VStack(spacing: 0) {
                RoadmapRow(title: "浏览和添加项目", detail: "远程文件夹选择尚未开放")
                Divider().padding(.leading, 16)
                RoadmapRow(title: "导入以前的会话", detail: "会话发现与导入尚未开放")
                Divider().padding(.leading, 16)
                RoadmapRow(title: "项目内搜索和整理", detail: "置顶、重命名和恢复尚未开放")
                Divider().padding(.leading, 16)
                RoadmapRow(title: "通知与后台保持连接", detail: "需要后续的服务端推送支持")
            }
            .tabletCard()
        }
    }
}

private struct TabletConnectionPage: View {
    let state: TabletViewState
    let mode: TabletConnectionMode
    let onMode: (TabletConnectionMode) -> Void
    let onRefresh: () -> Void

    var body: some View {
        TabletPageScroll {
            TabletPageTitle(
                title: "连接检查",
                subtitle: "连接是自动的：同一网络里直接连，不在一起时经互联网连接。"
            )
            VStack(spacing: 0) {
                if state.computers.isEmpty {
                    Text("还没有可以检查的电脑")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(Array(state.computers.enumerated()), id: \.element.id) { index, computer in
                        if index > 0 { Divider().padding(.leading, 16) }
                        ConnectionComputerRow(computer: computer, transport: state.connectionTransport)
                    }
                }
            }
            .tabletCard()

            #if DEBUG
            VStack(alignment: .leading, spacing: 10) {
                LabeledContent("连接方式") {
                    Picker("连接方式", selection: Binding(get: { mode }, set: onMode)) {
                        ForEach(TabletConnectionMode.allCases) { item in Text(item.rawValue).tag(item) }
                    }
                    .labelsHidden()
                    .fixedSize()
                    .disabled(state.isCheckingConnection)
                }
                Divider()
                DiagnosticRow(label: "状态", value: state.connectionStatus.isEmpty ? "等待检查" : state.connectionStatus)
                DiagnosticRow(label: "传输", value: state.connectionTransport.isEmpty ? "未连接" : state.connectionTransport)
                if !state.connectionDiagnostic.isEmpty {
                    DiagnosticRow(label: "诊断", value: state.connectionDiagnostic)
                }
                Button(action: onRefresh) {
                    HStack(spacing: 8) {
                        if state.isCheckingConnection { ProgressView().controlSize(.small) }
                        Text(state.isCheckingConnection ? "检查中" : "重新检查")
                    }
                }
                    .buttonStyle(TabletSecondaryButtonStyle())
                    .disabled(state.isCheckingConnection)
                    .accessibilityLabel(state.isCheckingConnection ? "正在检查连接" : "重新检查连接")
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(16)
            .tabletCard()
            #else
            Button(action: onRefresh) {
                HStack(spacing: 8) {
                    if state.isCheckingConnection { ProgressView().controlSize(.small) }
                    Text(state.isCheckingConnection ? "检查中" : "重新检查")
                }
            }
            .buttonStyle(TabletSecondaryButtonStyle())
            .disabled(state.isCheckingConnection)
            .accessibilityLabel(state.isCheckingConnection ? "正在检查连接" : "重新检查连接")
            .frame(maxWidth: .infinity, alignment: .leading)
            #endif
            Text("连接状态只用于检查，不会显示密钥或连接凭据。")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
        }
    }
}

private struct ConnectionComputerRow: View {
    let computer: TabletComputer
    let transport: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(computer.name)
                    .font(.system(size: 15, weight: .medium))
                Text(routeDescription)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text(computer.available ? "已连接" : "离线")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(computer.available ? TabletColors.success : .secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    (computer.available ? TabletColors.success : Color.secondary).opacity(0.12),
                    in: Capsule()
                )
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 62)
    }

    private var routeDescription: String {
        guard computer.available else { return "连不上 · 最近曾在线" }
        switch transport {
        case "relay": return "经互联网连接"
        case "direct": return "同一网络，直接连接"
        default: return "已连接"
        }
    }
}

private struct DiagnosticRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.system(size: 13)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).font(.system(size: 13, weight: .medium)).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
    }
}

private struct RoadmapRow: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "hourglass").foregroundStyle(.secondary).frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 14, weight: .medium))
                Text(detail).font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).frame(minHeight: 58)
    }
}

private struct TabletSignInPage: View {
    let state: TabletViewState
    let actions: TabletViewActions
    @State private var email = ""
    @State private var code = ""

    var body: some View {
        ZStack {
            TabletColors.grouped.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary)
                        Text(">_").font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundStyle(Color(uiColor: .systemBackground))
                    }
                    .frame(width: 42, height: 42)
                    Text("CodeTether").font(.system(size: 26, weight: .bold))
                }
                Text("登录")
                    .font(.system(size: 32, weight: .bold))
                    .padding(.top, 18)
                Text("使用已有账号登录。验证码将发送到你的邮箱。")
                    .font(.system(size: 15)).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 12) {
                    TextField("邮箱", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(state.isBusy || state.codeRequested)
                        .padding(14).background(TabletColors.secondaryCard, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityIdentifier("signin-email")
                    if state.codeRequested {
                        TextField("邮箱验证码", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .padding(14).background(TabletColors.secondaryCard, in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("signin-code")
                    }
                    if let error = state.errorMessage {
                        Text(error).font(.system(size: 13)).foregroundStyle(TabletColors.failure)
                    }
                    Button(state.codeRequested ? "验证并登录" : "发送验证码") {
                        if state.codeRequested { actions.verifySignInCode(state.email, code) }
                        else { actions.requestSignInCode(email) }
                    }
                    .buttonStyle(TabletPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(state.isBusy || (state.codeRequested ? code.isEmpty : email.isEmpty))
                    .accessibilityIdentifier("signin-submit")
                    if state.codeRequested {
                        HStack {
                            Button("重新发送验证码") { actions.requestSignInCode(state.email) }
                                .accessibilityIdentifier("signin-resend")
                            Spacer()
                            Button("更换邮箱") { actions.resetSignInCode() }
                                .accessibilityIdentifier("signin-change-email")
                        }
                        .disabled(state.isBusy)
                    }
                }
                .padding(18).tabletCard()
            }
            .frame(maxWidth: 560)
            .padding(24)
        }
        .onChange(of: state.codeRequested) { requested in
            if requested { email = state.email }
            else { code = "" }
        }
    }
}

private struct TabletRemovedPage: View {
    let computerName: String
    let onPair: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "laptopcomputer.and.iphone.slash")
                .font(.system(size: 40, weight: .regular)).foregroundStyle(.secondary)
            Text("这台电脑已移除这台 iPad")
                .font(.system(size: 26, weight: .bold)).multilineTextAlignment(.center)
            if !computerName.isEmpty {
                Text(computerName).font(.system(size: 16)).foregroundStyle(.secondary)
            }
            Text("重新输入电脑上的配对码即可再次连接。电脑上正在运行的工作不受影响。")
                .font(.system(size: 15)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("重新配对", action: onPair).buttonStyle(TabletPrimaryButtonStyle()).frame(maxWidth: 260)
        }
        .frame(maxWidth: 520).padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TabletColors.grouped)
    }
}

private struct TabletSheetContent: View {
    let sheet: TabletSheet
    @ObservedObject var model: TabletAppModel
    let dismiss: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .pair:
                    PairingSheet(state: model.state, actions: model.actions)
                case .createSession(let projectID):
                    NewSessionSheet(model: model, dismiss: dismiss, preferredProjectID: projectID)
                case .search:
                    SearchSheet(state: model.state, actions: model.actions, dismiss: dismiss)
                case .removeComputer(let id):
                    RemoveComputerSheet(computer: model.state.computers.first { $0.id == id }, actions: model.actions, dismiss: dismiss)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成", action: dismiss)
                        .fontWeight(.semibold)
                        .keyboardShortcut(.escape, modifiers: [])
                }
            }
        }
        .frame(maxWidth: 720)
        .background(TabletColors.grouped)
    }
}

private struct PairingSheet: View {
    let state: TabletViewState
    let actions: TabletViewActions
    @State private var code = ""

    var body: some View {
        Form {
            Section {
                Text("输入电脑上显示的 6 位配对码。配对码只能使用一次，且会在 5 分钟后失效。")
                    .font(.system(size: 15)).foregroundStyle(.secondary)
                TextField("000 000", text: $code)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("pairing-code")
            }
            if let message = state.pairingMessage {
                Section { Text(message).foregroundStyle(TabletColors.failure) }
            }
            Section {
                Button(state.isPairing ? "正在连接…" : "连接电脑") {
                    if let value = normalizedPairingCode(code) { actions.pair(value) }
                }
                    .buttonStyle(TabletPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(state.isPairing || normalizedPairingCode(code) == nil)
                    .accessibilityIdentifier("pairing-submit")
                if state.isPairing {
                    Button("取消等待") { actions.cancelPair() }
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("pairing-cancel")
                }
            }
        }
        .navigationTitle("输入配对码")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NewSessionSheet: View {
    @ObservedObject var model: TabletAppModel
    let dismiss: () -> Void
    let preferredProjectID: String?
    @State private var selectedProjectID = ""
    @State private var selectedProviderID = ""
    @State private var selectedReasoningID = ""
    @State private var initialInput = ""
    @State private var didSubmit = false

    private var state: TabletViewState { model.state }
    private var actions: TabletViewActions { model.actions }

    private var displayedErrorMessage: String? {
        state.createSessionErrorMessage
    }

    private var projects: [TabletProjectChoice] {
        state.computers.flatMap { computer in
            computer.machines.flatMap { machine in
                machine.projects.map { TabletProjectChoice(computer: computer, machine: machine, project: $0) }
            }
        }
    }
    private var selectedTuple: TabletProjectChoice? {
        projects.first { $0.project.id == selectedProjectID }
    }
    private var providers: [TabletProvider] { selectedTuple?.machine.providers ?? [] }
    private var selectedProvider: TabletProvider? { providers.first { $0.id == selectedProviderID } }
    private var pendingCreate: TabletPendingAction? {
        state.pendingActions[.create(projectID: selectedProjectID)]
    }

    var body: some View {
        Form {
            if let error = displayedErrorMessage {
                Section {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(TabletColors.failure)
                        .accessibilityLabel(error)
                        .accessibilityAddTraits(.isStaticText)
                        .accessibilityIdentifier("new-session-error")
                }
            }
            Section("项目") {
                if projects.isEmpty {
                    Text("没有可用的项目").foregroundStyle(.secondary)
                } else {
                    Picker("项目", selection: $selectedProjectID) {
                        Text("选择项目").tag("")
                        ForEach(projects) { choice in
                            Text("\(choice.project.name) · \(choice.computer.name)")
                                .tag(choice.project.id)
                                .disabled(!choice.project.available || !choice.computer.available || !(choice.machine.status == "online" || choice.machine.status == "local"))
                        }
                    }
                    .accessibilityIdentifier("new-session-project")
                    .disabled(state.pendingActions.values.contains(where: { $0.operation == .createConversation }))
                }
            }
            Section("AI 工具") {
                if providers.isEmpty {
                    Text(selectedProjectID.isEmpty ? "先选择一个项目" : "没有可用的 AI 工具")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(providers) { provider in
                        Button {
                            selectedProviderID = provider.id
                            selectedReasoningID = provider.reasoningOptions.first?.id ?? ""
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: selectedProviderID == provider.id ? "largecircle.fill.circle" : "circle")
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(provider.name).foregroundStyle(.primary)
                                    if !provider.canStart {
                                        Text(provider.unavailableReason ?? providerStatus(provider.status))
                                            .font(.system(size: 12)).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(!provider.canStart || pendingCreate != nil)
                    }
                }
                if let selectedProvider, !selectedProvider.reasoningOptions.isEmpty {
                    Picker("思考强度", selection: $selectedReasoningID) {
                        ForEach(selectedProvider.reasoningOptions) { option in Text(option.name).tag(option.id) }
                    }
                    .disabled(pendingCreate != nil)
                }
            }
            Section("第一句话") {
                TextField("输入要开始的内容", text: $initialInput, axis: .vertical)
                    .lineLimit(4...8)
                    .disabled(pendingCreate != nil)
                    .accessibilityIdentifier("new-session-input")
            }
            Section {
                if let pendingCreate {
                    Button("使用原请求重试") {
                        didSubmit = true
                        actions.retryUncertainAction(pendingCreate.actionID)
                    }
                    .buttonStyle(TabletPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(state.isBusy)
                    .accessibilityIdentifier("new-session-retry-uncertain")
                } else {
                    Button(displayedErrorMessage != nil ? "重试创建" : "创建会话") {
                        let input = initialInput.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !selectedProjectID.isEmpty, let provider = selectedProvider, provider.canStart, !input.isEmpty else { return }
                        didSubmit = true
                        actions.createConversation(selectedProjectID, provider.id, selectedReasoningID.isEmpty ? nil : selectedReasoningID, input)
                    }
                    .buttonStyle(TabletPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(selectedProjectID.isEmpty || selectedProvider?.canStart != true || initialInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || pendingCreate != nil)
                    .accessibilityIdentifier("new-session-create")
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
        }
        .navigationTitle("新建会话")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: state.route) { route in
            // Keep all fields visible until the Host confirms creation. A route
            // change is the success signal; failures leave this sheet open.
            guard didSubmit else { return }
            if case .conversation = route { dismiss() }
        }
        .onAppear {
            if let pending = state.pendingActions.values.first(where: { $0.operation == .createConversation }) {
                selectedProjectID = pending.projectID
                selectedProviderID = pending.provider ?? ""
                selectedReasoningID = pending.reasoning ?? ""
                initialInput = pending.input
                didSubmit = true
            }
            if selectedProjectID.isEmpty {
                let choice = preferredProjectID.flatMap { preferred in
                    projects.first(where: { $0.project.id == preferred && $0.project.available && $0.computer.available })
                } ?? projects.first(where: { $0.project.available && $0.computer.available })
                if let choice {
                    // Select the provider from the same choice so this first
                    // render does not briefly leave the create button disabled
                    // while the Picker state is settling.
                    selectedProjectID = choice.project.id
                    if selectedProviderID.isEmpty, let first = choice.machine.providers.first(where: \.canStart) {
                        selectedProviderID = first.id
                        selectedReasoningID = first.reasoningOptions.first?.id ?? ""
                    }
                }
            }
            if selectedProviderID.isEmpty, let first = providers.first(where: \.canStart) {
                selectedProviderID = first.id
                selectedReasoningID = first.reasoningOptions.first?.id ?? ""
            }
        }
        .onChange(of: selectedProjectID) { _ in
            guard pendingCreate == nil else { return }
            selectedProviderID = providers.first(where: \.canStart)?.id ?? ""
            selectedReasoningID = selectedProvider?.reasoningOptions.first?.id ?? ""
        }
    }
}

private func normalizedPairingCode(_ value: String) -> String? {
    let code = value.filter { !$0.isWhitespace }
    guard code.count == 6,
          code.unicodeScalars.allSatisfy({ (48...57).contains($0.value) }) else {
        return nil
    }
    return code
}

private struct SearchSheet: View {
    let state: TabletViewState
    let actions: TabletViewActions
    let dismiss: () -> Void
    @State private var query = ""

    private var matching: [TabletConversationSummary] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return state.searchResults }
        return state.searchResults.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("搜索已读取的会话标题", text: $query)
                    .submitLabel(.search)
                    .onChange(of: query) { value in actions.search(value) }
                    .accessibilityIdentifier("session-search-field")
                if !query.isEmpty {
                    Button { query = ""; actions.search("") } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain).accessibilityLabel("清空搜索")
                }
            }
            .padding(14)
            Divider()
            if matching.isEmpty {
                TabletEmptyState(icon: "magnifyingglass", title: query.isEmpty ? "搜索会话" : "没有匹配的会话", detail: "只会搜索已经读取的会话标题。")
            } else {
                List(matching) { session in
                    Button {
                        actions.navigate(.conversation(computerID: session.computerID, conversationID: session.id))
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.title).font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
                            Text("\(session.machineName) › \(session.projectName) · \(session.providerName)")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("search-result-\(session.id)")
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("搜索会话")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct RemoveComputerSheet: View {
    let computer: TabletComputer?
    let actions: TabletViewActions
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "laptopcomputer.and.iphone").font(.system(size: 34)).foregroundStyle(.secondary)
            Text("移除这台电脑？").font(.system(size: 24, weight: .bold))
            Text("移除后，\(computer?.name ?? "这台电脑") 会立刻断开。要再次使用，需要在电脑上重新生成配对码。电脑上正在运行的工作不受影响。")
                .font(.system(size: 15)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("移除电脑", role: .destructive) {
                if let computer { actions.removeComputer(computer.id) }
                dismiss()
            }
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: 300, minHeight: 48)
            .background(Color.red.opacity(0.10), in: Capsule())
            Button("取消", action: dismiss).buttonStyle(TabletSecondaryButtonStyle()).frame(maxWidth: 300)
        }
        .padding(28)
        .frame(maxWidth: 500, maxHeight: .infinity)
        .frame(maxWidth: .infinity)
        .background(TabletColors.grouped)
    }
}

private struct TabletPageScroll<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                content
            }
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.top, 16)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.visible)
    }
}

private struct TabletPageTitle: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 32, weight: .bold)).lineLimit(2).minimumScaleFactor(0.85)
            if let subtitle {
                Text(subtitle).font(.system(size: 15)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 6)
    }
}

private struct TabletSectionTitle: View {
    let title: String
    var count: Int? = nil
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.system(size: 16, weight: .semibold))
            if let count { Text("\(count)").font(.system(size: 13)).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
            if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 4)
        .padding(.top, 3)
    }
}

private struct TabletConversationRow: View {
    let session: TabletConversationSummary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle().fill(statusColor(session.status)).frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.title).font(.system(size: 15, weight: .medium)).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 4) {
                        Text(session.providerName).fontWeight(.semibold)
                        Text("·")
                        Text(session.projectName)
                        Text("·")
                        Text(sessionStatus(session))
                    }
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(session.lastActivity).font(.system(size: 12)).foregroundStyle(.tertiary).lineLimit(1)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).frame(minHeight: 66).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("conversation-row-\(session.id)")
    }
}

private struct AttentionRow: View {
    let item: TabletAttention
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Circle().fill(attentionColor(item.type)).frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.system(size: 15, weight: .medium)).multilineTextAlignment(.leading).lineLimit(2)
                    Text("\(item.computerName) · \(item.projectName) · \(attentionLabel(item.type))")
                        .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16).frame(minHeight: 62).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct StatusLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text).font(.system(size: 12, weight: .semibold)).foregroundStyle(color)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(color.opacity(0.10), in: Capsule())
    }
}

private struct TabletEmptyState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30, weight: .regular)).foregroundStyle(.secondary)
            Text(title).font(.system(size: 17, weight: .semibold)).multilineTextAlignment(.center)
            Text(detail).font(.system(size: 14)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(28).tabletCard()
    }
}

private struct TabletInlineNotice: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.system(size: 14)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(TabletColors.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct TabletPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 18)
            .frame(minHeight: 46)
            .foregroundStyle(Color(uiColor: .systemBackground))
            .background(Color.primary, in: Capsule())
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

private struct TabletSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .foregroundStyle(.primary)
            .background(Color.primary.opacity(0.07), in: Capsule())
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

private struct TabletIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.primary)
            .background(Color.primary.opacity(configuration.isPressed ? 0.12 : 0.07), in: Circle())
    }
}

private extension View {
    func tabletCard() -> some View {
        background(TabletColors.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "running", "starting": TabletColors.running
    case "waiting", "approval": TabletColors.waiting
    case "completed": TabletColors.success
    case "failed", "interrupted": TabletColors.failure
    default: .secondary
    }
}

private func attentionColor(_ type: String) -> Color {
    switch type {
    case "approval": TabletColors.waiting
    case "completed_review": TabletColors.success
    default: TabletColors.failure
    }
}

private func attentionLabel(_ type: String) -> String {
    switch type {
    case "approval": "等待批准"
    case "completed_review": "已完成待查看"
    default: "失败"
    }
}

private func machineStatus(_ status: String) -> String {
    switch status {
    case "online", "local": "在线"
    case "offline": "离线"
    case "authentication_required": "需要登录"
    default: "暂时不可用"
    }
}

private func providerStatus(_ status: String) -> String {
    switch status {
    case "available": "可用"
    case "not_installed": "尚未安装，请在电脑上处理"
    case "misconfigured", "unauthenticated": "请先在电脑上登录"
    case "unsupported_version": "版本不支持，请在电脑上检查"
    default: "暂时不可用"
    }
}

private func sessionStatus(_ session: TabletConversationSummary) -> String {
    if session.isArchived { return "已归档" }
    return switch session.status {
    case "running", "starting": "运行中"
    case "waiting": "等待批准"
    case "completed": "已完成"
    case "failed": "失败"
    default: "\(session.status)"
    }
}

private func conversationStatus(_ detail: TabletConversationDetail) -> String {
    if detail.summary.isArchived { return "已归档" }
    return switch detail.summary.status {
    case "running", "starting": "运行中"
    case "waiting": "等待批准"
    case "completed": "已完成"
    case "failed": "失败"
    default: detail.summary.status
    }
}
