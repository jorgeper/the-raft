import SwiftUI

struct SettingsView: View {
    @Binding var speakers: [KnownSpeaker]
    @Environment(\ .dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                ForEach($speakers) { $speaker in
                    HStack(spacing: 12) {
                        TextField("First name", text: $speaker.firstName)
                        TextField("Last name", text: $speaker.lastName)
                        TextField("Avatar (emoji)", text: $speaker.avatarSymbol)
                            .frame(width: 80)
                        TextField("Color hex", text: $speaker.colorHex)
                            .frame(width: 110)
                    }
                }
                .onDelete { speakers.remove(atOffsets: $0) }

                Button {
                    speakers.append(KnownSpeaker(firstName: "New", lastName: "Speaker", avatarSymbol: "🙂"))
                } label: {
                    Label("Add Speaker", systemImage: "plus.circle.fill")
                }
            }
            .navigationTitle("Speakers")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

