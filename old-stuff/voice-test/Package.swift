// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MeetingTranscriber",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        // Expose the app code as a library so SourceKit-LSP can index it
        .library(name: "MeetingTranscriber", targets: ["MeetingTranscriber"]) 
    ],
    targets: [
        .target(
            name: "MeetingTranscriber",
            path: "MeetingTranscriber-iOS/MeetingTranscriber",
            exclude: [
                // Exclude app entry point and resources that aren't needed for indexing
                "MeetingTranscriberApp.swift",
                "Info.plist",
                "Assets.xcassets"
            ]
        )
    ]
)






