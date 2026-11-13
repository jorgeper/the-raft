import SwiftUI

struct PiggyBankListView: View {
    @State private var kids: [Kid] = []
    @Environment(\.theme) private var theme
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: theme.itemSpacing) {
                    ForEach(kids) { kid in
                        PiggyBankCardView(kid: kid)
                            .padding(.horizontal, theme.cardPadding)
                    }
                }
                .padding(.vertical, theme.sectionSpacing)
            }
            .background(theme.backgroundColor)
        }
        .onAppear {
            loadKidsData()
        }
    }
    
    private func loadKidsData() {
        print("🔍 DEBUG: loadKidsData() called")
        print("🔍 DEBUG: Bundle path: \(Bundle.main.bundlePath)")
        
        guard let url = Bundle.main.url(forResource: "kids-data", withExtension: "json") else {
            // TODO: Implement better error handling - show user-friendly error message
            print("❌ DEBUG: Failed to locate kids-data.json")
            print("🔍 DEBUG: Trying to list all bundle resources...")
            if let resourcePath = Bundle.main.resourcePath {
                do {
                    let items = try FileManager.default.contentsOfDirectory(atPath: resourcePath)
                    print("📁 DEBUG: Bundle contents: \(items)")
                } catch {
                    print("❌ DEBUG: Failed to list bundle contents: \(error)")
                }
            }
            return
        }
        
        print("✅ DEBUG: Found JSON file at: \(url)")
        
        do {
            let data = try Data(contentsOf: url)
            print("✅ DEBUG: Loaded data, size: \(data.count) bytes")
            
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            kids = try decoder.decode([Kid].self, from: data)
            print("✅ DEBUG: Successfully decoded \(kids.count) kids")
            for kid in kids {
                print("  👶 DEBUG: \(kid.name) - $\(kid.balance)")
            }
        } catch {
            // TODO: Implement better error handling - show user-friendly error message
            print("❌ DEBUG: Failed to load or decode kids data: \(error)")
            print("🔍 DEBUG: Error details: \(error.localizedDescription)")
        }
    }
}

struct PiggyBankListView_Previews: PreviewProvider {
    static var previews: some View {
        PiggyBankListView()
    }
}