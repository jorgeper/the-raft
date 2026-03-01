import SwiftUI

enum RecordingState {
    case idle, recording, paused
}

struct ContentView: View {
    var onBack: (() -> Void)? = nil
    @EnvironmentObject private var model: ContentViewModel
    @StateObject private var tester = TestConversationPlayer()
    @State private var showingSettings = false

    var body: some View {
        VStack(spacing: 0) {
            // Compact header with controls and speaker bubbles
            HStack(alignment: .center) {
                // Remove non-functional chevron; leave space for Back title (parent supplies navigation)
                Button(action: { onBack?() }) {
                    Text("Back")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(Color.blue)
                }
                .padding(.leading, 16)

                Spacer()

                // Speaker avatar cloud in the center
                SpeakerCloudView(speakers: model.transcriptItems.map { $0.speaker }, known: model.knownSpeakers)
                    .frame(maxWidth: 200)

                Spacer()

                // Text buttons (blue for start, red for stop)
                HStack(spacing: 16) {
                    Button(action: { model.startStop() }) {
                        Text(model.recordingState == .recording ? "Stop" : "Start")
                            .foregroundColor(model.recordingState == .recording ? .red : .blue)
                            .font(.system(size: 16, weight: .semibold))
                    }
                    Button(action: toggleTest) {
                        Text(tester.isRunning ? "Stop test" : "Start test")
                            .foregroundColor(.blue)
                            .font(.system(size: 16, weight: .semibold))
                    }
                }
                .padding(.trailing, 12)
            }
            .frame(height: 56)
            .padding(.vertical, 8)
            .background(Color(UIColor.systemBackground))
            .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 2)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        let avatarSize: CGFloat = 28
                        let avatarLeading: CGFloat = 14
                        let bubbleSpacing: CGFloat = 6
                        let labelIndent: CGFloat = avatarLeading + avatarSize + bubbleSpacing
                        let enumerated = Array(model.transcriptItems.enumerated())
                        ForEach(enumerated, id: \.element.id) { index, item in
                            let isSameAsPrevious = index > 0 && model.transcriptItems[index - 1].speaker == item.speaker
                            let isLastOfRun = index == model.transcriptItems.count - 1 || model.transcriptItems[index + 1].speaker != item.speaker

                            VStack(alignment: .leading, spacing: isSameAsPrevious ? 4 : 8) {
                                if !isSameAsPrevious {
                                    Text(item.speaker)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                        .padding(.leading, labelIndent)
                                        .padding(.trailing, 16)
                                }
                                HStack(alignment: .bottom, spacing: bubbleSpacing) {
                                    if isLastOfRun {
                                        SpeakerAvatarView(name: item.speaker, known: model.knownSpeakers)
                                            .frame(width: avatarSize, height: avatarSize)
                                            .padding(.leading, avatarLeading)
                                            .padding(.bottom, 2)
                                    } else {
                                        Color.clear.frame(width: avatarSize, height: avatarSize)
                                            .padding(.leading, avatarLeading)
                                    }
                                    Text(item.text)
                                        .font(.system(.body, design: .rounded))
                                        .padding(.vertical, 12)
                                        .padding(.leading, 18)
                                        .padding(.trailing, 12)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .background(
                                            LeftBubbleShape(cornerRadius: 18, tailSize: 8)
                                                .fill(Color(UIColor.secondarySystemBackground))
                                        )
                                        .overlay(
                                            LeftBubbleShape(cornerRadius: 18, tailSize: 8)
                                                .stroke(Color(UIColor.separator).opacity(0.6), lineWidth: 0.5)
                                        )
                                    .padding(.trailing, 16)
                                    .id(item.id)
                                }
                            }
                            .padding(.top, isSameAsPrevious ? 4 : 12)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
                }
                .onChange(of: model.transcriptItems) { items in
                    guard let last = items.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .background(Color(UIColor.systemBackground))
        }
        .background(Color(UIColor.secondarySystemBackground))
        .onAppear { model.onAppear() }
        .sheet(isPresented: $showingSettings) {
            SettingsView(speakers: $model.knownSpeakers)
        }
        .alert("Error", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var iconName: String {
        switch model.recordingState {
        case .idle: return "record.circle.fill"
        case .recording: return "pause.circle.fill"
        case .paused: return "stop.circle.fill"
        }
    }

    private var buttonColor: Color {
        switch model.recordingState {
        case .idle: return .red
        case .recording: return .orange
        case .paused: return .blue
        }
    }
}

private extension ContentView {
    func toggleTest() {
        if tester.isRunning {
            tester.stop()
        } else {
            tester.start()
        }
    }
}


