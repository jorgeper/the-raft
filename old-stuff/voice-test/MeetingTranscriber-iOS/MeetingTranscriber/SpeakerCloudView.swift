import SwiftUI

struct SpeakerCloudView: View {
    let speakers: [String]
    let known: [KnownSpeaker]

    var body: some View {
        let filtered = speakers.filter { !$0.isEmpty && $0 != "Speaker ?" }
        let counts = Dictionary(filtered.map { ($0, 1) }, uniquingKeysWith: +)
        // Preserve order of first appearance so avatars don't jump around
        let order = orderedUnique(from: speakers)
        let unique = order.filter { counts.keys.contains($0) }

        // Sort by contribution (most active first)
        let indexMap = Dictionary(unique.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let ranked = unique.sorted { a, b in
            let ca = counts[a] ?? 0
            let cb = counts[b] ?? 0
            if ca != cb { return ca > cb }
            return (indexMap[a] ?? 0) < (indexMap[b] ?? 0)
        }

        GeometryReader { geo in
            let layout = buildIMessageLayout(speakers: ranked, counts: counts, totalWidth: geo.size.width, totalHeight: geo.size.height)
            ZStack {
                ForEach(Array(layout.enumerated()), id: \.offset) { _, item in
                    SpeakerAvatarView(name: item.name, known: known)
                        .frame(width: item.size, height: item.size)
                        .position(x: geo.size.width/2 + item.x, y: geo.size.height/2 + item.y)
                        .zIndex(item.z)
                        .shadow(color: Color.black.opacity(0.1), radius: 2, x: 0, y: 1)
                }
            }
        }
        .frame(height: 44)
    }

    private func sizeForSpeaker(count: Int, totalCount: Int, rank: Int, totalSpeakers: Int) -> CGFloat {
        // Simpler sizing with smaller range for compact header
        let maxSize: CGFloat = 36
        let minSize: CGFloat = 24
        
        // Calculate relative contribution (0-1)
        let contribution = CGFloat(count) / CGFloat(max(totalCount, 1))
        
        // Apply exponential scaling for more dramatic size differences
        let scaleFactor = pow(contribution, 0.8)
        
        // Also consider rank (first speaker gets small bonus)
        let rankBonus: CGFloat = rank == 0 ? 1.1 : 1.0
        
        let size = minSize + (maxSize - minSize) * scaleFactor * rankBonus
        return min(max(size, minSize), maxSize)
    }

    private struct LayoutItem { let name: String; let size: CGFloat; let x: CGFloat; let y: CGFloat; let z: Double }

    private func buildIMessageLayout(speakers: [String], counts: [String: Int], totalWidth: CGFloat, totalHeight: CGFloat) -> [LayoutItem] {
        guard !speakers.isEmpty else { return [] }
        
        var items: [LayoutItem] = []
        let totalCount = counts.values.reduce(0, +)
        
        // Calculate sizes for all speakers
        let speakerSizes = speakers.enumerated().map { index, speaker in
            (speaker, sizeForSpeaker(count: counts[speaker] ?? 0, totalCount: totalCount, rank: index, totalSpeakers: speakers.count))
        }
        
        // Simple horizontal layout with alternating y positions
        let spacing: CGFloat = 4
        
        // Calculate total width properly
        let totalBubblesWidth = speakerSizes.map { $0.1 }.reduce(0, +) + CGFloat(speakers.count - 1) * spacing
        
        // Start position to center the group
        var currentX = -totalBubblesWidth / 2
        
        for (index, (speaker, size)) in speakerSizes.enumerated() {
            // Alternate y position slightly for visual interest
            let yOffset: CGFloat = index % 2 == 0 ? -3 : 3
            
            // Position bubble center
            currentX += size / 2
            items.append(LayoutItem(
                name: speaker,
                size: size,
                x: currentX,
                y: yOffset,
                z: Double(speakers.count - index)
            ))
            
            // Move to next position
            currentX += size / 2 + spacing
        }
        
        // Scale to fit if needed
        let maxX = items.map { abs($0.x) + $0.size/2 }.max() ?? 0
        
        if maxX * 2 > totalWidth {
            let scale = (totalWidth - 40) / (maxX * 2)
            return items.map { LayoutItem(name: $0.name, size: $0.size * scale, x: $0.x * scale, y: $0.y, z: $0.z) }
        }
        
        return items
    }

    private func orderedUnique(from list: [String]) -> [String] {
        var seen: Set<String> = []
        var out: [String] = []
        for s in list where s != "Speaker ?" {
            if !seen.contains(s) { seen.insert(s); out.append(s) }
        }
        return out
    }
}

