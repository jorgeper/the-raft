### MeetingTranscriber iOS (SwiftUI)

Minimal, modern iPhone app for real-time meeting transcription with speaker diarization using Azure Speech.

#### Features
- Start/Pause/Stop with a single top-right button
- Real-time transcript stream filling the screen
- Designed for iOS Human Interface Guidelines

#### Prereqs
- Xcode 15+
- iOS 16+
- CocoaPods
- Azure Speech resource (key and region/endpoint)

#### Setup
1. Install CocoaPods if needed: `brew install cocoapods` (or `sudo gem install cocoapods`)
2. Install XcodeGen: `brew install xcodegen`
3. Create a `Podfile` in this directory (see below) and run `pod install`.
4. Generate the project: `xcodegen generate`
5. Open `MeetingTranscriber-iOS/MeetingTranscriber.xcworkspace` in Xcode.

#### Podfile template
```
platform :ios, '16.0'
use_frameworks!

target 'MeetingTranscriber' do
  pod 'MicrosoftCognitiveServicesSpeech-iOS'
end
```

Run:
```
pod install
```

Then open the generated `.xcworkspace`.

#### Configure credentials
Preferred: set from your terminal env and apply to the Xcode scheme via script.

1) Export env vars (put these in your shell profile to persist):
```bash
export AZURE_SPEECH_KEY=""   # add your key here
export AZURE_SPEECH_REGION="" # e.g. eastus
```

2) Apply to the scheme (writes the env vars into the Run → Environment Variables):
```bash
cd MeetingTranscriber-iOS
chmod +x Scripts/set_env.sh
./Scripts/set_env.sh
```

The script will try to find the `.xcscheme` automatically. You can also pass it explicitly:
```bash
./Scripts/set_env.sh MeetingTranscriber.xcodeproj/xcshareddata/xcschemes/MeetingTranscriber.xcscheme
```

Alternative (manual): In Xcode → Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables add:
- `SPEECH_KEY` = your Azure Speech key
- `SPEECH_REGION` = your Azure region (e.g. `eastus`)

#### Wiring Azure Speech SDK
This template includes `AzureTranscriber.swift` wired to `TranscriptManager`. After pods install, the SDK is used automatically.

Refer: Microsoft Docs "Real-time diarization quickstart" for event names and properties.

#### Build & Run
```bash
cd MeetingTranscriber-iOS
xcodegen generate
pod install --repo-update
open MeetingTranscriber.xcworkspace
```
Then Product → Clean Build Folder (first time), Build/Run.

