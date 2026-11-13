import SwiftUI

/// 7×24 activity heatmap (spec §7.3): day-of-week × hour, cell intensity =
/// egress volume. Pure drawing over a plain grid, so it can be rendered and
/// verified without the surrounding window.
struct HeatmapGrid: View {
    let grid: [[Int]]

    private let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    private var peak: Int {
        grid.flatMap { $0 }.max() ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 2) {
                Text("").frame(width: 30)
                ForEach(0..<24, id: \.self) { hour in
                    Text(hour % 6 == 0 ? "\(hour)" : "")
                        .font(.system(size: 8))
                        .foregroundStyle(.tertiary)
                        .frame(width: 16)
                }
            }
            ForEach(0..<7, id: \.self) { day in
                HStack(spacing: 2) {
                    Text(days[day])
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .leading)
                    ForEach(0..<24, id: \.self) { hour in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(color(day: day, hour: hour))
                            .frame(width: 16, height: 16)
                            .help(help(day: day, hour: hour))
                    }
                }
            }
        }
    }

    private func color(day: Int, hour: Int) -> Color {
        guard grid.count == 7, grid[day].count == 24, peak > 0 else {
            return Color.gray.opacity(0.08)
        }
        let value = grid[day][hour]
        guard value > 0 else { return Color.gray.opacity(0.08) }
        // Log scale: one busy hour shouldn't flatten everything else to nothing.
        let intensity = log(Double(value) + 1) / log(Double(peak) + 1)
        return Color.accentColor.opacity(0.15 + 0.85 * intensity)
    }

    private func help(day: Int, hour: Int) -> String {
        guard grid.count == 7, grid[day].count == 24 else { return "" }
        return "\(days[day]) \(hour):00 — \(ConstellationView.bytes(grid[day][hour])) out"
    }
}
